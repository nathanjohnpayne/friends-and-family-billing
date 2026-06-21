function getBillAnnualAmount(bill) {
  if (bill.billingFrequency === 'annual') return bill.amount;
  return bill.amount * 12;
}

function getBillMonthlyAmount(bill) {
  if (bill.billingFrequency === 'annual') return bill.amount / 12;
  return bill.amount;
}

function computeMemberSummary(familyMembers, bills, targetMemberId) {
  const member = familyMembers.find((m) => m.id === targetMemberId);
  if (!member) return null;

  const memberBills = [];
  let total = 0;

  bills.forEach((bill) => {
    if (bill.members && bill.members.includes(targetMemberId) && bill.members.length > 0) {
      const annualTotal = getBillAnnualAmount(bill);
      const annualShare = annualTotal / bill.members.length;
      const monthlyShare = annualShare / 12;
      total += annualShare;
      memberBills.push({
        billId: bill.id,
        name: bill.name,
        logo: bill.logo || '',
        website: bill.website || '',
        monthlyAmount: getBillMonthlyAmount(bill),
        billingFrequency: bill.billingFrequency || 'monthly',
        canonicalAmount: bill.amount,
        splitCount: bill.members.length,
        monthlyShare: Math.round(monthlyShare * 100) / 100,
        annualShare: Math.round(annualShare * 100) / 100,
      });
    }
  });

  return {
    name: member.name,
    memberId: targetMemberId,
    monthlyTotal: Math.round((total / 12) * 100) / 100,
    annualTotal: Math.round(total * 100) / 100,
    bills: memberBills,
  };
}

/**
 * Build the member-facing "Pending charges" payload for a share view (#317).
 * Mirror of src/lib/share.js `buildPendingChargesForShare` for the Cloud Function
 * (CommonJS) side. Returns the token member's OWN *deferred* Usage Charges
 * (per-member, ADR 0005 — "a linked member sees their own pending charges"),
 * sorted by incurred date, each with a running total, plus a count and grand total.
 *
 * Only member-safe fields are exposed. Voided/billed charges and other households'
 * charges are excluded. Deferred charges are NOT-YET-DUE and never touch owed.
 *
 * @param {Array} familyMembers
 * @param {Array} owedAdjustments
 * @param {*} memberId  the primary member the share token is scoped to
 * @returns {{ charges: Array, total: number, count: number }}
 */
function buildPendingChargesForShare(familyMembers, owedAdjustments, memberId) {
  const empty = { charges: [], total: 0, count: 0 };
  const member = (familyMembers || []).find((m) => m.id === memberId);
  if (!member) return empty;

  // Per-member (ADR 0005): a member sees their OWN deferred charges on their share
  // page, not the whole household's. The household grain is only for the admin board.
  const deferred = (owedAdjustments || []).filter(
    (a) => a && a.kind === "usage_charge" && a.status === "deferred" && a.memberId === memberId
  );

  deferred.sort((a, b) =>
    String(a.incurredDate || "").localeCompare(String(b.incurredDate || ""))
  );

  let running = 0;
  const charges = deferred.map((a) => {
    running = Math.round((running + (a.amount || 0)) * 100) / 100;
    return {
      id: a.id,
      description: a.description || "",
      amount: a.amount || 0,
      incurredDate: a.incurredDate || "",
      runningTotal: running,
    };
  });

  return { charges, total: running, count: charges.length };
}

/** Discriminator for an outbound Charge Notice in the shared `disputes` subcollection (#320). */
const CHARGE_NOTICE_KIND = "charge_notice";

/** ISO string from a Firestore Timestamp, an ISO string, or null. */
function toIso(v) {
  if (!v) return null;
  if (v.toDate) return v.toDate().toISOString();
  if (typeof v === "string") return v;
  return null;
}

/**
 * Project a member's `disputes` documents for the member-facing share view (#320).
 * Charge Notices ride the same subcollection but are outbound Requests, not Review
 * Requests, so they are EXCLUDED here — mirroring the client-side useDisputes
 * exclusion (ADR 0002, ADR 0005). The member contests a charge via a Review Request,
 * never by seeing the Charge Notice projected as one. Legacy statuses are normalized
 * and only member-safe review fields are surfaced.
 *
 * @param {Array} docs  raw dispute doc data objects (each may carry Timestamp fields)
 * @returns {Array} the member-safe Review Request projections
 */
function projectMemberDisputes(docs) {
  return (docs || [])
    // Charge Notices (#320) and Refund Notices (#319) ride the same disputes
    // subcollection but are outbound Requests, not Review Requests — exclude both
    // so a disputes:read link never renders them as empty Review Requests.
    .filter((data) => data && data.kind !== CHARGE_NOTICE_KIND && data.kind !== "refund_notice")
    .map((data) => {
      let status = data.status || "open";
      if (status === "pending") status = "open";
      if (status === "reviewed") status = "in_review";
      return {
        id: data.id,
        billId: data.billId,
        billName: data.billName,
        message: data.message,
        proposedCorrection: data.proposedCorrection || null,
        status: status,
        resolutionNote: data.resolutionNote || null,
        createdAt: toIso(data.createdAt),
        resolvedAt: toIso(data.resolvedAt),
        rejectedAt: toIso(data.rejectedAt),
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

/**
 * Sum a member's active Service Credits (#321) as a positive magnitude. Mirrors
 * the client getServiceCreditTotalForMember: only `service_credit` records with
 * `status: 'active'` and a finite positive amount count. The Cloud Function uses
 * this to reduce the member-facing owed so resolveShareToken agrees with
 * buildPublicShareData (the React writer) and never self-heals a gross total.
 */
function getServiceCreditTotalForMember(owedAdjustments, memberId) {
  return (owedAdjustments || [])
    .filter((a) => a && a.kind === "service_credit" && a.status === "active" && a.memberId === memberId)
    .reduce((sum, a) => {
      const n = Number.parseFloat(a.amount);
      return Number.isFinite(n) && n > 0 ? sum + n : sum;
    }, 0);
}

/**
 * Build the member-facing Service Credits line items for a share summary (#337).
 * CommonJS mirror of src/lib/share.js `buildServiceCreditsForShare` for the Cloud
 * Function side, so the self-healed `publicShares` doc and the live response carry the
 * same `serviceCredits` field the React writer produces (cache-hit / cache-miss parity).
 *
 * Aggregates the household's (primary + linked) active `service_credit` records by
 * (billId + reason) — a bill-level credit is stored as one record per affected member,
 * so the split is reconstructed into one line. Only member-safe fields are exposed
 * (reason, billName, amount); voided credits, the `+owed` Usage Charge direction,
 * `carry_opening` seeds, and other members' credits are excluded. The returned `total`
 * equals the `service_credit` reduction applied to combinedAnnual by resolveShareToken.
 *
 * @param {Array} bills
 * @param {Array} owedAdjustments
 * @param {*} memberId  the primary member the share token is scoped to
 * @param {Array} linkedIds  the primary member's linked household member ids
 * @returns {{ items: Array<{ reason: string, billName: string, amount: number }>, total: number }}
 */
function buildServiceCreditsForShare(bills, owedAdjustments, memberId, linkedIds) {
  const householdIds = [memberId, ...(linkedIds || [])];
  const billName = (id) => {
    const b = (bills || []).find((x) => x.id === id);
    return (b && b.name) || "";
  };
  const groups = new Map();
  (owedAdjustments || []).forEach((a) => {
    if (!a || a.kind !== "service_credit" || a.status !== "active") return;
    if (!householdIds.includes(a.memberId)) return;
    const amt = Number.parseFloat(a.amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const reason = a.reason || "";
    const key = String(a.billId) + "|" + reason;
    const existing = groups.get(key);
    if (existing) {
      existing.amount += amt; // accumulate raw; round once below
    } else {
      groups.set(key, { reason, billName: billName(a.billId), amount: amt });
    }
  });
  // Round once, after aggregation, so per-add rounding can't drift the line items or the
  // total from the raw service-credit sum (cent-level parity with getServiceCreditTotalForMember).
  let rawTotal = 0;
  const items = Array.from(groups.values()).map((it) => {
    rawTotal += it.amount;
    return { reason: it.reason, billName: it.billName, amount: Math.round(it.amount * 100) / 100 };
  });
  const total = Math.round(rawTotal * 100) / 100;
  return { items, total };
}

/**
 * Household-grain (ADR 0001) carried-forward opening balance (#322). CommonJS
 * mirror of src/lib/calculations.js `getHouseholdOpeningBalance` for the Cloud
 * Function side: the SIGNED sum of `carry_opening` seed records across a primary
 * member and their linked members. A carried credit is stored negative (owe less)
 * and a carried charge positive (owe more); they net to one number. Only non-voided
 * seeds count. resolveShareToken folds this into the member-facing owed so the
 * Cloud Function fallback (cache-miss / stale-refresh, self-healed
 * back into publicShares) agrees with the React buildPublicShareData
 * writer and the settlement board, and never persists an uncarried total.
 *
 * @param {{ id: *, linkedMembers?: Array }} member  the household's primary member
 * @param {Array} owedAdjustments
 * @returns {number}
 */
function getHouseholdOpeningBalance(member, owedAdjustments) {
  if (!member) return 0;
  const ids = [member.id, ...((member.linkedMembers) || [])];
  return (owedAdjustments || [])
    .filter((a) => a && a.kind === "carry_opening" && a.status !== "voided" && ids.includes(a.memberId))
    .reduce((sum, a) => {
      const n = Number.parseFloat(a.amount);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
}

module.exports = { computeMemberSummary, buildPendingChargesForShare, projectMemberDisputes, getServiceCreditTotalForMember, buildServiceCreditsForShare, getHouseholdOpeningBalance, CHARGE_NOTICE_KIND };
