// Labels, string transforms, and display constants — no DOM, no Firestore.

// Import status constants locally (needed by getBillingYearStatusLabel) and
// re-export so existing `import { … } from './formatting.js'` still works.
import { BILLING_YEAR_STATUSES, DISPUTE_STATUS_LABELS } from './constants.js';
export { BILLING_YEAR_STATUSES, DISPUTE_STATUS_LABELS };

export const PAYMENT_METHOD_LABELS = {
    cash: 'Cash',
    check: 'Check',
    venmo: 'Venmo',
    zelle: 'Zelle',
    paypal: 'PayPal',
    cashapp: 'Cash App',
    apple_cash: 'Apple Cash',
    bank_transfer: 'Bank Transfer',
    other: 'Other'
};

export const BILLING_EVENT_LABELS = {
    BILL_CREATED: 'Bill created',
    BILL_UPDATED: 'Bill updated',
    BILL_DELETED: 'Bill removed',
    MEMBER_ADDED_TO_BILL: 'Member added',
    MEMBER_REMOVED_FROM_BILL: 'Member removed',
    PAYMENT_RECORDED: 'Payment recorded',
    PAYMENT_REVERSED: 'Payment reversed',
    PAYMENT_UPDATED: 'Payment updated',
    YEAR_STATUS_CHANGED: 'Year status changed'
};

export const PAYMENT_METHOD_TYPES = {
    venmo: { label: 'Venmo', fields: ['handle', 'url', 'instructions'] },
    zelle: { label: 'Zelle', fields: ['email', 'phone', 'instructions'] },
    cashapp: { label: 'Cash App', fields: ['handle', 'url', 'instructions'] },
    paypal: { label: 'PayPal', fields: ['handle', 'url', 'instructions'] },
    apple_cash: { label: 'Apple Cash', fields: ['email', 'phone', 'instructions'] },
    check: { label: 'Check', fields: ['name', 'address', 'phone', 'instructions'] },
    other: { label: 'Other', fields: ['url', 'instructions'] }
};

export const PAYMENT_METHOD_ICONS = {
    zelle: '<svg viewBox="18 15 70 70" fill="currentColor" fill-rule="evenodd"><path d="M30.78 84.24C28.57 83.69 27.19 83.08 25.4 81.84C23.27 80.36 22.68 79.79 21.45 77.94C18.36 73.31 18.45 74.14 18.46 50.31C18.46 33.51 18.54 29.64 18.89 28.14C19.96 23.6 23.23 19.63 27.7 17.45L30.34 16.16L51.76 16.07C67.28 16 73.63 16.07 74.8 16.32C79.97 17.41 84.78 21.79 86.47 26.95C87.12 28.93 87.12 29.02 87.12 50.43C87.12 71.32 87.1 71.96 86.52 73.49C85.41 76.43 84.52 77.83 82.5 79.87C80.18 82.21 77.21 83.86 74.37 84.37C71.62 84.86 32.86 84.75 30.78 84.24ZM57.03 76.11C57.37 75.62 57.48 74.69 57.48 72.44V69.42H62.61C67.37 69.42 67.75 69.38 68.04 68.85C68.2 68.54 68.34 66.95 68.34 65.31C68.34 63.68 68.2 62.08 68.04 61.77C67.75 61.23 67.33 61.21 59.09 61.21C53.5 61.21 50.44 61.1 50.44 60.91C50.44 60.75 53.77 56.36 57.83 51.15C61.9 45.95 65.93 40.79 66.78 39.68L68.34 37.67V34.78C68.34 30.89 68.49 30.98 62.26 30.98H57.48V28.03C57.48 23.82 57.6 23.94 53.39 23.94C51.47 23.94 49.69 24.02 49.44 24.12C49.05 24.26 48.97 24.86 48.97 27.64V30.98H44.08C37.84 30.98 38.11 30.78 38.11 35.26C38.11 37.88 38.21 38.66 38.58 39.03C38.97 39.43 40.16 39.49 47.09 39.49C51.51 39.49 55.13 39.59 55.13 39.71C55.13 39.83 54.29 40.99 53.27 42.28C52.25 43.57 48.21 48.71 44.3 53.7L37.18 62.78L37.28 65.78C37.34 67.44 37.49 68.9 37.62 69.03C37.76 69.17 40.33 69.34 43.35 69.42L48.83 69.57L48.91 72.78C48.96 74.54 49.14 76.16 49.31 76.37C49.54 76.65 50.6 76.76 53.1 76.76C56.35 76.76 56.6 76.72 57.03 76.11Z"/></svg>',
    cashapp: '<svg viewBox="100 15 70 70" fill="currentColor" fill-rule="evenodd"><path d="M145.69 16.24C152.59 16.24 156.04 16.24 159.81 17.43C163.86 18.91 167.06 22.1 168.54 26.15C169.73 29.93 169.73 33.37 169.73 40.28V61.15C169.73 68.07 169.73 71.54 168.54 75.27C167.06 79.32 163.86 82.52 159.81 84C156.04 85.21 152.59 85.21 145.69 85.21H124.79C117.87 85.21 114.4 85.21 110.67 84.02C106.62 82.54 103.43 79.35 101.94 75.29C100.76 71.52 100.76 68.07 100.76 61.17V40.27C100.76 33.35 100.76 29.88 101.94 26.15C103.43 22.1 106.62 18.91 110.67 17.43C114.44 16.24 117.89 16.24 124.79 16.24H145.69Z"/><path d="M146.52 41.89C147.06 42.43 147.96 42.43 148.46 41.89L151.16 39.09C151.73 38.55 151.7 37.58 151.09 37C148.98 35.15 146.52 33.74 143.85 32.86L144.7 28.76C144.89 27.87 144.22 27.03 143.32 27.03H138.11C137.78 27.03 137.47 27.15 137.22 27.35C136.97 27.56 136.79 27.85 136.73 28.17L135.97 31.81C129.03 32.17 123.15 35.69 123.15 42.91C123.15 49.16 128.01 51.84 133.15 53.69C138.01 55.54 140.59 56.23 140.59 58.84C140.59 61.52 138.02 63.09 134.23 63.09C130.78 63.09 127.16 61.94 124.36 59.13C124.1 58.87 123.74 58.72 123.37 58.72C122.99 58.72 122.64 58.87 122.38 59.13L119.47 62.04C119.19 62.31 119.04 62.69 119.04 63.07C119.04 63.46 119.19 63.83 119.47 64.11C121.73 66.34 124.6 67.95 127.86 68.85L127.06 72.7C126.88 73.59 127.54 74.43 128.43 74.43L133.66 74.47C133.99 74.48 134.31 74.36 134.57 74.15C134.82 73.95 134.99 73.66 135.06 73.33L135.82 69.68C144.16 69.12 149.25 64.52 149.25 57.8C149.25 51.62 144.19 49.01 138.04 46.89C134.53 45.58 131.49 44.69 131.49 42.01C131.49 39.4 134.33 38.36 137.17 38.36C140.79 38.36 144.27 39.86 146.55 41.91L146.52 41.89Z" fill="var(--color-surface)"/></svg>',
    venmo: '<svg viewBox="20 96 71 71" fill="currentColor" fill-rule="evenodd"><path d="M26.59 166.38C23.66 165.66 21.52 163.45 20.85 160.45C20.7 159.81 20.69 157.03 20.69 131.76C20.69 106.49 20.7 103.71 20.85 103.07C21.27 101.16 22.28 99.58 23.8 98.45C24.74 97.75 25.34 97.48 26.64 97.15C27.36 96.97 28.22 96.96 55.47 96.96C80.55 96.96 83.64 96.97 84.28 97.11C84.67 97.2 85.08 97.31 85.19 97.36C85.3 97.4 85.61 97.54 85.88 97.66C86.49 97.92 87.75 98.8 88.18 99.25C88.35 99.44 88.69 99.89 88.95 100.26C89.35 100.86 89.5 101.14 89.9 102.06C89.94 102.17 90.05 102.56 90.14 102.93C90.28 103.53 90.3 106.4 90.3 131.76C90.3 157.13 90.28 160 90.14 160.6C90.05 160.96 89.94 161.35 89.9 161.46C89.5 162.38 89.35 162.67 88.95 163.26C88.03 164.61 86.99 165.43 85.29 166.12C84.3 166.52 85.74 166.51 55.74 166.53C29.15 166.55 27.24 166.54 26.59 166.38Z"/><path d="M59.59 151.17C61.13 149.19 63.84 145.32 65.57 142.62C66.53 141.12 66.96 140.44 67.03 140.29C67.07 140.21 67.15 140.05 67.22 139.94C68.37 138.05 68.7 137.46 69.6 135.73C69.87 135.21 70.15 134.67 70.22 134.54C70.49 134.05 71.85 131.09 71.85 131.01C71.85 130.97 71.92 130.81 71.99 130.64C72.26 130.04 72.9 128.34 73.09 127.75C73.19 127.42 73.3 127.06 73.34 126.95C73.61 126.21 74.06 124.33 74.33 122.84C74.75 120.54 74.65 117.14 74.12 115.15C73.74 113.76 72.78 111.58 72.49 111.47C72.41 111.44 72.02 111.48 71.63 111.57C70.96 111.72 69.15 112.09 68.58 112.19C68.44 112.22 68.04 112.3 67.69 112.37C67.33 112.45 66.78 112.56 66.45 112.62C66.12 112.69 65.56 112.8 65.21 112.88C64.85 112.95 64.3 113.06 63.97 113.13C63.64 113.19 63.11 113.3 62.78 113.37C62.06 113.53 60.09 113.91 60 113.91C59.9 113.91 59.98 114.23 60.32 115.2C61.24 117.83 61.41 121.03 60.78 124.03C60.6 124.9 60.4 125.71 60.26 126.14C59.87 127.36 59.33 128.97 59.26 129.13C59.22 129.24 58.97 129.83 58.72 130.45C57.99 132.24 56.69 134.97 55.87 136.42C55.71 136.72 55.43 137.21 55.27 137.51C55.1 137.81 54.87 138.21 54.75 138.4C54.64 138.6 54.46 138.92 54.35 139.12C54.13 139.54 53.93 139.6 53.86 139.27C53.8 139.04 53.57 137.13 53.4 135.63C53.35 135.17 53.29 134.68 53.26 134.56C53.23 134.43 53.16 133.92 53.11 133.42C53.06 132.92 52.95 131.97 52.86 131.32C52.77 130.66 52.66 129.79 52.62 129.38C52.4 127.52 52.32 126.8 52.23 126.16C52.17 125.78 52.06 124.86 51.97 124.13C51.88 123.39 51.77 122.5 51.72 122.14C51.61 121.38 51.44 120 51.33 118.97C51.28 118.56 51.17 117.67 51.08 116.99C50.99 116.31 50.88 115.41 50.84 115C50.74 114.08 50.52 112.52 50.47 112.34C50.45 112.27 50.37 112.23 50.3 112.26C50.23 112.29 49.64 112.36 48.99 112.42C48.34 112.48 47.38 112.57 46.87 112.63C44.88 112.83 43.71 112.94 42.7 113.02C42.13 113.07 40.95 113.19 40.07 113.27C39.2 113.36 38.1 113.47 37.63 113.5C37.15 113.54 36.74 113.6 36.7 113.63C36.64 113.7 36.72 114.33 37 116C37.09 116.51 37.2 117.18 37.25 117.48C37.29 117.78 37.47 118.83 37.64 119.81C37.81 120.79 37.99 121.87 38.04 122.19C38.09 122.52 38.2 123.19 38.29 123.68C38.37 124.17 38.48 124.84 38.53 125.17C38.58 125.49 38.66 125.99 38.72 126.26C38.77 126.53 38.86 127.04 38.92 127.4C39.22 129.31 39.35 130.07 39.43 130.52C39.48 130.79 39.59 131.46 39.68 132.01C39.77 132.55 39.9 133.34 39.97 133.74C40.04 134.15 40.15 134.8 40.21 135.18C40.27 135.56 40.37 136.14 40.43 136.47C40.49 136.8 40.58 137.31 40.62 137.61C40.74 138.44 40.91 139.49 41.01 140.04C41.11 140.55 41.34 141.9 41.53 143.07C41.58 143.42 41.67 143.93 41.73 144.21C41.78 144.48 41.86 144.97 41.91 145.3C41.96 145.62 42.07 146.32 42.16 146.83C42.25 147.35 42.34 147.91 42.37 148.07C42.39 148.24 42.48 148.77 42.56 149.26C42.84 150.92 42.89 151.24 42.95 151.62L43.01 151.99H50.98H58.95L59.59 151.17Z" fill="var(--color-surface)"/></svg>',
    paypal: '<svg viewBox="102 97 70 70" fill="currentColor" fill-rule="evenodd"><path d="M107.86 166.42C105.37 165.89 103.19 163.8 102.52 161.3L102.36 160.7V132.22V103.74L102.52 103.14C103.19 100.61 105.38 98.53 107.91 98.02C108.53 97.89 109.4 97.88 136.88 97.9L165.21 97.92L165.77 98.08C168.29 98.78 170.35 100.96 170.86 103.47C170.99 104.09 171 104.96 170.98 132.44L170.96 160.77L170.8 161.33C170.08 163.86 167.93 165.9 165.43 166.42C164.82 166.55 163.83 166.55 136.63 166.55C109.8 166.54 108.43 166.54 107.86 166.42ZM134.15 157.86C134.29 157.82 134.56 157.69 134.74 157.57C135.38 157.14 135.39 157.12 136.46 152.49C136.99 150.18 137.47 148.14 137.53 147.95C137.67 147.49 137.99 147.11 138.44 146.89C138.77 146.72 138.91 146.7 140.37 146.61C143.31 146.43 145.46 145.97 147.84 145.03C152.74 143.08 156.67 139.29 158.55 134.71C159.74 131.77 160.1 128.36 159.5 125.51C159.2 124.06 158.53 122.49 157.78 121.46L157.44 121L157.39 122.67C157.34 124.75 157.1 126.38 156.55 128.42C155.15 133.68 152.35 137.5 148.17 139.85C146.53 140.78 144.48 141.5 142.3 141.92C140.63 142.24 139.58 142.33 136.87 142.37C134.69 142.41 134.28 142.43 134.1 142.53C133.81 142.69 133.67 142.86 133.54 143.22C133.48 143.4 133.13 145.41 132.77 147.7C132.4 150 132.04 152.09 131.96 152.36C131.61 153.56 131.01 154.41 130.26 154.78C129.35 155.23 128.86 155.29 125.96 155.32L123.36 155.35L123.31 156.19C123.26 157.01 123.26 157.03 123.45 157.34C123.81 157.96 123.53 157.93 129.06 157.93C132.14 157.93 133.99 157.91 134.15 157.86ZM127.6 152.28C128.02 152.05 128.44 151.59 128.59 151.18C128.67 150.98 129.09 148.48 129.55 145.6C130.1 142.09 130.41 140.28 130.5 140.07C130.68 139.66 131 139.33 131.44 139.1L131.79 138.91L135.47 138.87C139.3 138.82 139.98 138.78 141.64 138.46C147.94 137.24 151.87 133.26 153.4 126.54C153.8 124.78 153.92 123.72 153.93 122.06C153.93 120.36 153.84 119.65 153.44 118.44C152.29 114.91 149.24 112.68 144.65 112.01C143.15 111.79 141.89 111.76 134.1 111.76C125.09 111.76 125.77 111.71 125.1 112.38C124.88 112.6 124.66 112.89 124.62 113.03C124.57 113.18 123.18 121.85 121.53 132.32C119.1 147.71 118.53 151.39 118.59 151.58C118.68 151.92 118.91 152.19 119.24 152.34C119.51 152.46 119.75 152.47 123.42 152.45C127.3 152.43 127.31 152.43 127.6 152.28ZM131.9 129.05C131.9 129.01 132.23 127.27 132.64 125.18C133.14 122.63 133.42 121.34 133.5 121.22C133.57 121.12 133.73 120.98 133.87 120.9C134.08 120.78 134.25 120.76 135.53 120.74C138.13 120.7 140 120.93 141.03 121.42C141.54 121.67 142.07 122.19 142.27 122.64C142.86 123.99 142.35 126.37 141.23 127.5C140.87 127.86 139.93 128.43 139.43 128.6C138.86 128.79 137.67 128.99 136.7 129.07C135.36 129.17 131.9 129.16 131.9 129.05Z"/></svg>',
    apple_cash: '<svg viewBox="0 0 100 100" fill="currentColor"><rect width="100" height="100" rx="18"/><path transform="translate(23.5,17.5) scale(0.065)" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" fill="var(--color-surface, #fff)"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3C1.9 3 1 3.9 1 5V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V5C23 3.9 22.1 3 21 3ZM21 19H3V5H21V19ZM4 15H8V17H4V15ZM4 11H10V13H4V11ZM20 17H10V15H20V17ZM14 7L15.41 8.41L11.83 12L15.41 15.59L14 17L9 12L14 7Z"/></svg>',
    other: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 7H3C1.9 7 1 7.9 1 9V19C1 20.1 1.9 21 3 21H21C22.1 21 23 20.1 23 19V9C23 7.9 22.1 7 21 7ZM21 19H3V13H21V19ZM21 11H3V9H21V11ZM1 5H23V3H1V5Z"/></svg>'
};

export const PAYMENT_METHOD_STRIP_ICONS = {
    apple_cash: '<svg viewBox="0 0 100 100" fill="currentColor"><rect width="100" height="100" rx="18"/><path transform="translate(22.32,16) scale(0.068)" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" fill="var(--color-surface, #fff)"/></svg>'
};

/**
 * @param {string} method
 * @returns {string}
 */
export function getPaymentMethodLabel(method) {
    if (!method) return 'Other';
    return PAYMENT_METHOD_LABELS[method] || method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' ');
}

/**
 * @param {string} status
 * @returns {string}
 */
export function getBillingYearStatusLabel(status) {
    return (BILLING_YEAR_STATUSES[status] || BILLING_YEAR_STATUSES.open).label;
}

/**
 * @param {{ billingFrequency?: string }} bill
 * @returns {string}
 */
export function getBillFrequencyLabel(bill) {
    return bill.billingFrequency === 'annual' ? ' / year' : ' / month';
}

/**
 * @param {number} amount
 * @returns {string}
 */
export function formatAnnualSummaryCurrency(amount) {
    return '$' + Number(amount || 0).toFixed(2);
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Escape user-controlled strings before interpolating into HTML
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Only allow data: image URIs (produced by the Canvas compression pipeline).
 * @param {string} src
 * @returns {string}
 */
export function sanitizeImageSrc(src) {
    if (!src) return '';
    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(src)) return src;
    return '';
}

/**
 * @param {string} name
 * @returns {string}
 */
export function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * Generate a Gravatar URL from an email address.
 * Uses MD5 hash of the lowercased, trimmed email.
 * Returns null if no email is provided.
 * @param {string|undefined} email
 * @param {number} [size=200]
 * @returns {string|null}
 */
export function getGravatarUrl(email, size) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    // Simple MD5 implementation for Gravatar (browser-compatible, no crypto import needed)
    const hash = md5(normalized);
    return 'https://www.gravatar.com/avatar/' + hash + '?d=404&s=' + (size || 200);
}

/* Minimal MD5 for Gravatar hashing — browser-compatible, no dependencies. */
/* Based on Joseph Myers' public-domain implementation. */
function md5(str) {
    function md5cycle(x, k) {
        let a = x[0], b = x[1], c = x[2], d = x[3];
        a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
        c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
        a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
        c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
        a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
        c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
        a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
        c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
        a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
        c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
        a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
        c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
        a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
        c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
        a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
        c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
        a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
        c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
        a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
        c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
        a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
        c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
        a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
        c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
        a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
        c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
        a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
        c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
        a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
        c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
        a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
        c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
        x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
    }
    function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
    const n = str.length;
    let state = [1732584193, -271733879, -1732584194, 271733878];
    let tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let i;
    for (i = 64; i <= n; i += 64) {
        const block = [];
        for (let j = i - 64; j < i; j += 4)
            block.push(str.charCodeAt(j) | (str.charCodeAt(j + 1) << 8) | (str.charCodeAt(j + 2) << 16) | (str.charCodeAt(j + 3) << 24));
        md5cycle(state, block);
    }
    for (let j = 0; j < 16; j++) tail[j] = 0;
    for (let j = i - 64; j < n; j++)
        tail[(j >> 2) & 15] |= str.charCodeAt(j) << ((j % 4) << 3);
    tail[(n >> 2) & 15] |= 0x80 << ((n % 4) << 3);
    if (n > 55) { md5cycle(state, tail); for (let j = 0; j < 16; j++) tail[j] = 0; }
    tail[14] = n * 8;
    md5cycle(state, tail);
    const hex = '0123456789abcdef';
    let s = '';
    for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++)
            s += hex.charAt((state[j] >> (k * 8 + 4)) & 0xf) + hex.charAt((state[j] >> (k * 8)) & 0xf);
    return s;
}

/**
 * @param {string} type
 * @returns {string}
 */
export function getPaymentMethodIcon(type) {
    return PAYMENT_METHOD_ICONS[type] || PAYMENT_METHOD_ICONS.other;
}

/**
 * @param {string} type
 * @returns {string}
 */
export function getPaymentMethodStripIcon(type) {
    return PAYMENT_METHOD_STRIP_ICONS[type] || getPaymentMethodIcon(type);
}

/**
 * @param {{ email?: string, phone?: string, handle?: string, url?: string }} method
 * @returns {string}
 */
export function getPaymentMethodDetail(method) {
    if (method.type === 'check') {
        const parts = [];
        if (method.name) parts.push(method.name);
        if (method.address) parts.push(method.address.split('\n')[0]);
        return parts.join(' · ') || 'No mailing info';
    }
    const parts = [];
    if (method.email) parts.push(method.email);
    if (method.phone) parts.push(method.phone);
    if (method.handle) parts.push(method.handle);
    if (method.url) parts.push(method.url);
    return parts.join(' · ');
}

/**
 * @param {string} status
 * @returns {string}
 */
export function disputeStatusClass(status) {
    return 'dispute-' + status.replace('_', '-');
}
