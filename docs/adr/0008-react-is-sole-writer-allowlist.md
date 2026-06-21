# React is the sole writer; the billing-year document is a full-overwrite allowlist

With the legacy /site/ app retired (#326), the React SPA is the sole reader and
writer of /users/{uid}/billingYears/{yearId}. That document is persisted by a
full-document `setDoc` *without* merge from an explicit field allowlist
(`buildSavePayload`), so every persisted field must be threaded through that
function — including fields written by the status-transition merge path (e.g.
`closedAt`), which are otherwise erased by the next full save. We keep this
explicit allowlist + migrate-forward-on-load model rather than opaque
unknown-field preservation or `setDoc(merge: true)`: with a single writer the
allowlist *is* the schema, and explicit fields keep the document shape reviewable.

Consequence: adding a persisted field is a two-touch change (write it AND add it
to `buildSavePayload`). The `closedAt` drop fixed in #326 is the cautionary example.
