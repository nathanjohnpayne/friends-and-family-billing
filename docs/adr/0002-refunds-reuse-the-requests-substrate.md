# Refunds reuse the Requests substrate as a distinct kind

The member-communication machinery—a member-facing share view, an email, and
a confirmation round-trip—currently serves member-initiated disputes. Rather
than build parallel plumbing, an administrator-initiated **Refund Notice**
reuses it as a second *kind* of **Request**, alongside the renamed **Review
Request** (formerly "dispute").

The two are distinct domain concepts—inbound/adversarial vs outbound/
cooperative—so they do **not** share confirmation vocabulary. Refund Notices
use `confirmed_by_member` / `not_received`; they never reuse the Review
Request's `approved_by_user` / `rejected_by_user`.

This is why a future reader will find refund records living in the `disputes`
subcollection: it is the shared Request substrate, not a claim that a refund is
a dispute.

## Considered options

- **A separate subcollection + parallel Cloud Functions**—rejected:
  duplicates the share-token, email, and confirmation plumbing.
- **Reuse the Review Request resolution states verbatim**—rejected: overloads
  `approved`/`rejected_by_user` with an unrelated "received / not received"
  meaning.
- **Shared substrate, distinct kind, distinct confirmation vocabulary**—chosen.

## Scope note

Renaming the existing machinery (the `disputes` subcollection, `useDisputes`,
`DisputeDetailDialog`, the `/manage/reviews` route, and the `submitDispute*`
Cloud Functions) to match this language is **deliberately deferred** to a
separate, behavior-free PR. Refunds ship as a `refund_notice` *kind* under the
existing `disputes` collection name; new code uses the glossary terms while the
legacy `dispute*` names stay put. Do not "fix" the mismatch as a drive-by—the
deferral is intentional, to keep this feature's (already Phase-4-sized) PR
reviewable and to avoid a live subcollection migration.
