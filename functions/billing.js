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

module.exports = { computeMemberSummary };
