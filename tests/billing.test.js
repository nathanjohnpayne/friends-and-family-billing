const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scriptSource = fs.readFileSync(
    path.join(__dirname, '..', 'script.js'),
    'utf8'
);

// No stripping needed — document.addEventListener is mocked as a no-op,
// so the DOMContentLoaded callback never fires.

function createContext(overrides = {}) {
    const saved = [];
    const ctx = {
        familyMembers: [],
        bills: [],
        settings: { emailMessage: 'Pay %total now.' },
        currentUser: { uid: 'test-user' },

        // Minimal DOM stubs
        document: {
            addEventListener: () => {},
            getElementById: () => ({
                innerHTML: '',
                textContent: '',
                value: '',
            }),
            querySelectorAll: () => [],
            createElement: (tag) => ({
                type: '',
                accept: '',
                click: () => {},
                onchange: null,
                getContext: () => ({
                    fillStyle: '',
                    fillRect: () => {},
                    drawImage: () => {},
                }),
                toDataURL: () => 'data:image/png;base64,stub',
                width: 0,
                height: 0,
            }),
        },
        window: {
            location: { href: '' },
            open: () => ({
                document: { write: () => {}, close: () => {} },
            }),
        },
        alert: () => {},
        confirm: () => true,
        prompt: () => null,
        console,
        Date,
        Math,
        parseInt,
        parseFloat,
        isNaN,
        NaN,
        Set,
        String,
        Object,
        Array,
        Promise,
        setTimeout,
        clearTimeout,
        Image: class {
            set src(v) {
                if (this.onload) this.onload();
            }
        },
        FileReader: class {},
        encodeURIComponent,

        firebase: {
            firestore: {
                FieldValue: { serverTimestamp: () => new Date() },
            },
        },
        auth: {
            onAuthStateChanged: () => {},
            signOut: () => Promise.resolve(),
        },
        db: {
            collection: () => ({
                doc: () => ({
                    set: (...args) => {
                        saved.push(args);
                        return Promise.resolve();
                    },
                    get: () =>
                        Promise.resolve({ exists: false }),
                }),
            }),
        },
        analytics: { logEvent: () => {} },
        ...overrides,
    };

    ctx._saved = saved;
    vm.createContext(ctx);
    vm.runInContext(scriptSource, ctx);
    return ctx;
}

// ───────────────────────── escapeHtml ─────────────────────────

describe('escapeHtml', () => {
    let ctx;
    beforeEach(() => { ctx = createContext(); });

    it('returns empty string for falsy input', () => {
        assert.equal(ctx.escapeHtml(''), '');
        assert.equal(ctx.escapeHtml(null), '');
        assert.equal(ctx.escapeHtml(undefined), '');
    });

    it('escapes HTML special characters', () => {
        assert.equal(
            ctx.escapeHtml('<script>alert("xss")</script>'),
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('escapes ampersands and single quotes', () => {
        assert.equal(ctx.escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#039;s");
    });

    it('passes through safe strings unchanged', () => {
        assert.equal(ctx.escapeHtml('John Doe'), 'John Doe');
    });
});

// ───────────────────── calculateAnnualSummary ─────────────────

describe('calculateAnnualSummary', () => {
    let ctx;

    beforeEach(() => {
        ctx = createContext();
    });

    it('returns empty summary when no members or bills', () => {
        const summary = ctx.calculateAnnualSummary();
        assert.deepEqual(summary, {});
    });

    it('returns zero totals when members exist but no bills', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 0);
        assert.equal(summary[1].bills.length, 0);
    });

    it('splits a bill evenly among assigned members', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'Internet', amount: 120, logo: '', website: '', members: [1, 2] },
        ];

        const summary = ctx.calculateAnnualSummary();
        // $120/mo split 2 ways = $60/mo each, $720/yr each
        assert.equal(summary[1].total, 720);
        assert.equal(summary[2].total, 720);
        assert.equal(summary[1].bills.length, 1);
        assert.equal(summary[1].bills[0].monthlyShare, 60);
        assert.equal(summary[1].bills[0].annualShare, 720);
    });

    it('excludes members not assigned to a bill', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'Netflix', amount: 20, logo: '', website: '', members: [1] },
        ];

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 240); // $20 * 12
        assert.equal(summary[2].total, 0);
    });

    it('accumulates across multiple bills', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'A', amount: 10, logo: '', website: '', members: [1] },
            { id: 101, name: 'B', amount: 30, logo: '', website: '', members: [1] },
        ];

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, (10 + 30) * 12);
        assert.equal(summary[1].bills.length, 2);
    });

    it('handles a bill with no members assigned', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'Orphan', amount: 50, logo: '', website: '', members: [] },
        ];

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 0);
    });
});

// ───────────────────────── updatePayment ──────────────────────

describe('updatePayment', () => {
    let ctx;

    beforeEach(() => {
        ctx = createContext();
    });

    it('sets paymentReceived on a simple (unlinked) member', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'Net', amount: 100, logo: '', website: '', members: [1] },
        ];

        ctx.updatePayment(1, '500');
        assert.equal(ctx.familyMembers[0].paymentReceived, 500);
    });

    it('clamps negative values to zero', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'Net', amount: 100, logo: '', website: '', members: [1] },
        ];

        ctx.updatePayment(1, '-50');
        assert.equal(ctx.familyMembers[0].paymentReceived, 0);
    });

    it('distributes payment proportionally among linked members', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'Phone', amount: 100, logo: '', website: '', members: [1, 2] },
        ];

        // Both owe $50/mo = $600/yr each, combined $1200
        ctx.updatePayment(1, '600');

        // Parent stores full payment
        assert.equal(ctx.familyMembers[0].paymentReceived, 600);
        // Child gets proportional share: 600 * (600/1200) = 300
        assert.equal(ctx.familyMembers[1].paymentReceived, 300);
    });

    it('distributes proportionally with unequal bill assignments', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            // Both on this bill
            { id: 100, name: 'Phone', amount: 100, logo: '', website: '', members: [1, 2] },
            // Only parent on this bill
            { id: 101, name: 'Insurance', amount: 200, logo: '', website: '', members: [1] },
        ];

        // Parent: $50/mo + $200/mo = $250/mo = $3000/yr
        // Child: $50/mo = $600/yr
        // Combined: $3600
        const payment = 1800;
        ctx.updatePayment(1, String(payment));

        const parentTotal = 3000;
        const childTotal = 600;
        const combined = parentTotal + childTotal;
        const expectedChild = payment * (childTotal / combined);

        assert.equal(ctx.familyMembers[0].paymentReceived, payment);
        assert.ok(
            Math.abs(ctx.familyMembers[1].paymentReceived - expectedChild) < 0.01,
            `Child payment ${ctx.familyMembers[1].paymentReceived} should be ~${expectedChild}`
        );
    });

    it('handles zero combined total without NaN', () => {
        ctx.familyMembers = [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [];

        ctx.updatePayment(1, '100');
        assert.equal(ctx.familyMembers[0].paymentReceived, 100);
        assert.equal(ctx.familyMembers[1].paymentReceived, 0);
    });
});

// ─────────────────── manageLinkMembers ────────────────────────

describe('manageLinkMembers', () => {
    let ctx;

    it('preserves existing links in the available members list', () => {
        let promptMessage = '';
        ctx = createContext({
            prompt: (msg) => {
                promptMessage = msg;
                return null; // cancel
            },
        });

        ctx.familyMembers = [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 3, name: 'Other', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];

        ctx.manageLinkMembers(1);

        // Both Child (already linked) and Other (unlinked) should appear
        assert.ok(promptMessage.includes('Child'), 'Already-linked child should appear in list');
        assert.ok(promptMessage.includes('[LINKED]'), 'Already-linked child should be marked');
        assert.ok(promptMessage.includes('Other'), 'Unlinked member should appear');
    });

    it('does not show members linked to a different parent', () => {
        let promptMessage = '';
        ctx = createContext({
            prompt: (msg) => {
                promptMessage = msg;
                return null;
            },
        });

        ctx.familyMembers = [
            { id: 1, name: 'Parent1', email: '', avatar: '', paymentReceived: 0, linkedMembers: [3] },
            { id: 2, name: 'Parent2', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 3, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];

        ctx.manageLinkMembers(2);

        // Child is linked to Parent1, should NOT appear for Parent2
        assert.ok(!promptMessage.includes('Child'), 'Child linked to another parent should not appear');
    });
});

// ──────────────────────── clearAllData ─────────────────────────

describe('clearAllData', () => {
    it('resets arrays and persists to Firestore', async () => {
        const ctx = createContext({
            confirm: () => true,
            alert: () => {},
        });

        ctx.familyMembers = [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];
        ctx.bills = [
            { id: 100, name: 'X', amount: 10, logo: '', website: '', members: [1] },
        ];

        await ctx.clearAllData();

        assert.equal(ctx.familyMembers.length, 0);
        assert.equal(ctx.bills.length, 0);
        assert.ok(ctx._saved.length > 0, 'saveData should have been called (Firestore write)');
    });
});

// ──────────────────────── importFromLocalStorage ──────────────

describe('importFromLocalStorage', () => {
    it('replaces existing data with imported data', async () => {
        const storage = {
            familyMembers: JSON.stringify([
                { id: 99, name: 'Imported', email: 'i@e.com' },
            ]),
            bills: JSON.stringify([
                { id: 200, name: 'ImportedBill', amount: 50 },
            ]),
            settings: null,
        };

        const ctx = createContext({
            confirm: () => true,
            alert: () => {},
            localStorage: {
                getItem: (key) => storage[key] || null,
            },
        });

        ctx.familyMembers = [
            { id: 1, name: 'Existing', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ];

        await ctx.importFromLocalStorage();

        assert.equal(ctx.familyMembers.length, 1);
        assert.equal(ctx.familyMembers[0].name, 'Imported');
        assert.equal(ctx.bills.length, 1);
        assert.equal(ctx.bills[0].name, 'ImportedBill');
    });
});

// ──────────────────── URL validation ──────────────────────────

describe('editBillWebsite URL validation', () => {
    it('rejects non-http URLs', () => {
        const alerts = [];
        const ctx = createContext({
            prompt: () => 'javascript:alert(1)',
            alert: (msg) => alerts.push(msg),
        });

        ctx.bills = [
            { id: 1, name: 'Test', amount: 10, logo: '', website: '', members: [] },
        ];

        ctx.editBillWebsite(1);
        assert.equal(ctx.bills[0].website, '', 'Website should not be set to javascript: URL');
        assert.ok(alerts.some(a => a.includes('http')), 'Should warn about URL format');
    });

    it('accepts valid https URLs', () => {
        const ctx = createContext({
            prompt: () => 'https://example.com',
            alert: () => {},
        });

        ctx.bills = [
            { id: 1, name: 'Test', amount: 10, logo: '', website: '', members: [] },
        ];

        ctx.editBillWebsite(1);
        assert.equal(ctx.bills[0].website, 'https://example.com');
    });
});
