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

module.exports = { computeMemberSummary, buildPendingChargesForShare };
