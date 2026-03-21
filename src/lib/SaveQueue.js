/**
 * SaveQueue — serializes Firestore writes so concurrent mutations never
 * overwrite each other out of order.
 *
 * This is a generic middleware: callers push async write functions onto
 * the queue and they execute in FIFO order.
 *
 * Usage:
 *   const queue = new SaveQueue();
 *   queue.enqueue(async () => { await db.doc(path).set(payload); });
 *
 * Subscribers are notified after each write completes or fails.
 */
export class SaveQueue {
    constructor() {
        /** @type {Promise<void>} */
        this._chain = Promise.resolve();

        /** @type {Set<(event: { type: string, error?: Error }) => void>} */
        this._listeners = new Set();

        /** @type {boolean} */
        this._saving = false;
    }

    /** Whether a write is currently in flight. */
    get saving() {
        return this._saving;
    }

    /**
     * Enqueue an async write operation.
     * @param {() => Promise<void>} writeFn
     * @returns {Promise<void>} resolves when this specific write completes
     */
    enqueue(writeFn) {
        this._chain = this._chain.then(async () => {
            this._saving = true;
            this._notify({ type: 'save:start' });
            try {
                await writeFn();
                this._notify({ type: 'save:success' });
            } catch (error) {
                console.error('SaveQueue write failed:', error);
                this._notify({ type: 'save:error', error });
            } finally {
                this._saving = false;
            }
        });
        return this._chain;
    }

    /**
     * Subscribe to queue events.
     * @param {(event: { type: string, error?: Error }) => void} fn
     * @returns {() => void} unsubscribe function
     */
    subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    /** @private */
    _notify(event) {
        this._listeners.forEach(fn => {
            try { fn(event); } catch (e) { console.error('SaveQueue listener error:', e); }
        });
    }
}
