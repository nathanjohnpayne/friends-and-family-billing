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
        case 'settings': settings = val; break;
        case 'currentUser': currentUser = val; break;
    }
}
function _get(key) {
    switch(key) {
        case 'familyMembers': return familyMembers;
        case 'bills': return bills;
        case 'settings': return settings;
        case 'currentUser': return currentUser;
    }
}
`;

function createContext(overrides = {}) {
    const saved = [];
    const ctx = {
        // Minimal DOM stubs
        document: {
            addEventListener: () => {},
            getElementById: () => ({
                innerHTML: '',
                textContent: '',
                value: '',
            }),
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
        JSON,
        Promise,
        RegExp,
        setTimeout,
        clearTimeout,
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
    vm.runInContext(testableSource, ctx);

    // Set currentUser so saveData works
    ctx._set('currentUser', { uid: 'test-user' });

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

// ───────────────────────── updatePayment ──────────────────────

describe('updatePayment', () => {
    it('sets paymentReceived on a simple (unlinked) member', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Net', amount: 100, logo: '', website: '', members: [1] },
        ]);

        ctx.updatePayment(1, '500');
        assert.equal(ctx._get('familyMembers')[0].paymentReceived, 500);
    });

    it('clamps negative values to zero', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Net', amount: 100, logo: '', website: '', members: [1] },
        ]);

        ctx.updatePayment(1, '-50');
        assert.equal(ctx._get('familyMembers')[0].paymentReceived, 0);
    });

    it('distributes payment proportionally among linked members', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Phone', amount: 100, logo: '', website: '', members: [1, 2] },
        ]);

        // Both owe $50/mo = $600/yr each, combined $1200
        ctx.updatePayment(1, '600');

        const members = ctx._get('familyMembers');
        assert.equal(members[0].paymentReceived, 600);
        // Child gets proportional share: 600 * (600/1200) = 300
        assert.equal(members[1].paymentReceived, 300);
    });

    it('distributes proportionally with unequal bill assignments', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'Phone', amount: 100, logo: '', website: '', members: [1, 2] },
            { id: 101, name: 'Insurance', amount: 200, logo: '', website: '', members: [1] },
        ]);

        // Parent: $50/mo + $200/mo = $3000/yr
        // Child: $50/mo = $600/yr
        // Combined: $3600
        const payment = 1800;
        ctx.updatePayment(1, String(payment));

        const members = ctx._get('familyMembers');
        const expectedChild = payment * (600 / 3600);

        assert.equal(members[0].paymentReceived, payment);
        assert.ok(
            Math.abs(members[1].paymentReceived - expectedChild) < 0.01,
            `Child payment ${members[1].paymentReceived} should be ~${expectedChild}`
        );
    });

    it('handles zero combined total without NaN', () => {
        const ctx = createContext();
        ctx._set('familyMembers', [
            { id: 1, name: 'Parent', email: '', avatar: '', paymentReceived: 0, linkedMembers: [2] },
            { id: 2, name: 'Child', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', []);

        ctx.updatePayment(1, '100');
        const members = ctx._get('familyMembers');
        assert.equal(members[0].paymentReceived, 100);
        assert.equal(members[1].paymentReceived, 0);
        assert.ok(!Number.isNaN(members[1].paymentReceived));
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

// ──────────────────────── clearAllData ─────────────────────────

describe('clearAllData', () => {
    it('resets arrays and persists to Firestore', async () => {
        const ctx = createContext({
            confirm: () => true,
            alert: () => {},
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Alice', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'X', amount: 10, logo: '', website: '', members: [1] },
        ]);

        await ctx.clearAllData();

        assert.equal(ctx._get('familyMembers').length, 0);
        assert.equal(ctx._get('bills').length, 0);
        assert.ok(ctx._saved.length > 0, 'saveData should have persisted to Firestore');
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

        ctx._set('familyMembers', [
            { id: 1, name: 'Existing', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);

        await ctx.importFromLocalStorage();

        const members = ctx._get('familyMembers');
        assert.equal(members.length, 1);
        assert.equal(members[0].name, 'Imported');

        const bills = ctx._get('bills');
        assert.equal(bills.length, 1);
        assert.equal(bills[0].name, 'ImportedBill');
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
            return { innerHTML: '', textContent: '', value: '' };
        };

        assert.doesNotThrow(() => ctx.addFamilyMember());
    });
});

// ──────────── import replaces with empty arrays ───────────────

describe('importFromLocalStorage with empty arrays', () => {
    it('replaces existing data even when imported arrays are empty', async () => {
        const storage = {
            familyMembers: '[]',
            bills: '[]',
            settings: null,
        };

        const ctx = createContext({
            confirm: () => true,
            alert: () => {},
            localStorage: {
                getItem: (key) => storage[key] || null,
            },
        });

        ctx._set('familyMembers', [
            { id: 1, name: 'Existing', email: '', avatar: '', paymentReceived: 0, linkedMembers: [] },
        ]);
        ctx._set('bills', [
            { id: 100, name: 'OldBill', amount: 50, logo: '', website: '', members: [1] },
        ]);

        await ctx.importFromLocalStorage();

        assert.equal(ctx._get('familyMembers').length, 0, 'familyMembers should be empty after importing []');
        assert.equal(ctx._get('bills').length, 0, 'bills should be empty after importing []');
    });
});
