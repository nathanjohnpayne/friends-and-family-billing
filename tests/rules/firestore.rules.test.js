// Firestore security-rules suite for firestore.rules (run: npm run test:rules).
//
// Every hardened rule gets a deny case for the write/read it now forbids and an
// allow case for the legitimate client flow that must keep working (the client
// call sites are named next to each allow case).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
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
    serverTimestamp,
    setDoc,
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
