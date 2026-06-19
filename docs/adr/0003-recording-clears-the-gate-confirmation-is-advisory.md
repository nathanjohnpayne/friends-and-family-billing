# Recording a refund clears the close-gate; confirmation is a non-blocking trust signal

> **Amended by ADR 0006:** an undisposed credit now auto-carries at close instead of blocking; everything else here stands.

#314 decision 4 originally held that a Refund Notice had to be *confirmed by the
member* before it cleared the close-gate. We reversed this.

Closing a billing year asserts "I have **sent** everyone their money," not "I
have **been confirmed** to have paid everyone back." Since the app only ever
records out-of-band transfers (Venmo, Zelle) and never moves money itself, the
administrator's recorded refund is the honest settlement signal—and this
matches the literal requirement in #314 ("until an outgoing payment has been
**recorded**").

Therefore **recording a Refund (or a Waiver) clears a household's credit and the
gate, optimistically.** Member confirmation (`confirmed_by_member`) is a
positive trust signal that changes nothing about the gate.

One exception preserves member protection: an **active, unresolved
`not_received`** report re-opens that household's credit and re-blocks the gate
*while the year is still open*. The administrator resolves it by re-sending (a
new recorded refund), cancelling-and-waiving, or dismissing it as false with a
logged reason (which keeps the member's objection in the audit trail). Silence
never blocks—only active denial does—so there is no deadlock. A
`not_received` arriving after the year has closed is a non-blocking follow-up; it
does not auto-reopen a read-only year.

## Considered options

- **"Paid everyone back" (confirmation gates)**—rejected: a member can hold the
  year open indefinitely by never responding, forcing a manual-override escape
  hatch and a silence-vs-denial distinction.
- **"Sent everyone their money" (recording gates)**—chosen, with the active-
  denial re-block as the one concession to member protection.

## Supersedes

- #314 decision 4 ("member confirmation holds the gate"). The issue text is now
  stale and should be reconciled.
