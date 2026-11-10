/**
 * The Year-End Review wireframe sample year (plans/ffb-wireframes.html, `YE_*`):
 * 2026 · settling, nine members in five households, five bills, three deferred
 * member charges. Shared by tests/react/views/YearEndReviewView.test.jsx and the
 * screenshot script so both render the same data.
 */
export const MEMBER = { ada: 1, tobi: 2, zara: 3, erik: 4, maja: 5, kenji: 6, dede: 7, rosa: 8, sam: 9 };

export const BILL = { nl: 101, cs: 102, hc: 103, mm: 104, pv: 105 };

const person = (id, name, linkedMembers = [], extra = {}) => ({
    id, name, email: '', phone: '', avatar: '', linkedMembers, paymentReceived: 0, ...extra
});

export function yearEndMembers() {
    return [
        person(MEMBER.ada, 'Ada Okafor', [MEMBER.tobi, MEMBER.zara], { householdName: 'Okafor' }),
        person(MEMBER.tobi, 'Tobi Okafor'),
        person(MEMBER.zara, 'Zara Okafor'),
        person(MEMBER.erik, 'Erik Lindqvist', [MEMBER.maja], { householdName: 'Lindqvist' }),
        person(MEMBER.maja, 'Maja Lindqvist'),
        person(MEMBER.kenji, 'Kenji Nakamura', [MEMBER.dede], { householdName: 'Nakamura–Osei' }),
        person(MEMBER.dede, 'Dede Osei'),
        person(MEMBER.rosa, 'Rosa Delgado'),
        person(MEMBER.sam, 'Sam Whitfield')
    ];
}

const all = Object.values(MEMBER);

export function yearEndBills() {
    return [
        { id: BILL.nl, name: 'Northline Mobile', amount: 180, billingFrequency: 'monthly', members: [...all], website: '', logo: '' },
        { id: BILL.cs, name: 'Cloudstream Family', amount: 20, billingFrequency: 'monthly', members: [MEMBER.ada, MEMBER.tobi, MEMBER.erik, MEMBER.kenji, MEMBER.dede, MEMBER.sam], website: '', logo: '' },
        { id: BILL.hc, name: 'Harbor Cloud Storage', amount: 120, billingFrequency: 'annual', members: [MEMBER.ada, MEMBER.erik, MEMBER.kenji, MEMBER.sam], website: '', logo: '' },
        { id: BILL.mm, name: 'Meridian Music', amount: 15, billingFrequency: 'monthly', members: [MEMBER.rosa, MEMBER.sam, MEMBER.zara], website: '', logo: '' },
        { id: BILL.pv, name: 'Pinecone Vault', amount: 60, billingFrequency: 'annual', members: [MEMBER.ada, MEMBER.erik, MEMBER.kenji, MEMBER.dede, MEMBER.rosa], website: '', logo: '' }
    ];
}

/** Maja's $30.00 activation fee, Dede's and Kenji's deferred charges (already recorded). */
export function yearEndCharges() {
    return [
        { id: 'oadj_maja_fee', memberId: MEMBER.maja, kind: 'usage_charge', amount: 30, description: 'Activation fee', incurredDate: '2026-11-03', status: 'deferred', createdAt: '2026-11-03T10:00:00.000Z' },
        { id: 'oadj_dede_roam', memberId: MEMBER.dede, kind: 'usage_charge', amount: 38.5, description: 'Roaming overage—Lisbon trip', incurredDate: '2026-07-14', status: 'deferred', createdAt: '2026-07-14T10:00:00.000Z' },
        { id: 'oadj_kenji_calls', memberId: MEMBER.kenji, kind: 'usage_charge', amount: 12, description: 'International calls', incurredDate: '2026-08-02', status: 'deferred', createdAt: '2026-08-02T10:00:00.000Z' }
    ];
}

const credit = (id, memberId, amount, reason, incurredDate) => ({
    id, memberId, billId: BILL.pv, kind: 'service_credit', amount, reason, incurredDate,
    createdAt: incurredDate + 'T12:00:00.000Z', status: 'active'
});

/** Earlier Service Credits on Pinecone Vault (the "credited" alternate scenario). */
export function pineconeCredits() {
    return [
        credit('oadj_sc_ada', MEMBER.ada, 3, 'Cancelled Pinecone Vault', '2026-09-02'),
        credit('oadj_sc_erik', MEMBER.erik, 3, 'Cancelled Pinecone Vault', '2026-09-02'),
        credit('oadj_sc_kenji', MEMBER.kenji, 3, 'Cancelled Pinecone Vault', '2026-09-02'),
        credit('oadj_sc_dede', MEMBER.dede, 3, 'Cancelled Pinecone Vault', '2026-09-02'),
        credit('oadj_sc_rosa', MEMBER.rosa, 3, 'Cancelled Pinecone Vault', '2026-09-02'),
        credit('oadj_sc_dede_mar', MEMBER.dede, 10, 'Billing mistake', '2026-03-14'),
        credit('oadj_sc_rosa_oct', MEMBER.rosa, 6, 'Cancelled early—partial month', '2026-10-20')
    ];
}

export function yearEndState({ credits = false } = {}) {
    return {
        billingYears: [{ id: '2026', label: '2026', status: 'settling' }],
        activeYear: { id: '2026', label: '2026', status: 'settling' },
        familyMembers: yearEndMembers(),
        bills: yearEndBills(),
        payments: [],
        creditAdjustments: [],
        owedAdjustments: [...yearEndCharges(), ...(credits ? pineconeCredits() : [])],
        billingEvents: [],
        settings: null,
        loading: false,
        error: null
    };
}
