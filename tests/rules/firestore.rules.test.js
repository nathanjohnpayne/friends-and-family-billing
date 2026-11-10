// Firestore security-rules suite for firestore.rules (run: npm run test:rules).
//
// Every hardened rule gets a deny case for the write/read it now forbids and an
// allow case for the legitimate client flow that must keep working (the client
// call sites are named next to each allow case).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
    where,
    writeBatch,
} from 'firebase/firestore';

const RULES_PATH = fileURLToPath(new URL('../../firestore.rules', import.meta.url));
const ALICE = 'alice';
const BOB = 'bob';
const TOKEN = 'a'.repeat(64);
const BOB_TOKEN = 'b'.repeat(64);

let testEnv;
const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();
const asGuest = () => testEnv.unauthenticatedContext().firestore();

async function seed(path, data) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), path), data);
    });
}

const tokenDoc = (ownerId, extra = {}) => ({
    ownerId,
    memberId: 1,
    memberName: 'Member One',
    billingYearId: '2026',
    scopes: ['summary:read', 'disputes:create', 'disputes:read'],
    revoked: false,
    rawToken: 'raw',
    expiresAt: null,
    ...extra,
});

beforeAll(async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
    const [hostname, port] = host.split(':');
    testEnv = await initializeTestEnvironment({
        projectId: 'demo-ffb-rules',
        firestore: { host: hostname, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
    });
});

afterAll(async () => {
    await testEnv?.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
});

// ── shareTokens ─────────────────────────────────────────────────────────────

describe('shareTokens', () => {
    beforeEach(async () => {
        await seed(`shareTokens/${TOKEN}`, tokenDoc(ALICE));
        await seed(`shareTokens/${BOB_TOKEN}`, tokenDoc(BOB));
    });

    it('allows the owner to create a new, unrevoked token (ShareLinkService / InvoicingTab)', async () => {
        const db = asUser(ALICE);
        await assertSucceeds(setDoc(doc(db, 'shareTokens', 'c'.repeat(64)), {
            ...tokenDoc(ALICE),
            createdAt: serverTimestamp(),
        }));
    });

    it('denies creating a token for another owner', async () => {
        await assertFails(setDoc(doc(asUser(ALICE), 'shareTokens', 'c'.repeat(64)), tokenDoc(BOB)));
    });

    it('allows the owner to revoke with a merge set of revoked: true (ShareLinkDialog)', async () => {
        await assertSucceeds(setDoc(doc(asUser(ALICE), 'shareTokens', TOKEN), { revoked: true }, { merge: true }));
    });

    it('allows the owner to revoke with revokedAt = server time in a batch (ShareLinkService prune)', async () => {
        const db = asUser(ALICE);
        const batch = writeBatch(db);
        batch.update(doc(db, 'shareTokens', TOKEN), { revoked: true, revokedAt: serverTimestamp() });
        await assertSucceeds(batch.commit());
    });

    it('denies rewriting ownerId, memberId, billingYearId or scopes on an owned token', async () => {
        const ref = doc(asUser(ALICE), 'shareTokens', TOKEN);
        await assertFails(updateDoc(ref, { ownerId: BOB }));
        await assertFails(updateDoc(ref, { memberId: 2 }));
        await assertFails(updateDoc(ref, { billingYearId: '2025' }));
        await assertFails(updateDoc(ref, { scopes: ['summary:read', 'disputes:read', 'refunds:read'] }));
        await assertFails(updateDoc(ref, { revoked: true, scopes: ['summary:read'] }));
        await assertFails(updateDoc(ref, { expiresAt: null, revoked: true, memberId: 3 }));
    });

    it('denies un-revoking or a client-chosen revokedAt', async () => {
        await seed(`shareTokens/${TOKEN}`, tokenDoc(ALICE, { revoked: true }));
        const ref = doc(asUser(ALICE), 'shareTokens', TOKEN);
        await assertFails(updateDoc(ref, { revoked: false }));
        await assertFails(updateDoc(ref, { revokedAt: new Date('2000-01-01') }));
    });

    it('denies any update or read by a non-owner', async () => {
        const ref = doc(asUser(BOB), 'shareTokens', TOKEN);
        await assertFails(updateDoc(ref, { revoked: true }));
        await assertFails(getDoc(ref));
        await assertFails(getDoc(doc(asGuest(), 'shareTokens', TOKEN)));
    });

    it('allows owner-filtered queries and denies unfiltered/foreign ones (SettingsView, ShareLinkDialog)', async () => {
        const db = asUser(ALICE);
        await assertSucceeds(getDocs(query(collection(db, 'shareTokens'), where('ownerId', '==', ALICE))));
        await assertSucceeds(getDocs(query(
            collection(db, 'shareTokens'),
            where('ownerId', '==', ALICE),
            where('memberId', '==', 1),
            where('revoked', '==', false),
        )));
        await assertFails(getDocs(collection(db, 'shareTokens')));
        await assertFails(getDocs(query(collection(db, 'shareTokens'), where('ownerId', '==', BOB))));
    });

    it('allows the owner to delete their token and denies others', async () => {
        await assertFails(deleteDoc(doc(asUser(BOB), 'shareTokens', TOKEN)));
        await assertSucceeds(deleteDoc(doc(asUser(ALICE), 'shareTokens', TOKEN)));
    });
});

// ── publicShares ────────────────────────────────────────────────────────────

describe('publicShares', () => {
    beforeEach(async () => {
        await seed(`publicShares/${TOKEN}`, { ownerId: ALICE, memberId: 1, accessCount: 0, paymentMethods: [] });
        await seed(`publicShares/${BOB_TOKEN}`, { ownerId: BOB, memberId: 1, accessCount: 0 });
    });

    it('allows anyone to get a single share doc by token hash (ShareView)', async () => {
        await assertSucceeds(getDoc(doc(asGuest(), 'publicShares', TOKEN)));
        await assertSucceeds(getDoc(doc(asUser(BOB), 'publicShares', TOKEN)));
    });

    it('denies listing the collection to guests and to unfiltered/foreign queries (#424)', async () => {
        await assertFails(getDocs(collection(asGuest(), 'publicShares')));
        await assertFails(getDocs(collection(asUser(ALICE), 'publicShares')));
        await assertFails(getDocs(query(collection(asUser(ALICE), 'publicShares'), where('ownerId', '==', BOB))));
    });

    it('allows an owner-filtered list', async () => {
        await assertSucceeds(getDocs(query(collection(asUser(ALICE), 'publicShares'), where('ownerId', '==', ALICE))));
    });

    it('allows the owner to create and update while keeping ownerId (ShareLinkService, SettingsView sync)', async () => {
        const db = asUser(ALICE);
        await assertSucceeds(setDoc(doc(db, 'publicShares', 'c'.repeat(64)), { ownerId: ALICE, memberId: 2 }));
        await assertSucceeds(updateDoc(doc(db, 'publicShares', TOKEN), { paymentMethods: [{ type: 'venmo' }], updatedAt: serverTimestamp() }));
    });

    it('denies the owner changing ownerId on update', async () => {
        await assertFails(updateDoc(doc(asUser(ALICE), 'publicShares', TOKEN), { ownerId: BOB }));
    });

    it('denies creating a share for another owner and updating someone else\'s share', async () => {
        await assertFails(setDoc(doc(asUser(ALICE), 'publicShares', 'c'.repeat(64)), { ownerId: BOB }));
        await assertFails(updateDoc(doc(asUser(ALICE), 'publicShares', BOB_TOKEN), { paymentMethods: [] }));
        await assertFails(deleteDoc(doc(asUser(ALICE), 'publicShares', BOB_TOKEN)));
    });

    it('allows guests to bump only accessCount/lastAccessedAt (ShareView)', async () => {
        const ref = doc(asGuest(), 'publicShares', TOKEN);
        await assertSucceeds(updateDoc(ref, { accessCount: increment(1), lastAccessedAt: serverTimestamp() }));
        await assertFails(updateDoc(ref, { ownerId: BOB }));
        await assertFails(updateDoc(ref, { paymentMethods: [{ type: 'venmo', handle: '@attacker' }] }));
    });

    it('allows the owner to delete their share (revoke flow)', async () => {
        await assertSucceeds(deleteDoc(doc(asUser(ALICE), 'publicShares', TOKEN)));
    });
});

// ── publicQrCodes ───────────────────────────────────────────────────────────

describe('publicQrCodes', () => {
    const qr = (ownerId, methodId = 'm1') => ({ ownerId, methodId, qrCode: 'data:image/png;base64,AAAA' });

    beforeEach(async () => {
        await seed(`publicQrCodes/${BOB}_m1`, qr(BOB));
    });

    it('allows anyone to get a QR doc by id (ShareView, BillingYearService)', async () => {
        await assertSucceeds(getDoc(doc(asGuest(), 'publicQrCodes', `${BOB}_m1`)));
    });

    it('denies listing to guests and unfiltered queries; allows an owner-filtered list (#424)', async () => {
        await assertFails(getDocs(collection(asGuest(), 'publicQrCodes')));
        await assertFails(getDocs(collection(asUser(ALICE), 'publicQrCodes')));
        await assertSucceeds(getDocs(query(collection(asUser(BOB), 'publicQrCodes'), where('ownerId', '==', BOB))));
    });

    it('allows the owner to create and overwrite docs in their own id namespace (SettingsView sync)', async () => {
        const db = asUser(ALICE);
        await assertSucceeds(setDoc(doc(db, 'publicQrCodes', `${ALICE}_m1`), { ...qr(ALICE), updatedAt: serverTimestamp() }));
        await assertSucceeds(setDoc(doc(db, 'publicQrCodes', `${ALICE}_m1`), { ...qr(ALICE), qrCode: 'data:image/png;base64,BBBB' }));
    });

    it('denies overwriting another owner\'s QR doc by claiming ownerId', async () => {
        await assertFails(setDoc(doc(asUser(ALICE), 'publicQrCodes', `${BOB}_m1`), qr(ALICE)));
        await assertFails(updateDoc(doc(asUser(ALICE), 'publicQrCodes', `${BOB}_m1`), { ownerId: ALICE, qrCode: 'x' }));
    });

    it('denies creating docs outside the caller\'s id namespace', async () => {
        await assertFails(setDoc(doc(asUser(ALICE), 'publicQrCodes', `${BOB}_m2`), qr(ALICE, 'm2')));
        await assertFails(setDoc(doc(asUser('ali'), 'publicQrCodes', 'alice_m9'), qr('ali', 'm9')));
        await assertFails(setDoc(doc(asUser(ALICE), 'publicQrCodes', `${ALICE}_`), qr(ALICE)));
        await assertFails(setDoc(doc(asUser(ALICE), 'publicQrCodes', 'm1'), qr(ALICE)));
    });

    it('denies the owner handing a doc to someone else', async () => {
        await assertFails(updateDoc(doc(asUser(BOB), 'publicQrCodes', `${BOB}_m1`), { ownerId: ALICE }));
    });

    it('allows the owner to delete and denies others', async () => {
        await assertFails(deleteDoc(doc(asUser(ALICE), 'publicQrCodes', `${BOB}_m1`)));
        await assertSucceeds(deleteDoc(doc(asUser(BOB), 'publicQrCodes', `${BOB}_m1`)));
    });

    it('denies guests writing', async () => {
        await assertFails(setDoc(doc(asGuest(), 'publicQrCodes', `${BOB}_m1`), qr(BOB)));
    });
});

// ── disputes ────────────────────────────────────────────────────────────────

describe('users/{uid}/billingYears/{year}/disputes', () => {
    const disputePath = `users/${ALICE}/billingYears/2026/disputes`;

    beforeEach(async () => {
        await seed(`publicShares/${TOKEN}`, {
            ownerId: ALICE,
            billingYearId: '2026',
            scopes: ['disputes:create', 'disputes:read'],
        });
        await seed(`${disputePath}/d1`, {
            tokenHash: TOKEN,
            memberId: 1,
            status: 'resolved',
            userReview: { state: 'requested' },
        });
    });

    it('denies unauthenticated dispute creation even with a valid share token', async () => {
        await assertFails(setDoc(doc(asGuest(), disputePath, 'd2'), {
            tokenHash: TOKEN,
            memberId: 1,
            memberName: 'Member One',
            billId: 1,
            billName: 'Internet',
            message: 'hi',
            status: 'open',
            createdAt: serverTimestamp(),
        }));
    });

    it('denies unauthenticated dispute updates (decisions go through submitDisputeDecision)', async () => {
        await assertFails(updateDoc(doc(asGuest(), disputePath, 'd1'), {
            status: 'open',
            userReview: { state: 'rejected_by_user' },
        }));
    });

    it('denies other signed-in users', async () => {
        await assertFails(getDoc(doc(asUser(BOB), disputePath, 'd1')));
        await assertFails(updateDoc(doc(asUser(BOB), disputePath, 'd1'), { status: 'open' }));
    });

    it('allows the owner to read, create and update (useDisputes, ChargeNoticeService, RefundNoticeService)', async () => {
        const db = asUser(ALICE);
        await assertSucceeds(getDocs(collection(db, disputePath)));
        await assertSucceeds(addDoc(collection(db, disputePath), { kind: 'refund_notice', memberId: 1, status: 'open' }));
        await assertSucceeds(updateDoc(doc(db, disputePath, 'd1'), { status: 'in_review' }));
    });
});

// ── mailQueue ───────────────────────────────────────────────────────────────

describe('mailQueue', () => {
    const mail = (extra = {}) => ({
        to: 'member@example.com',
        subject: 'Your 2026 invoice',
        body: 'Hello **there**',
        uid: ALICE,
        status: 'pending',
        createdAt: serverTimestamp(),
        ...extra,
    });

    it('allows a signed-in user to queue plain mail for their own uid (queueEmail)', async () => {
        await assertSucceeds(addDoc(collection(asUser(ALICE), 'mailQueue'), mail()));
    });

    it('allows queueing mail without a createdAt field (createdAt is optional)', async () => {
        const { createdAt: _createdAt, ...noCreatedAt } = mail();
        await assertSucceeds(addDoc(collection(asUser(ALICE), 'mailQueue'), noCreatedAt));
    });

    it('denies client-supplied html, replyTo, origin or other extra fields', async () => {
        const col = collection(asUser(ALICE), 'mailQueue');
        await assertFails(addDoc(col, mail({ html: '<a href="https://example.com">x</a>' })));
        await assertFails(addDoc(col, mail({ replyTo: 'someone@example.com' })));
        await assertFails(addDoc(col, mail({ origin: 'server' })));
        await assertFails(addDoc(col, mail({ from: 'x@example.com' })));
    });

    it('denies queueing for another uid, a non-pending status, or unauthenticated', async () => {
        await assertFails(addDoc(collection(asUser(ALICE), 'mailQueue'), mail({ uid: BOB })));
        await assertFails(addDoc(collection(asUser(ALICE), 'mailQueue'), mail({ status: 'sent' })));
        await assertFails(addDoc(collection(asGuest(), 'mailQueue'), mail()));
    });

    it('denies malformed or oversized fields and a client-chosen createdAt', async () => {
        const col = collection(asUser(ALICE), 'mailQueue');
        await assertFails(addDoc(col, mail({ to: ['a@example.com', 'b@example.com'] })));
        await assertFails(addDoc(col, mail({ body: 'x'.repeat(100001) })));
        await assertFails(addDoc(col, mail({ subject: 's'.repeat(501) })));
        await assertFails(addDoc(col, mail({ createdAt: new Date('2000-01-01') })));
    });

    it('lets the sender watch their own queue doc but not others\', and denies client updates', async () => {
        await seed('mailQueue/m1', { ...mail(), createdAt: null });
        await assertSucceeds(getDoc(doc(asUser(ALICE), 'mailQueue', 'm1')));
        await assertFails(getDoc(doc(asUser(BOB), 'mailQueue', 'm1')));
        await assertFails(updateDoc(doc(asUser(ALICE), 'mailQueue', 'm1'), { status: 'sent' }));
    });
});

// ── server-only collections ────────────────────────────────────────────────

describe('server-only collections', () => {
    it('denies all client access to mailRateLimits', async () => {
        await seed(`mailRateLimits/${ALICE}`, { windowStartMs: 1, count: 1 });
        await assertFails(getDoc(doc(asUser(ALICE), 'mailRateLimits', ALICE)));
        await assertFails(setDoc(doc(asUser(ALICE), 'mailRateLimits', ALICE), { windowStartMs: 1, count: 0 }));
    });

    it('denies client writes to the audit log', async () => {
        await assertFails(addDoc(collection(asUser(ALICE), `users/${ALICE}/auditLog`), { action: 'x' }));
    });
});

// ── billingYears: versioned year-document writes ────────────────────────────
//
// specs/year-end-review.md § Versioned year-document writes (D-A option 2,
// #612). `describeYearDocumentRules(stage, rulesPath)` registers one describe
// per rules stage with the same cases; the stage-1-only allowances (an
// unversioned create, an unversioned write onto an unversioned document) are
// expected to succeed at stage 1 and fail at stage 2, every other case is the
// same at both stages. Each stage loads its rules into its own emulator project.
//
// firestore.rules is the stage-2 text since #616 removed both stage-1
// allowances, so the suite runs at stage 2: every `stage1Only(...)` case (the
// four marked "flipped at stage 2") now asserts the denial, and a write without
// `rev` is refused on every year document, absent, unversioned or versioned.
// The stage-1 run passed on #615 against the stage-1 rules text.
//
// Old tabs (a build deployed before the feature) are simulated by writing
// without `rev`. Client call sites are named next to each case.

const YEAR_ID = '2026';
const SOURCE_ID = '2025';
const CREATED_AT = Timestamp.fromMillis(Date.UTC(2026, 0, 1));
const SOURCE_CREATED_AT = Timestamp.fromMillis(Date.UTC(2025, 0, 1));
const OTHER_CREATED_AT = Timestamp.fromMillis(Date.UTC(2026, 5, 1));
const MALFORMED_REVS = ['1', 1.5, null];

const yearPath = (uid, yearId) => `users/${uid}/billingYears/${yearId}`;

// An abridged buildSavePayload-shaped year document; `extra` overrides fields.
const yearData = (extra = {}) => ({
    label: YEAR_ID,
    status: 'open',
    familyMembers: [{ id: 1, name: 'Member One' }],
    bills: [],
    payments: [],
    billingEvents: [],
    settings: {},
    createdAt: CREATED_AT,
    ...extra,
});

const sourceData = (extra = {}) => yearData({ label: SOURCE_ID, createdAt: SOURCE_CREATED_AT, ...extra });

// The same document without one field (a createdAt-less payload or stored document).
const without = (data, key) => {
    const { [key]: _omitted, ...rest } = data;
    return rest;
};

function describeYearDocumentRules(stage, rulesPath) {
    // Allowed only while the stage-1 rollout allowances are in force; denied at stage 2.
    const stage1Only = (promise) => (stage === 1 ? assertSucceeds(promise) : assertFails(promise));

    describe(`users/{uid}/billingYears/{year} versioned writes — stage ${stage}`, () => {
        let env;
        const owner = () => env.authenticatedContext(ALICE).firestore();
        const yearRef = (db, yearId = YEAR_ID, uid = ALICE) => doc(db, yearPath(uid, yearId));

        const seedYear = (yearId, data) => env.withSecurityRulesDisabled(async (ctx) => {
            await setDoc(doc(ctx.firestore(), yearPath(ALICE, yearId)), data);
        });

        const readYear = async (yearId) => {
            let snap;
            await env.withSecurityRulesDisabled(async (ctx) => {
                snap = await getDoc(doc(ctx.firestore(), yearPath(ALICE, yearId)));
            });
            return snap.exists() ? snap.data() : undefined;
        };

        // The legacy createYear writeBatch: a create-shaped destination (server
        // createdAt, no rev) and the source rewritten from memory (no rev).
        const legacyCreateYearBatch = (db) => {
            const batch = writeBatch(db);
            batch.set(yearRef(db, YEAR_ID), yearData({ createdAt: serverTimestamp() }));
            batch.set(yearRef(db, SOURCE_ID), sourceData({ status: 'closed' }));
            return batch.commit();
        };

        beforeAll(async () => {
            const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
            const [hostname, port] = host.split(':');
            env = await initializeTestEnvironment({
                projectId: `demo-ffb-rules-stage${stage}`,
                firestore: { host: hostname, port: Number(port), rules: readFileSync(rulesPath, 'utf8') },
            });
        });

        afterAll(async () => {
            await env?.cleanup();
        });

        beforeEach(async () => {
            await env.clearFirestore();
        });

        // ── versioned updates ──

        it('allows a versioned write at stored rev + 1 (save() full setDoc, setYearStatus() payload)', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 3 }));
            const db = owner();
            await assertSucceeds(setDoc(yearRef(db), yearData({ rev: 4, lastWriteId: 'w4', updatedAt: serverTimestamp() })));
            await assertSucceeds(setDoc(yearRef(db), { status: 'closed', billingEvents: [{ id: 'e1' }], rev: 5 }, { merge: true }));
            expect((await readYear(YEAR_ID)).rev).toBe(5);
        });

        it('denies a versioned write at the same rev, rev + 2, or a lower rev', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 3 }));
            const db = owner();
            await assertFails(setDoc(yearRef(db), yearData({ rev: 3 })));
            await assertFails(setDoc(yearRef(db), yearData({ rev: 5 })));
            await assertFails(setDoc(yearRef(db), yearData({ rev: 2 })));
            await assertFails(updateDoc(yearRef(db), { status: 'closed', rev: 3 }));
            expect((await readYear(YEAR_ID)).rev).toBe(3);
        });

        // ── create ──

        it('allows creating an absent year at rev 1 (loadData() first run, createYear destination)', async () => {
            await assertSucceeds(setDoc(yearRef(owner()), yearData({ rev: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })));
        });

        it('denies creating an absent year at any rev other than 1', async () => {
            const db = owner();
            await assertFails(setDoc(yearRef(db), yearData({ rev: 0 })));
            await assertFails(setDoc(yearRef(db), yearData({ rev: 2 })));
            expect(await readYear(YEAR_ID)).toBeUndefined();
        });

        it('denies a create-shaped rev 1 payload onto an existing versioned year', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 1 }));
            await seedYear(SOURCE_ID, sourceData({ rev: 4 }));
            const db = owner();
            await assertFails(setDoc(yearRef(db), yearData({ rev: 1, createdAt: serverTimestamp() })));
            await assertFails(setDoc(yearRef(db, SOURCE_ID), sourceData({ rev: 1, createdAt: serverTimestamp() })));
            await assertFails(setDoc(yearRef(db, SOURCE_ID), sourceData({ rev: 1 })));
        });

        // Flipped at stage 2 (#616): first-run and legacy creation without rev are denied.
        it('allows an unversioned create only at stage 1 (pre-feature loadData() first run, legacy createYear destination)', async () => {
            const db = owner();
            await stage1Only(setDoc(yearRef(db, YEAR_ID), yearData({ createdAt: serverTimestamp() })));
            const batch = writeBatch(db);
            batch.set(yearRef(db, '2027'), yearData({ label: '2027', createdAt: serverTimestamp() }));
            await stage1Only(batch.commit());
        });

        // ── migration of an unversioned document ──

        it('allows the first versioned write of an unversioned year at rev 1 with the stored createdAt', async () => {
            await seedYear(YEAR_ID, yearData());
            await seedYear(SOURCE_ID, sourceData());
            const db = owner();
            // save(): the full document, carrying the createdAt it loaded.
            await assertSucceeds(setDoc(yearRef(db), yearData({ rev: 1, lastWriteId: 'w1', updatedAt: serverTimestamp() })));
            // setYearStatus()-shaped merge: createdAt is untouched, so unchanged.
            await assertSucceeds(setDoc(yearRef(db, SOURCE_ID), { status: 'closed', billingEvents: [], rev: 1 }, { merge: true }));
        });

        it('denies a migration write that changes or drops createdAt (a create-shaped rollover payload)', async () => {
            await seedYear(YEAR_ID, yearData());
            const db = owner();
            await assertFails(setDoc(yearRef(db), yearData({ rev: 1, createdAt: serverTimestamp() })));
            await assertFails(setDoc(yearRef(db), yearData({ rev: 1, createdAt: OTHER_CREATED_AT })));
            await assertFails(setDoc(yearRef(db), without(yearData({ rev: 1 }), 'createdAt')));
            expect((await readYear(YEAR_ID)).rev).toBeUndefined();
        });

        it('denies migrating an unversioned year that has no stored createdAt', async () => {
            await seedYear(YEAR_ID, without(yearData(), 'createdAt'));
            const db = owner();
            await assertFails(setDoc(yearRef(db), yearData({ rev: 1 })));
            await assertFails(setDoc(yearRef(db), without(yearData({ rev: 1 }), 'createdAt')));
            await assertFails(setDoc(yearRef(db), { status: 'closed', rev: 1 }, { merge: true }));
        });

        it('denies a first versioned write of an unversioned year at any rev other than 1', async () => {
            await seedYear(YEAR_ID, yearData());
            const db = owner();
            await assertFails(setDoc(yearRef(db), yearData({ rev: 0 })));
            await assertFails(setDoc(yearRef(db), yearData({ rev: 2 })));
        });

        // ── old tabs (writes without rev) ──

        it('denies an unversioned write onto a versioned year (the old-tab case)', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 2 }));
            const db = owner();
            // Pre-feature save(): full setDoc without rev.
            await assertFails(setDoc(yearRef(db), yearData({ updatedAt: serverTimestamp() })));
            // Pre-feature setYearStatus(): merge of status and billingEvents (the stored rev is kept, so it does not advance).
            await assertFails(setDoc(yearRef(db), { status: 'closed', billingEvents: [] }, { merge: true }));
            await assertFails(updateDoc(yearRef(db), { status: 'closed' }));
            expect(await readYear(YEAR_ID)).toEqual(yearData({ rev: 2 }));
        });

        // Flipped at stage 2 (#616): an unversioned update onto an unversioned year is denied.
        it('allows an unversioned write onto an unversioned year only at stage 1', async () => {
            await seedYear(YEAR_ID, yearData());
            const db = owner();
            await stage1Only(setDoc(yearRef(db), yearData({ updatedAt: serverTimestamp() })));
            await stage1Only(setDoc(yearRef(db), { status: 'closed', billingEvents: [] }, { merge: true }));
        });

        // ── malformed rev ──

        it('denies a malformed rev ("1", 1.5, null) on create', async () => {
            const db = owner();
            for (const rev of MALFORMED_REVS) {
                await assertFails(setDoc(yearRef(db), yearData({ rev })));
            }
            expect(await readYear(YEAR_ID)).toBeUndefined();
        });

        it('denies a malformed rev on update of a versioned or an unversioned year', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 1 }));
            await seedYear(SOURCE_ID, sourceData());
            const db = owner();
            for (const rev of MALFORMED_REVS) {
                await assertFails(setDoc(yearRef(db), yearData({ rev })));
                await assertFails(setDoc(yearRef(db, SOURCE_ID), sourceData({ rev })));
            }
        });

        it('fails closed on a stored malformed rev, whether the request carries rev 1, the next integer, or no rev', async () => {
            for (const storedRev of MALFORMED_REVS) {
                await seedYear(YEAR_ID, yearData({ rev: storedRev }));
                const db = owner();
                await assertFails(setDoc(yearRef(db), yearData({ rev: 1 })));
                await assertFails(setDoc(yearRef(db), yearData({ rev: 2 })));
                await assertFails(setDoc(yearRef(db), yearData()));
                await assertFails(setDoc(yearRef(db), { status: 'closed' }, { merge: true }));
                expect((await readYear(YEAR_ID)).rev).toEqual(storedRev);
            }
        });

        // ── batches ──

        it('denies a legacy createYear writeBatch when the source is versioned; nothing is written', async () => {
            await seedYear(SOURCE_ID, sourceData({ rev: 2 }));
            await assertFails(legacyCreateYearBatch(owner()));
            expect(await readYear(YEAR_ID)).toBeUndefined();
            expect(await readYear(SOURCE_ID)).toEqual(sourceData({ rev: 2 }));
        });

        it('denies a legacy createYear writeBatch when the destination exists and is versioned', async () => {
            await seedYear(SOURCE_ID, sourceData());
            await seedYear(YEAR_ID, yearData({ rev: 1, bills: [{ id: 7 }] }));
            await assertFails(legacyCreateYearBatch(owner()));
            expect(await readYear(YEAR_ID)).toEqual(yearData({ rev: 1, bills: [{ id: 7 }] }));
            expect(await readYear(SOURCE_ID)).toEqual(sourceData());
        });

        // Flipped at stage 2 (#616): the legacy batch is refused as a whole (legacy-versus-reviewed).
        it('accepts a legacy createYear writeBatch onto an existing unversioned destination only at stage 1', async () => {
            await seedYear(SOURCE_ID, sourceData());
            await seedYear(YEAR_ID, yearData({ bills: [{ id: 7 }] }));
            await stage1Only(legacyCreateYearBatch(owner()));
        });

        // Flipped at stage 2 (#616): the legacy batch is refused as a whole.
        it('accepts a legacy createYear writeBatch onto an absent destination only at stage 1', async () => {
            await seedYear(SOURCE_ID, sourceData());
            await stage1Only(legacyCreateYearBatch(owner()));
        });

        it('denies a versioned batch holding one stale document entirely, and allows it with the right revs', async () => {
            await seedYear(SOURCE_ID, sourceData({ rev: 3 }));
            const db = owner();
            const stale = writeBatch(db);
            stale.set(yearRef(db, SOURCE_ID), sourceData({ rev: 3, status: 'closed' })); // expected rev 2, stored 3: stale
            stale.set(yearRef(db, YEAR_ID), yearData({ rev: 1, createdAt: serverTimestamp() }));
            await assertFails(stale.commit());
            expect(await readYear(YEAR_ID)).toBeUndefined();
            expect(await readYear(SOURCE_ID)).toEqual(sourceData({ rev: 3 }));

            const fresh = writeBatch(db);
            fresh.set(yearRef(db, SOURCE_ID), sourceData({ rev: 4, status: 'closed' }));
            fresh.set(yearRef(db, YEAR_ID), yearData({ rev: 1, createdAt: serverTimestamp() }));
            await assertSucceeds(fresh.commit());
        });

        // ── transactions ──

        it('leaves exactly one of two concurrent transactions committed', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 1 }));
            // Two sessions that both loaded rev 1 and write rev 2 without their own
            // stale check, so only the rules can stop the second.
            const attempt = (writeId) => {
                const db = env.authenticatedContext(ALICE).firestore();
                return runTransaction(db, async (tx) => {
                    await tx.get(yearRef(db));
                    tx.set(yearRef(db), yearData({ rev: 2, lastWriteId: writeId }));
                });
            };
            const results = await Promise.allSettled([attempt('a'), attempt('b')]);
            const committed = results.filter((r) => r.status === 'fulfilled');
            expect(committed).toHaveLength(1);
            const winner = results[0].status === 'fulfilled' ? 'a' : 'b';
            const loser = results.find((r) => r.status === 'rejected');
            expect(loser.reason.code).toBe('permission-denied');
            const stored = await readYear(YEAR_ID);
            expect(stored.rev).toBe(2);
            expect(stored.lastWriteId).toBe(winner);
        });

        it('checks both documents of a rollover-shaped transaction (get destination, get source, set both)', async () => {
            await seedYear(SOURCE_ID, sourceData({ rev: 3 }));
            const db = owner();
            const rollover = (sourceRev, destinationRev) => runTransaction(db, async (tx) => {
                await tx.get(yearRef(db, YEAR_ID));
                await tx.get(yearRef(db, SOURCE_ID));
                tx.set(yearRef(db, SOURCE_ID), sourceData({ rev: sourceRev, status: 'closed' }));
                tx.set(yearRef(db, YEAR_ID), yearData({ rev: destinationRev, createdAt: serverTimestamp() }));
            });
            await assertFails(rollover(3, 1));
            await assertFails(rollover(4, 2));
            expect(await readYear(YEAR_ID)).toBeUndefined();
            await assertSucceeds(rollover(4, 1));
        });

        // ── the reviewed rollover's sequences (#607; D-A #612) ──
        //
        // The reviewed createYear's transaction (BillingYearService._createReviewedYearNow):
        // get the destination, get the source, set the destination at rev 1 (a
        // create-shaped payload: server createdAt) and the source at the rev it read + 1
        // (keeping the stored createdAt). It versions both documents, so every later
        // stale or unversioned writer is refused by the rules from then on.
        const reviewedRollover = (db, sourceRev) => runTransaction(db, async (tx) => {
            await tx.get(yearRef(db, YEAR_ID));
            const source = await tx.get(yearRef(db, SOURCE_ID));
            tx.set(yearRef(db, YEAR_ID), yearData({ rev: 1, lastWriteId: 'w-review', createdAt: serverTimestamp(),
                billingEvents: [{ id: 'e1', eventType: 'YEAR_CREATED_FROM_REVIEW' }] }));
            tx.set(yearRef(db, SOURCE_ID), sourceData({ rev: sourceRev, lastWriteId: 'w-review', createdAt: source.data().createdAt,
                owedAdjustments: [{ id: 'oadj_tu_1', status: 'carried_forward' }], billingEvents: [{ id: 'e2', eventType: 'YEAR_ROLLED_OVER' }] }));
        });

        it('lets the reviewed rollover create the destination and advance a versioned or migrate an unversioned source', async () => {
            await seedYear(SOURCE_ID, sourceData({ rev: 3 }));
            await assertSucceeds(reviewedRollover(owner(), 4));
            expect((await readYear(SOURCE_ID)).rev).toBe(4);
            expect((await readYear(YEAR_ID)).rev).toBe(1);
            await env.clearFirestore();
            await seedYear(SOURCE_ID, sourceData());
            await assertSucceeds(reviewedRollover(owner(), 1));
            expect((await readYear(SOURCE_ID)).rev).toBe(1);
        });

        it('never lets the reviewed rollover overwrite an existing next year, versioned or not', async () => {
            await seedYear(SOURCE_ID, sourceData({ rev: 3 }));
            await seedYear(YEAR_ID, yearData({ rev: 1, bills: [{ id: 7 }] }));
            await assertFails(reviewedRollover(owner(), 4));
            await seedYear(YEAR_ID, yearData({ bills: [{ id: 7 }] }));
            await assertFails(reviewedRollover(owner(), 4));
            expect((await readYear(SOURCE_ID)).rev).toBe(3);
            expect(await readYear(YEAR_ID)).toEqual(yearData({ bills: [{ id: 7 }] }));
        });

        it('legacy-versus-reviewed: refuses a legacy createYear after the reviewed rollover, versioned or not', async () => {
            await seedYear(SOURCE_ID, sourceData({ rev: 3 }));
            await assertSucceeds(reviewedRollover(owner(), 4));
            const after = { next: await readYear(YEAR_ID), source: await readYear(SOURCE_ID) };
            // A pre-feature tab's writeBatch (no rev) and a versioned-build tab's stale
            // version-checked legacy rollover (the destination at rev 1, the source at its loaded rev + 1).
            await assertFails(legacyCreateYearBatch(owner()));
            const db = owner();
            const stale = writeBatch(db);
            stale.set(yearRef(db, YEAR_ID), yearData({ rev: 1, createdAt: serverTimestamp() }));
            stale.set(yearRef(db, SOURCE_ID), sourceData({ rev: 4 }));
            await assertFails(stale.commit());
            expect({ next: await readYear(YEAR_ID), source: await readYear(SOURCE_ID) }).toEqual(after);
        });

        it('stale-save-after-rollover: refuses a save() or setYearStatus() from pre-rollover state, versioned or not', async () => {
            await seedYear(SOURCE_ID, sourceData({ rev: 3 }));
            await assertSucceeds(reviewedRollover(owner(), 4));
            const after = await readYear(SOURCE_ID);
            const db = owner();
            await assertFails(setDoc(yearRef(db, SOURCE_ID), sourceData({ rev: 4, payments: [{ id: 'pay_stale' }] })));
            await assertFails(setDoc(yearRef(db, SOURCE_ID), sourceData({ payments: [{ id: 'pay_stale' }] })));
            await assertFails(setDoc(yearRef(db, SOURCE_ID), { status: 'closed', billingEvents: [] }, { merge: true }));
            expect(await readYear(SOURCE_ID)).toEqual(after);
        });

        // ── delete, other users, unchanged neighbours ──

        it('denies deleting a year document, versioned or not, to the owner and to everyone else', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 1 }));
            await seedYear(SOURCE_ID, sourceData());
            for (const yearId of [YEAR_ID, SOURCE_ID]) {
                await assertFails(deleteDoc(yearRef(owner(), yearId)));
                await assertFails(deleteDoc(yearRef(env.authenticatedContext(BOB).firestore(), yearId)));
                await assertFails(deleteDoc(yearRef(env.unauthenticatedContext().firestore(), yearId)));
                expect(await readYear(yearId)).toBeDefined();
            }
        });

        it('lets the owner read and denies other users and guests every read and write, as before', async () => {
            await seedYear(YEAR_ID, yearData({ rev: 1 }));
            await seedYear(SOURCE_ID, sourceData());
            await assertSucceeds(getDoc(yearRef(owner())));
            await assertSucceeds(getDocs(collection(owner(), `users/${ALICE}/billingYears`)));
            for (const db of [env.authenticatedContext(BOB).firestore(), env.unauthenticatedContext().firestore()]) {
                await assertFails(getDoc(yearRef(db)));
                await assertFails(setDoc(yearRef(db), yearData({ rev: 2 })));
                await assertFails(setDoc(yearRef(db, SOURCE_ID), sourceData()));
                await assertFails(setDoc(yearRef(db, SOURCE_ID), sourceData({ rev: 1 })));
                await assertFails(setDoc(yearRef(db, '2027'), yearData({ rev: 1 })));
                await assertFails(setDoc(yearRef(db, '2028'), yearData()));
            }
        });

        it('leaves the disputes subcollection owner-only read and write, including delete', async () => {
            const disputes = `${yearPath(ALICE, YEAR_ID)}/disputes`;
            await seedYear(YEAR_ID, yearData({ rev: 1 }));
            await env.withSecurityRulesDisabled(async (ctx) => {
                await setDoc(doc(ctx.firestore(), disputes, 'd1'), { memberId: 1, status: 'open' });
            });
            const db = owner();
            await assertSucceeds(getDocs(collection(db, disputes)));
            await assertSucceeds(addDoc(collection(db, disputes), { kind: 'charge_notice', memberId: 1, status: 'open' }));
            await assertSucceeds(updateDoc(doc(db, disputes, 'd1'), { status: 'in_review' }));
            await assertSucceeds(deleteDoc(doc(db, disputes, 'd1')));
            for (const other of [env.authenticatedContext(BOB).firestore(), env.unauthenticatedContext().firestore()]) {
                await assertFails(getDocs(collection(other, disputes)));
                await assertFails(addDoc(collection(other, disputes), { memberId: 1, status: 'open' }));
            }
        });

        it('leaves the users/{uid} document (the activeBillingYear pointer) unversioned and owner-only', async () => {
            const db = owner();
            await assertSucceeds(setDoc(doc(db, 'users', ALICE), { activeBillingYear: YEAR_ID }, { merge: true }));
            await assertSucceeds(setDoc(doc(db, 'users', ALICE), { activeBillingYear: SOURCE_ID }, { merge: true }));
            await assertFails(setDoc(doc(env.authenticatedContext(BOB).firestore(), 'users', ALICE), { activeBillingYear: YEAR_ID }));
        });
    });
}

describeYearDocumentRules(2, RULES_PATH);
