---
spec_id: formatting-validation
---

# Formatting and Validation

Covers display formatting utilities (labels, currency, file sizes, HTML escaping, initials) and validation helpers (E.164 phone, dispute status normalization, ID generation, year status predicates, duplicate payment text detection).

## Test Coverage

- `tests/react/lib/formatting.test.js`
- `tests/react/lib/validation.test.js`

## Acceptance Criteria

### Billing Year Status Constants

- `BILLING_YEAR_STATUSES` defines four ordered statuses: open, settling, closed, archived with correct labels and order values.

### Dispute Status Labels

- `DISPUTE_STATUS_LABELS` maps statuses to human-readable labels (e.g., "in_review" to "In Review", "resolved" to "Resolved").

### Payment Method Labels

- `getPaymentMethodLabel` returns known labels (e.g., "venmo" to "Venmo", "apple_cash" to "Apple Cash"), capitalizes unknown methods, and returns "Other" for null/undefined.

### Billing Year Status Labels

- `getBillingYearStatusLabel` returns the correct label for known statuses and falls back to "Open" for unknown statuses.

### Bill Frequency Labels

- `getBillFrequencyLabel` returns " / year" for annual and " / month" for monthly or default.

### Currency Formatting

- `formatAnnualSummaryCurrency` formats numbers with a dollar sign and two decimal places; handles zero and falsy values as "$0.00".

### File Size Formatting

- `formatFileSize` formats bytes ("500 B"), kilobytes ("1.5 KB"), and megabytes ("2.0 MB").

### HTML Escaping

- `escapeHtml` escapes `<`, `>`, `"`, `&`, and `'` characters; returns empty string for falsy input.

### Image Source Sanitization

- `sanitizeImageSrc` allows valid `data:image/*` URIs, rejects non-data URIs (https, javascript), and returns empty string for falsy input.

### Initials Extraction

- `getInitials` returns the first letter of each word up to two characters; handles single-word names.

### Payment Method Detail Formatting

- `getPaymentMethodDetail` joins available fields (email, handle) with a middle dot separator; returns empty string when no fields are present.

### Dispute Status CSS Class

- `disputeStatusClass` converts a status string to a CSS class (e.g., "in_review" to "dispute-in-review").

### Payment Provider Pattern

- `PAYMENT_PROVIDER_PATTERN` matches known payment providers (Venmo, Zelle, Cash App) case-insensitively; does not match unrelated text.

### Duplicate Payment Text Detection

- `detectDuplicatePaymentText` returns false when the template has no `%payment_methods%` token, false when it has the token but no hardcoded provider, true when it has both the token and a hardcoded provider name, and false for null/empty input.

### E.164 Phone Validation

- `isValidE164` accepts valid E.164 numbers (e.g., "+14155551234") and rejects invalid formats (no plus sign, leading zero after plus, empty string).

### Dispute Status Normalization

- `normalizeDisputeStatus` maps legacy "pending" to "open" and "reviewed" to "in_review"; passes through known statuses unchanged; defaults to "open" for falsy input.

### ID Generation

- `generateEventId` returns a string matching `evt_<timestamp>_<random>`.
- `generateUniquePaymentId` returns a string matching `pay_<timestamp>_<random>`.
- `generateUniqueId` and `generateUniqueBillId` return numbers not present in the existing list.

### Year Status Predicates

- `isArchivedYear`, `isClosedYear`, `isSettlingYear` correctly identify their respective statuses and return false for null.
- `isYearReadOnly` returns true for closed and archived statuses, false for open and settling.
- `yearReadOnlyMessage` returns a message containing "archived" or "closed" for read-only years, and empty string for open years.
