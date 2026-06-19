# Undisposed adjustments auto-carry at close (amends ADR 0003, ADR 0004)

ADR 0003 and ADR 0004 made an unresolved **Credit** *block* the year-close until
the administrator actively recorded a refund or a carry-forward. Extending the
model to the debit side (ADR 0005) exposed an asymmetry: a deferred **Usage
Charge** auto-carries, but a Credit blocked. We made them symmetric.

At close, **any *undisposed* adjustment—a Credit or a deferred Usage Charge—auto-carries into next year by default. Neither blocks.** Carry-forward is the
default; refund (for credits) and off-cycle billing (for charges) are the active
alternatives. The close-gate blocks only on **present-tense money**: a household
that is Outstanding (underpaid, now including any billed-unpaid charges). Nothing
*undisposed* holds the year open.

One exception preserves the member protection from ADR 0003: an active,
unresolved **`not_received`** is a live dispute, not an undisposed adjustment, so
it still re-blocks the gate rather than silently carrying.

## Amends

- **ADR 0003** and **ADR 0004**: the "unresolved credit blocks the close" rule is
  replaced by "undisposed adjustments auto-carry." Everything else in those ADRs
  stands—recording clears (not confirmation), confirmation is advisory, refund
  and carry-forward are the two credit exits, and there is never a write-off.
