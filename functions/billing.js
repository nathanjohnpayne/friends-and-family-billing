function computeMemberSummary(familyMembers, bills, targetMemberId) {
  const member = familyMembers.find((m) => m.id === targetMemberId);
  if (!member) return null;

  const memberBills = [];
  let total = 0;

  bills.forEach((bill) => {
    if (bill.members && bill.members.includes(targetMemberId) && bill.members.length > 0) {
      const monthlyShare = bill.amount / bill.members.length;
      const annualShare = monthlyShare * 12;
      total += annualShare;
      memberBills.push({
        name: bill.name,
        monthlyAmount: bill.amount,
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
