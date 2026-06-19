# Credits flow back to the member: refund or carry-forward, never write-off

> **Amended by ADR 0006:** an undisposed credit now auto-carries at close instead of blocking; carry-forward becomes the default, refund the active alternative.

A household credit has exactly two exits, and both return the value to the
member:

- **Refund**—send it back out-of-band now.
- **Carry-forward**—apply it to the household's next billing year.

We deliberately removed any "waiver" / "write-off" path where the administrator
keeps the overpaid cash. In a friends-and-family tool the administrator must
never silently pocket an overpayment; every credit is returned—now, or against
next year's invoice. A member who says "just keep it" gets next-year credit
anyway; there is no machinery for the administrator to accept an overpayment as
a gift. A future reader will not find a "forgive credit" action—its absence is
intentional.

Carry-forward is recorded as a **pending household credit, applied lazily**:
choosing it clears the close-gate immediately (consistent with ADR 0003—the
disposition is *recorded*, not contingent on a future year existing), and
`buildNewYearData` seeds the opening credit whenever the household's next year is
created. If no next year is ever created, the pending credit is preserved in the
record (recoverable), never destroyed.

**Refund is the universal fallback**—always available regardless of whether a
next year will exist, so a credit is never trapped.

## Considered options

- **Waiver (administrator keeps it) + refund**—rejected: lets the administrator
  pocket overpayments; wrong for a trust-based tool.
- **Carry-forward requiring the next year to already exist (eager)**—rejected:
  would block closing this year until a next year is created.
- **Refund + lazily-applied carry-forward, no write-off**—chosen.
