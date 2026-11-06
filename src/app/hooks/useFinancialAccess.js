import { useEffect, useRef } from 'react';

/**
 * Guard existing UI entry points, including continuations after an await. A
 * ticket expires on close/unmount, identity change or any observed hold. This
 * does not cancel a writer that was already invoked while available.
 */
export function useFinancialAccess(readAvailability, identity, open = true) {
    const available = readAvailability().available;
    const live = useRef({ identity, open, available, epoch: 0, readAvailability });
    if (live.current.identity !== identity || live.current.open !== open || live.current.available !== available) {
        live.current.epoch++;
    }
    Object.assign(live.current, { identity, open, available, readAvailability });
    useEffect(() => {
        const state = live.current;
        state.open = open;
        return () => { state.open = false; state.epoch++; };
    }, [open]);
    /** Acquire an action ticket only while the current dialog and household remain available. */
    function begin() {
        const state = live.current;
        return state.open && state.readAvailability().available ? state.epoch : null;
    }
    /** Recheck live availability and dialog identity after awaits, before further side effects. */
    function canContinue(ticket) {
        const state = live.current;
        return ticket !== null && state.open && state.epoch === ticket && state.readAvailability().available;
    }
    return { available, begin, canContinue };
}
