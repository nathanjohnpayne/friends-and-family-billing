// Status and lifecycle constants — used by both business logic and display.

export const BILLING_YEAR_STATUSES = {
    open:     { label: 'Open',     order: 0, color: 'primary' },
    settling: { label: 'Settling', order: 1, color: 'warning' },
    closed:   { label: 'Closed',   order: 2, color: 'success' },
    archived: { label: 'Archived', order: 3, color: 'muted' }
};

export const DISPUTE_STATUS_LABELS = {
    open: 'Open',
    in_review: 'In Review',
    resolved: 'Resolved',
    rejected: 'Rejected'
};
