/**
 * StatusBadge — small pill displaying payment status.
 * Port of getPaymentStatusBadge() from main.js:1788.
 */

const STATUS_CONFIG = {
    outstanding: { label: 'Outstanding', className: 'status-badge--outstanding' },
    partial:     { label: 'Partial',     className: 'status-badge--partial' },
    settled:     { label: 'Settled',     className: 'status-badge--settled' },
    overpaid:    { label: 'Overpaid',    className: 'status-badge--overpaid' }
};

/**
 * Compute payment status from total owed and amount paid.
 * @param {number} total
 * @param {number} paid
 * @returns {'outstanding'|'partial'|'settled'|'overpaid'|null}
 */
export function getPaymentStatus(total, paid) {
    if (total <= 0) return null;
    if (paid <= 0) return 'outstanding';
    if (paid >= total) return paid > total ? 'overpaid' : 'settled';
    return 'partial';
}

export default function StatusBadge({ status }) {
    const config = STATUS_CONFIG[status];
    if (!config) return null;
    return (
        <span className={'status-badge ' + config.className}>
            {config.label}
        </span>
    );
}
