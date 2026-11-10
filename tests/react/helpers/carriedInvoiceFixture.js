// Synthetic approved Year-End Review example (specs/year-end-review.md § Member-facing
// copy); no customer data. Seeds use the stored shape the rollover writes: every item
// has a sourceId, the household credit is attributed to the contact, detail explains it.
export const invoiceYear = { id: '2027', label: '2027' };

export const invoiceMembers = [
    { id: 1, name: 'Erik Lindqvist', email: 'erik.lindqvist@example.com', linkedMembers: [2] },
    { id: 2, name: 'Maja Lindqvist', email: '', linkedMembers: [] },
    { id: 3, name: 'Rosa Delgado', email: 'rosa@example.com', linkedMembers: [] },
    { id: 4, name: 'Sam Whitfield', email: 'sam@example.com', linkedMembers: [] },
    { id: 5, name: 'Ada Okafor', email: 'ada@example.com', linkedMembers: [] },
    { id: 6, name: 'Kenji Nakamura', email: 'kenji@example.com', linkedMembers: [] },
    { id: 7, name: 'Dede Osei', email: 'dede@example.com', linkedMembers: [] },
    { id: 8, name: 'Tobi Okafor', email: 'tobi@example.com', linkedMembers: [] },
    { id: 9, name: 'Zara Okafor', email: 'zara@example.com', linkedMembers: [] },
];

// Erik $352.00 + Maja $316.00 = $668.00 of 2027 bills; Rosa and Sam $352.00 each.
export const invoiceBills = [
    { id: 'northline', name: 'Northline Mobile', amount: 198, billingFrequency: 'monthly', members: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { id: 'cloudstream', name: 'Cloudstream Family', amount: 26, billingFrequency: 'monthly', members: [1, 2, 3, 4, 5, 6] },
    { id: 'harbor', name: 'Harbor Cloud Storage', amount: 144, billingFrequency: 'annual', members: [1, 3, 4, 5] },
];

const northline = memberId => ({
    sourceId: 'oadj_tu_2026_tu_2026_northline_' + memberId, kind: 'usage_charge', basis: 'price_change', memberId,
    billName: 'Northline Mobile', description: 'Northline Mobile went from $180 to $198 a month in July. Your share of six months: $12.00.', amount: 12,
});

/** Lindqvist: +$55.00 carried, first 2027 invoice $723.00. */
export const lindqvistSeed = {
    id: 'coadj_2026_1', kind: 'carry_opening', status: 'carried_in', memberId: 1, fromYear: '2026', amount: 55,
    items: [
        northline(1),
        { sourceId: 'oadj_tu_2026_tu_2026_harbor_1', kind: 'usage_charge', basis: 'price_change', memberId: 1, billName: 'Harbor Cloud Storage',
            description: 'Harbor Cloud Storage went from $120 to $144 a year in March. Your share of ten months: $5.00.', amount: 5 },
        northline(2),
        { sourceId: 'oadj_uc_2026_activation', kind: 'usage_charge', basis: 'member', memberId: 2, billName: null, description: 'Activation fee (Nov 3)', amount: 30 },
        { sourceId: 'cadj_carry_2027_1', kind: 'credit', basis: 'credit', memberId: 1, billName: null, description: 'Your household’s 2026 credit', amount: -4,
            detail: [{ sourceId: 'oadj_sc_2026_ended_pinecone_1', basis: 'ended', memberId: 1, billName: 'Pinecone Vault', description: 'Pinecone Vault ended in August', amount: -4 }] },
    ],
};

/** Rosa: a net credit of −$28.00 with two detail lines. */
export const rosaSeed = {
    id: 'coadj_2026_3', kind: 'carry_opening', status: 'carried_in', memberId: 3, fromYear: '2026', amount: -28,
    items: [{ sourceId: 'cadj_carry_2027_3', kind: 'credit', basis: 'credit', memberId: 3, billName: null, description: 'Your 2026 credit', amount: -28,
        detail: [
            { sourceId: 'oadj_sc_2026_ended_pinecone_3', basis: 'ended', memberId: 3, billName: 'Pinecone Vault', description: 'Pinecone Vault ended in August', amount: -6 },
            { kind: 'remainder', description: 'Other 2026 overpayment', amount: -22 },
        ] }],
};

/** Sam: a seed written before itemization (no items). */
export const samLegacySeed = { id: 'seed_legacy_4', kind: 'carry_opening', status: 'carried_in', memberId: 4, fromYear: '2026', amount: 30 };

export const invoiceSeeds = [lindqvistSeed, rosaSeed, samLegacySeed];
