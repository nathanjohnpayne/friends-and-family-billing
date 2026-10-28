/**
 * StatusBadge — pill naming a household's or member's settlement status.
 *
 * Every variant renders a glyph and a text label together (RD-03), so a
 * status is never carried by colour alone: the glyph is decorative
 * (`aria-hidden`) and the label carries the meaning. The glyphs are the
 * wireframe's status set (plans/ffb-wireframes.html, `st-*` in LUCIDE):
 * check-circle, half-filled circle, exclamation circle, question circle and
 * arrow-left circle, drawn in the same stroke grammar as the lucide icons.
 *
 * Display vocabulary follows CONTEXT.md and RD-09: a household whose Net
 * Contribution exceeds what it owes holds a Credit, so that variant is named
 * `credit` (formerly "Overpaid"). Only the display variant is renamed — the
 * billing math in src/lib/calculations.js and the persisted Firestore fields
 * are untouched. The `review` variant marks a household with an open Review
 * Request; the Settlement Board shows it beside the settlement badge (RD-03).
 *
 * `StatusGlyph` is the glyph alone, exported so the board's filter chips carry
 * the same status icon as the badge without duplicating the path data.
 */

const GLYPHS = {
    settled: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.5 4.5-5" />
        </>
    ),
    partial: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
        </>
    ),
    outstanding: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5" />
            <path d="M12 16h.01" />
        </>
    ),
    review: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.3 9.3a2.8 2.8 0 0 1 5.4.9c0 1.8-2.7 2.4-2.7 3.6" />
            <path d="M12 17h.01" />
        </>
    ),
    credit: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M15.5 12h-7" />
            <path d="m11.5 9-3 3 3 3" />
        </>
    )
};

const STATUS_CONFIG = {
    outstanding: { label: 'Outstanding',    className: 'status-badge--outstanding' },
    partial:     { label: 'Partial',        className: 'status-badge--partial' },
    settled:     { label: 'Settled',        className: 'status-badge--settled' },
    review:      { label: 'Review request', className: 'status-badge--review' },
    credit:      { label: 'Credit',         className: 'status-badge--credit' }
};

/** Every status the badge can render, in the order the board sorts them. */
export const STATUS_KEYS = Object.freeze(Object.keys(STATUS_CONFIG));

/**
 * Compute payment status from total owed and amount paid.
 * @param {number} total
 * @param {number} paid
 * @returns {'outstanding'|'partial'|'settled'|'credit'|null}
 */
export function getPaymentStatus(total, paid) {
    if (total <= 0) return null;
    if (paid <= 0) return 'outstanding';
    if (paid >= total) return paid > total ? 'credit' : 'settled';
    return 'partial';
}

/**
 * The decorative status glyph on its own: aria-hidden, drawn in currentColor so
 * it takes the colour of whatever carries it (a badge, a filter chip).
 * @param {{ status: string, className?: string }} props
 */
export function StatusGlyph({ status, className }) {
    const glyph = GLYPHS[status];
    if (!glyph) return null;
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
        >
            {glyph}
        </svg>
    );
}

export default function StatusBadge({ status }) {
    const config = STATUS_CONFIG[status];
    if (!config) return null;
    return (
        <span className={'status-badge ' + config.className} data-status={status}>
            <StatusGlyph status={status} className="status-badge-glyph" />
            {config.label}
        </span>
    );
}
