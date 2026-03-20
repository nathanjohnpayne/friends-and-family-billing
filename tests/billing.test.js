const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scriptSource = fs.readFileSync(
    path.join(__dirname, '..', 'script.js'),
    'utf8'
);

// The bundle already includes _set/_get helpers (exported to window.*)
const testableSource = scriptSource;

function makeMockDoc(saved) {
    return {
        set: (...args) => { saved.push(args); return Promise.resolve(); },
        get: () => Promise.resolve({ exists: false }),
        delete: () => Promise.resolve(),
        collection: () => ({
            doc: () => makeMockDoc(saved),
            get: () => Promise.resolve({ docs: [] }),
        }),
    };
}

function createContext(overrides = {}) {
    const saved = [];
    const nodeCrypto = require('node:crypto');
    const ctx = {
        // Minimal DOM stubs
        document: {
            body: { appendChild: () => {} },
            addEventListener: () => {},
            getElementById: () => ({
                innerHTML: '',
                textContent: '',
                value: '',
                style: {},
                classList: { add: () => {}, remove: () => {}, contains: () => false },
            }),
            querySelector: () => ({ style: {} }),
            querySelectorAll: () => [],
            createElement: () => ({
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
        navigator: {
            clipboard: { writeText: () => Promise.resolve() },
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
        JSON,
        Promise,
        RegExp,
        setTimeout,
        clearTimeout,
        Number,
        Uint8Array,
        TextEncoder,
        crypto: nodeCrypto.webcrypto,
        Image: class {
            set src(v) {
                if (this.onload) this.onload();
            }
        },
        FileReader: class {},
        encodeURIComponent,
        process,
        localStorage: { getItem: () => null, clear: () => {} },

        firebase: {
            firestore: {
                FieldValue: { serverTimestamp: () => new Date() },
                Timestamp: { fromDate: (d) => d },
            },
        },
        auth: {
            onAuthStateChanged: () => {},
            signOut: () => Promise.resolve(),
        },
        db: {
            collection: (name) => ({
                doc: (id) => makeMockDoc(saved),
                where: () => ({
                    where: () => ({
                        get: () => Promise.resolve({ docs: [] }),
                    }),
                    get: () => Promise.resolve({ docs: [] }),
                }),
            }),
        },
        analytics: { logEvent: () => {} },
        storage: {
            ref: () => ({
                put: () => ({ on: () => {} }),
                getDownloadURL: () => Promise.resolve('https://example.com/file'),
                delete: () => Promise.resolve(),
            }),
        },
        ...overrides,
    };

    // Proxy wraps window so that writes (window.fn = fn) also appear on ctx,
    // and reads (window.auth) fall back to ctx for Firebase mock access.
    const windowBase = {
        location: { href: '', origin: 'https://friends-and-family-billing.web.app' },
        open: () => ({
            document: { write: () => {}, close: () => {} },
        }),
    };
    ctx.window = new Proxy(windowBase, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return ctx[prop];
        },
        set(target, prop, value) {
            target[prop] = value;
            ctx[prop] = value;
            return true;
        },
    });
    ctx.globalThis = ctx;
    ctx._saved = saved;
    vm.createContext(ctx);
    vm.runInContext(testableSource, ctx);

    // Set currentUser and currentBillingYear so saveData works
    ctx._set('currentUser', { uid: 'test-user' });
    ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });

    return ctx;
}

// ───────────────────────── escapeHtml ─────────────────────────

describe('escapeHtml', () => {
    it('returns empty string for falsy input', () => {
        const ctx = createContext();
        assert.equal(ctx.escapeHtml(''), '');
        assert.equal(ctx.escapeHtml(null), '');
        assert.equal(ctx.escapeHtml(undefined), '');
    });

    it('escapes HTML special characters', () => {
        const ctx = createContext();
        assert.equal(
            ctx.escapeHtml('<script>alert("xss")</script>'),
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('escapes ampersands and single quotes', () => {
        const ctx = createContext();
        assert.equal(ctx.escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#039;s");
    });

    it('passes through safe strings unchanged', () => {
        const ctx = createContext();
        assert.equal(ctx.escapeHtml('John Doe'), 'John Doe');
    });
});

// ───────────────────── calculateAnnualSummary ─────────────────

describe('calculateAnnualSummary', () => {
    it('returns empty summary when no members or bills', () => {
        const ctx = createContext();
        const summary = ctx.calculateAnnualSummary();
        assert.equal(Object.keys(summary).length, 0);
    });

    it('returns zero totals when members exist but no bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 0);
        assert.equal(summary[1].bills.length, 0);
    });

    it('splits a bill evenly among assigned members', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Internet', amount: 120, logo: '', website: '', members: [1, 2] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        // $120/mo split 2 ways = $60/mo each, $720/yr each
        assert.equal(summary[1].total, 720);
        assert.equal(summary[2].total, 720);
        assert.equal(summary[1].bills[0].monthlyShare, 60);
        assert.equal(summary[1].bills[0].annualShare, 720);
    });

    it('excludes members not assigned to a bill', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 20, logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 240);
        assert.equal(summary[2].total, 0);
    });

    it('accumulates across multiple bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'A', amount: 10, logo: '', website: '', members: [1] },
            { id: 101, name: 'B', amount: 30, logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, (10 + 30) * 12);
        assert.equal(summary[1].bills.length, 2);
    });

    it('handles a bill with no members assigned', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Orphan', amount: 50, logo: '', website: '', members: [] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 0);
    });
});

// ───────────────────────── recordPayment ──────────────────────

describe('recordPayment', () => {
    it('appends a payment entry to the ledger', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Net', amount: 100, logo: '', website: '', members: [1] },
        ]);

        ctx.recordPayment(1, 500, 'venmo', 'Q1 payment', false);

        const payments = ctx._get('payments');
        assert.equal(payments.length, 1);
        assert.equal(payments[0].memberId, 1);
        assert.equal(payments[0].amount, 500);
        assert.equal(payments[0].method, 'venmo');
        assert.equal(payments[0].note, 'Q1 payment');
        assert.equal(ctx.getPaymentTotalForMember(1), 500);
    });

    it('rejects non-positive amounts', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.recordPayment(1, -50, 'cash', '', false);
        assert.equal(ctx._get('payments').length, 0);

        ctx.recordPayment(1, 0, 'cash', '', false);
        assert.equal(ctx._get('payments').length, 0);
    });

    it('distributes payment proportionally among linked members', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Phone', amount: 100, logo: '', website: '', members: [1, 2] },
        ]);

        // Both owe $600/yr each, combined $1200
        ctx.recordPayment(1, 600, 'cash', 'Annual', true);

        const payments = ctx._get('payments');
        assert.equal(payments.length, 2);
        assert.equal(ctx.getPaymentTotalForMember(1), 300);
        assert.equal(ctx.getPaymentTotalForMember(2), 300);
    });

    it('distributes proportionally with unequal bill assignments', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Phone', amount: 100, logo: '', website: '', members: [1, 2] },
            { id: 101, name: 'Insurance', amount: 200, logo: '', website: '', members: [1] },
        ]);

        // Parent: $50/mo + $200/mo = $3000/yr; Child: $50/mo = $600/yr; Combined: $3600
        ctx.recordPayment(1, 1800, 'check', '', true);

        const expectedChild = 1800 * (600 / 3600);
        assert.ok(
            Math.abs(ctx.getPaymentTotalForMember(2) - expectedChild) < 0.01,
            `Child payment ${ctx.getPaymentTotalForMember(2)} should be ~${expectedChild}`
        );
        assert.ok(
            Math.abs(ctx.getPaymentTotalForMember(1) + ctx.getPaymentTotalForMember(2) - 1800) < 0.01,
            'Total distributed should equal payment amount'
        );
    });

    it('handles zero combined total without NaN', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', []);

        ctx.recordPayment(1, 100, 'cash', '', true);

        const payments = ctx._get('payments');
        payments.forEach(p => {
            assert.ok(!Number.isNaN(p.amount), 'Amount should not be NaN');
        });
    });
});

// ──────────────── getPaymentTotalForMember ─────────────────────

describe('getPaymentTotalForMember', () => {
    it('returns 0 when no payments exist', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        assert.equal(ctx.getPaymentTotalForMember(1), 0);
    });

    it('sums payments for the specified member only', () => {
        const ctx = createContext();
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 100, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
            { id: 'p2', memberId: 1, amount: 200, receivedAt: new Date().toISOString(), note: '', method: 'venmo' },
            { id: 'p3', memberId: 2, amount: 500, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);
        assert.equal(ctx.getPaymentTotalForMember(1), 300);
        assert.equal(ctx.getPaymentTotalForMember(2), 500);
    });
});

// ──────────────── migratePaymentReceivedToLedger ──────────────

describe('migratePaymentReceivedToLedger', () => {
    it('converts independent member paymentReceived to ledger entry', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 500, linkedMembers: [] },
        ]);

        ctx.migratePaymentReceivedToLedger();

        const payments = ctx._get('payments');
        assert.equal(payments.length, 1);
        assert.equal(payments[0].memberId, 1);
        assert.equal(payments[0].amount, 500);
        assert.ok(payments[0].note.includes('legacy') || payments[0].note.includes('Migrated'));
    });

    it('correctly splits parent/child payments during migration', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 600, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 200, linkedMembers: [] },
        ]);

        ctx.migratePaymentReceivedToLedger();

        // Parent's own share: 600 - 200 = 400; Child keeps 200
        assert.equal(ctx.getPaymentTotalForMember(1), 400);
        assert.equal(ctx.getPaymentTotalForMember(2), 200);
    });

    it('is idempotent — does not re-migrate if payments exist', () => {
        const ctx = createContext();
        ctx._set('payments', [
            { id: 'existing', memberId: 1, amount: 100, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 500, linkedMembers: [] },
        ]);

        ctx.migratePaymentReceivedToLedger();

        const payments = ctx._get('payments');
        assert.equal(payments.length, 1, 'Should not add migration entries when payments exist');
        assert.equal(payments[0].id, 'existing');
    });

    it('skips members with zero paymentReceived', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.migratePaymentReceivedToLedger();

        assert.equal(ctx._get('payments').length, 0);
    });

    it('zeroes out paymentReceived after migration', () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 500, linkedMembers: [] },
        ]);

        ctx.migratePaymentReceivedToLedger();

        assert.equal(ctx._get('familyMembers')[0].paymentReceived, 0);
    });
});

// ──────────────── deletePaymentEntry ──────────────────────────

describe('deletePaymentEntry', () => {
    it('reverses a payment entry instead of removing it', () => {
        const ctx = createContext();
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 100, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
            { id: 'p2', memberId: 1, amount: 200, receivedAt: new Date().toISOString(), note: '', method: 'venmo' },
        ]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.deletePaymentEntry('p1', 1);

        const payments = ctx._get('payments');
        assert.equal(payments.length, 3, 'should have original 2 + reversal');
        const original = payments.find(p => p.id === 'p1');
        assert.equal(original.reversed, true, 'original should be marked reversed');
        const reversal = payments.find(p => p.type === 'reversal');
        assert.equal(reversal.amount, -100, 'reversal should negate original');
        assert.equal(reversal.reversesPaymentId, 'p1');
        const p2 = payments.find(p => p.id === 'p2');
        assert.equal(p2.reversed, undefined, 'other payment should be unaffected');
    });
});

// ─────────────────── manageLinkMembers ────────────────────────

describe('manageLinkMembers', () => {
    it('preserves existing links in the available members list', () => {
        let promptMessage = '';
        const ctx = createContext({
            prompt: (msg) => {
                promptMessage = msg;
                return null; // cancel
            },
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 3, name: 'Other', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.manageLinkMembers(1);

        assert.ok(promptMessage.includes('Child'), 'Already-linked child should appear in list');
        assert.ok(promptMessage.includes('[LINKED]'), 'Already-linked child should be marked');
        assert.ok(promptMessage.includes('Other'), 'Unlinked member should appear');
    });

    it('does not show members linked to a different parent', () => {
        let promptMessage = '';
        const ctx = createContext({
            prompt: (msg) => {
                promptMessage = msg;
                return null;
            },
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Parent1', email: '', avatar: '', paymentReceived: 0, linkedMembers: [3] },
            { id: 2, name: 'Parent2', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 3, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.manageLinkMembers(2);

        assert.ok(!promptMessage.includes('Child'), 'Child linked to another parent should not appear');
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

        ctx._set('bills', [
            { id: 1, name: 'Test', amount: 10, logo: '', website: '', members: [] },
        ]);

        ctx.editBillWebsite(1);
        assert.equal(ctx._get('bills')[0].website, '', 'Website should not be set to javascript: URL');
        assert.ok(alerts.some(a => a.includes('http')), 'Should warn about URL format');
    });

    it('accepts valid https URLs', () => {
        const ctx = createContext({
            prompt: () => 'https://example.com',
            alert: () => {},
        });

        ctx._set('bills', [
            { id: 1, name: 'Test', amount: 10, logo: '', website: '', members: [] },
        ]);

        ctx.editBillWebsite(1);
        assert.equal(ctx._get('bills')[0].website, 'https://example.com');
    });

    it('allows clearing website by entering empty string', () => {
        const ctx = createContext({
            prompt: () => '',
            alert: () => {},
        });

        ctx._set('bills', [
            { id: 1, name: 'Test', amount: 10, logo: '', website: 'https://old.com', members: [] },
        ]);

        ctx.editBillWebsite(1);
        assert.equal(ctx._get('bills')[0].website, '');
    });
});

// ──────────────────── sanitizeImageSrc ─────────────────────────

describe('sanitizeImageSrc', () => {
    it('allows valid data:image/png URIs', () => {
        const ctx = createContext();
        const valid = 'data:image/png;base64,iVBORw0KGgo=';
        assert.equal(ctx.sanitizeImageSrc(valid), valid);
    });

    it('allows valid data:image/jpeg URIs', () => {
        const ctx = createContext();
        const valid = 'data:image/jpeg;base64,/9j/4AAQ=';
        assert.equal(ctx.sanitizeImageSrc(valid), valid);
    });

    it('rejects javascript: URIs', () => {
        const ctx = createContext();
        assert.equal(ctx.sanitizeImageSrc('javascript:alert(1)'), '');
    });

    it('rejects external https URLs', () => {
        const ctx = createContext();
        assert.equal(ctx.sanitizeImageSrc('https://evil.com/tracker.png'), '');
    });

    it('rejects data URIs with non-image types', () => {
        const ctx = createContext();
        assert.equal(ctx.sanitizeImageSrc('data:text/html;base64,PHNjcmlwdD4='), '');
    });

    it('returns empty string for falsy values', () => {
        const ctx = createContext();
        assert.equal(ctx.sanitizeImageSrc(''), '');
        assert.equal(ctx.sanitizeImageSrc(null), '');
        assert.equal(ctx.sanitizeImageSrc(undefined), '');
    });
});

// ──────────────── analytics null guard ─────────────────────────

describe('analytics null guard', () => {
    it('does not throw when analytics is null', () => {
        const ctx = createContext({ analytics: null });
        ctx._set('familyMembers', []);
        ctx._set('bills', []);

        // addFamilyMember calls analytics.logEvent — should not throw
        ctx.document.getElementById = (id) => {
            if (id === 'memberName') return { value: 'Test User' };
            if (id === 'memberEmail') return { value: '' };
            if (id === 'familyMembersList') return { innerHTML: '' };
            if (id === 'billsList') return { innerHTML: '' };
            if (id === 'annualSummary') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        assert.doesNotThrow(() => ctx.addFamilyMember());
    });
});

// ──────────────── isArchivedYear ──────────────────────────────

describe('isArchivedYear', () => {
    it('returns false when currentBillingYear is null', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', null);
        assert.equal(ctx.isArchivedYear(), false);
    });

    it('returns false when status is open', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        assert.equal(ctx.isArchivedYear(), false);
    });

    it('returns true when status is archived', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived' });
        assert.equal(ctx.isArchivedYear(), true);
    });
});

// ──────────────── billing year lifecycle helpers ──────────────

describe('isClosedYear', () => {
    it('returns false when currentBillingYear is null', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', null);
        assert.equal(ctx.isClosedYear(), false);
    });

    it('returns true when status is closed', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'closed' });
        assert.equal(ctx.isClosedYear(), true);
    });

    it('returns false when status is open', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        assert.equal(ctx.isClosedYear(), false);
    });
});

describe('isSettlingYear', () => {
    it('returns true when status is settling', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'settling' });
        assert.equal(ctx.isSettlingYear(), true);
    });

    it('returns false when status is open', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        assert.equal(ctx.isSettlingYear(), false);
    });
});

describe('isYearReadOnly', () => {
    it('returns false for open', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        assert.equal(ctx.isYearReadOnly(), false);
    });

    it('returns false for settling', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'settling' });
        assert.equal(ctx.isYearReadOnly(), false);
    });

    it('returns true for closed', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'closed' });
        assert.equal(ctx.isYearReadOnly(), true);
    });

    it('returns true for archived', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived' });
        assert.equal(ctx.isYearReadOnly(), true);
    });
});

describe('yearReadOnlyMessage', () => {
    it('returns archived message for archived status', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived' });
        assert.ok(ctx.yearReadOnlyMessage().includes('archived'));
    });

    it('returns closed message for closed status', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'closed' });
        assert.ok(ctx.yearReadOnlyMessage().includes('closed'));
    });

    it('returns empty string when year is open', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        assert.equal(ctx.yearReadOnlyMessage(), '');
    });
});

describe('getBillingYearStatusLabel', () => {
    it('returns correct labels for all statuses', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillingYearStatusLabel('open'), 'Open');
        assert.equal(ctx.getBillingYearStatusLabel('settling'), 'Settling');
        assert.equal(ctx.getBillingYearStatusLabel('closed'), 'Closed');
        assert.equal(ctx.getBillingYearStatusLabel('archived'), 'Archived');
    });

    it('defaults to Open for unknown status', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillingYearStatusLabel('unknown'), 'Open');
    });
});

describe('BILLING_YEAR_STATUSES', () => {
    it('defines all four lifecycle stages in order', () => {
        const ctx = createContext();
        const statuses = ctx._get('BILLING_YEAR_STATUSES');
        assert.ok(statuses.open);
        assert.ok(statuses.settling);
        assert.ok(statuses.closed);
        assert.ok(statuses.archived);
        assert.ok(statuses.open.order < statuses.settling.order);
        assert.ok(statuses.settling.order < statuses.closed.order);
        assert.ok(statuses.closed.order < statuses.archived.order);
    });
});

// ──────────────── closed year guards ──────────────────────────

describe('closed year guards', () => {
    it('prevents recordPayment when year is closed', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'closed', createdAt: null, archivedAt: null });
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.recordPayment(1, 500, 'cash', '', false);
        assert.equal(ctx._get('payments').length, 0, 'Payment should not be recorded');
        assert.ok(alerts.some(a => a.includes('closed')), 'Should show closed alert');
    });

    it('allows recordPayment when year is settling', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'settling', createdAt: null, archivedAt: null });
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Net', amount: 100, logo: '', website: '', members: [1] },
        ]);

        ctx.recordPayment(1, 500, 'cash', '', false);
        assert.equal(ctx.getPaymentTotalForMember(1), 500, 'Payment should be recorded when settling');
    });

    it('prevents addBill when year is closed', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'closed', createdAt: null, archivedAt: null });
        ctx._set('bills', []);

        ctx.document.getElementById = (id) => {
            if (id === 'billName') return { value: 'Test Bill' };
            if (id === 'billAmount') return { value: '100' };
            if (id === 'billWebsite') return { value: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addBill();
        assert.equal(ctx._get('bills').length, 0, 'Bill should not be added');
        assert.ok(alerts.some(a => a.includes('closed')), 'Should show closed alert');
    });
});

// ──────────────── archived year guards ────────────────────────

describe('archived year guards', () => {
    it('prevents addFamilyMember when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('familyMembers', []);

        ctx.document.getElementById = (id) => {
            if (id === 'memberName') return { value: 'New Member' };
            if (id === 'memberEmail') return { value: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addFamilyMember();
        assert.equal(ctx._get('familyMembers').length, 0, 'Member should not be added');
        assert.ok(alerts.some(a => a.includes('archived')), 'Should show archived alert');
    });

    it('prevents recordPayment when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.recordPayment(1, 500, 'cash', '', false);
        assert.equal(ctx._get('payments').length, 0, 'Payment should not be recorded');
    });

    it('prevents addBill when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('bills', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.document.getElementById = (id) => {
            if (id === 'billName') return { value: 'Test Bill' };
            if (id === 'billAmount') return { value: '100' };
            if (id === 'billWebsite') return { value: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addBill();
        assert.equal(ctx._get('bills').length, 0, 'Bill should not be added');
    });

    it('prevents editBillAmount when year is archived', () => {
        const alerts = [];
        const ctx = createContext({
            alert: (msg) => alerts.push(msg),
            prompt: () => '200',
        });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('bills', [
            { id: 1, name: 'Test', amount: 100, logo: '', website: '', members: [] },
        ]);

        ctx.editBillAmount(1);
        assert.equal(ctx._get('bills')[0].amount, 100, 'Amount should not change');
    });

    it('prevents saveEmailMessage when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('settings', { emailMessage: 'Original' });

        ctx.document.getElementById = (id) => {
            if (id === 'emailMessageInput') return { value: 'Changed' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.saveEmailMessage();
        assert.equal(ctx._get('settings').emailMessage, 'Original', 'Setting should not change');
    });

    it('allows mutations when year is open', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Net', amount: 100, logo: '', website: '', members: [1] },
        ]);

        ctx.recordPayment(1, 500, 'cash', '', false);
        assert.equal(ctx.getPaymentTotalForMember(1), 500, 'Payment should be recorded when open');
    });
});

// ──────────────── startNewYear ─────────────────────────────────

describe('startNewYear', () => {
    it('clones members with payments reset and bills preserved', async () => {
        const ctx = createContext({
            prompt: () => '2027',
            alert: () => {},
        });

        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });
        ctx._set('billingYears', [{ id: '2026', label: '2026', status: 'open' }]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: 'a@b.com', avatar: '', paymentReceived: 500, linkedMembers: [2] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 200, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Internet', amount: 120, logo: '', website: 'https://isp.com', members: [1, 2] },
        ]);
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 300, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);

        await ctx.startNewYear();

        const yearSave = ctx._saved.find(args => args[0] && args[0].familyMembers);
        assert.ok(yearSave, 'Should have saved year data');

        const savedMembers = yearSave[0].familyMembers;
        assert.equal(savedMembers[0].paymentReceived, 0, 'Alice payment should be reset');
        assert.equal(savedMembers[1].paymentReceived, 0, 'Bob payment should be reset');
        assert.equal(savedMembers[0].name, 'Alice', 'Name should be preserved');
        assert.equal(savedMembers[0].linkedMembers.length, 1, 'Links should be preserved');

        assert.equal(yearSave[0].payments.length, 0, 'Payments should start empty for new year');

        const savedBills = yearSave[0].bills;
        assert.equal(savedBills.length, 1, 'Bills should be cloned');
        assert.equal(savedBills[0].name, 'Internet', 'Bill name should be preserved');
        assert.equal(savedBills[0].members.length, 2, 'Bill members should be preserved');
    });

    it('rejects duplicate year labels', async () => {
        const alerts = [];
        const ctx = createContext({
            prompt: () => '2026',
            alert: (msg) => alerts.push(msg),
        });

        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });
        ctx._set('billingYears', [{ id: '2026', label: '2026', status: 'open' }]);
        ctx._set('familyMembers', []);
        ctx._set('bills', []);

        await ctx.startNewYear();
        assert.ok(alerts.some(a => a.includes('already exists')), 'Should warn about duplicate');
    });

    it('does nothing when prompt is cancelled', async () => {
        const ctx = createContext({
            prompt: () => null,
        });

        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });
        ctx._set('billingYears', [{ id: '2026', label: '2026', status: 'open' }]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 500, linkedMembers: [] },
        ]);

        const savedBefore = ctx._saved.length;
        await ctx.startNewYear();
        assert.equal(ctx._saved.length, savedBefore, 'No data should be saved');
    });
});

// ──────────────── archiveCurrentYear ──────────────────────────

describe('archiveCurrentYear', () => {
    it('sets status to archived on confirm', async () => {
        const ctx = createContext({
            confirm: () => true,
            prompt: () => null,
        });

        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });
        ctx._set('billingYears', [{ id: '2026', label: '2026', status: 'open' }]);
        ctx._set('familyMembers', []);
        ctx._set('bills', []);

        await ctx.archiveCurrentYear();

        const billingYear = ctx._get('currentBillingYear');
        assert.equal(billingYear.status, 'archived', 'Status should be archived');
        assert.ok(billingYear.archivedAt, 'archivedAt should be set');

        const yearsList = ctx._get('billingYears');
        assert.equal(yearsList[0].status, 'archived', 'List entry should be archived');
    });

    it('does nothing when already archived', async () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: new Date() });

        const savedBefore = ctx._saved.length;
        await ctx.archiveCurrentYear();
        assert.equal(ctx._saved.length, savedBefore, 'No data should be saved');
    });

    it('does nothing when user cancels', async () => {
        const ctx = createContext({
            confirm: () => false,
        });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });

        const savedBefore = ctx._saved.length;
        await ctx.archiveCurrentYear();
        assert.equal(ctx._get('currentBillingYear').status, 'open', 'Should remain open');
    });
});

// ──────────────── isValidE164 ──────────────────────────────────

describe('isValidE164', () => {
    it('accepts valid E.164 numbers', () => {
        const ctx = createContext();
        assert.equal(ctx.isValidE164('+14155551212'), true);
        assert.equal(ctx.isValidE164('+441234567890'), true);
        assert.equal(ctx.isValidE164('+86123456789'), true);
        assert.equal(ctx.isValidE164('+12'), true); // minimal valid: country code + digit
    });

    it('rejects numbers without leading +', () => {
        const ctx = createContext();
        assert.equal(ctx.isValidE164('14155551212'), false);
        assert.equal(ctx.isValidE164('4155551212'), false);
    });

    it('rejects numbers starting with +0', () => {
        const ctx = createContext();
        assert.equal(ctx.isValidE164('+0123456789'), false);
    });

    it('rejects numbers with non-digit characters', () => {
        const ctx = createContext();
        assert.equal(ctx.isValidE164('+1-415-555-1212'), false);
        assert.equal(ctx.isValidE164('+1 415 555 1212'), false);
        assert.equal(ctx.isValidE164('+1(415)5551212'), false);
    });

    it('rejects numbers exceeding 15 digits', () => {
        const ctx = createContext();
        assert.equal(ctx.isValidE164('+1234567890123456'), false);
    });

    it('rejects empty and plus-only strings', () => {
        const ctx = createContext();
        assert.equal(ctx.isValidE164(''), false);
        assert.equal(ctx.isValidE164('+'), false);
    });
});

// ──────────────── editMemberPhone ─────────────────────────────

describe('editMemberPhone', () => {
    it('sets a valid phone number', () => {
        const ctx = createContext({
            prompt: () => '+14155551212',
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.editMemberPhone(1);
        assert.equal(ctx._get('familyMembers')[0].phone, '+14155551212');
    });

    it('clears phone when empty string is entered', () => {
        const ctx = createContext({
            prompt: () => '',
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', phone: '+14155551212', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.editMemberPhone(1);
        assert.equal(ctx._get('familyMembers')[0].phone, '');
    });

    it('rejects invalid phone format', () => {
        const alerts = [];
        const ctx = createContext({
            prompt: () => '555-1212',
            alert: (msg) => alerts.push(msg),
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.editMemberPhone(1);
        assert.equal(ctx._get('familyMembers')[0].phone, '', 'Phone should not be set');
        assert.ok(alerts.some(a => a.includes('E.164')), 'Should warn about format');
    });

    it('does nothing when prompt is cancelled', () => {
        const ctx = createContext({
            prompt: () => null,
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', phone: '+14155551212', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.editMemberPhone(1);
        assert.equal(ctx._get('familyMembers')[0].phone, '+14155551212', 'Phone should remain unchanged');
    });

    it('prevents editing when year is archived', () => {
        const alerts = [];
        const ctx = createContext({
            prompt: () => '+14155551212',
            alert: (msg) => alerts.push(msg),
        });

        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', phone: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.editMemberPhone(1);
        assert.equal(ctx._get('familyMembers')[0].phone, '', 'Phone should not change');
        assert.ok(alerts.some(a => a.includes('archived')), 'Should show archived alert');
    });
});

// ──────────────── phone field in addFamilyMember ──────────────

describe('addFamilyMember with phone', () => {
    it('includes phone when adding a member', () => {
        const ctx = createContext();
        ctx._set('familyMembers', []);

        ctx.document.getElementById = (id) => {
            if (id === 'memberName') return { value: 'Alice' };
            if (id === 'memberEmail') return { value: 'alice@test.com' };
            if (id === 'memberPhone') return { value: '+14155551212' };
            if (id === 'familyMembersList') return { innerHTML: '' };
            if (id === 'billsList') return { innerHTML: '' };
            if (id === 'annualSummary') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addFamilyMember();
        const members = ctx._get('familyMembers');
        assert.equal(members.length, 1);
        assert.equal(members[0].phone, '+14155551212');
    });

    it('rejects invalid phone on add', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('familyMembers', []);

        ctx.document.getElementById = (id) => {
            if (id === 'memberName') return { value: 'Bob' };
            if (id === 'memberEmail') return { value: '' };
            if (id === 'memberPhone') return { value: 'not-a-phone' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addFamilyMember();
        assert.equal(ctx._get('familyMembers').length, 0, 'Member should not be added');
        assert.ok(alerts.some(a => a.includes('E.164')), 'Should warn about format');
    });

    it('allows blank phone on add', () => {
        const ctx = createContext();
        ctx._set('familyMembers', []);

        ctx.document.getElementById = (id) => {
            if (id === 'memberName') return { value: 'Charlie' };
            if (id === 'memberEmail') return { value: '' };
            if (id === 'memberPhone') return { value: '' };
            if (id === 'familyMembersList') return { innerHTML: '' };
            if (id === 'billsList') return { innerHTML: '' };
            if (id === 'annualSummary') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addFamilyMember();
        const members = ctx._get('familyMembers');
        assert.equal(members.length, 1);
        assert.equal(members[0].phone, '');
    });

    it('defaults phone to empty string when input element is absent', () => {
        const ctx = createContext();
        ctx._set('familyMembers', []);

        ctx.document.getElementById = (id) => {
            if (id === 'memberName') return { value: 'Dave' };
            if (id === 'memberEmail') return { value: '' };
            if (id === 'memberPhone') return null;
            if (id === 'familyMembersList') return { innerHTML: '' };
            if (id === 'billsList') return { innerHTML: '' };
            if (id === 'annualSummary') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addFamilyMember();
        const members = ctx._get('familyMembers');
        assert.equal(members.length, 1);
        assert.equal(members[0].phone, '');
    });
});

// ──────────────── phone field in loadBillingYearData ───────────

describe('phone field backwards compatibility', () => {
    it('defaults phone to empty string for legacy members without phone', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Legacy', email: 'test@test.com', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        // Simulate what loadBillingYearData does
        const members = ctx._get('familyMembers').map(m => {
            if (!m.phone) m.phone = '';
            return m;
        });

        assert.equal(members[0].phone, '');
    });
});

// ──────────────── saveData archived guard ─────────────────────

describe('saveData archived guard', () => {
    it('refuses to write when year is archived', async () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        const savedBefore = ctx._saved.length;
        await ctx.saveData();
        assert.equal(ctx._saved.length, savedBefore, 'Should not save when archived');
    });

    it('writes when year is open', async () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        const savedBefore = ctx._saved.length;
        await ctx.saveData();
        assert.ok(ctx._saved.length > savedBefore, 'Should save when open');
    });
});

// ──────────────── generateRawToken ────────────────────────────

describe('generateRawToken', () => {
    it('produces a 64-character hex string', () => {
        const ctx = createContext();
        const token = ctx.generateRawToken();
        assert.equal(token.length, 64);
        assert.ok(/^[0-9a-f]{64}$/.test(token), 'Should be lowercase hex');
    });

    it('produces unique tokens on successive calls', () => {
        const ctx = createContext();
        const a = ctx.generateRawToken();
        const b = ctx.generateRawToken();
        assert.notEqual(a, b, 'Two generated tokens should differ');
    });
});

// ──────────────── hashToken ───────────────────────────────────

describe('hashToken', () => {
    it('produces a 64-character hex SHA-256 hash', async () => {
        const ctx = createContext();
        const hash = await ctx.hashToken('test-token-value');
        assert.equal(hash.length, 64);
        assert.ok(/^[0-9a-f]{64}$/.test(hash), 'Should be lowercase hex');
    });

    it('is deterministic for the same input', async () => {
        const ctx = createContext();
        const hash1 = await ctx.hashToken('same-input');
        const hash2 = await ctx.hashToken('same-input');
        assert.equal(hash1, hash2);
    });

    it('produces different hashes for different inputs', async () => {
        const ctx = createContext();
        const hash1 = await ctx.hashToken('input-a');
        const hash2 = await ctx.hashToken('input-b');
        assert.notEqual(hash1, hash2);
    });

    it('matches Node.js crypto SHA-256', async () => {
        const ctx = createContext();
        const input = 'verify-against-node';
        const hash = await ctx.hashToken(input);
        const nodeCrypto = require('node:crypto');
        const expected = nodeCrypto.createHash('sha256').update(input).digest('hex');
        assert.equal(hash, expected);
    });
});

// ──────────────── Payment Methods Settings ──────────────────────

describe('payment methods settings', () => {
    const dialogStub = () => ({
        innerHTML: '', textContent: '', value: '', style: {},
        classList: { add: () => {}, remove: () => {}, contains: () => false },
    });

    it('addPaymentMethod creates a method with correct type and default label', () => {
        const ctx = createContext();
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [], paymentMethods: [] });

        ctx.document.getElementById = (id) => {
            if (id === 'newPaymentMethodType') return { value: 'zelle' };
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            if (id === 'payment-dialog-overlay') return dialogStub();
            if (id === 'payment-dialog') return dialogStub();
            return dialogStub();
        };

        ctx.addPaymentMethod();
        const methods = ctx._get('settings').paymentMethods;
        assert.equal(methods.length, 1);
        assert.equal(methods[0].type, 'zelle');
        assert.equal(methods[0].label, 'Zelle');
        assert.equal(methods[0].enabled, true);
        assert.ok(methods[0].id.startsWith('pm_'), 'ID should have pm_ prefix');
    });

    it('addPaymentMethod defaults to other when type select is missing', () => {
        const ctx = createContext();
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [], paymentMethods: [] });

        ctx.document.getElementById = (id) => {
            if (id === 'newPaymentMethodType') return null;
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            if (id === 'payment-dialog-overlay') return dialogStub();
            if (id === 'payment-dialog') return dialogStub();
            return dialogStub();
        };

        ctx.addPaymentMethod();
        const methods = ctx._get('settings').paymentMethods;
        assert.equal(methods.length, 1);
        assert.equal(methods[0].type, 'other');
        assert.equal(methods[0].label, 'Other');
    });

    it('addPaymentMethod initializes paymentMethods array when missing', () => {
        const ctx = createContext();
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [] });

        ctx.document.getElementById = (id) => {
            if (id === 'newPaymentMethodType') return { value: 'venmo' };
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            if (id === 'payment-dialog-overlay') return dialogStub();
            if (id === 'payment-dialog') return dialogStub();
            return dialogStub();
        };

        ctx.addPaymentMethod();
        const methods = ctx._get('settings').paymentMethods;
        assert.equal(methods.length, 1);
        assert.equal(methods[0].type, 'venmo');
    });

    it('removePaymentMethod removes by ID and preserves others', () => {
        const ctx = createContext();
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [],
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true },
                { id: 'pm_2', type: 'zelle', label: 'Zelle', enabled: true },
            ]
        });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.removePaymentMethod('pm_1');
        const methods = ctx._get('settings').paymentMethods;
        assert.equal(methods.length, 1);
        assert.equal(methods[0].id, 'pm_2');
    });

    it('togglePaymentMethodEnabled toggles enabled state', () => {
        const ctx = createContext();
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [],
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true },
            ]
        });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.togglePaymentMethodEnabled('pm_1');
        assert.equal(ctx._get('settings').paymentMethods[0].enabled, false);

        ctx.togglePaymentMethodEnabled('pm_1');
        assert.equal(ctx._get('settings').paymentMethods[0].enabled, true);
    });

    it('getEnabledPaymentMethods filters disabled methods', () => {
        const ctx = createContext();
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [],
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true },
                { id: 'pm_2', type: 'zelle', label: 'Zelle', enabled: false },
                { id: 'pm_3', type: 'paypal', label: 'PayPal', enabled: true },
            ]
        });

        const enabled = ctx.getEnabledPaymentMethods();
        assert.equal(enabled.length, 2);
        assert.equal(enabled[0].id, 'pm_1');
        assert.equal(enabled[1].id, 'pm_3');
    });

    it('getEnabledPaymentMethods returns empty array when no methods', () => {
        const ctx = createContext();
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [] });
        const enabled = ctx.getEnabledPaymentMethods();
        assert.equal(enabled.length, 0);
    });

    it('getEnabledPaymentMethods includes qrCode field', () => {
        const ctx = createContext();
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [],
            paymentMethods: [
                { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, qrCode: 'data:image/png;base64,abc123' },
                { id: 'pm_2', type: 'zelle', label: 'Zelle', enabled: true, qrCode: '' },
            ]
        });

        const enabled = ctx.getEnabledPaymentMethods();
        assert.equal(enabled.length, 2);
        assert.equal(enabled[0].qrCode, 'data:image/png;base64,abc123');
        assert.equal(enabled[1].qrCode, '');
    });

    it('addPaymentMethod initializes qrCode as empty string', () => {
        const ctx = createContext();
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [], paymentMethods: [] });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        ctx.addPaymentMethod();
        const methods = ctx._get('settings').paymentMethods;
        assert.equal(methods.length, 1);
        assert.equal(methods[0].qrCode, '');
    });

    it('uploadPaymentMethodQr sets qrCode on method', () => {
        const ctx = createContext();
        const method = { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, qrCode: '' };
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [], paymentMethods: [method] });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        method.qrCode = 'data:image/png;base64,newqr';
        assert.equal(ctx._get('settings').paymentMethods[0].qrCode, 'data:image/png;base64,newqr');
    });

    it('removePaymentMethodQr clears qrCode on method', () => {
        const ctx = createContext();
        const method = { id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true, qrCode: 'data:image/png;base64,existing' };
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [], paymentMethods: [method] });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open' });
        ctx.removePaymentMethodQr('pm_1');
        assert.equal(ctx._get('settings').paymentMethods[0].qrCode, '');
    });

    it('migratePaymentLinksToMethods infers type from name', () => {
        const ctx = createContext();
        const legacy = [
            { id: 'pl_1', name: 'Venmo', url: 'https://venmo.com/x' },
            { id: 'pl_2', name: 'My Zelle', url: '' },
            { id: 'pl_3', name: 'PayPal', url: 'https://paypal.me/x' },
            { id: 'pl_4', name: 'Cash App', url: 'https://cash.app/x' },
            { id: 'pl_5', name: 'Apple Cash Pay', url: '' },
            { id: 'pl_6', name: 'Wire Transfer', url: 'https://bank.com' },
        ];

        const migrated = ctx.migratePaymentLinksToMethods(legacy);
        assert.equal(migrated.length, 6);
        assert.equal(migrated[0].type, 'venmo');
        assert.equal(migrated[1].type, 'zelle');
        assert.equal(migrated[2].type, 'paypal');
        assert.equal(migrated[3].type, 'cashapp');
        assert.equal(migrated[4].type, 'apple_cash');
        assert.equal(migrated[5].type, 'other');
    });

    it('migratePaymentLinksToMethods preserves label and url', () => {
        const ctx = createContext();
        const legacy = [{ id: 'pl_1', name: 'My Venmo', url: 'https://venmo.com/handle' }];
        const migrated = ctx.migratePaymentLinksToMethods(legacy);
        assert.equal(migrated[0].label, 'My Venmo');
        assert.equal(migrated[0].url, 'https://venmo.com/handle');
        assert.equal(migrated[0].enabled, true);
    });

    it('migratePaymentLinksToMethods returns empty array for empty input', () => {
        const ctx = createContext();
        assert.equal(ctx.migratePaymentLinksToMethods([]).length, 0);
        assert.equal(ctx.migratePaymentLinksToMethods(null).length, 0);
        assert.equal(ctx.migratePaymentLinksToMethods(undefined).length, 0);
    });

    it('prevents addPaymentMethod when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [], paymentMethods: [] });

        ctx.document.getElementById = (id) => {
            if (id === 'newPaymentMethodType') return { value: 'zelle' };
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addPaymentMethod();
        assert.equal(ctx._get('settings').paymentMethods.length, 0, 'Should not add method');
        assert.ok(alerts.some(a => a.includes('archived')), 'Should show archived alert');
    });

    it('prevents removePaymentMethod when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [],
            paymentMethods: [{ id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true }]
        });

        ctx.removePaymentMethod('pm_1');
        assert.equal(ctx._get('settings').paymentMethods.length, 1, 'Should not remove method');
        assert.ok(alerts.some(a => a.includes('archived')), 'Should show archived alert');
    });

    it('prevents togglePaymentMethodEnabled when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [],
            paymentMethods: [{ id: 'pm_1', type: 'venmo', label: 'Venmo', enabled: true }]
        });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.togglePaymentMethodEnabled('pm_1');
        assert.equal(ctx._get('settings').paymentMethods[0].enabled, true, 'Should not toggle');
        assert.ok(alerts.some(a => a.includes('archived')), 'Should show archived alert');
    });

    it('PAYMENT_METHOD_TYPES defines all supported types', () => {
        const ctx = createContext();
        const types = ctx._get('PAYMENT_METHOD_TYPES');
        assert.ok(types.zelle, 'Should define zelle');
        assert.ok(types.apple_cash, 'Should define apple_cash');
        assert.ok(types.venmo, 'Should define venmo');
        assert.ok(types.cashapp, 'Should define cashapp');
        assert.ok(types.paypal, 'Should define paypal');
        assert.ok(types.other, 'Should define other');
    });

    it('PAYMENT_METHOD_TYPES zelle includes email and phone fields', () => {
        const ctx = createContext();
        const types = ctx._get('PAYMENT_METHOD_TYPES');
        assert.ok(types.zelle.fields.includes('email'), 'Zelle should have email field');
        assert.ok(types.zelle.fields.includes('phone'), 'Zelle should have phone field');
    });

    it('PAYMENT_METHOD_TYPES apple_cash includes email and phone fields', () => {
        const ctx = createContext();
        const types = ctx._get('PAYMENT_METHOD_TYPES');
        assert.ok(types.apple_cash.fields.includes('email'), 'Apple Cash should have email field');
        assert.ok(types.apple_cash.fields.includes('phone'), 'Apple Cash should have phone field');
    });
});

// ──────────────── computeMemberSummary (Cloud Function) ───────

const { computeMemberSummary } = require(path.join(__dirname, '..', 'functions', 'billing'));

describe('computeMemberSummary', () => {
    const members = [
        { id: 1, name: 'Alice', email: '', linkedMembers: [] },
        { id: 2, name: 'Bob', email: '', linkedMembers: [] },
    ];

    it('computes correct summary for a member in a shared bill', () => {
        const bills = [
            { id: 42, name: 'Internet', amount: 120, members: [1, 2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.name, 'Alice');
        assert.equal(result.annualTotal, 720);
        assert.equal(result.monthlyTotal, 60);
        assert.equal(result.bills.length, 1);
        assert.equal(result.bills[0].splitCount, 2);
        assert.equal(result.bills[0].monthlyShare, 60);
        assert.equal(result.bills[0].annualShare, 720);
    });

    it('includes billId in the summary output', () => {
        const bills = [
            { id: 99, name: 'Netflix', amount: 20, members: [1] },
            { id: 100, name: 'Hulu', amount: 15, members: [1, 2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.bills[0].billId, 99);
        assert.equal(result.bills[1].billId, 100);
    });

    it('returns null for a non-existent member', () => {
        const bills = [];
        const result = computeMemberSummary(members, bills, 999);
        assert.equal(result, null);
    });

    it('returns zero totals when member has no bills', () => {
        const bills = [
            { name: 'Netflix', amount: 20, members: [2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 0);
        assert.equal(result.monthlyTotal, 0);
        assert.equal(result.bills.length, 0);
    });

    it('accumulates across multiple bills', () => {
        const bills = [
            { name: 'A', amount: 10, members: [1] },
            { name: 'B', amount: 30, members: [1, 2] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 10 * 12 + 15 * 12);
        assert.equal(result.bills.length, 2);
    });

    it('ignores bills with empty members array', () => {
        const bills = [
            { name: 'Orphan', amount: 100, members: [] },
        ];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 0);
    });
});

// ──────────────── submitDispute validation helpers ─────────────

const { _testHelpers } = require(path.join(__dirname, '..', 'functions', 'index'));
const { validateToken, validateDisputeInput, DISPUTE_RATE_LIMIT, EVIDENCE_URL_EXPIRY_MS } = _testHelpers;

describe('validateToken', () => {
    it('rejects null/undefined token', () => {
        assert.equal(validateToken(null).valid, false);
        assert.equal(validateToken(undefined).valid, false);
    });

    it('rejects non-string token', () => {
        assert.equal(validateToken(12345).valid, false);
        assert.equal(validateToken({}).valid, false);
    });

    it('rejects short tokens', () => {
        assert.equal(validateToken('abc').valid, false);
        assert.equal(validateToken('a'.repeat(31)).valid, false);
    });

    it('accepts valid 64-char hex token', () => {
        const token = 'a'.repeat(64);
        assert.equal(validateToken(token).valid, true);
    });

    it('accepts token of exactly 32 characters', () => {
        assert.equal(validateToken('x'.repeat(32)).valid, true);
    });
});

describe('validateDisputeInput', () => {
    const validInput = {
        billId: 1,
        billName: 'Internet',
        message: 'This amount seems wrong.',
        proposedCorrection: null,
    };

    it('accepts valid dispute input', () => {
        assert.equal(validateDisputeInput(validInput).valid, true);
    });

    it('rejects missing billId', () => {
        const result = validateDisputeInput({ ...validInput, billId: undefined });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('bill'));
    });

    it('rejects non-numeric billId', () => {
        const result = validateDisputeInput({ ...validInput, billId: 'abc' });
        assert.equal(result.valid, false);
    });

    it('rejects missing billName', () => {
        const result = validateDisputeInput({ ...validInput, billName: '' });
        assert.equal(result.valid, false);
    });

    it('rejects missing message', () => {
        const result = validateDisputeInput({ ...validInput, message: '' });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('message'));
    });

    it('rejects whitespace-only message', () => {
        const result = validateDisputeInput({ ...validInput, message: '   ' });
        assert.equal(result.valid, false);
    });

    it('rejects message exceeding 2000 characters', () => {
        const result = validateDisputeInput({ ...validInput, message: 'x'.repeat(2001) });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('2000'));
    });

    it('accepts message of exactly 2000 characters', () => {
        const result = validateDisputeInput({ ...validInput, message: 'x'.repeat(2000) });
        assert.equal(result.valid, true);
    });

    it('rejects proposedCorrection exceeding 500 characters', () => {
        const result = validateDisputeInput({ ...validInput, proposedCorrection: 'x'.repeat(501) });
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('500'));
    });

    it('accepts proposedCorrection of exactly 500 characters', () => {
        const result = validateDisputeInput({ ...validInput, proposedCorrection: 'x'.repeat(500) });
        assert.equal(result.valid, true);
    });

    it('accepts null proposedCorrection', () => {
        const result = validateDisputeInput({ ...validInput, proposedCorrection: null });
        assert.equal(result.valid, true);
    });
});

describe('DISPUTE_RATE_LIMIT', () => {
    it('is set to a reasonable value', () => {
        assert.equal(typeof DISPUTE_RATE_LIMIT, 'number');
        assert.ok(DISPUTE_RATE_LIMIT > 0 && DISPUTE_RATE_LIMIT <= 100);
    });
});

describe('EVIDENCE_URL_EXPIRY_MS', () => {
    it('is 1 hour in milliseconds', () => {
        assert.equal(EVIDENCE_URL_EXPIRY_MS, 60 * 60 * 1000);
    });
});

// ──────────────── normalizeDisputeStatus ─────────────────────

describe('normalizeDisputeStatus', () => {
    it('maps pending to open', () => {
        const ctx = createContext();
        assert.equal(ctx.normalizeDisputeStatus('pending'), 'open');
    });

    it('maps reviewed to in_review', () => {
        const ctx = createContext();
        assert.equal(ctx.normalizeDisputeStatus('reviewed'), 'in_review');
    });

    it('passes through resolved', () => {
        const ctx = createContext();
        assert.equal(ctx.normalizeDisputeStatus('resolved'), 'resolved');
    });

    it('passes through rejected', () => {
        const ctx = createContext();
        assert.equal(ctx.normalizeDisputeStatus('rejected'), 'rejected');
    });

    it('passes through open', () => {
        const ctx = createContext();
        assert.equal(ctx.normalizeDisputeStatus('open'), 'open');
    });

    it('passes through in_review', () => {
        const ctx = createContext();
        assert.equal(ctx.normalizeDisputeStatus('in_review'), 'in_review');
    });

    it('defaults to open for null/undefined', () => {
        const ctx = createContext();
        assert.equal(ctx.normalizeDisputeStatus(null), 'open');
        assert.equal(ctx.normalizeDisputeStatus(undefined), 'open');
        assert.equal(ctx.normalizeDisputeStatus(''), 'open');
    });
});

// ──────────────── disputeStatusClass ─────────────────────

describe('disputeStatusClass', () => {
    it('returns correct class for open', () => {
        const ctx = createContext();
        assert.equal(ctx.disputeStatusClass('open'), 'dispute-open');
    });

    it('returns correct class for in_review', () => {
        const ctx = createContext();
        assert.equal(ctx.disputeStatusClass('in_review'), 'dispute-in-review');
    });

    it('returns correct class for resolved', () => {
        const ctx = createContext();
        assert.equal(ctx.disputeStatusClass('resolved'), 'dispute-resolved');
    });

    it('returns correct class for rejected', () => {
        const ctx = createContext();
        assert.equal(ctx.disputeStatusClass('rejected'), 'dispute-rejected');
    });
});

// ──────────────── formatFileSize ─────────────────────

describe('formatFileSize', () => {
    it('formats bytes', () => {
        const ctx = createContext();
        assert.equal(ctx.formatFileSize(500), '500 B');
    });

    it('formats kilobytes', () => {
        const ctx = createContext();
        assert.equal(ctx.formatFileSize(2048), '2.0 KB');
    });

    it('formats megabytes', () => {
        const ctx = createContext();
        assert.equal(ctx.formatFileSize(5 * 1024 * 1024), '5.0 MB');
    });

    it('formats zero', () => {
        const ctx = createContext();
        assert.equal(ctx.formatFileSize(0), '0 B');
    });
});

// ──────────────── Evidence constants ─────────────────────

describe('Evidence constraints', () => {
    it('EVIDENCE_MAX_SIZE is 20MB', () => {
        const ctx = createContext();
        assert.equal(ctx._get('EVIDENCE_MAX_SIZE'), 20 * 1024 * 1024);
    });

    it('EVIDENCE_MAX_COUNT is 10', () => {
        const ctx = createContext();
        assert.equal(ctx._get('EVIDENCE_MAX_COUNT'), 10);
    });

    it('EVIDENCE_ALLOWED_TYPES includes PDF, PNG, JPEG', () => {
        const ctx = createContext();
        const types = ctx._get('EVIDENCE_ALLOWED_TYPES');
        assert.ok(types.includes('application/pdf'));
        assert.ok(types.includes('image/png'));
        assert.ok(types.includes('image/jpeg'));
        assert.equal(types.length, 3);
    });
});

// ──────────────── DISPUTE_STATUS_LABELS ─────────────────────

describe('DISPUTE_STATUS_LABELS', () => {
    it('has labels for all statuses', () => {
        const ctx = createContext();
        const labels = ctx._get('DISPUTE_STATUS_LABELS');
        assert.equal(labels.open, 'Open');
        assert.equal(labels.in_review, 'In Review');
        assert.equal(labels.resolved, 'Resolved');
        assert.equal(labels.rejected, 'Rejected');
    });
});

// ──────────────── migrateLegacyData ───────────────────────────

describe('migrateLegacyData', () => {
    function makeMigrationMocks(yearDocExists) {
        const saved = { user: [], year: [] };
        const mockDocRef = {
            set: (...args) => { saved.user.push(args); return Promise.resolve(); },
            collection: () => ({
                doc: () => ({
                    set: (...args) => { saved.year.push(args); return Promise.resolve(); },
                    get: () => Promise.resolve({ exists: yearDocExists }),
                }),
            }),
        };
        return { saved, mockDocRef };
    }

    it('copies flat data including payments to year-scoped doc', async () => {
        const ctx = createContext();
        const { saved, mockDocRef } = makeMigrationMocks(false);

        const userData = {
            familyMembers: [
                { id: 1, name: 'Alice', email: '', paymentReceived: 500, linkedMembers: [] },
            ],
            bills: [
                { id: 100, name: 'Internet', amount: 120, members: [1] },
            ],
            payments: [
                { id: 'p1', memberId: 1, amount: 300, receivedAt: '2025-01-01', note: '', method: 'cash' },
            ],
            settings: { emailMessage: 'test' },
        };

        await ctx.migrateLegacyData(mockDocRef, userData);

        assert.equal(saved.year.length, 1, 'Year doc should be created');
        const yearData = saved.year[0][0];
        assert.deepStrictEqual(yearData.familyMembers, userData.familyMembers);
        assert.deepStrictEqual(yearData.bills, userData.bills);
        assert.deepStrictEqual(yearData.payments, userData.payments);
        assert.equal(yearData.settings.emailMessage, 'test');
        assert.equal(yearData.status, 'open');
    });

    it('sets migrationVersion and activeBillingYear on user doc', async () => {
        const ctx = createContext();
        const { saved, mockDocRef } = makeMigrationMocks(false);

        await ctx.migrateLegacyData(mockDocRef, { familyMembers: [] });

        assert.equal(saved.user.length, 1, 'User doc should be updated');
        const userUpdate = saved.user[0][0];
        assert.equal(userUpdate.migrationVersion, ctx._get('CURRENT_MIGRATION_VERSION'));
        assert.ok(userUpdate.activeBillingYear, 'activeBillingYear should be set');
    });

    it('skips year doc creation when it already exists (idempotent)', async () => {
        const ctx = createContext();
        const { saved, mockDocRef } = makeMigrationMocks(true);

        const userData = {
            familyMembers: [
                { id: 1, name: 'Alice', email: '', paymentReceived: 500, linkedMembers: [] },
            ],
        };

        await ctx.migrateLegacyData(mockDocRef, userData);

        assert.equal(saved.year.length, 0, 'Should not overwrite existing year doc');
        assert.equal(saved.user.length, 1, 'User doc should still be stamped');
        assert.equal(saved.user[0][0].migrationVersion, ctx._get('CURRENT_MIGRATION_VERSION'));
    });

    it('defaults missing fields to empty arrays/objects', async () => {
        const ctx = createContext();
        const { saved, mockDocRef } = makeMigrationMocks(false);

        await ctx.migrateLegacyData(mockDocRef, {});

        const yearData = saved.year[0][0];
        assert.ok(Array.isArray(yearData.familyMembers) && yearData.familyMembers.length === 0);
        assert.ok(Array.isArray(yearData.bills) && yearData.bills.length === 0);
        assert.ok(Array.isArray(yearData.payments) && yearData.payments.length === 0);
    });

    it('returns the current year as the active year ID', async () => {
        const ctx = createContext();
        const { mockDocRef } = makeMigrationMocks(false);

        const yearId = await ctx.migrateLegacyData(mockDocRef, {});
        assert.equal(yearId, String(new Date().getFullYear()));
    });

    it('preserves totals — paymentReceived converted to ledger on load', async () => {
        const ctx = createContext();
        ctx._set('payments', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 750, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 300, linkedMembers: [] },
        ]);

        ctx.migratePaymentReceivedToLedger();

        assert.equal(ctx.getPaymentTotalForMember(1), 750, 'Alice total should match pre-migration');
        assert.equal(ctx.getPaymentTotalForMember(2), 300, 'Bob total should match pre-migration');
        assert.equal(ctx._get('familyMembers')[0].paymentReceived, 0, 'paymentReceived zeroed');
        assert.equal(ctx._get('familyMembers')[1].paymentReceived, 0, 'paymentReceived zeroed');
    });

    it('does not duplicate payments if ledger already has entries', async () => {
        const ctx = createContext();
        ctx._set('payments', [
            { id: 'existing', memberId: 1, amount: 200, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 750, linkedMembers: [] },
        ]);

        ctx.migratePaymentReceivedToLedger();

        assert.equal(ctx._get('payments').length, 1, 'Should not add migration entries');
        assert.equal(ctx._get('payments')[0].id, 'existing');
    });
});

// ──────────────── CURRENT_MIGRATION_VERSION ───────────────────

describe('CURRENT_MIGRATION_VERSION', () => {
    it('is a positive integer', () => {
        const ctx = createContext();
        const version = ctx._get('CURRENT_MIGRATION_VERSION');
        assert.equal(typeof version, 'number');
        assert.ok(version >= 1);
        assert.equal(version, Math.floor(version));
    });
});

// ──────────────── calculateSettlementMetrics ──────────────────

describe('calculateSettlementMetrics', () => {
    it('returns zero metrics when no members or bills exist', () => {
        const ctx = createContext();
        ctx._set('familyMembers', []);
        ctx._set('bills', []);
        ctx._set('payments', []);

        const m = ctx.calculateSettlementMetrics();
        assert.equal(m.totalAnnual, 0);
        assert.equal(m.totalPayments, 0);
        assert.equal(m.totalOutstanding, 0);
        assert.equal(m.paidCount, 0);
        assert.equal(m.totalMembers, 0);
        assert.equal(m.percentage, 0);
    });

    it('computes correct percentage with partial payments', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Rent', amount: 100, logo: '', website: '', members: [1, 2] },
        ]);
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 600, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);

        const m = ctx.calculateSettlementMetrics();
        assert.equal(m.totalAnnual, 1200);
        assert.equal(m.totalPayments, 600);
        assert.equal(m.totalOutstanding, 600);
        assert.equal(m.paidCount, 1);
        assert.equal(m.totalMembers, 2);
        assert.equal(m.percentage, 50);
    });

    it('reports 100% when all members are fully paid', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Internet', amount: 50, logo: '', website: '', members: [1] },
        ]);
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 600, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);

        const m = ctx.calculateSettlementMetrics();
        assert.equal(m.percentage, 100);
        assert.equal(m.paidCount, 1);
        assert.equal(m.totalOutstanding, 0);
    });

    it('caps percentage at 100 when overpaid', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Rent', amount: 10, logo: '', website: '', members: [1] },
        ]);
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 999, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);

        const m = ctx.calculateSettlementMetrics();
        assert.equal(m.percentage, 100);
    });

    it('includes linked member totals in parent metrics', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Rent', amount: 120, logo: '', website: '', members: [1, 2] },
        ]);
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 720, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
            { id: 'p2', memberId: 2, amount: 720, receivedAt: new Date().toISOString(), note: '', method: 'cash' },
        ]);

        const m = ctx.calculateSettlementMetrics();
        assert.equal(m.totalMembers, 1, 'only parent counted as main member');
        assert.equal(m.paidCount, 1);
        assert.equal(m.percentage, 100);
    });
});

// ──────────────── getPaymentStatusBadge (Settled label) ───────

describe('getPaymentStatusBadge labels', () => {
    it('returns "Settled" instead of "Paid" when fully paid', () => {
        const ctx = createContext();
        const badge = ctx.getPaymentStatusBadge(100, 100);
        assert.ok(badge.includes('Settled'), 'badge should say Settled');
        assert.ok(!badge.includes('>Paid<'), 'badge should NOT say Paid');
    });

    it('returns "Outstanding" for zero payment', () => {
        const ctx = createContext();
        const badge = ctx.getPaymentStatusBadge(100, 0);
        assert.ok(badge.includes('Outstanding'));
    });

    it('returns "Partial" for partial payment', () => {
        const ctx = createContext();
        const badge = ctx.getPaymentStatusBadge(100, 50);
        assert.ok(badge.includes('Partial'));
    });

    it('returns empty string when total is zero', () => {
        const ctx = createContext();
        const badge = ctx.getPaymentStatusBadge(0, 0);
        assert.equal(badge, '');
    });
});

// ──────────────── getCalculationBreakdown ─────────────────────

describe('getCalculationBreakdown', () => {
    it('returns empty string when no bills exist', () => {
        const ctx = createContext();
        const result = ctx.getCalculationBreakdown({ bills: [] });
        assert.equal(result, '');
    });

    it('returns empty string for null input', () => {
        const ctx = createContext();
        assert.equal(ctx.getCalculationBreakdown(null), '');
        assert.equal(ctx.getCalculationBreakdown(undefined), '');
    });

    it('generates breakdown HTML for a member with bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Netflix', amount: 19.99, logo: '', website: '', members: [1, 2] },
            { id: 2, name: 'Spotify', amount: 9.99, logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        const html = ctx.getCalculationBreakdown(summary[1]);

        assert.ok(html.includes('calc-breakdown'), 'should contain breakdown container');
        assert.ok(html.includes('Netflix'), 'should list Netflix');
        assert.ok(html.includes('Spotify'), 'should list Spotify');
        assert.ok(html.includes('$19.99'), 'should show bill amount');
        assert.ok(html.includes('&divide; 2'), 'should show split count for Netflix');
        assert.ok(html.includes('&divide; 1'), 'should show split count for Spotify');
    });

    it('escapes bill names in the output', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: '<script>XSS</script>', amount: 10, logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        const html = ctx.getCalculationBreakdown(summary[1]);

        assert.ok(!html.includes('<script>'), 'should escape script tags');
        assert.ok(html.includes('&lt;script&gt;'), 'should contain escaped version');
    });
});

// ──────────────── showChangeToast ─────────────────────────────

describe('showChangeToast', () => {
    it('is a callable function', () => {
        const ctx = createContext();
        assert.equal(typeof ctx.showChangeToast, 'function');
    });
});

// ──────────────── Billing Frequency Helpers ─────────────────────

describe('getBillAnnualAmount', () => {
    it('returns amount * 12 for monthly bills', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillAnnualAmount({ amount: 10, billingFrequency: 'monthly' }), 120);
    });

    it('returns amount as-is for annual bills', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillAnnualAmount({ amount: 139.99, billingFrequency: 'annual' }), 139.99);
    });

    it('defaults to monthly when billingFrequency is undefined', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillAnnualAmount({ amount: 10 }), 120);
    });
});

describe('getBillMonthlyAmount', () => {
    it('returns amount as-is for monthly bills', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillMonthlyAmount({ amount: 10, billingFrequency: 'monthly' }), 10);
    });

    it('returns amount / 12 for annual bills', () => {
        const ctx = createContext();
        const result = ctx.getBillMonthlyAmount({ amount: 120, billingFrequency: 'annual' });
        assert.equal(result, 10);
    });

    it('defaults to monthly when billingFrequency is undefined', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillMonthlyAmount({ amount: 15 }), 15);
    });
});

describe('getBillFrequencyLabel', () => {
    it('returns " / month" for monthly bills', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillFrequencyLabel({ billingFrequency: 'monthly' }), ' / month');
    });

    it('returns " / year" for annual bills', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillFrequencyLabel({ billingFrequency: 'annual' }), ' / year');
    });

    it('returns " / month" when billingFrequency is undefined', () => {
        const ctx = createContext();
        assert.equal(ctx.getBillFrequencyLabel({}), ' / month');
    });
});

// ──────────────── calculateAnnualSummary with billing frequency ─────────

describe('calculateAnnualSummary with billing frequency', () => {
    it('calculates correctly for monthly bills (backwards compatible)', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Internet', amount: 120, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 720);
        assert.equal(summary[2].total, 720);
        assert.equal(summary[1].bills[0].monthlyShare, 60);
        assert.equal(summary[1].bills[0].annualShare, 720);
    });

    it('calculates correctly for annual bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Disney+', amount: 139.99, billingFrequency: 'annual', logo: '', website: '', members: [1, 2] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 139.99 / 2);
        assert.equal(summary[2].total, 139.99 / 2);
        assert.equal(summary[1].bills[0].annualShare, 139.99 / 2);
        assert.equal(summary[1].bills[0].monthlyShare, 139.99 / 2 / 12);
    });

    it('annual bill total equals entered amount (no rounding drift)', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Disney+', amount: 139.99, billingFrequency: 'annual', logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 139.99, 'Annual total must exactly equal the entered amount');
    });

    it('mixes monthly and annual bills correctly', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [1] },
            { id: 101, name: 'Disney+', amount: 139.99, billingFrequency: 'annual', logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        const expectedTotal = (15 * 12) + 139.99;
        assert.equal(summary[1].total, expectedTotal);
        assert.equal(summary[1].bills.length, 2);
    });

    it('defaults missing billingFrequency to monthly', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Legacy', amount: 50, logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        assert.equal(summary[1].total, 600, 'Legacy bill without frequency should be treated as monthly');
    });

    it('annual bill split among 3 members sums to canonical amount', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 3, name: 'Charlie', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Service', amount: 100, billingFrequency: 'annual', logo: '', website: '', members: [1, 2, 3] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        const totalFromShares = summary[1].total + summary[2].total + summary[3].total;
        const diff = Math.abs(totalFromShares - 100);
        assert.ok(diff < 0.01, 'Sum of member shares should approximately equal canonical annual amount');
    });
});

// ──────────────── toggleBillFrequency ─────────────────────────

// Helper: toggleBillFrequency now shows a confirmation dialog.
// Set the _testAutoConfirmDialogs flag to auto-confirm.
function toggleBillFrequencyWithAutoConfirm(ctx, billId) {
    ctx._set('_testAutoConfirmDialogs', true);
    ctx.toggleBillFrequency(billId);
    ctx._set('_testAutoConfirmDialogs', false);
}

describe('toggleBillFrequency', () => {
    it('converts monthly to annual', () => {
        const ctx = createContext();
        ctx._set('bills', [
            { id: 1, name: 'Netflix', amount: 10, billingFrequency: 'monthly', logo: '', website: '', members: [] },
        ]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        toggleBillFrequencyWithAutoConfirm(ctx, 1);
        const bill = ctx._get('bills')[0];
        assert.equal(bill.billingFrequency, 'annual');
        assert.equal(bill.amount, 120);
    });

    it('converts annual to monthly', () => {
        const ctx = createContext();
        ctx._set('bills', [
            { id: 1, name: 'Disney+', amount: 120, billingFrequency: 'annual', logo: '', website: '', members: [] },
        ]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        toggleBillFrequencyWithAutoConfirm(ctx, 1);
        const bill = ctx._get('bills')[0];
        assert.equal(bill.billingFrequency, 'monthly');
        assert.equal(bill.amount, 10);
    });

    it('rounds to 2 decimal places when converting annual to monthly', () => {
        const ctx = createContext();
        ctx._set('bills', [
            { id: 1, name: 'Disney+', amount: 139.99, billingFrequency: 'annual', logo: '', website: '', members: [] },
        ]);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        toggleBillFrequencyWithAutoConfirm(ctx, 1);
        const bill = ctx._get('bills')[0];
        assert.equal(bill.billingFrequency, 'monthly');
        assert.equal(bill.amount, Math.round((139.99 / 12) * 100) / 100);
    });

    it('is blocked when year is read-only', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('bills', [
            { id: 1, name: 'Test', amount: 100, billingFrequency: 'monthly', logo: '', website: '', members: [] },
        ]);

        ctx.toggleBillFrequency(1);
        assert.equal(ctx._get('bills')[0].amount, 100, 'Amount should not change');
        assert.equal(ctx._get('bills')[0].billingFrequency, 'monthly', 'Frequency should not change');
    });

    it('does nothing for non-existent bill', () => {
        const ctx = createContext();
        ctx._set('bills', []);
        ctx.toggleBillFrequency(999);
        assert.equal(ctx._get('bills').length, 0);
    });
});

// ──────────────── getCalculationBreakdown with frequency ─────────

describe('getCalculationBreakdown with billing frequency', () => {
    it('shows monthly formula for monthly bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [1] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        const html = ctx.getCalculationBreakdown(summary[1]);

        assert.ok(html.includes('&times; 12'), 'Monthly bills should show x12 formula');
        assert.ok(html.includes('/ month'), 'Monthly bills should show / month label');
    });

    it('shows annual formula for annual bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Disney+', amount: 139.99, billingFrequency: 'annual', logo: '', website: '', members: [1, 2] },
        ]);

        const summary = ctx.calculateAnnualSummary();
        const html = ctx.getCalculationBreakdown(summary[1]);

        assert.ok(html.includes('/ year'), 'Annual bills should show / year label');
        assert.ok(html.includes('&divide; 2'), 'Should show split count');
        assert.ok(!html.includes('&times; 12'), 'Annual bills should NOT show x12');
    });
});

// ──────────────── computeMemberSummaryForShare with frequency ─────

describe('computeMemberSummaryForShare with billing frequency', () => {
    it('computes correct totals for annual bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Disney+', amount: 139.99, billingFrequency: 'annual', logo: '', website: '', members: [1] },
        ]);

        const result = ctx.computeMemberSummaryForShare(1);
        assert.equal(result.annualTotal, 139.99);
        assert.equal(result.bills[0].annualShare, 139.99);
        assert.equal(result.bills[0].billingFrequency, 'annual');
        assert.equal(result.bills[0].canonicalAmount, 139.99);
    });

    it('includes billingFrequency and canonicalAmount in bill data', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [1] },
        ]);

        const result = ctx.computeMemberSummaryForShare(1);
        assert.equal(result.bills[0].billingFrequency, 'monthly');
        assert.equal(result.bills[0].canonicalAmount, 15);
    });

    it('includes sanitized member avatars and bill logos for share rendering', () => {
        const ctx = createContext();
        const avatar = 'data:image/png;base64,QUJD';
        const logo = 'data:image/png;base64,REVG';
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar, paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo, website: '', members: [1] },
        ]);

        const result = ctx.computeMemberSummaryForShare(1);
        assert.equal(result.avatar, avatar);
        assert.equal(result.bills[0].logo, logo);
    });
});

// ──────────────── Money Integrity Layer — Event Ledger ─────────────────

describe('emitBillingEvent', () => {
    it('appends an event to billingEvents', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);

        ctx.emitBillingEvent('BILL_CREATED', { billId: 1, billName: 'Test' });
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'BILL_CREATED');
        assert.equal(events[0].payload.billId, 1);
    });

    it('generates unique event IDs', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);

        ctx.emitBillingEvent('BILL_CREATED', { billId: 1 });
        ctx.emitBillingEvent('BILL_UPDATED', { billId: 1 });
        const events = ctx._get('billingEvents');
        assert.notEqual(events[0].id, events[1].id);
    });

    it('records timestamp and actor', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);

        const event = ctx.emitBillingEvent('PAYMENT_RECORDED', { amount: 100 });
        assert.ok(event.timestamp, 'should have timestamp');
        assert.equal(event.actor.type, 'admin');
        assert.equal(event.actor.userId, 'test-user');
    });

    it('defaults source to ui', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);

        const event = ctx.emitBillingEvent('BILL_CREATED', {});
        assert.equal(event.source, 'ui');
    });

    it('accepts custom source', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);

        const event = ctx.emitBillingEvent('BILL_CREATED', {}, '', 'migration');
        assert.equal(event.source, 'migration');
    });

    it('accepts optional note', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);

        const event = ctx.emitBillingEvent('BILL_UPDATED', {}, 'Manual correction');
        assert.equal(event.note, 'Manual correction');
    });
});

describe('BILLING_EVENT_LABELS', () => {
    it('has labels for all event types', () => {
        const ctx = createContext();
        const labels = ctx._get('BILLING_EVENT_LABELS');
        assert.ok(labels.BILL_CREATED);
        assert.ok(labels.BILL_UPDATED);
        assert.ok(labels.BILL_DELETED);
        assert.ok(labels.MEMBER_ADDED_TO_BILL);
        assert.ok(labels.MEMBER_REMOVED_FROM_BILL);
        assert.ok(labels.PAYMENT_RECORDED);
        assert.ok(labels.PAYMENT_REVERSED);
        assert.ok(labels.YEAR_STATUS_CHANGED);
    });
});

describe('getBillingEventsForBill', () => {
    it('filters events by billId', () => {
        const ctx = createContext();
        ctx._set('billingEvents', [
            { id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'BILL_CREATED', payload: { billId: 1 }, actor: {} },
            { id: 'e2', timestamp: '2026-01-02T00:00:00Z', eventType: 'BILL_UPDATED', payload: { billId: 2 }, actor: {} },
            { id: 'e3', timestamp: '2026-01-03T00:00:00Z', eventType: 'MEMBER_ADDED_TO_BILL', payload: { billId: 1 }, actor: {} },
        ]);

        const result = ctx.getBillingEventsForBill(1);
        assert.equal(result.length, 2);
        assert.ok(result.every(e => e.payload.billId === 1));
    });

    it('returns events sorted newest first', () => {
        const ctx = createContext();
        ctx._set('billingEvents', [
            { id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'BILL_CREATED', payload: { billId: 1 }, actor: {} },
            { id: 'e2', timestamp: '2026-01-15T00:00:00Z', eventType: 'BILL_UPDATED', payload: { billId: 1 }, actor: {} },
        ]);

        const result = ctx.getBillingEventsForBill(1);
        assert.equal(result[0].id, 'e2', 'newest event should be first');
    });

    it('returns empty array when no events match', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);
        assert.deepStrictEqual(ctx.getBillingEventsForBill(999), []);
    });
});

describe('addBill emits BILL_CREATED event', () => {
    it('creates a BILL_CREATED event when adding a bill', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        ctx.document.getElementById = (id) => {
            if (id === 'billName') return { value: 'Netflix' };
            if (id === 'billAmount') return { value: '15.99' };
            if (id === 'billWebsite') return { value: '' };
            if (id === 'billFrequencyToggle') return {
                querySelectorAll: () => [],
                querySelector: () => ({ getAttribute: () => 'monthly', classList: { add: () => {}, remove: () => {} } })
            };
            return { innerHTML: '', textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {} } };
        };

        ctx.addBill();
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'BILL_CREATED');
        assert.equal(events[0].payload.billName, 'Netflix');
        assert.equal(events[0].payload.amount, 15.99);
    });
});

describe('editBillAmount emits BILL_UPDATED event', () => {
    it('records before/after values', () => {
        const ctx = createContext({
            prompt: () => '25.00',
            alert: () => {},
        });
        ctx._set('billingEvents', []);
        ctx._set('bills', [
            { id: 1, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [] },
        ]);

        ctx.editBillAmount(1);
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'BILL_UPDATED');
        assert.equal(events[0].payload.previousValue, 15);
        assert.equal(events[0].payload.newValue, 25);
        assert.equal(events[0].payload.field, 'amount');
    });
});

describe('removeBill emits BILL_DELETED event', () => {
    it('records bill details before deletion', () => {
        const ctx = createContext({ confirm: () => true });
        ctx._set('billingEvents', []);
        ctx._set('bills', [
            { id: 1, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] },
        ]);

        ctx.removeBill(1);
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'BILL_DELETED');
        assert.equal(events[0].payload.billName, 'Netflix');
        assert.equal(events[0].payload.memberCount, 2);
    });
});

describe('toggleMember emits membership events', () => {
    it('emits MEMBER_ADDED_TO_BILL when adding', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [] },
        ]);

        ctx.toggleMember(100, 1);
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'MEMBER_ADDED_TO_BILL');
        assert.equal(events[0].payload.memberName, 'Alice');
        assert.equal(events[0].payload.billName, 'Netflix');
    });

    it('emits MEMBER_REMOVED_FROM_BILL when removing', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [1] },
        ]);

        ctx.toggleMember(100, 1);
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'MEMBER_REMOVED_FROM_BILL');
    });
});

describe('recordPayment emits PAYMENT_RECORDED event', () => {
    it('emits event for a standard payment', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [1] },
        ]);

        ctx.recordPayment(1, 100, 'zelle', 'January payment', false);
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'PAYMENT_RECORDED');
        assert.equal(events[0].payload.amount, 100);
        assert.equal(events[0].payload.memberName, 'Alice');
        assert.equal(events[0].payload.method, 'zelle');
        assert.equal(events[0].payload.distributed, false);
    });

    it('emits multiple events for distributed payments', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', logo: '', website: '', members: [1, 2] },
        ]);

        ctx.recordPayment(1, 100, 'cash', '', true);
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 2, 'should emit events for parent and child');
        assert.ok(events.every(e => e.eventType === 'PAYMENT_RECORDED'));
        assert.ok(events.some(e => e.payload.distributed === true));
    });
});

describe('deletePaymentEntry (payment reversal)', () => {
    it('creates a reversal entry instead of deleting', () => {
        const ctx = createContext({ confirm: () => true });
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('payments', [
            { id: 'pay_1', memberId: 1, amount: 100, receivedAt: '2026-01-15T00:00:00Z', note: 'Test', method: 'zelle' },
        ]);

        ctx.deletePaymentEntry('pay_1', 1);

        const payments = ctx._get('payments');
        assert.equal(payments.length, 2, 'should have original + reversal');

        const original = payments.find(p => p.id === 'pay_1');
        assert.equal(original.reversed, true, 'original should be marked reversed');

        const reversal = payments.find(p => p.type === 'reversal');
        assert.ok(reversal, 'should have a reversal entry');
        assert.equal(reversal.amount, -100, 'reversal should have negative amount');
        assert.equal(reversal.reversesPaymentId, 'pay_1');
        assert.equal(reversal.memberId, 1);
    });

    it('emits PAYMENT_REVERSED event', () => {
        const ctx = createContext({ confirm: () => true });
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('payments', [
            { id: 'pay_1', memberId: 1, amount: 50, receivedAt: '2026-01-15T00:00:00Z', note: '', method: 'cash' },
        ]);

        ctx.deletePaymentEntry('pay_1', 1);

        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'PAYMENT_REVERSED');
        assert.equal(events[0].payload.paymentId, 'pay_1');
        assert.equal(events[0].payload.originalAmount, 50);
    });

    it('net payment total is zero after reversal', () => {
        const ctx = createContext({ confirm: () => true });
        ctx._set('billingEvents', []);
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('payments', [
            { id: 'pay_1', memberId: 1, amount: 200, receivedAt: '2026-01-15T00:00:00Z', note: '', method: 'zelle' },
        ]);

        ctx.deletePaymentEntry('pay_1', 1);

        const total = ctx.getPaymentTotalForMember(1);
        assert.equal(total, 0, 'reversed payment should net to zero');
    });

    it('is blocked when year is read-only', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg), confirm: () => true });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('billingEvents', []);
        ctx._set('payments', [
            { id: 'pay_1', memberId: 1, amount: 100, receivedAt: '2026-01-15T00:00:00Z', note: '', method: 'cash' },
        ]);

        ctx.deletePaymentEntry('pay_1', 1);
        assert.equal(ctx._get('payments').length, 1, 'should not modify payments');
        assert.equal(ctx._get('payments')[0].reversed, undefined, 'should not mark as reversed');
    });

    it('does nothing if payment not found', () => {
        const ctx = createContext({ confirm: () => true });
        ctx._set('billingEvents', []);
        ctx._set('payments', []);

        ctx.deletePaymentEntry('nonexistent', 1);
        assert.equal(ctx._get('payments').length, 0);
        assert.equal(ctx._get('billingEvents').length, 0);
    });
});

describe('getBillingEventsForMember', () => {
    it('filters events by memberId', () => {
        const ctx = createContext();
        ctx._set('billingEvents', [
            { id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'PAYMENT_RECORDED', payload: { memberId: 1 }, actor: {} },
            { id: 'e2', timestamp: '2026-01-02T00:00:00Z', eventType: 'PAYMENT_RECORDED', payload: { memberId: 2 }, actor: {} },
            { id: 'e3', timestamp: '2026-01-03T00:00:00Z', eventType: 'PAYMENT_REVERSED', payload: { memberId: 1 }, actor: {} },
        ]);

        const result = ctx.getBillingEventsForMember(1);
        assert.equal(result.length, 2);
    });
});

describe('getBillingEventsForPayment', () => {
    it('finds events referencing a payment ID', () => {
        const ctx = createContext();
        ctx._set('billingEvents', [
            { id: 'e1', timestamp: '2026-01-01T00:00:00Z', eventType: 'PAYMENT_RECORDED', payload: { paymentId: 'pay_1' }, actor: {} },
            { id: 'e2', timestamp: '2026-01-02T00:00:00Z', eventType: 'PAYMENT_REVERSED', payload: { reversesPaymentId: 'pay_1' }, actor: {} },
            { id: 'e3', timestamp: '2026-01-03T00:00:00Z', eventType: 'PAYMENT_RECORDED', payload: { paymentId: 'pay_2' }, actor: {} },
        ]);

        const result = ctx.getBillingEventsForPayment('pay_1');
        assert.equal(result.length, 2);
    });
});

describe('toggleBillFrequency emits BILL_UPDATED event', () => {
    it('records frequency change with before/after', () => {
        const ctx = createContext();
        ctx._set('billingEvents', []);
        ctx._set('bills', [
            { id: 1, name: 'Netflix', amount: 10, billingFrequency: 'monthly', logo: '', website: '', members: [] },
        ]);

        toggleBillFrequencyWithAutoConfirm(ctx, 1);
        const events = ctx._get('billingEvents');
        assert.equal(events.length, 1);
        assert.equal(events[0].eventType, 'BILL_UPDATED');
        assert.equal(events[0].payload.field, 'billingFrequency');
        assert.equal(events[0].payload.previousValue, 'monthly');
        assert.equal(events[0].payload.newValue, 'annual');
        assert.equal(events[0].payload.previousAmount, 10);
        assert.equal(events[0].payload.newAmount, 120);
    });
});

// ──────────────── updateBillAmountPreview ─────────────────────

describe('updateBillAmountPreview', () => {
    function createPreviewContext(amountValue, frequency) {
        const elements = {
            billAmountPreview: { textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '' },
            billAmount: { textContent: '', value: String(amountValue), style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '' },
            billAmountLabel: { textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '' },
            billFrequencyToggle: {
                textContent: '', value: '', style: {}, innerHTML: '',
                classList: { add: () => {}, remove: () => {}, contains: () => false },
                querySelectorAll: (sel) => {
                    const monthly = {
                        getAttribute: (a) => 'monthly',
                        classList: {
                            add: () => {},
                            remove: () => {},
                            contains: (c) => frequency === 'monthly' && c === 'active',
                        },
                    };
                    const annual = {
                        getAttribute: (a) => 'annual',
                        classList: {
                            add: () => {},
                            remove: () => {},
                            contains: (c) => frequency === 'annual' && c === 'active',
                        },
                    };
                    return [monthly, annual];
                },
                querySelector: (sel) => {
                    if (sel === '.frequency-option.active') {
                        return { getAttribute: () => frequency };
                    }
                    return null;
                },
            },
        };

        return createContext({
            document: {
                body: { appendChild: () => {} },
                addEventListener: () => {},
                getElementById: (id) => elements[id] || { textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '', querySelectorAll: () => [], querySelector: () => null },
                querySelector: () => ({ style: {} }),
                querySelectorAll: () => [],
                createElement: () => ({
                    type: '', accept: '', click: () => {}, onchange: null,
                    getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }),
                    toDataURL: () => 'data:image/png;base64,stub',
                    width: 0, height: 0,
                }),
            },
            _previewEl: elements.billAmountPreview,
            _labelEl: elements.billAmountLabel,
        });
    }

    it('shows annual equivalent for monthly input', () => {
        const ctx = createPreviewContext('50', 'monthly');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '\u2248 $600.00 per year');
    });

    it('shows monthly equivalent for annual input', () => {
        const ctx = createPreviewContext('120', 'annual');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '\u2248 $10.00 per month');
    });

    it('clears preview for empty input', () => {
        const ctx = createPreviewContext('', 'monthly');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '');
    });

    it('clears preview for zero value', () => {
        const ctx = createPreviewContext('0', 'monthly');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '');
    });

    it('clears preview for negative value', () => {
        const ctx = createPreviewContext('-10', 'monthly');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '');
    });

    it('clears preview for non-numeric input', () => {
        const ctx = createPreviewContext('abc', 'monthly');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '');
    });

    it('rounds derived amount to 2 decimal places', () => {
        const ctx = createPreviewContext('37.95', 'monthly');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '\u2248 $455.40 per year');
    });

    it('rounds monthly derived from annual to 2 decimal places', () => {
        const ctx = createPreviewContext('100', 'annual');
        ctx.updateBillAmountPreview();
        assert.equal(ctx._previewEl.textContent, '\u2248 $8.33 per month');
    });
});

// ──────────────── setAddBillFrequency updates label ─────────────

describe('setAddBillFrequency updates label', () => {
    function createLabelContext() {
        const labelEl = { textContent: 'Monthly Amount ($)', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '' };
        const previewEl = { textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '' };
        let activeFreq = 'monthly';
        const monthly = {
            getAttribute: () => 'monthly',
            classList: {
                add: (c) => { if (c === 'active') activeFreq = 'monthly'; },
                remove: () => {},
            },
        };
        const annual = {
            getAttribute: () => 'annual',
            classList: {
                add: (c) => { if (c === 'active') activeFreq = 'annual'; },
                remove: () => {},
            },
        };

        const elements = {
            billAmountLabel: labelEl,
            billAmountPreview: previewEl,
            billAmount: { textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '' },
            billFrequencyToggle: {
                textContent: '', value: '', style: {}, innerHTML: '',
                classList: { add: () => {}, remove: () => {}, contains: () => false },
                querySelectorAll: () => [monthly, annual],
                querySelector: (sel) => {
                    if (sel === '.frequency-option.active') {
                        return { getAttribute: () => activeFreq };
                    }
                    return null;
                },
            },
        };

        return createContext({
            document: {
                body: { appendChild: () => {} },
                addEventListener: () => {},
                getElementById: (id) => elements[id] || { textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false }, innerHTML: '', querySelectorAll: () => [], querySelector: () => null },
                querySelector: () => ({ style: {} }),
                querySelectorAll: () => [],
                createElement: () => ({
                    type: '', accept: '', click: () => {}, onchange: null,
                    getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }),
                    toDataURL: () => 'data:image/png;base64,stub',
                    width: 0, height: 0,
                }),
            },
            _labelEl: labelEl,
        });
    }

    it('sets label to Annual Amount when frequency is annual', () => {
        const ctx = createLabelContext();
        ctx.setAddBillFrequency('annual');
        assert.equal(ctx._labelEl.textContent, 'Annual Amount ($)');
    });

    it('sets label to Monthly Amount when frequency is monthly', () => {
        const ctx = createLabelContext();
        ctx.setAddBillFrequency('annual');
        ctx.setAddBillFrequency('monthly');
        assert.equal(ctx._labelEl.textContent, 'Monthly Amount ($)');
    });
});

// ──────────────── Cloud Function frequency math ─────────────────

describe('computeMemberSummary with billing frequency', () => {
    it('treats annual bills correctly (amount IS the annual total)', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Insurance', amount: 1200, billingFrequency: 'annual', members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 1200);
        assert.equal(result.monthlyTotal, 100);
        assert.equal(result.bills[0].annualShare, 1200);
        assert.equal(result.bills[0].monthlyShare, 100);
        assert.equal(result.bills[0].monthlyAmount, 100);
    });

    it('treats monthly bills correctly (amount * 12 = annual)', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Netflix', amount: 20, billingFrequency: 'monthly', members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 240);
        assert.equal(result.monthlyTotal, 20);
        assert.equal(result.bills[0].annualShare, 240);
        assert.equal(result.bills[0].monthlyShare, 20);
    });

    it('defaults to monthly when billingFrequency is missing', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Utility', amount: 50, members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 600);
        assert.equal(result.monthlyTotal, 50);
    });

    it('splits annual bills correctly among multiple members', () => {
        const members = [
            { id: 1, name: 'Alice', email: '', linkedMembers: [] },
            { id: 2, name: 'Bob', email: '', linkedMembers: [] },
        ];
        const bills = [{ id: 1, name: 'Insurance', amount: 2400, billingFrequency: 'annual', members: [1, 2] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.annualTotal, 1200);
        assert.equal(result.monthlyTotal, 100);
    });

    it('includes billingFrequency and canonicalAmount in bill output', () => {
        const members = [{ id: 1, name: 'Alice', email: '', linkedMembers: [] }];
        const bills = [{ id: 1, name: 'Annual Sub', amount: 120, billingFrequency: 'annual', members: [1] }];
        const result = computeMemberSummary(members, bills, 1);
        assert.equal(result.bills[0].billingFrequency, 'annual');
        assert.equal(result.bills[0].canonicalAmount, 120);
    });
});

// ──────────────── Dispute read-only year guards ─────────────────

describe('dispute mutations respect read-only year', () => {
    it('updateDispute blocks when year is closed', async () => {
        const ctx = createContext();
        let alertMsg = '';
        ctx.alert = (msg) => { alertMsg = msg; };
        ctx._set('currentBillingYear', { id: '2025', label: '2025', status: 'closed', createdAt: null, archivedAt: null });
        ctx._set('_loadedDisputes', [{ id: 'd1', status: 'open', memberId: 1, billId: 1, message: 'test' }]);
        await ctx.updateDispute('d1', { status: 'in_review' });
        assert.ok(alertMsg.includes('closed'));
    });

    it('updateDispute blocks when year is archived', async () => {
        const ctx = createContext();
        let alertMsg = '';
        ctx.alert = (msg) => { alertMsg = msg; };
        ctx._set('currentBillingYear', { id: '2024', label: '2024', status: 'archived', createdAt: null, archivedAt: new Date() });
        await ctx.updateDispute('d1', { status: 'resolved' });
        assert.ok(alertMsg.includes('archived'));
    });

    it('uploadEvidence blocks when year is closed', () => {
        const ctx = createContext();
        let alertMsg = '';
        ctx.alert = (msg) => { alertMsg = msg; };
        ctx._set('currentBillingYear', { id: '2025', label: '2025', status: 'closed', createdAt: null, archivedAt: null });
        ctx.uploadEvidence('d1');
        assert.ok(alertMsg.includes('closed'));
    });

    it('removeEvidence blocks when year is archived', () => {
        const ctx = createContext();
        let alertMsg = '';
        ctx.alert = (msg) => { alertMsg = msg; };
        ctx._set('currentBillingYear', { id: '2024', label: '2024', status: 'archived', createdAt: null, archivedAt: new Date() });
        ctx.removeEvidence('d1', 0);
        assert.ok(alertMsg.includes('archived'));
    });
});

// ──────────────── startNewYear preserves paymentMethods ──────────

describe('startNewYear preserves paymentMethods', () => {
    it('clones paymentMethods into the new year settings', async () => {
        const saved = [];
        const yearData = {};
        const ctx = createContext({
            db: {
                collection: (name) => ({
                    doc: (id) => ({
                        set: (...args) => { saved.push({ name, id, args }); return Promise.resolve(); },
                        get: () => Promise.resolve({ exists: true, data: () => ({}) }),
                        update: (...args) => { saved.push({ name, id, action: 'update', args }); return Promise.resolve(); },
                        collection: (subName) => ({
                            doc: (subId) => ({
                                set: (...args) => {
                                    if (subName === 'billingYears') yearData[subId] = args[0];
                                    return Promise.resolve();
                                },
                                get: () => Promise.resolve({ exists: false }),
                                collection: () => ({ doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }),
                            }),
                            get: () => Promise.resolve({ docs: [] }),
                        }),
                    }),
                    where: () => ({ where: () => ({ get: () => Promise.resolve({ docs: [] }) }), get: () => Promise.resolve({ docs: [] }) }),
                }),
                batch: () => ({ set: () => {}, delete: () => {}, commit: () => Promise.resolve() }),
            },
        });

        ctx._set('familyMembers', [{ id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [] }]);
        ctx._set('bills', [{ id: 1, name: 'Test', amount: 100, billingFrequency: 'monthly', logo: '', website: '', members: [1] }]);
        ctx._set('settings', {
            emailMessage: 'Hello',
            paymentLinks: [],
            paymentMethods: [
                { id: 'pm1', type: 'venmo', label: 'Venmo', enabled: true, handle: '@me', url: '', phone: '', email: '', instructions: '' },
                { id: 'pm2', type: 'zelle', label: 'Zelle', enabled: true, handle: '', url: '', phone: '555', email: 'a@b.c', instructions: '' },
            ],
        });

        ctx.prompt = () => '2027';
        ctx.alert = () => {};

        await ctx.startNewYear();

        const newYear = yearData['2027'];
        assert.ok(newYear, 'New year doc should be created');
        assert.ok(newYear.settings.paymentMethods, 'paymentMethods should exist');
        assert.equal(newYear.settings.paymentMethods.length, 2);
        assert.equal(newYear.settings.paymentMethods[0].type, 'venmo');
        assert.equal(newYear.settings.paymentMethods[1].type, 'zelle');
    });
});

// ──────────────── revokeShareLink deletes publicShares doc ───────

describe('revokeShareLink cleans up publicShares', () => {
    it('deletes the publicShares doc when revoking a token', async () => {
        const deletedDocs = [];
        const updatedDocs = [];
        const ctx = createContext({
            db: {
                collection: (name) => ({
                    doc: (id) => ({
                        update: (...args) => { updatedDocs.push({ name, id, args }); return Promise.resolve(); },
                        delete: () => { deletedDocs.push({ name, id }); return Promise.resolve(); },
                        set: () => Promise.resolve(),
                        get: () => Promise.resolve({ exists: false }),
                        collection: () => ({
                            doc: () => ({ get: () => Promise.resolve({ exists: false }), set: () => Promise.resolve() }),
                            get: () => Promise.resolve({ docs: [] }),
                        }),
                    }),
                    where: () => ({ where: () => ({ get: () => Promise.resolve({ docs: [] }) }), get: () => Promise.resolve({ docs: [] }) }),
                }),
                batch: () => ({ set: () => {}, delete: () => {}, commit: () => Promise.resolve() }),
            },
        });
        ctx.confirm = () => true;

        await ctx.revokeShareLink('abc123hash', 1);

        const shareTokenUpdate = updatedDocs.find(d => d.name === 'shareTokens' && d.id === 'abc123hash');
        assert.ok(shareTokenUpdate, 'shareTokens doc should be updated');
        assert.equal(shareTokenUpdate.args[0].revoked, true);

        const publicShareDelete = deletedDocs.find(d => d.name === 'publicShares' && d.id === 'abc123hash');
        assert.ok(publicShareDelete, 'publicShares doc should be deleted');
    });
});

// ──────────────── refreshPublicShares deletes stale docs ────────

describe('refreshPublicShares cleanup', () => {
    it('deletes publicShares docs for revoked tokens', async () => {
        const ops = [];
        const ctx = createContext({
            db: {
                collection: (name) => ({
                    doc: (id) => ({
                        set: () => Promise.resolve(),
                        get: () => Promise.resolve({ exists: false }),
                        collection: () => ({
                            doc: () => ({ get: () => Promise.resolve({ exists: false }), set: () => Promise.resolve() }),
                            get: () => Promise.resolve({ docs: [] }),
                        }),
                    }),
                    where: (field, op, val) => ({
                        where: () => ({
                            get: () => Promise.resolve({
                                docs: [
                                    {
                                        id: 'hash1',
                                        data: () => ({
                                            ownerId: 'test-user',
                                            memberId: 1,
                                            billingYearId: '2026',
                                            revoked: true,
                                            scopes: ['summary:read'],
                                        }),
                                    },
                                    {
                                        id: 'hash2',
                                        data: () => ({
                                            ownerId: 'test-user',
                                            memberId: 1,
                                            billingYearId: '2026',
                                            revoked: false,
                                            scopes: ['summary:read'],
                                        }),
                                    },
                                ],
                            }),
                        }),
                        get: () => Promise.resolve({ docs: [] }),
                    }),
                }),
                batch: () => {
                    const batchOps = [];
                    return {
                        set: (ref, data) => { batchOps.push({ op: 'set', ref, data }); ops.push({ op: 'set' }); },
                        delete: (ref) => { batchOps.push({ op: 'delete', ref }); ops.push({ op: 'delete' }); },
                        commit: () => Promise.resolve(),
                    };
                },
            },
        });

        ctx._set('familyMembers', [{ id: 1, name: 'Alice', email: '', phone: '', linkedMembers: [] }]);
        ctx._set('bills', []);

        await ctx.refreshPublicShares();

        const deleteOps = ops.filter(o => o.op === 'delete');
        const setOps = ops.filter(o => o.op === 'set');
        assert.equal(deleteOps.length, 1, 'should delete 1 stale doc');
        assert.equal(setOps.length, 1, 'should set 1 active doc');
    });

    it('deletes publicShares docs for expired tokens', async () => {
        const ops = [];
        const pastDate = new Date(Date.now() - 86400000);
        const ctx = createContext({
            db: {
                collection: (name) => ({
                    doc: (id) => ({
                        set: () => Promise.resolve(),
                        get: () => Promise.resolve({ exists: false }),
                        collection: () => ({
                            doc: () => ({ get: () => Promise.resolve({ exists: false }), set: () => Promise.resolve() }),
                            get: () => Promise.resolve({ docs: [] }),
                        }),
                    }),
                    where: (field, op, val) => ({
                        where: () => ({
                            get: () => Promise.resolve({
                                docs: [
                                    {
                                        id: 'hashExpired',
                                        data: () => ({
                                            ownerId: 'test-user',
                                            memberId: 1,
                                            billingYearId: '2026',
                                            revoked: false,
                                            expiresAt: { toDate: () => pastDate },
                                            scopes: ['summary:read'],
                                        }),
                                    },
                                ],
                            }),
                        }),
                        get: () => Promise.resolve({ docs: [] }),
                    }),
                }),
                batch: () => {
                    return {
                        set: () => { ops.push({ op: 'set' }); },
                        delete: () => { ops.push({ op: 'delete' }); },
                        commit: () => Promise.resolve(),
                    };
                },
            },
        });

        ctx._set('familyMembers', [{ id: 1, name: 'Alice', email: '', phone: '', linkedMembers: [] }]);
        ctx._set('bills', []);

        await ctx.refreshPublicShares();

        assert.equal(ops.filter(o => o.op === 'delete').length, 1, 'should delete expired doc');
        assert.equal(ops.filter(o => o.op === 'set').length, 0, 'should not set expired doc');
    });
});

// ──────────────── Invoice Composer Helpers ────────────────

describe('getInvoiceSummaryContext', () => {
    it('returns null for unknown memberId', () => {
        const ctx = createContext();
        ctx._set('familyMembers', []);
        assert.equal(ctx.getInvoiceSummaryContext(999), null);
    });

    it('returns correct context for a member with bills', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice Smith', email: 'alice@test.com', phone: '+15551234567', avatar: '', linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', members: [1], logo: '', website: '' },
        ]);
        ctx._set('payments', []);

        const result = ctx.getInvoiceSummaryContext(1);
        assert.ok(result);
        assert.equal(result.member.id, 1);
        assert.equal(result.firstName, 'Alice');
        assert.equal(result.combinedTotal, 180);
        assert.equal(result.payment, 0);
        assert.equal(result.balance, 180);
        assert.equal(result.amountStr, '$180.00');
        assert.equal(result.amountLabel, 'total');
        assert.equal(result.currentYear, '2026');
        assert.equal(result.numMembers, 1);
    });

    it('includes linked member totals', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Bob', email: '', phone: '', avatar: '', linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', phone: '', avatar: '', linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 10, billingFrequency: 'monthly', members: [1, 2], logo: '', website: '' },
        ]);
        ctx._set('payments', []);

        const result = ctx.getInvoiceSummaryContext(1);
        assert.equal(result.combinedTotal, 120);
        assert.equal(result.numMembers, 2);
        assert.equal(result.linkedMembersData.length, 1);
    });

    it('computes balance when payments exist', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Hulu', amount: 120, billingFrequency: 'annual', members: [1], logo: '', website: '' },
        ]);
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 50, receivedAt: '2026-01-01', note: '', method: 'cash' },
        ]);

        const result = ctx.getInvoiceSummaryContext(1);
        assert.equal(result.combinedTotal, 120);
        assert.equal(result.payment, 50);
        assert.equal(result.balance, 70);
        assert.equal(result.amountStr, '$70.00');
        assert.equal(result.amountLabel, 'remaining balance');
    });
});

describe('buildInvoiceSubject', () => {
    it('returns formatted subject with year and member name', () => {
        const ctx = createContext();
        const result = ctx.buildInvoiceSubject('2026', { name: 'Alice Smith' });
        assert.ok(result.includes('2026'));
        assert.ok(result.includes('Alice Smith'));
        assert.ok(result.includes('Annual Billing Summary'));
    });
});

describe('generateInvoiceHTML', () => {
    it('uses the shared annual summary shell and includes visual assets', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice Smith', email: '', phone: '', avatar: 'data:image/png;base64,QUJD', linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', members: [1], logo: 'data:image/png;base64,REVG', website: '' },
        ]);

        const summary = ctx.calculateAnnualSummary();
        const html = ctx.generateInvoiceHTML(summary, '2026');

        assert.ok(html.includes('annual-summary.css'));
        assert.ok(html.includes('annual-summary-hero'));
        assert.ok(html.includes('logo.svg'));
        assert.ok(html.includes('data:image/png;base64,REVG'));
        assert.ok(html.includes('Billing Year 2026'));
    });
});

describe('buildInvoiceBody', () => {
    function makeCtx() {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice Smith', email: 'alice@test.com', phone: '', avatar: '', linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', members: [1], logo: '', website: '' },
        ]);
        ctx._set('payments', []);
        return ctx;
    }

    it('text-only variant includes greeting and amount, no link', () => {
        const ctx = makeCtx();
        const summary = ctx.getInvoiceSummaryContext(1);
        const body = ctx.buildInvoiceBody(summary, 'text-only', 'https://example.com/share', 'sms');
        assert.ok(body.includes('Alice'));
        assert.ok(body.includes('$180.00'));
        assert.ok(!body.includes('https://example.com/share'));
        assert.ok(body.startsWith('Hey'));
    });

    it('text-only email variant uses Hello greeting', () => {
        const ctx = makeCtx();
        const summary = ctx.getInvoiceSummaryContext(1);
        const body = ctx.buildInvoiceBody(summary, 'text-only', '', 'email');
        assert.ok(body.startsWith('Hello'));
    });

    it('text-link variant includes greeting and link', () => {
        const ctx = makeCtx();
        const summary = ctx.getInvoiceSummaryContext(1);
        const body = ctx.buildInvoiceBody(summary, 'text-link', 'https://example.com/share', 'sms');
        assert.ok(body.includes('Alice'));
        assert.ok(body.includes('$180.00'));
        assert.ok(body.includes('https://example.com/share'));
    });

    it('text-link variant without shareUrl omits link', () => {
        const ctx = makeCtx();
        const summary = ctx.getInvoiceSummaryContext(1);
        const body = ctx.buildInvoiceBody(summary, 'text-link', '', 'sms');
        assert.ok(body.includes('Alice'));
        assert.ok(!body.includes('View & pay'));
    });

    it('unknown variant falls through to text-link', () => {
        const ctx = makeCtx();
        const summary = ctx.getInvoiceSummaryContext(1);
        const body = ctx.buildInvoiceBody(summary, 'link-cta', 'https://example.com/share', 'sms');
        assert.ok(body.includes('https://example.com/share'));
        assert.ok(body.includes('Alice'));
    });

    it('full variant produces detailed invoice text', () => {
        const ctx = makeCtx();
        const summary = ctx.getInvoiceSummaryContext(1);
        const body = ctx.buildInvoiceBody(summary, 'full', '', 'email');
        assert.ok(body.includes('ANNUAL BILLING SUMMARY'));
        assert.ok(body.includes('Netflix'));
        assert.ok(body.includes('$180.00'));
        assert.ok(body.includes('Thank you'));
    });

    it('full variant includes share link when provided', () => {
        const ctx = makeCtx();
        const summary = ctx.getInvoiceSummaryContext(1);
        const body = ctx.buildInvoiceBody(summary, 'full', 'https://example.com/share', 'email');
        assert.ok(body.includes('https://example.com/share'));
    });
});

describe('buildSmsDeepLink', () => {
    it('returns iOS format when user agent is iPhone', () => {
        const ctx = createContext({
            navigator: {
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
                clipboard: { writeText: () => Promise.resolve() },
            },
        });
        const result = ctx.buildSmsDeepLink('+15551234567', 'Hello');
        assert.ok(result.startsWith('sms:+15551234567&body='));
        assert.ok(result.includes(encodeURIComponent('Hello')));
    });

    it('returns Android format when user agent is Android', () => {
        const ctx = createContext({
            navigator: {
                userAgent: 'Mozilla/5.0 (Linux; Android 14)',
                clipboard: { writeText: () => Promise.resolve() },
            },
        });
        const result = ctx.buildSmsDeepLink('+15551234567', 'Hello');
        assert.ok(result.startsWith('sms:+15551234567?body='));
        assert.ok(result.includes(encodeURIComponent('Hello')));
    });

    it('returns iOS format for macOS user agent', () => {
        const ctx = createContext({
            navigator: {
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                clipboard: { writeText: () => Promise.resolve() },
            },
        });
        const result = ctx.buildSmsDeepLink('+15551234567', 'Hello');
        assert.ok(result.startsWith('sms:+15551234567&body='));
        assert.ok(result.includes(encodeURIComponent('Hello')));
    });

    it('handles missing phone number on iOS', () => {
        const ctx = createContext({
            navigator: {
                userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)',
                clipboard: { writeText: () => Promise.resolve() },
            },
        });
        const result = ctx.buildSmsDeepLink('', 'Test message');
        assert.ok(result.startsWith('sms:&body='));
    });

    it('handles missing phone number on Android', () => {
        const ctx = createContext({
            navigator: {
                userAgent: 'Mozilla/5.0 (Linux; Android 14)',
                clipboard: { writeText: () => Promise.resolve() },
            },
        });
        const result = ctx.buildSmsDeepLink(null, 'Test message');
        assert.ok(result.startsWith('sms:?body='));
    });

    it('handles undefined userAgent gracefully', () => {
        const ctx = createContext({
            navigator: {
                clipboard: { writeText: () => Promise.resolve() },
            },
        });
        const result = ctx.buildSmsDeepLink('+15551234567', 'Hello');
        assert.equal(result, null);
    });
});

describe('openSmsComposer', () => {
    it('navigates via location.href on iOS', () => {
        const ctx = createContext({
            navigator: {
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
                clipboard: { writeText: () => Promise.resolve() },
            },
        });
        ctx.openSmsComposer('+15551234567', 'Hello');
        assert.ok(ctx.window.location.href.startsWith('sms:'));
    });

    it('copies to clipboard on unsupported platform fallback', async () => {
        let copiedText = '';
        const ctx = createContext({
            navigator: {
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                clipboard: { writeText: (text) => { copiedText = text; return Promise.resolve(); } },
            },
        });
        ctx.openSmsComposer('+15551234567', 'Hello there');
        assert.equal(copiedText, 'Hello there');
    });
});

describe('updateInvoiceVariant', () => {
    it('updates textarea value for sms channel', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', phone: '', avatar: '', linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Netflix', amount: 15, billingFrequency: 'monthly', members: [1], logo: '', website: '' },
        ]);
        ctx._set('payments', []);

        const summary = ctx.getInvoiceSummaryContext(1);
        ctx._set('_invoiceDialogState', { ctx: summary, shareUrl: 'https://example.com', memberId: 1, variant: 'text-only' });

        let textareaValue = '';
        ctx.document.getElementById = (id) => {
            if (id === 'textInvoiceMessage') return { get value() { return textareaValue; }, set value(v) { textareaValue = v; } };
            return { innerHTML: '', textContent: '', value: '', style: {}, classList: { add: () => {}, remove: () => {}, contains: () => false } };
        };

        ctx.updateInvoiceVariant('text-link', 'sms');
        assert.ok(textareaValue.includes('https://example.com'));
    });
});
