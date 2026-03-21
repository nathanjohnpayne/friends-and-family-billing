import { describe, it, expect, vi } from 'vitest';
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
});
