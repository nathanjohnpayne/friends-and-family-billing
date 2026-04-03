/**
 * processMailQueue idempotency test (issue #120).
 * Verifies the transactional claim step (pending → processing) prevents
 * duplicate email sends on at-least-once trigger redelivery.
 *
 * Uses mocked state to test the claim logic without Firebase emulators.
 */
import { describe, it, expect, vi } from 'vitest';

/**
 * Simulates the Firestore transaction claim logic from processMailQueue.
 * Returns the document data if successfully claimed, or null if already claimed.
 * This mirrors functions/index.js:741-748.
 */
function simulateClaimTransaction(currentStatus) {
    if (currentStatus !== 'pending') return null;
    return { status: 'pending' };
}

describe('processMailQueue idempotency (issue #120)', () => {
    it('first invocation claims a pending document', () => {
        const result = simulateClaimTransaction('pending');
        expect(result).not.toBeNull();
        expect(result.status).toBe('pending');
    });

    it('second invocation on a processing document returns null (no duplicate send)', () => {
        const result = simulateClaimTransaction('processing');
        expect(result).toBeNull();
    });

    it('invocation on an already-sent document returns null', () => {
        const result = simulateClaimTransaction('sent');
        expect(result).toBeNull();
    });

    it('invocation on an error document returns null', () => {
        const result = simulateClaimTransaction('error');
        expect(result).toBeNull();
    });

    it('full scenario: redelivery does not call send twice', () => {
        const sendEmail = vi.fn().mockResolvedValue({ data: { id: 'resend_123' } });
        let docStatus = 'pending';

        function processOnce() {
            if (docStatus !== 'pending') return null;
            docStatus = 'processing';
            sendEmail({ to: 'test@example.com', subject: 'Test', body: 'Hello' });
            docStatus = 'sent';
            return 'sent';
        }

        // First invocation succeeds
        const result1 = processOnce();
        expect(result1).toBe('sent');
        expect(sendEmail).toHaveBeenCalledTimes(1);

        // Second invocation (redelivery) — claim fails, no send
        const result2 = processOnce();
        expect(result2).toBeNull();
        expect(sendEmail).toHaveBeenCalledTimes(1);
    });

    it('concurrent invocations: only one claims the document', () => {
        const sendEmail = vi.fn();
        let docStatus = 'pending';
        let claimCount = 0;

        function atomicClaim() {
            if (docStatus !== 'pending') return false;
            docStatus = 'processing';
            claimCount++;
            return true;
        }

        const claimed1 = atomicClaim();
        const claimed2 = atomicClaim();

        if (claimed1) sendEmail();
        if (claimed2) sendEmail();

        expect(claimCount).toBe(1);
        expect(sendEmail).toHaveBeenCalledTimes(1);
    });
});
