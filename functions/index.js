const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

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

const { computeMemberSummary } = require("./billing");

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

  const { token } = req.body || {};
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
      res.status(403).json({ error: "This link has been revoked by the account owner." });
      return;
    }

    if (tokenData.expiresAt) {
      const expiry = tokenData.expiresAt.toDate ? tokenData.expiresAt.toDate() : new Date(tokenData.expiresAt);
      if (expiry < new Date()) {
        res.status(403).json({ error: "This link has expired." });
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

    const scopes = tokenData.scopes || ["summary:read", "paymentMethods:read"];
    const result = {
      memberName: primarySummary.name,
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

      result.disputes = disputesSnap.docs.map((doc) => {
        const data = doc.data();
        let status = data.status || "open";
        if (status === "pending") status = "open";
        if (status === "reviewed") status = "in_review";
        return {
          id: doc.id,
          billId: data.billId,
          billName: data.billName,
          message: data.message,
          proposedCorrection: data.proposedCorrection || null,
          status: status,
          resolutionNote: data.resolutionNote || null,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
          resolvedAt: data.resolvedAt ? data.resolvedAt.toDate().toISOString() : null,
          rejectedAt: data.rejectedAt ? data.rejectedAt.toDate().toISOString() : null,
          evidence: (data.evidence || []).map((ev, idx) => ({
            index: idx,
            name: ev.name,
            contentType: ev.contentType,
            size: ev.size,
          })),
          userReview: data.userReview || null,
        };
      });
    }

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

exports._testHelpers = { validateToken, validateDisputeInput, DISPUTE_RATE_LIMIT, EVIDENCE_URL_EXPIRY_MS };

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

    const disputesRef = db
      .collection("users")
      .doc(tokenData.ownerId)
      .collection("billingYears")
      .doc(tokenData.billingYearId)
      .collection("disputes");

    const cutoff = Timestamp.fromDate(new Date(Date.now() - DISPUTE_RATE_WINDOW_MS));
    const recentSnap = await disputesRef
      .where("tokenHash", "==", tokenHash)
      .where("createdAt", ">", cutoff)
      .get();

    if (recentSnap.size >= DISPUTE_RATE_LIMIT) {
      res.status(429).json({ error: "Too many review requests. Please try again later." });
      return;
    }

    const dispute = {
      memberId: tokenData.memberId,
      memberName: tokenData.memberName || "",
      billId: billId,
      billName: billName.trim(),
      message: message.trim(),
      proposedCorrection: proposedCorrection ? proposedCorrection.trim() : null,
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      tokenHash: tokenHash,
    };

    const docRef = await disputesRef.add(dispute);

    appendAuditLog(tokenData.ownerId, {
      action: "dispute_submitted",
      disputeId: docRef.id,
      memberId: tokenData.memberId,
      billId: billId,
      billingYearId: tokenData.billingYearId,
      ip: req.ip || null,
    });

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

    const disputeDoc = await disputeRef.get();

    if (!disputeDoc.exists) {
      res.status(404).json({ error: "Dispute not found." });
      return;
    }

    const disputeData = disputeDoc.data();

    if (disputeData.memberId !== tokenData.memberId) {
      res.status(403).json({ error: "Access denied." });
      return;
    }

    const currentState = disputeData.userReview ? disputeData.userReview.state : null;

    if (currentState === "approved_by_user" || currentState === "rejected_by_user") {
      res.status(200).json({ message: "Decision already recorded.", alreadyDecided: true });
      return;
    }

    if (currentState !== "requested") {
      res.status(400).json({ error: "This dispute is not awaiting your decision." });
      return;
    }

    if (decision === "approve") {
      await disputeRef.update({
        status: "resolved",
        "userReview.state": "approved_by_user",
        "userReview.decidedAt": FieldValue.serverTimestamp(),
        resolvedAt: FieldValue.serverTimestamp(),
      });
    } else {
      await disputeRef.update({
        status: "open",
        "userReview.state": "rejected_by_user",
        "userReview.rejectionNote": note.trim(),
        "userReview.decidedAt": FieldValue.serverTimestamp(),
      });
    }

    appendAuditLog(tokenData.ownerId, {
      action: "dispute_decision",
      disputeId: disputeId,
      decision: decision,
      memberId: tokenData.memberId,
      billingYearId: tokenData.billingYearId,
      ip: req.ip || null,
    });

    res.status(200).json({ message: "Decision recorded successfully." });
  } catch (err) {
    console.error("submitDisputeDecision error:", err);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});
