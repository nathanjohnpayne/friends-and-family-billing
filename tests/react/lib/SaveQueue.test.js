import { describe, it, expect } from 'vitest';
import { SaveQueue } from '@/lib/SaveQueue.js';

describe('SaveQueue', () => {
    it('executes writes in FIFO order', async () => {
        const queue = new SaveQueue();
        const order = [];

        queue.enqueue(async () => {
            await new Promise(r => setTimeout(r, 20));
            order.push('first');
        });
        await queue.enqueue(async () => {
            order.push('second');
        });

        expect(order).toEqual(['first', 'second']);
    });

    it('notifies subscribers on save:start and save:success', async () => {
        const queue = new SaveQueue();
        const events = [];
        queue.subscribe(e => events.push(e.type));

        await queue.enqueue(async () => {});

        expect(events).toEqual(['save:start', 'save:success']);
    });

    it('notifies save:error when a write fails', async () => {
        const queue = new SaveQueue();
        const events = [];
        queue.subscribe(e => events.push(e.type));

        await queue.enqueue(async () => { throw new Error('fail'); });

        expect(events).toEqual(['save:start', 'save:error']);
    });

    it('continues processing after a failed write', async () => {
        const queue = new SaveQueue();
        const results = [];

        queue.enqueue(async () => { throw new Error('fail'); });
        await queue.enqueue(async () => { results.push('ok'); });

        expect(results).toEqual(['ok']);
    });

    it('reports saving state correctly', async () => {
        const queue = new SaveQueue();
        expect(queue.saving).toBe(false);

        let savingDuringWrite;
        await queue.enqueue(async () => {
            savingDuringWrite = queue.saving;
        });

        expect(savingDuringWrite).toBe(true);
        expect(queue.saving).toBe(false);
    });

    it('unsubscribe stops notifications', async () => {
        const queue = new SaveQueue();
        const events = [];
        const unsub = queue.subscribe(e => events.push(e.type));
        unsub();

        await queue.enqueue(async () => {});

        expect(events).toEqual([]);
    });

    // ── Stop-on-stale (#614 / #669) ──

    it('rejects every later enqueue for a stopped key with the same outcome, without running it', async () => {
        const queue = new SaveQueue();
        const outcome = Object.assign(new Error('stale'), { code: 'STALE_DOCUMENT' });
        const events = [];
        queue.subscribe(e => events.push(e.type));
        queue.stop('2026', outcome);
        let ran = false;
        await expect(queue.enqueue(async () => { ran = true; }, { keys: ['2026'] })).rejects.toBe(outcome);
        await expect(queue.enqueue(async () => { ran = true; }, { keys: ['2027', '2026'] })).rejects.toBe(outcome);
        expect(ran).toBe(false);
        expect(events).toEqual(['save:blocked', 'save:blocked']);
        expect(queue.stoppedOutcome('2026')).toBe(outcome);
    });

    it('skips writes for the key already waiting behind the write that stopped it', async () => {
        const queue = new SaveQueue();
        const outcome = new Error('stale');
        const order = [];
        const first = queue.enqueue(async () => { order.push('stale write'); queue.stop('2026', outcome); throw outcome; }, { keys: ['2026'] });
        const waiting = queue.enqueue(async () => { order.push('must not run'); }, { keys: ['2026'] });
        const otherYear = queue.enqueue(async () => { order.push('other year'); }, { keys: ['2025'] });
        const errSpy = console.error;
        console.error = () => {};
        try {
            await first;
            await expect(waiting).rejects.toBe(outcome);
            await otherYear;
        } finally {
            console.error = errSpy;
        }
        expect(order).toEqual(['stale write', 'other year']);
    });

    it('keeps the first outcome a key was stopped with', () => {
        const queue = new SaveQueue();
        const first = new Error('first');
        queue.stop('2026', first);
        queue.stop('2026', new Error('second'));
        expect(queue.stoppedOutcome('2026')).toBe(first);
        expect(queue.stoppedOutcome('2025')).toBeNull();
    });

    it('idle() resolves once every write enqueued so far has settled, without events', async () => {
        const queue = new SaveQueue();
        const events = [];
        queue.subscribe(e => events.push(e.type));
        let release;
        queue.enqueue(() => new Promise(resolve => { release = resolve; }));
        let idle = false;
        const waiting = queue.idle().then(() => { idle = true; });
        await Promise.resolve();
        expect(idle).toBe(false);
        release();
        await waiting;
        expect(idle).toBe(true);
        expect(events).toEqual(['save:start', 'save:success']);
    });
});
