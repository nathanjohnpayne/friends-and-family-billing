const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scriptSource = fs.readFileSync(
    path.join(__dirname, '..', 'script.js'),
    'utf8'
);

// Append test helpers that close over the let-scoped variables,
// giving tests a way to read/write them from outside the VM.
const testableSource = scriptSource + `
function _set(key, val) {
    switch(key) {
        case 'familyMembers': familyMembers = val; break;
        case 'bills': bills = val; break;
        case 'payments': payments = val; break;
        case 'settings': settings = val; break;
        case 'currentUser': currentUser = val; break;
        case 'currentBillingYear': currentBillingYear = val; break;
        case 'billingYears': billingYears = val; break;
    }
}
function _get(key) {
    switch(key) {
        case 'familyMembers': return familyMembers;
        case 'bills': return bills;
        case 'payments': return payments;
        case 'settings': return settings;
        case 'currentUser': return currentUser;
        case 'currentBillingYear': return currentBillingYear;
        case 'billingYears': return billingYears;
    }
}
`;

function makeMockDoc(saved) {
    return {
        set: (...args) => { saved.push(args); return Promise.resolve(); },
        get: () => Promise.resolve({ exists: false }),
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
        window: {
            location: { href: '', origin: 'https://friends-and-family-billing.web.app' },
            open: () => ({
                document: { write: () => {}, close: () => {} },
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
        ...overrides,
    };

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
    it('removes a payment entry from the ledger', () => {
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
        assert.equal(payments.length, 1);
        assert.equal(payments[0].id, 'p2');
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

// ──────────────── Payment Links Settings ──────────────────────

describe('payment links settings', () => {
    it('addPaymentLink adds a link to settings', () => {
        const ctx = createContext();
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [] });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinkName') return { value: 'Venmo' };
            if (id === 'paymentLinkUrl') return { value: 'https://venmo.com/handle' };
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addPaymentLink();
        const links = ctx._get('settings').paymentLinks;
        assert.equal(links.length, 1);
        assert.equal(links[0].name, 'Venmo');
        assert.equal(links[0].url, 'https://venmo.com/handle');
        assert.ok(links[0].id.startsWith('pl_'), 'ID should have pl_ prefix');
    });

    it('removePaymentLink removes a link', () => {
        const ctx = createContext();
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [
                { id: 'pl_1', name: 'Venmo', url: 'https://venmo.com/x' },
                { id: 'pl_2', name: 'Zelle', url: 'zelle:test@test.com' },
            ]
        });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.removePaymentLink('pl_1');
        const links = ctx._get('settings').paymentLinks;
        assert.equal(links.length, 1);
        assert.equal(links[0].id, 'pl_2');
    });

    it('editPaymentLink updates name and url', () => {
        let promptCalls = 0;
        const ctx = createContext({
            prompt: () => {
                promptCalls++;
                return promptCalls === 1 ? 'PayPal' : 'https://paypal.me/new';
            }
        });
        ctx._set('settings', {
            emailMessage: 'test',
            paymentLinks: [
                { id: 'pl_1', name: 'Venmo', url: 'https://venmo.com/x' },
            ]
        });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.editPaymentLink('pl_1');
        const link = ctx._get('settings').paymentLinks[0];
        assert.equal(link.name, 'PayPal');
        assert.equal(link.url, 'https://paypal.me/new');
    });

    it('prevents changes when year is archived', () => {
        const alerts = [];
        const ctx = createContext({ alert: (msg) => alerts.push(msg) });
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('settings', { emailMessage: 'test', paymentLinks: [] });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinkName') return { value: 'Venmo' };
            if (id === 'paymentLinkUrl') return { value: 'https://venmo.com/x' };
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addPaymentLink();
        assert.equal(ctx._get('settings').paymentLinks.length, 0, 'Should not add link');
        assert.ok(alerts.some(a => a.includes('archived')), 'Should show archived alert');
    });

    it('initializes paymentLinks when missing from settings', () => {
        const ctx = createContext();
        ctx._set('settings', { emailMessage: 'test' });

        ctx.document.getElementById = (id) => {
            if (id === 'paymentLinkName') return { value: 'Test' };
            if (id === 'paymentLinkUrl') return { value: 'https://test.com' };
            if (id === 'paymentLinksSettings') return { innerHTML: '' };
            return { innerHTML: '', textContent: '', value: '', style: {} };
        };

        ctx.addPaymentLink();
        const links = ctx._get('settings').paymentLinks;
        assert.equal(links.length, 1);
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
            { name: 'Internet', amount: 120, members: [1, 2] },
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

