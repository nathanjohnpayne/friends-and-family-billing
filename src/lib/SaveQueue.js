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
 *
 * Stop-on-stale (#614): `stop(key, outcome)` stops the queue accepting writes for
 * one key (a billing year id). Every later `enqueue` for that key — and every
 * write for it already waiting in the queue — rejects with the same outcome
 * without running, and subscribers get `save:blocked`. Other keys are unaffected.
 */
export class SaveQueue {
    constructor() {
        /** @type {Promise<void>} */
        this._chain = Promise.resolve();

        /** @type {Set<(event: { type: string, error?: Error }) => void>} */
        this._listeners = new Set();

        /** @type {boolean} */
        this._saving = false;

        /** @type {Map<string, Error>} keys whose writes are stopped, with the outcome */
        this._stopped = new Map();
    }

    /**
     * Stop accepting writes for a key; later writes for it reject with `outcome`.
     * @param {string} key
     * @param {Error} outcome
     */
    stop(key, outcome) {
        if (!this._stopped.has(String(key))) this._stopped.set(String(key), outcome);
    }

    /** Resolves once every write enqueued so far has settled (no events are emitted). */
    idle() {
        return this._chain.then(() => {}, () => {});
    }

    /** Accept writes for every key again (the signed-in account changed). */
    clearStops() {
        this._stopped.clear();
    }

    /** The outcome a key was stopped with, or null. */
    stoppedOutcome(key) {
        return this._stopped.get(String(key)) || null;
    }

    /** @private The first stopped key among these, as its outcome. */
    _blockedBy(keys) {
        for (const key of keys) {
            const outcome = this._stopped.get(String(key));
            if (outcome) return outcome;
        }
        return null;
    }

    /** Whether a write is currently in flight. */
    get saving() {
        return this._saving;
    }

    /**
     * Enqueue an async write operation.
     * @param {() => Promise<void>} writeFn
     * @param {{ keys?: Array<string> }} [options]  the billing years the write touches
     * @returns {Promise<void>} resolves when this specific write completes (also when
     *   it failed: the failure is reported to subscribers); rejects only when a key it
     *   touches is stopped, with that key's outcome
     */
    enqueue(writeFn, options = {}) {
        const keys = options.keys || [];
        const refused = this._blockedBy(keys);
        if (refused) {
            this._notify({ type: 'save:blocked', error: refused });
            return Promise.reject(refused);
        }
        let blocked = null;
        const run = this._chain.then(async () => {
            blocked = this._blockedBy(keys);
            if (blocked) {
                this._notify({ type: 'save:blocked', error: blocked });
                return;
            }
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
        this._chain = run;
        return run.then(() => { if (blocked) throw blocked; });
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
