/**
 * E2E test fixtures — mock auth user and billing data.
 * Injected into the page via addInitScript before the app loads.
 */

export const E2E_USER = {
    uid: 'e2e-test-user',
    email: 'test@example.com',
    displayName: 'Test User',
};

export const E2E_DATA = {
    billingYears: [{ id: '2026', label: '2026', status: 'open' }],
    activeYear: { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null },
    familyMembers: [
        { id: 1, name: 'John Payne', email: 'john@example.com', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
        { id: 2, name: 'Jane Payne', email: 'jane@example.com', phone: '', avatar: '', linkedMembers: [], paymentReceived: 0 },
    ],
    bills: [
        { id: 101, name: 'Internet', amount: 100, billingFrequency: 'monthly', members: [1, 2] },
        { id: 102, name: 'Streaming', amount: 15, billingFrequency: 'monthly', members: [1] },
    ],
    payments: [],
    billingEvents: [],
    settings: {
        emailSubject: '%billing_year% %last_name% Family Annual Billing Summary',
        emailMessage: 'Hi %first_name%,\n\nA link to your %billing_year% bill summary is below. Thank you for your **prompt** payment of %household_total%.\n\n%share_link%\n\n%payment_methods%\n\nThank you,\nNathan!\n[https://nathanpayne.com](https://nathanpayne.com)',
        emailMessageDocument: {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Hi ' },
                        { type: 'templateToken', attrs: { id: 'first_name', label: 'First Name' } },
                        { type: 'text', text: ',' },
                    ],
                },
                { type: 'paragraph' },
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'A link to your ' },
                        { type: 'templateToken', attrs: { id: 'billing_year', label: 'Billing Year' } },
                        { type: 'text', text: ' bill summary is below. Thank you for your ' },
                        { type: 'text', text: 'prompt', marks: [{ type: 'bold' }] },
                        { type: 'text', text: ' payment of ' },
                        { type: 'templateToken', attrs: { id: 'household_total', label: 'Household Total' } },
                        { type: 'text', text: '.' },
                    ],
                },
                { type: 'paragraph' },
                {
                    type: 'blockToken',
                    attrs: { id: 'share_link', label: 'Share Link', description: 'Expands into the member\u2019s share link.' },
                },
                { type: 'paragraph' },
                {
                    type: 'blockToken',
                    attrs: { id: 'payment_methods', label: 'Payment Methods', description: 'Expands into your configured payment options.' },
                },
                { type: 'paragraph' },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Thank you,' }],
                },
                {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Nathan!' }],
                },
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'https://nathanpayne.com',
                            marks: [{ type: 'link', attrs: { href: 'https://nathanpayne.com', target: '_blank', rel: 'noopener noreferrer' } }],
                        },
                    ],
                },
            ],
        },
        _templateDocVersion: 2,
        _templateMigrated: true,
        paymentMethods: [
            { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@NathanPayne', url: 'https://www.venmo.com/u/NathanPayne', email: '', phone: '', instructions: '' },
        ],
        paymentLinks: [],
    },
};

/**
 * Seed a Playwright page with E2E user and data before navigating.
 * Must be called before page.goto().
 *
 * - Blocks firebase-config.local.js (sets real Firebase config) and replaces
 *   it with a dummy config so the E2E guard in firebase.js works correctly
 * - Injects mock user and billing data onto window for AuthContext and useBillingData
 */
export async function seedPage(page) {
    // Block the real Firebase config script and replace with a dummy
    await page.route('**/firebase-config.local.js', route => {
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__FIREBASE_CONFIG__ = {
                apiKey: "e2e-test-key",
                authDomain: "e2e-test.firebaseapp.com",
                projectId: "e2e-test",
                storageBucket: "e2e-test.appspot.com",
                messagingSenderId: "000000000000",
                appId: "1:000000000000:web:0000000000000000"
            };`,
        });
    });

    // Inject mock auth user and billing data
    await page.addInitScript((data) => {
        window.__E2E_USER__ = data.user;
        window.__E2E_DATA__ = data.state;
    }, { user: E2E_USER, state: E2E_DATA });
}
