// Synthetic approved Lindqvist example; no customer data.
export const carriedMembers = [
    { id: 1, name: 'Erik Lindqvist', linkedMembers: [2] },
    { id: 2, name: 'Maja Lindqvist', linkedMembers: [] },
    { id: 3, name: 'Other Household', linkedMembers: [] },
];
export const carriedBills = [
    { id: 'northline', name: 'Northline Mobile', amount: 198, billingFrequency: 'monthly', members: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { id: 'cloudstream', name: 'Cloudstream Family', amount: 26, billingFrequency: 'monthly', members: [1, 2, 3, 4, 5, 6] },
    { id: 'harbor', name: 'Harbor Cloud Storage', amount: 144, billingFrequency: 'annual', members: [1, 3, 4, 5] },
];
const northline = { kind: 'true_up', basis: 'price_change', billName: 'Northline Mobile', description: 'Northline Mobile went from $180 to $198 a month in July. Your share of six months.', amount: 12 };
export const carriedSeeds = [{
    id: 'seed', kind: 'carry_opening', status: 'carried_in', memberId: 1, amount: 55, fromYear: '2026',
    items: [
        { ...northline, memberId: 1 },
        { kind: 'true_up', basis: 'price_change', memberId: 1, billName: 'Harbor Cloud Storage', description: 'Harbor Cloud Storage went from $120 to $144 a year in March. Your share of ten months.', amount: 5 },
        { ...northline, memberId: 2 },
        { kind: 'usage_charge', memberId: 2, description: 'Activation fee (Nov 3).', amount: 30 },
        { kind: 'credit', memberId: null, description: 'Your household’s 2026 credit', amount: -4, detail: [
            { kind: 'service_credit', memberId: 1, billName: 'Pinecone Vault', description: 'Pinecone Vault ended in August', amount: -4 },
        ] },
    ],
}];
