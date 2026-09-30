const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");

const resendApiKey = defineSecret("RESEND_API_KEY");

initializeApp();
const db = getFirestore();

let _bucket = null;
function getBucket() {
  if (!_bucket) _bucket = getStorage().bucket();
  return _bucket;
}

const DISPUTE_RATE_LIMIT = 10;
const DISPUTE_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = [
  "https://friends-and-family-billing.web.app",
  "https://friends-and-family-billing.firebaseapp.com",
];

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

const { computeMemberSummary, buildPendingChargesForShare, buildPaymentHistoryForShare, projectMemberDisputes, getServiceCreditTotalForMember, buildServiceCreditsForShare, getHouseholdOpeningBalance } = require("./billing");

const EVIDENCE_URL_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function appendAuditLog(ownerId, entry) {
  return db
    .collection("users")
    .doc(ownerId)
    .collection("auditLog")
    .add({
      ...entry,
      timestamp: FieldValue.serverTimestamp(),
    })
    .catch((err) => console.error("Audit log write failed:", err));
}

const APP_ORIGIN = "https://friends-and-family-billing.web.app";

/**
 * Marker on mailQueue docs written by these Cloud Functions (Admin SDK). The
 * Firestore rules only let clients create docs with a fixed plain-field
 * allowlist, so a client can never set `origin` — processMailQueue uses it to
 * skip the client-sender checks for server-originated notifications.
 */
const MAIL_ORIGIN_SERVER = "server";

/** Enqueue an email via Firestore mailQueue. Logs errors, never throws. Must be awaited in HTTP functions. */
async function queueEmailFromFunction(to, subject, body, uid) {
  try {
    await db
      .collection("mailQueue")
      .add({
        to,
        subject,
        body,
        uid,
        origin: MAIL_ORIGIN_SERVER,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.error("queueEmailFromFunction failed:", err);
  }
}

/** Look up a family member's contact info from the billing year doc. */
async function getMemberContact(ownerId, billingYearId, memberId) {
  try {
    const yearDoc = await db
      .collection("users")
      .doc(ownerId)
      .collection("billingYears")
      .doc(billingYearId)
      .get();
    if (!yearDoc.exists) return null;
    const members = yearDoc.data().familyMembers || [];
    const member = members.find((m) => m.id === memberId);
    return member ? { name: member.name, email: member.email || null } : null;
  } catch (err) {
    console.error("getMemberContact failed:", err);
    return null;
  }
}

/**
 * Find an active share token with disputes:read scope for a specific billing year + member.
 * Returns the rawToken string if found, null otherwise.
 */
async function findActiveDisputeShareToken(ownerId, billingYearId, memberId) {
  try {
    const snap = await db
      .collection("shareTokens")
      .where("ownerId", "==", ownerId)
      .where("memberId", "==", memberId)
      .where("revoked", "==", false)
      .get();
    const now = new Date();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (!data.rawToken) continue;
      if (data.billingYearId !== billingYearId) continue;
      const scopes = data.scopes || [];
      if (!scopes.includes("disputes:read")) continue;
      if (data.expiresAt) {
        const expiry = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
        if (expiry < now) continue;
      }
      return data.rawToken;
    }
    return null;
  } catch (err) {
    console.error("findActiveDisputeShareToken failed:", err);
    return null;
  }
}

exports.resolveShareToken = onRequest({ region: "us-central1" }, async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, refreshOnly } = req.body || {};
  if (!token || typeof token !== "string" || token.length < 32) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }

  try {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenDoc = await db.collection("shareTokens").doc(hash).get();

    if (!tokenDoc.exists) {
      res.status(404).json({ error: "This link is invalid or has been removed." });
      return;
    }

    const tokenData = tokenDoc.data();

    if (tokenData.revoked) {
      res.status(403).json({ error: "This link has been revoked by the account owner.", canRequestLink: true, tokenHash: hash });
      return;
    }

    if (tokenData.expiresAt) {
      const expiry = tokenData.expiresAt.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt);
      if (expiry < new Date()) {
        res.status(403).json({ error: "This link has expired.", canRequestLink: true, tokenHash: hash });
        return;
      }
    }

    const yearDoc = await db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .get();

    if (!yearDoc.exists) {
      res.status(404).json({ error: "Billing data not found." });
      return;
    }

    const yearData = yearDoc.data();
    const familyMembers = (yearData.familyMembers || []).map((m) => {
      if (!m.linkedMembers) m.linkedMembers = [];
      return m;
    });
    const billsData = (yearData.bills || []).map((b) => {
      if (!b.members) b.members = [];
      return b;
    });
    const payments = yearData.payments || [];
    const yearSettings = yearData.settings || {};

    const primarySummary = computeMemberSummary(familyMembers, billsData, tokenData.memberId);
    if (!primarySummary) {
      res.status(404).json({ error: "Member not found in billing data." });
      return;
    }

    const primaryMember = familyMembers.find((m) => m.id === tokenData.memberId);
    const linkedIds = primaryMember.linkedMembers || [];
    const linkedSummaries = linkedIds
      .map((id) => computeMemberSummary(familyMembers, billsData, id))
      .filter(Boolean);

    const paymentTotal = payments
      .filter((p) => p.memberId === tokenData.memberId)
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    let combinedAnnual = primarySummary.annualTotal;
    let combinedPayment = paymentTotal;

    linkedSummaries.forEach((ls) => {
      combinedAnnual += ls.annualTotal;
      combinedPayment += payments
        .filter((p) => p.memberId === ls.memberId)
        .reduce((sum, p) => sum + (p.amount || 0), 0);
    });

    // Compose the member-facing owed exactly as buildPublicShareData (the React writer)
    // and getHouseholdFinancials do: active Service Credits (#321) lower owed and the
    // netted carried opening balance (carry_opening seeds, #322 — a carried credit is
    // negative, a carried charge positive, summed across the primary + linked members)
    // adjusts it, the combined result floored at 0. This Cloud Function fallback — used
    // by ShareView on cache miss / stale-refresh and self-healed back
    // into publicShares — must agree with the React writer and never persist an uncarried
    // (or gross) total. carry_opening is a distinct kind, so the service-credit helper
    // ignores it — no double-count.
    const owedAdjustments = yearData.owedAdjustments || [];
    const serviceCreditTotal = getServiceCreditTotalForMember(owedAdjustments, tokenData.memberId)
      + linkedIds.reduce((s, id) => s + getServiceCreditTotalForMember(owedAdjustments, id), 0);
    const openingBalance = getHouseholdOpeningBalance(primaryMember, owedAdjustments);
    combinedAnnual = Math.max(0, combinedAnnual - serviceCreditTotal + openingBalance);

    // Skip access increment and audit log on background refreshes (refreshOnly)
    // to avoid double-counting when the client already incremented publicShares.
    if (!refreshOnly) {
      tokenDoc.ref
        .update({
          lastAccessedAt: FieldValue.serverTimestamp(),
          accessCount: FieldValue.increment(1),
        })
        .catch(() => {});

      appendAuditLog(tokenData.ownerId, {
        action: "share_link_accessed",
        tokenHash: hash,
        memberId: tokenData.memberId,
        billingYearId: tokenData.billingYearId,
        ip: req.ip || null,
      });
    }

    const scopes = tokenData.scopes || ["summary:read", "paymentMethods:read"];
    const result = {
      memberName: primarySummary.name,
      memberId: tokenData.memberId,
      billingYearId: tokenData.billingYearId,
      ownerId: tokenData.ownerId,
      year: yearData.label || tokenData.billingYearId,
      scopes: scopes,
    };

    if (scopes.includes("summary:read")) {
      result.summary = primarySummary;
      result.linkedMembers = linkedSummaries;
      result.paymentSummary = {
        combinedAnnualTotal: Math.round(combinedAnnual * 100) / 100,
        combinedMonthlyTotal: Math.round((combinedAnnual / 12) * 100) / 100,
        totalPaid: Math.round(combinedPayment * 100) / 100,
        balanceRemaining: Math.round((combinedAnnual - combinedPayment) * 100) / 100,
      };
      // Member-safe Service Credit line items (#337) so the cache-miss / self-healed
      // doc explains the reduced combinedAnnualTotal exactly as the React writer does.
      const serviceCredits = buildServiceCreditsForShare(billsData, owedAdjustments, tokenData.memberId, linkedIds);
      if (serviceCredits.total > 0) {
        result.serviceCredits = serviceCredits;
      }
    }

    if (scopes.includes("paymentMethods:read") || scopes.includes("paymentLinks:read")) {
      result.paymentLinks = yearSettings.paymentLinks || [];
      result.paymentMethods = (yearSettings.paymentMethods || []).filter(
        (m) => m.enabled
      );
    }

    if (scopes.includes("disputes:read")) {
      const disputesSnap = await db
        .collection("users")
        .doc(tokenData.ownerId)
        .collection("billingYears")
        .doc(tokenData.billingYearId)
        .collection("disputes")
        .where("memberId", "==", tokenData.memberId)
        .get();

      // Refund Notices (#319) and Charge Notices (#320) share this subcollection but
      // are outbound Requests, not Review Requests — projectMemberDisputes excludes
      // both kinds so a normal disputes:read link never renders them as empty
      // Review Requests (ADR 0002, ADR 0005).
      result.disputes = projectMemberDisputes(
        disputesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      );
    }

    // Refund Notices (#319) — outbound Requests sharing the disputes subcollection.
    // Member sees only THEIR OWN notices (ADR 0005); the CF filters by memberId.
    if (scopes.includes("refunds:read")) {
      const refundSnap = await db
        .collection("users")
        .doc(tokenData.ownerId)
        .collection("billingYears")
        .doc(tokenData.billingYearId)
        .collection("disputes")
        .where("kind", "==", "refund_notice")
        .where("memberId", "==", tokenData.memberId)
        .get();

      const refundDocs = refundSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      result.refundNotices = filterMemberRefundNotices(refundDocs, tokenData.memberId);
    }

    // Deferred Usage Charges (#317): the member's NOT-YET-DUE pending charges,
    // gated behind the usageCharges:read scope. Sourced from the year document's
    // owedAdjustments[] array (already loaded above), filtered to this token
    // member and to deferred status only. Member-safe fields only; never touches owed.
    if (scopes.includes("usageCharges:read")) {
      result.pendingCharges = buildPendingChargesForShare(
        familyMembers,
        owedAdjustments,
        tokenData.memberId
      );
    }

    // Member-safe payment history (#356) for the household (primary + linked),
    // gated behind payments:read. Mirrors buildPublicShareData (the React writer)
    // so the cache-hit, cache-miss, and self-healed publicShares doc all agree.
    if (scopes.includes("payments:read")) {
      result.paymentHistory = buildPaymentHistoryForShare(
        payments,
        [tokenData.memberId, ...linkedIds]
      );
    }

    // Self-heal: recreate publicShares doc for future direct Firestore reads.
    // publicShares is the single source of truth for view counts.
    //
    // On refreshOnly (stale-cache background refresh): the client already
    // incremented publicShares.accessCount, so we must NOT overwrite those
    // fields. Use merge:true and omit accessCount/lastAccessedAt to preserve
    // the client-written values while refreshing billing data.
    //
    // On cache-miss (non-refreshOnly): this is the first write to publicShares,
    // so we include access metrics seeded from shareTokens + 1 for the
    // current visit.
    const publicShareData = {
      memberName: result.memberName,
      memberId: tokenData.memberId,
      billingYearId: tokenData.billingYearId,
      year: result.year,
      scopes: scopes,
      ownerId: tokenData.ownerId,
      // Mirror token validity fields so the client can validate expiry
      // without reading owner-only shareTokens.
      expiresAt: tokenData.expiresAt || null,
      revoked: false,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!refreshOnly) {
      // Cache-miss: seed access metrics from shareTokens + current visit
      publicShareData.accessCount = (tokenData.accessCount || 0) + 1;
      publicShareData.lastAccessedAt = FieldValue.serverTimestamp();
    }
    if (result.summary) {
      publicShareData.summary = result.summary;
      publicShareData.linkedMembers = result.linkedMembers || [];
      publicShareData.paymentSummary = result.paymentSummary;
      // Always reconcile serviceCredits within the summary so a refresh that drops the
      // household's credits to zero CLEARS a stale value left behind by merge:true (the
      // field is omitted only when there are none). FieldValue.delete() is a no-op when
      // the field is already absent.
      publicShareData.serviceCredits = result.serviceCredits || FieldValue.delete();
    }
    if (result.paymentMethods) {
      publicShareData.paymentMethods = result.paymentMethods;
    }
    if (result.pendingCharges) {
      publicShareData.pendingCharges = result.pendingCharges;
    }
    if (result.paymentHistory) {
      publicShareData.paymentHistory = result.paymentHistory;
    }
    // merge:true ensures refreshOnly writes don't clobber accessCount/lastAccessedAt
    db.collection("publicShares").doc(hash).set(publicShareData, { merge: true }).catch((err) => {
      console.error("Failed to self-heal publicShares:", err);
    });

    res.status(200).json(result);
  } catch (err) {
    console.error("resolveShareToken error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

function validateToken(token) {
  if (!token || typeof token !== "string" || token.length < 32) {
    return { valid: false, status: 400, error: "Invalid token" };
  }
  return { valid: true };
}

function validateDisputeInput({ billId, billName, message, proposedCorrection }) {
  if (typeof billId !== "number" || !billName || typeof billName !== "string") {
    return { valid: false, status: 400, error: "Missing or invalid bill information." };
  }
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return { valid: false, status: 400, error: "A message is required." };
  }
  if (message.length > 2000) {
    return { valid: false, status: 400, error: "Message is too long (max 2000 characters)." };
  }
  if (proposedCorrection && typeof proposedCorrection === "string" && proposedCorrection.length > 500) {
    return { valid: false, status: 400, error: "Proposed correction is too long (max 500 characters)." };
  }
  return { valid: true };
}

/**
 * Find the bill a share-page member may dispute: it must exist in the billing
 * year and list the token's member. Returns the bill or null.
 */
function findDisputableBill(yearData, billId, memberId) {
  const bills = (yearData && Array.isArray(yearData.bills)) ? yearData.bills : [];
  const bill = bills.find((b) => b && b.id === billId);
  if (!bill || !Array.isArray(bill.members) || !bill.members.includes(memberId)) return null;
  return bill;
}

/**
 * Evidence files live under users/{ownerId}/disputes/{disputeId}/ (see
 * useDisputes.js and storage.rules). Only sign a URL for an object inside the
 * token owner's folder for this exact dispute.
 */
function isEvidencePathForDispute(storagePath, ownerId, disputeId) {
  if (typeof storagePath !== "string" || !ownerId || !disputeId) return false;
  const prefix = "users/" + ownerId + "/disputes/" + disputeId + "/";
  return storagePath.startsWith(prefix) && storagePath.length > prefix.length;
}

const LINK_REQUEST_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Refund Notice (#319) ────────────────────────────────────────────────────
//
// A Refund Notice is an OUTBOUND Request riding the shared `disputes`
// subcollection as a distinct KIND (ADR 0002). Members confirm receipt or report
// non-receipt via submitRefundConfirmation — they never write Firestore directly.

const REFUND_NOTICE_KIND = "refund_notice";

/** Map the wire `outcome` to the stored confirmation state. Returns null for unknown. */
function refundConfirmationOutcome(outcome) {
  if (outcome === "confirm") return "confirmed_by_member";
  if (outcome === "not_received") return "not_received";
  return null;
}

/**
 * Validate a submitRefundConfirmation request body. Only `confirm` and
 * `not_received` are accepted — never the Review Request vocabulary or any
 * other field name (members cannot write arbitrary fields).
 */
function validateRefundConfirmationInput({ noticeId, outcome }) {
  if (!noticeId || typeof noticeId !== "string") {
    return { valid: false, status: 400, error: "Missing refund notice ID." };
  }
  if (refundConfirmationOutcome(outcome) === null) {
    return { valid: false, status: 400, error: "Outcome must be 'confirm' or 'not_received'." };
  }
  return { valid: true };
}

/**
 * Project the token member's OWN Refund Notices for the share page.
 * ADR 0005 lesson: filter to the token member's memberId — NEVER expand to the
 * household. A refund is issued to the primary, so it appears on the primary's
 * share only. Only presentational fields are returned (tokenHash never leaks).
 *
 * @param {Array<Object>} docs — raw notice/dispute docs (with an `id`)
 * @param {number} memberId — the share token's member
 * @returns {Array<Object>}
 */
function filterMemberRefundNotices(docs, memberId) {
  return (docs || [])
    .filter((d) => d && d.kind === REFUND_NOTICE_KIND && d.memberId === memberId)
    .map((d) => ({
      id: d.id,
      memberId: d.memberId,
      amount: d.amount,
      method: d.method || null,
      reason: d.reason || null,
      confirmation: d.confirmation || null,
      resolution: d.resolution ? { type: d.resolution.type } : null,
      createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString()
        : (typeof d.createdAt === "string" ? d.createdAt : null),
      confirmedAt: d.confirmedAt && d.confirmedAt.toDate ? d.confirmedAt.toDate().toISOString()
        : (typeof d.confirmedAt === "string" ? d.confirmedAt : null),
    }));
}

exports._testHelpers = {
  validateToken,
  validateDisputeInput,
  findDisputableBill,
  isEvidencePathForDispute,
  validateRefundConfirmationInput,
  filterMemberRefundNotices,
  refundConfirmationOutcome,
  REFUND_NOTICE_KIND,
  DISPUTE_RATE_LIMIT,
  EVIDENCE_URL_EXPIRY_MS,
  LINK_REQUEST_RATE_WINDOW_MS,
};

/**
 * requestShareLink — allows a member visiting an expired/revoked link to
 * request the admin generate a new one. Rate-limited to 1 request per
 * tokenHash per 24 hours.
 */
exports.requestShareLink = onRequest({ region: "us-central1" }, async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { tokenHash } = req.body || {};
  if (!tokenHash || typeof tokenHash !== "string" || tokenHash.length < 32) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }

  try {
    const tokenRef = db.collection("shareTokens").doc(tokenHash);

    // Rate limit: 1 request per tokenHash per 24 hours. The check and the
    // lastLinkRequestedAt stamp run in one transaction so concurrent requests
    // cannot both pass the check.
    const outcome = await db.runTransaction(async (tx) => {
      const tokenDoc = await tx.get(tokenRef);
      if (!tokenDoc.exists) return { status: 404, error: "Link not found." };

      const data = tokenDoc.data();
      if (data.lastLinkRequestedAt) {
        const lastRequested = data.lastLinkRequestedAt.toDate
          ? data.lastLinkRequestedAt.toDate()
          : new Date(data.lastLinkRequestedAt);
        if (Date.now() - lastRequested.getTime() < LINK_REQUEST_RATE_WINDOW_MS) {
          return { status: 429, error: "A request was already sent recently. Please wait before trying again." };
        }
      }

      tx.update(tokenRef, { lastLinkRequestedAt: FieldValue.serverTimestamp() });
      return { ok: true, tokenData: data };
    });

    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }

    const { tokenData } = outcome;

    // Send email to admin
    const adminUser = await getAuth().getUser(tokenData.ownerId);
    if (adminUser.email) {
      const memberName = tokenData.memberName || "A member";
      const year = tokenData.billingYearId || "unknown";
      const nSubject = "Link Request\u2014" + memberName + " needs a new billing summary link";
      let nBody = memberName + " tried to access their " + year + " billing summary but the link has expired or been revoked.\n\n";
      nBody += "Generate a new link from the Dashboard.\n\n";
      nBody += "[Open Dashboard](" + APP_ORIGIN + "/app/)";
      await queueEmailFromFunction(adminUser.email, nSubject, nBody, tokenData.ownerId);
    }

    res.status(200).json({ message: "Request sent. The account owner will be notified." });
  } catch (err) {
    console.error("requestShareLink error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

async function resolveAndValidateToken(token, requiredScope) {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const tokenDoc = await db.collection("shareTokens").doc(hash).get();

  if (!tokenDoc.exists) {
    return { ok: false, status: 404, error: "This link is invalid or has been removed." };
  }

  const tokenData = tokenDoc.data();

  if (tokenData.revoked) {
    return { ok: false, status: 403, error: "This link has been revoked by the account owner." };
  }

  if (tokenData.expiresAt) {
    const expiry = tokenData.expiresAt.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt);
    if (expiry < new Date()) {
      return { ok: false, status: 403, error: "This link has expired." };
    }
  }

  const scopes = tokenData.scopes || [];
  if (!scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: "This link does not have permission to perform this action." };
  }

  return { ok: true, tokenData, tokenHash: hash, tokenDoc };
}

exports.submitDispute = onRequest({ region: "us-central1" }, async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, billId, billName, message, proposedCorrection } = req.body || {};

  const tokenCheck = validateToken(token);
  if (!tokenCheck.valid) {
    res.status(tokenCheck.status).json({ error: tokenCheck.error });
    return;
  }

  const inputCheck = validateDisputeInput({ billId, billName, message, proposedCorrection });
  if (!inputCheck.valid) {
    res.status(inputCheck.status).json({ error: inputCheck.error });
    return;
  }

  try {
    const result = await resolveAndValidateToken(token, "disputes:create");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const { tokenData, tokenHash } = result;

    const yearDoc = await db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .get();

    // The bill must exist in the token's billing year and include the token's
    // member. A missing year is a not-found, never a skipped membership check.
    if (!yearDoc.exists) {
      res.status(404).json({ error: "Billing year not found." });
      return;
    }

    const targetBill = findDisputableBill(yearDoc.data(), billId, tokenData.memberId);
    if (!targetBill) {
      res.status(403).json({ error: "You are not assigned to this bill." });
      return;
    }

    // Store and email the server-side bill name; the client-supplied billName
    // is only validated for shape and never persisted.
    const serverBillName = typeof targetBill.name === "string" ? targetBill.name.trim() : "";

    const disputesRef = db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .collection("disputes");

    const dispute = {
      memberId: tokenData.memberId,
      memberName: tokenData.memberName || "",
      billId: billId,
      billName: serverBillName,
      message: message.trim(),
      proposedCorrection: proposedCorrection ? proposedCorrection.trim() : null,
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      tokenHash: tokenHash,
    };

    // Rate-limit check and create run in one transaction so concurrent
    // submissions cannot all pass the count check.
    const cutoff = Timestamp.fromDate(new Date(Date.now() - DISPUTE_RATE_WINDOW_MS));
    const docRef = disputesRef.doc();
    const created = await db.runTransaction(async (tx) => {
      const recentSnap = await tx.get(
        disputesRef
          .where("tokenHash", "==", tokenHash)
          .where("createdAt", ">", cutoff)
      );
      if (recentSnap.size >= DISPUTE_RATE_LIMIT) return false;
      tx.create(docRef, dispute);
      return true;
    });

    if (!created) {
      res.status(429).json({ error: "Too many review requests. Please try again later." });
      return;
    }

    appendAuditLog(tokenData.ownerId, {
      action: "dispute_submitted",
      disputeId: docRef.id,
      memberId: tokenData.memberId,
      billId: billId,
      billingYearId: tokenData.billingYearId,
      ip: req.ip || null,
    });

    // Notification 1: email admin that a new dispute was submitted
    try {
      const adminUser = await getAuth().getUser(tokenData.ownerId);
      if (adminUser.email) {
        const nSubject = "Review Request\u2014" + serverBillName + " from " + (tokenData.memberName || "a member");
        let nBody = "**" + (tokenData.memberName || "A member") + "** submitted a review request for **" + serverBillName + "**.\n\n";
        nBody += "**Message:** " + message.trim() + "\n";
        if (proposedCorrection) nBody += "**Proposed correction:** " + proposedCorrection.trim() + "\n";
        nBody += "\n[View Review Requests](" + APP_ORIGIN + "/app/manage/reviews)";
        await queueEmailFromFunction(adminUser.email, nSubject, nBody, tokenData.ownerId);
      }
    } catch (emailErr) {
      console.error("Notification 1 (dispute submitted) failed:", emailErr);
    }

    res.status(201).json({ id: docRef.id, message: "Review request submitted successfully." });
  } catch (err) {
    console.error("submitDispute error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

exports.getEvidenceUrl = onRequest({ region: "us-central1" }, async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, disputeId, evidenceIndex } = req.body || {};

  const tokenCheck = validateToken(token);
  if (!tokenCheck.valid) {
    res.status(tokenCheck.status).json({ error: tokenCheck.error });
    return;
  }

  if (!disputeId || typeof disputeId !== "string") {
    res.status(400).json({ error: "Missing dispute ID." });
    return;
  }

  if (typeof evidenceIndex !== "number" || evidenceIndex < 0) {
    res.status(400).json({ error: "Invalid evidence index." });
    return;
  }

  try {
    const result = await resolveAndValidateToken(token, "disputes:read");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const { tokenData } = result;

    const disputeDoc = await db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .collection("disputes")
      .doc(disputeId)
      .get();

    if (!disputeDoc.exists) {
      res.status(404).json({ error: "Dispute not found." });
      return;
    }

    const disputeData = disputeDoc.data();

    if (disputeData.memberId !== tokenData.memberId) {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    const evidence = disputeData.evidence || [];
    if (evidenceIndex >= evidence.length) {
      res.status(404).json({ error: "Evidence not found." });
      return;
    }

    const ev = evidence[evidenceIndex];
    if (!ev || !isEvidencePathForDispute(ev.storagePath, tokenData.ownerId, disputeId)) {
      res.status(404).json({ error: "Evidence not found." });
      return;
    }
    const file = getBucket().file(ev.storagePath);

    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + EVIDENCE_URL_EXPIRY_MS,
    });

    appendAuditLog(tokenData.ownerId, {
      action: "evidence_accessed",
      disputeId: disputeId,
      evidenceIndex: evidenceIndex,
      memberId: tokenData.memberId,
      billingYearId: tokenData.billingYearId,
      ip: req.ip || null,
    });

    res.status(200).json({ url });
  } catch (err) {
    console.error("getEvidenceUrl error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

exports.submitDisputeDecision = onRequest({ region: "us-central1" }, async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, disputeId, decision, note } = req.body || {};

  const tokenCheck = validateToken(token);
  if (!tokenCheck.valid) {
    res.status(tokenCheck.status).json({ error: tokenCheck.error });
    return;
  }

  if (!disputeId || typeof disputeId !== "string") {
    res.status(400).json({ error: "Missing dispute ID." });
    return;
  }

  if (decision !== "approve" && decision !== "reject") {
    res.status(400).json({ error: "Decision must be 'approve' or 'reject'." });
    return;
  }

  if (decision === "reject" && (!note || typeof note !== "string" || note.trim().length === 0)) {
    res.status(400).json({ error: "A note is required when rejecting." });
    return;
  }

  if (note && typeof note === "string" && note.length > 2000) {
    res.status(400).json({ error: "Note is too long (max 2000 characters)." });
    return;
  }

  try {
    const result = await resolveAndValidateToken(token, "disputes:read");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const { tokenData } = result;

    const disputeRef = db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .collection("disputes")
      .doc(disputeId);

    // Read-check-write in one transaction so two concurrent decisions cannot
    // both observe `requested` and both write.
    const outcome = await db.runTransaction(async (tx) => {
      const disputeDoc = await tx.get(disputeRef);
      if (!disputeDoc.exists) return { status: 404, body: { error: "Dispute not found." } };

      const data = disputeDoc.data();
      if (data.memberId !== tokenData.memberId) {
        return { status: 403, body: { error: "Access denied." } };
      }

      const currentState = data.userReview ? data.userReview.state : null;
      if (currentState === "approved_by_user" || currentState === "rejected_by_user") {
        return { status: 200, body: { message: "Decision already recorded.", alreadyDecided: true } };
      }
      if (currentState !== "requested") {
        return { status: 400, body: { error: "This dispute is not awaiting your decision." } };
      }

      if (decision === "approve") {
        tx.update(disputeRef, {
          status: "resolved",
          "userReview.state": "approved_by_user",
          "userReview.decidedAt": FieldValue.serverTimestamp(),
          resolvedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.update(disputeRef, {
          status: "open",
          "userReview.state": "rejected_by_user",
          "userReview.rejectionNote": note.trim(),
          "userReview.decidedAt": FieldValue.serverTimestamp(),
          resolutionNotificationSentAt: FieldValue.delete(),
        });
      }
      return { ok: true, disputeData: data };
    });

    if (!outcome.ok) {
      res.status(outcome.status).json(outcome.body);
      return;
    }

    const { disputeData } = outcome;

    appendAuditLog(tokenData.ownerId, {
      action: "dispute_decision",
      disputeId: disputeId,
      decision: decision,
      memberId: tokenData.memberId,
      billingYearId: tokenData.billingYearId,
      ip: req.ip || null,
    });

    // Notification 3: email admin with the member's decision
    try {
      const adminUser = await getAuth().getUser(tokenData.ownerId);
      if (adminUser.email) {
        const decisionWord = decision === "approve" ? "Approved" : "Rejected";
        const nSubject = "Resolution " + decisionWord + "\u2014" + disputeData.billName + " by " + (tokenData.memberName || "member");
        let nBody = "**" + (tokenData.memberName || "The member") + "** has **" + decisionWord.toLowerCase() + "** the resolution for **" + disputeData.billName + "**.\n\n";
        if (decision === "reject" && note) {
          nBody += "**Rejection note:** " + note.trim() + "\n\n";
          nBody += "The dispute has been reopened.\n\n";
        }
        nBody += "[View Review Requests](" + APP_ORIGIN + "/app/manage/reviews)";
        await queueEmailFromFunction(adminUser.email, nSubject, nBody, tokenData.ownerId);
      }
    } catch (emailErr) {
      console.error("Notification 3 (user decision) failed:", emailErr);
    }

    // Notification 4: on reject, confirm to member that dispute is reopened
    if (decision === "reject") {
      try {
        const memberInfo = await getMemberContact(tokenData.ownerId, tokenData.billingYearId, tokenData.memberId);
        if (memberInfo && memberInfo.email) {
          const nSubject = "Review Request Reopened\u2014" + disputeData.billName;
          let nBody = "Hi " + memberInfo.name + ",\n\n";
          nBody += "You rejected the proposed resolution for **" + disputeData.billName + "**, so it has been reopened for further review.\n\n";
          nBody += "**Your note:** " + note.trim() + "\n\n";
          const rawToken = await findActiveDisputeShareToken(tokenData.ownerId, tokenData.billingYearId, tokenData.memberId);
          if (rawToken) {
            nBody += "[View your billing summary](" + APP_ORIGIN + "/share?token=" + rawToken + ")\n\n";
          } else {
            nBody += "Use your existing billing share link or contact the account owner.\n\n";
          }
          nBody += "The account owner will follow up with you.";
          await queueEmailFromFunction(memberInfo.email, nSubject, nBody, tokenData.ownerId);
        }
      } catch (emailErr) {
        console.error("Notification 4 (reopened) failed:", emailErr);
      }
    }

    res.status(200).json({ message: "Decision recorded successfully." });
  } catch (err) {
    console.error("submitDisputeDecision error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

/**
 * submitRefundConfirmation (#319) — the member's advisory response to a Refund
 * Notice. Records `confirmed_by_member` or `not_received` on the member's OWN
 * refund_notice Request. Confirmation does NOT change settlement (the
 * creditAdjustment already cleared the gate in #318, ADR 0003). An active
 * `not_received` surfaces to the admin as a follow-up.
 *
 * SECURITY (HIGH-RISK, mirrors submitDisputeDecision):
 * - requires a valid, unexpired, non-revoked share token with the refunds:read scope
 * - only writes a notice whose memberId === the token's memberId (no household reach)
 * - only ever writes confirmation/confirmedAt — never arbitrary fields
 * - idempotent: a second submit is a no-op once a confirmation is recorded
 */
exports.submitRefundConfirmation = onRequest({ region: "us-central1" }, async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token, noticeId, outcome } = req.body || {};

  const tokenCheck = validateToken(token);
  if (!tokenCheck.valid) {
    res.status(tokenCheck.status).json({ error: tokenCheck.error });
    return;
  }

  const inputCheck = validateRefundConfirmationInput({ noticeId, outcome });
  if (!inputCheck.valid) {
    res.status(inputCheck.status).json({ error: inputCheck.error });
    return;
  }

  try {
    const result = await resolveAndValidateToken(token, "refunds:read");
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    const { tokenData } = result;

    const noticeRef = db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .collection("disputes")
      .doc(noticeId);

    const newConfirmation = refundConfirmationOutcome(outcome);

    // Read-check-write in one transaction so two concurrent submissions cannot
    // both see "no confirmation yet" and both write (the confirmation is terminal).
    const txResult = await db.runTransaction(async (tx) => {
      const noticeDoc = await tx.get(noticeRef);
      if (!noticeDoc.exists) return { status: 404, body: { error: "Refund notice not found." } };

      const noticeData = noticeDoc.data();

      // Must be a Refund Notice (never let this CF mutate a Review Request).
      if (noticeData.kind !== REFUND_NOTICE_KIND) {
        return { status: 400, body: { error: "This is not a refund notice." } };
      }

      // Per-member scope (ADR 0005): only the member the notice belongs to may respond.
      if (noticeData.memberId !== tokenData.memberId) {
        return { status: 403, body: { error: "Access denied." } };
      }

      // Idempotent: a confirmation is terminal. A member who already responded
      // cannot flip the outcome (re-opening a not_received is the admin's job).
      if (noticeData.confirmation) {
        return { status: 200, body: { message: "Response already recorded.", alreadyRecorded: true } };
      }

      // Only ever write the confirmation fields — never anything else.
      tx.update(noticeRef, {
        confirmation: newConfirmation,
        confirmedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true };
    });

    if (!txResult.ok) {
      res.status(txResult.status).json(txResult.body);
      return;
    }

    appendAuditLog(tokenData.ownerId, {
      action: "refund_confirmation",
      noticeId: noticeId,
      outcome: newConfirmation,
      memberId: tokenData.memberId,
      billingYearId: tokenData.billingYearId,
      ip: req.ip || null,
    });

    // Notify the admin — a not_received is an actionable follow-up.
    try {
      const adminUser = await getAuth().getUser(tokenData.ownerId);
      if (adminUser.email) {
        const memberName = tokenData.memberName || "A member";
        if (newConfirmation === "not_received") {
          const nSubject = "Refund Not Received—" + memberName;
          let nBody = "**" + memberName + "** reported they have **not received** their refund.\n\n";
          nBody += "Follow up by re-sending the refund, cancelling it, or dismissing the report with a reason.\n\n";
          nBody += "[Open Dashboard](" + APP_ORIGIN + "/app/)";
          await queueEmailFromFunction(adminUser.email, nSubject, nBody, tokenData.ownerId);
        } else {
          const nSubject = "Refund Confirmed—" + memberName;
          let nBody = "**" + memberName + "** confirmed they received their refund.\n\n";
          nBody += "No further action is needed.";
          await queueEmailFromFunction(adminUser.email, nSubject, nBody, tokenData.ownerId);
        }
      }
    } catch (emailErr) {
      console.error("Refund confirmation notification failed:", emailErr);
    }

    res.status(200).json({ message: "Response recorded successfully." });
  } catch (err) {
    console.error("submitRefundConfirmation error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

// ── Send Email via Resend ──────────────────────────────────────────────────

const EMAIL_FROM = "Friends & Family Billing <billing@mail.nathanpayne.com>";

/**
 * Wrap plain-text or markdown-rendered HTML in a responsive email shell.
 * Uses inline CSS for maximum email client compatibility.
 */
function wrapEmailHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin: 0; padding: 0; background: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
  .header { background: linear-gradient(135deg, #6E78D6, #7B5FAF); padding: 24px 32px; color: #ffffff; }
  .header h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
  .body { padding: 24px 32px; color: #1F2430; font-size: 0.9375rem; line-height: 1.6; }
  .body p { margin: 0 0 1em 0; }
  .body a { color: #6E78D6; text-decoration: underline; }
  .body h2 { font-size: 1rem; margin: 1.5em 0 0.5em; color: #1F2430; }
  .body ul { padding-left: 1.5em; }
  .body li { margin-bottom: 0.3em; }
  .body pre, .body code { font-family: 'SF Mono', Menlo, monospace; font-size: 0.85em; }
  .footer { padding: 16px 32px; font-size: 0.75rem; color: #999; border-top: 1px solid #e0e0e0; }
</style>
</head>
<body>
<div style="padding: 24px 16px; background: #f4f5f7;">
  <div class="container">
    <div class="header"><h1>Friends &amp; Family Billing</h1></div>
    <div class="body">${bodyHtml}</div>
    <div class="footer">Sent via Friends &amp; Family Billing</div>
  </div>
</div>
</body>
</html>`;
}

/**
 * Sanitize a URL for use in an href attribute.
 * Blocks non-http(s) protocols (javascript:, data:, vbscript:, etc.)
 * and escapes quotes to prevent attribute breakout.
 */
function sanitizeHref(url) {
  // Reverse the earlier entity-escaping so we work on the raw URL
  let raw = (url || "").trim()
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  // Only allow http and https protocols
  if (!/^https?:\/\//i.test(raw)) return "";
  // Escape characters that could break out of the attribute context.
  // & is escaped ONLY in the attribute value — query strings stay valid
  // because the browser un-escapes &amp; back to & when following the href.
  return raw
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Minimal markdown-to-HTML for email bodies. Handles every construct the
 * invoice template serializer (src/lib/template-doc.js docToPlainTextWithTokens)
 * and the markdown invoice builders (src/lib/invoice.js) emit:
 *   **bold**, *italic* (and ***both***), [text](url) links, bare/www URLs,
 *   "## " headings, "- " bullet lists, "1. " ordered lists, "> " blockquotes,
 *   "---" / "===" rules, and newlines (<br>).
 * Backslash escapes (\\ \* \[ \] \- \. \> \# \=) — emitted by the template
 * serializer's markdown mode for literal text — render as the literal
 * character and never as syntax.
 * All input is HTML-escaped first; hrefs go through sanitizeHref().
 */
const MD_ESCAPE_OPEN = "\uE000";
const MD_ESCAPE_CLOSE = "\uE001";

function simpleMarkdownToHtml(text) {
  if (!text) return "";
  let html = text
    // Private-use placeholder delimiters are reserved for escapes below.
    .replace(/[\uE000\uE001]/g, "")
    // Backslash escapes → opaque placeholders (hex char code) that no markdown
    // rule matches; restored as literal (HTML-escaped) characters at the end.
    .replace(/\\([\\*[\]\-.>#=])/g, (_, ch) => MD_ESCAPE_OPEN + ch.charCodeAt(0).toString(16) + MD_ESCAPE_CLOSE)
    // Escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic (single asterisks left after bold). The content must start and
    // end with a non-space so arithmetic like "2 * 3 * 4" is left alone.
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, "<em>$1</em>")
    // Headings (## Heading)
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    // Links [text](url) — sanitize href to prevent XSS
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, linkText, url) {
      const safe = sanitizeHref(url);
      if (!safe) return linkText;
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + linkText + '</a>';
    })
    // Bare URLs (not already in an <a> tag) — already http(s) by regex
    .replace(/(?<!href="|">)(https?:\/\/[^\s<"']+)/g, function(url) {
      const safe = sanitizeHref(url);
      if (!safe) return url;
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + safe + '</a>';
    })
    // www. URLs without protocol (not already inside an <a> tag or its link text)
    .replace(/(?<!href="|"|\/\/|<a [^>]*>(?:[^<]*))(www\.[^\s<"']+)/g, function(match, url, offset, str) {
      // Skip if we're inside an <a>...</a> tag (i.e., this is already link text)
      const before = str.substring(0, offset);
      const lastOpenA = before.lastIndexOf('<a ');
      const lastCloseA = before.lastIndexOf('</a>');
      if (lastOpenA > lastCloseA) return match;
      const safe = sanitizeHref("https://" + url);
      if (!safe) return url;
      return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    })
    // An indented line right after a list item continues that item (e.g. the
    // "  Note: …" line formatPaymentOptionsMarkdown emits under a method).
    .replace(/^((?:- |\d+\. ).+)\n {2,}(\S.*)$/gm, "$1<br>$2")
    // List items (- item)
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Wrap consecutive <li> in <ul> (the newline after the last item is left
    // in place so the following line still starts at a line boundary)
    .replace(/(<li>.*<\/li>(?:\n<li>.*<\/li>)*)/g, "<ul>$1</ul>")
    // Ordered list items (1. item) — placeholder tags so the <ul> wrap above
    // never captures them; renamed to <li> once wrapped in <ol>.
    .replace(/^\d+\. (.+)$/gm, "<oli>$1</oli>")
    .replace(/(<oli>.*<\/oli>(?:\n<oli>.*<\/oli>)*)/g, "<ol>$1</ol>")
    .replace(/<(\/?)oli>/g, "<$1li>")
    // Blockquote lines ("> text"; ">" was escaped to &gt; above). Consecutive
    // quote lines form one <blockquote>, one <p> per line.
    .replace(/^&gt; ?(.*)$/gm, "<bqp>$1</bqp>")
    .replace(/(<bqp>.*<\/bqp>(?:\n<bqp>.*<\/bqp>)*)/g, "<blockquote>$1</blockquote>")
    .replace(/<(\/?)bqp>/g, "<$1p>")
    // === separator lines
    .replace(/^={3,}$/gm, "<hr>")
    .replace(/^-{3,}$/gm, "<hr>")
    // Newlines to <br> (but not adjacent to block elements)
    .replace(/\n(?!<[hulob/])/g, "<br>\n")
    // Strip <br> between block elements (prevents extra spacing around hr, h2, lists, quotes)
    .replace(/(<\/(?:h[1-6]|ul|ol|li|p|blockquote)>|<hr>)\s*(?:<br>\n?)+/g, "$1\n")
    .replace(/(?:<br>\n?)+\s*(<(?:h[1-6]|ul|ol|hr|blockquote)[\s>])/g, "$1")
    // Restore escaped literals (HTML-escaped: only ">" needs it in this set).
    .replace(/\uE000([0-9a-f]+)\uE001/g, (_, hex) => {
      const ch = String.fromCharCode(parseInt(hex, 16));
      return ch === ">" ? "&gt;" : ch;
    });
  return html;
}

/**
 * Plain-text alternative for an email body written in the simpleMarkdownToHtml
 * subset: strips inline markdown syntax so text-only mail clients show clean
 * text. **bold** / *italic* → text, [label](url) → "label (url)" (or just the
 * URL when label === url), "## " heading markers removed, and backslash
 * escapes → the literal character. List ("- ", "1. "), quote ("> ") and rule
 * lines are left as-is: they read naturally as plain text.
 */
function markdownToPlainText(text) {
  if (!text) return "";
  return text
    .replace(/[\uE000\uE001]/g, "")
    .replace(/\\([\\*[\]\-.>#=])/g, (_, ch) => MD_ESCAPE_OPEN + ch.charCodeAt(0).toString(16) + MD_ESCAPE_CLOSE)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => (label.trim() === url.trim() ? url : label + " (" + url + ")"))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, "$1")
    .replace(/^## /gm, "")
    .replace(/\uE000([0-9a-f]+)\uE001/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// ── Mail sender policy (client-enqueued mail) ──────────────────────────────

/** Client-enqueued emails allowed per sender uid per rolling window. */
const MAIL_RATE_LIMIT = 100;
const MAIL_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * The set of addresses a signed-in user may email through the app: their own
 * account email plus every household member email recorded in their own
 * billing years. Returns a Set of normalized addresses.
 */
function collectAllowedRecipients(ownEmail, billingYears) {
  const allowed = new Set();
  const own = normalizeEmail(ownEmail);
  if (own) allowed.add(own);
  for (const year of billingYears || []) {
    const members = year && Array.isArray(year.familyMembers) ? year.familyMembers : [];
    for (const m of members) {
      const e = normalizeEmail(m && m.email);
      if (e) allowed.add(e);
    }
  }
  return allowed;
}

/**
 * Fixed-window rate limit step. `state` is the stored counter doc data (or
 * null). Returns { allowed, next } where `next` is the state to persist when
 * allowed.
 */
function nextMailRateState(state, nowMs, limit = MAIL_RATE_LIMIT, windowMs = MAIL_RATE_WINDOW_MS) {
  const windowStart = state && typeof state.windowStartMs === "number" ? state.windowStartMs : 0;
  const count = state && typeof state.count === "number" ? state.count : 0;
  if (!windowStart || nowMs - windowStart >= windowMs) {
    return { allowed: true, next: { windowStartMs: nowMs, count: 1 } };
  }
  if (count >= limit) return { allowed: false, next: null };
  return { allowed: true, next: { windowStartMs: windowStart, count: count + 1 } };
}

/**
 * Authorize a client-enqueued email: the sender must have a verified account
 * email, the recipient must be the sender or one of their household members,
 * and the sender must be under the per-uid rate limit (transactional counter
 * in mailRateLimits/{uid}, a server-only collection).
 * Returns { ok: true } or { ok: false, error }.
 */
async function authorizeClientMail(uid, to) {
  let sender;
  try {
    sender = await getAuth().getUser(uid);
  } catch (err) {
    console.error("authorizeClientMail: sender lookup failed:", err);
    return { ok: false, error: "Sender account not found." };
  }
  if (!sender.emailVerified) {
    return { ok: false, error: "Verify your account email address before sending email from the app (use \u201cResend verification email\u201d in the banner at the top of the app)." };
  }

  const yearsSnap = await db.collection("users").doc(uid).collection("billingYears").get();
  const allowed = collectAllowedRecipients(sender.email, yearsSnap.docs.map((d) => d.data()));
  if (!allowed.has(normalizeEmail(to))) {
    return { ok: false, error: "Recipient must be your own email address or a household member's email address." };
  }

  const limitRef = db.collection("mailRateLimits").doc(uid);
  const underLimit = await db.runTransaction(async (tx) => {
    const snap = await tx.get(limitRef);
    const step = nextMailRateState(snap.exists ? snap.data() : null, Date.now());
    if (!step.allowed) return false;
    tx.set(limitRef, step.next);
    return true;
  });
  if (!underLimit) {
    return { ok: false, error: "Daily email limit reached. Please try again later." };
  }
  return { ok: true };
}

/**
 * Firestore-triggered email sender. The client writes a document to
 * mailQueue/{docId} with { to, subject, body, uid, status: 'pending' }.
 * This trigger picks it up, sends via Resend, and updates the document
 * with the result ({ status: 'sent', resendId } or { status: 'error', error }).
 *
 * Uses a transactional claim step (pending → processing) to prevent
 * duplicate sends on at-least-once Firestore trigger redelivery.
 *
 * HTML is always rendered server-side from `body` via simpleMarkdownToHtml();
 * queue documents cannot supply their own HTML or reply-to address.
 *
 * Client-enqueued mail (no server `origin` marker, which clients cannot set)
 * must pass authorizeClientMail(): verified sender email, recipient restricted
 * to the sender or their household members, per-uid rate limit.
 *
 * No Cloud Run invoker policy needed — Firestore triggers are event-driven.
 */
exports.processMailQueue = onDocumentCreated(
  { document: "mailQueue/{docId}", region: "us-central1", secrets: [resendApiKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const docRef = snap.ref;

    // Atomically claim the document: pending → processing.
    // If another invocation already claimed it, the transaction fails and we bail out.
    let data;
    try {
      data = await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(docRef);
        if (!freshSnap.exists) return null;
        const d = freshSnap.data();
        if (d.status !== "pending") return null; // Already claimed or processed
        tx.update(docRef, { status: "processing" });
        return d;
      });
    } catch (err) {
      console.error("processMailQueue claim transaction failed:", err);
      return;
    }

    if (!data) return; // Already claimed by another invocation

    const { to, subject, body, uid } = data;
    const isServerOrigin = data.origin === MAIL_ORIGIN_SERVER;

    // Validate required fields
    if (!uid || typeof uid !== "string") {
      await docRef.update({ status: "error", error: "Missing uid.", processedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (!to || typeof to !== "string" || !to.includes("@")) {
      await docRef.update({ status: "error", error: "Valid recipient email is required.", processedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (!subject || typeof subject !== "string") {
      await docRef.update({ status: "error", error: "Subject is required.", processedAt: FieldValue.serverTimestamp() });
      return;
    }
    if (!body || typeof body !== "string") {
      await docRef.update({ status: "error", error: "Email body is required.", processedAt: FieldValue.serverTimestamp() });
      return;
    }

    try {
      if (!isServerOrigin) {
        const auth = await authorizeClientMail(uid, to);
        if (!auth.ok) {
          await docRef.update({ status: "error", error: auth.error, processedAt: FieldValue.serverTimestamp() });
          return;
        }
      }

      const { Resend } = require("resend");
      const resend = new Resend(resendApiKey.value());

      const htmlBody = wrapEmailHtml(simpleMarkdownToHtml(body));

      const result = await resend.emails.send({
        from: EMAIL_FROM,
        to: [to],
        subject: subject,
        html: htmlBody,
        text: markdownToPlainText(body),
      });

      if (result.error) {
        console.error("Resend API error:", result.error);
        await docRef.update({ status: "error", error: result.error.message || "Resend error", processedAt: FieldValue.serverTimestamp() });
        return;
      }

      await docRef.update({ status: "sent", resendId: result.data?.id || null, processedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      console.error("processMailQueue error:", err);
      await docRef.update({ status: "error", error: err.message || "Unknown error", processedAt: FieldValue.serverTimestamp() });
    }
  }
);

exports._testHelpers.simpleMarkdownToHtml = simpleMarkdownToHtml;
exports._testHelpers.markdownToPlainText = markdownToPlainText;
exports._testHelpers.normalizeEmail = normalizeEmail;
exports._testHelpers.collectAllowedRecipients = collectAllowedRecipients;
exports._testHelpers.nextMailRateState = nextMailRateState;
exports._testHelpers.MAIL_RATE_LIMIT = MAIL_RATE_LIMIT;
exports._testHelpers.MAIL_RATE_WINDOW_MS = MAIL_RATE_WINDOW_MS;
exports._testHelpers.MAIL_ORIGIN_SERVER = MAIL_ORIGIN_SERVER;
