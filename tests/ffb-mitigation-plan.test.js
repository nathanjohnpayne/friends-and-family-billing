const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scriptSource = fs.readFileSync(
    path.join(__dirname, '..', 'script.js'),
    'utf8'
);

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

    ctx._set('currentUser', { uid: 'test-user' });
    ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'open', createdAt: null, archivedAt: null });

    return ctx;
}

// ───────────────── P0.4: Invoice Template Duplication ─────────────────

describe('detectDuplicatePaymentText', () => {
    it('returns false for template with only %payment_methods% token', () => {
        const ctx = createContext();
        const template = 'Your total is %annual_total%. Pay via:\n%payment_methods%';
        assert.equal(ctx.detectDuplicatePaymentText(template), false);
    });

    it('returns false for template with only literal payment text (no token)', () => {
        const ctx = createContext();
        const template = 'Pay via Venmo @handle or Zelle to email@test.com';
        assert.equal(ctx.detectDuplicatePaymentText(template), false);
    });

    it('returns true for template with both token and literal Venmo text', () => {
        const ctx = createContext();
        const template = 'Your total is %annual_total%.\n%payment_methods%\n\nVenmo: @nathanpayne';
        assert.equal(ctx.detectDuplicatePaymentText(template), true);
    });

    it('returns true for template with both token and literal Zelle text', () => {
        const ctx = createContext();
        const template = '%payment_methods%\nAlso pay via Zelle to 555-1234';
        assert.equal(ctx.detectDuplicatePaymentText(template), true);
    });

    it('returns true for template with both token and Apple Cash text', () => {
        const ctx = createContext();
        const template = '%payment_methods%\nApple Cash: 555-1234';
        assert.equal(ctx.detectDuplicatePaymentText(template), true);
    });

    it('returns false for empty or null template', () => {
        const ctx = createContext();
        assert.equal(ctx.detectDuplicatePaymentText(''), false);
        assert.equal(ctx.detectDuplicatePaymentText(null), false);
        assert.equal(ctx.detectDuplicatePaymentText(undefined), false);
    });

    it('returns true for case-insensitive match', () => {
        const ctx = createContext();
        const template = '%payment_methods%\nVENMO: @handle';
        assert.equal(ctx.detectDuplicatePaymentText(template), true);
    });
});

// ───────────────── P1.1: Settlement Status Display ─────────────────

describe('settlement status - ready to close display', () => {
    it('calculateSettlementMetrics returns 100% when all members paid', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', linkedMembers: [] },
            { id: 2, name: 'Bob', linkedMembers: [] }
        ]);
        ctx._set('bills', [
            { id: 1, name: 'Test', amount: 100, billingFrequency: 'annual', members: [1, 2] }
        ]);
        ctx._set('payments', [
            { id: 'p1', memberId: 1, amount: 50, receivedAt: new Date().toISOString() },
            { id: 'p2', memberId: 2, amount: 50, receivedAt: new Date().toISOString() }
        ]);

        const metrics = ctx.calculateSettlementMetrics();
        assert.equal(metrics.percentage, 100);
        assert.equal(metrics.paidCount, 2);
        assert.equal(metrics.totalMembers, 2);
        assert.equal(metrics.totalOutstanding, 0);
    });

    it('BILLING_YEAR_STATUSES has settling status', () => {
        const ctx = createContext();
        assert.equal(ctx.BILLING_YEAR_STATUSES.settling.label, 'Settling');
    });
});

// ───────────────── P1.2: Confirmation modals ─────────────────

describe('showConfirmationDialog', () => {
    it('is exported and callable', () => {
        const ctx = createContext();
        assert.equal(typeof ctx.showConfirmationDialog, 'function');
    });
});

// ───────────────── P1.4: Bill frequency toggle label ─────────────────

describe('toggleBillFrequency', () => {
    it('is exported and callable', () => {
        const ctx = createContext();
        assert.equal(typeof ctx.toggleBillFrequency, 'function');
    });

    it('does not modify bill when year is read-only', () => {
        const ctx = createContext();
        ctx._set('currentBillingYear', { id: '2026', label: '2026', status: 'archived', createdAt: null, archivedAt: null });
        ctx._set('bills', [
            { id: 1, name: 'Netflix', amount: 15, billingFrequency: 'monthly', members: [1], website: '' }
        ]);
        ctx._set('familyMembers', [{ id: 1, name: 'Alice', linkedMembers: [] }]);

        ctx.toggleBillFrequency(1);
        // Bill should remain unchanged since year is archived
        assert.equal(ctx._get('bills')[0].amount, 15);
        assert.equal(ctx._get('bills')[0].billingFrequency, 'monthly');
    });

    it('getBillAnnualAmount computes annual from monthly', () => {
        const ctx = createContext();
        const bill = { amount: 15, billingFrequency: 'monthly' };
        assert.equal(ctx.getBillAnnualAmount(bill), 180);
    });

    it('getBillMonthlyAmount computes monthly from annual', () => {
        const ctx = createContext();
        const bill = { amount: 1200, billingFrequency: 'annual' };
        assert.equal(ctx.getBillMonthlyAmount(bill), 100);
    });
});
