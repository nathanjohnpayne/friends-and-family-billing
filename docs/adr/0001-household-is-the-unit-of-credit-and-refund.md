# Credit and refunds operate at the household level

Money is recorded per individual member, and each member carries their own
"Overpaid" badge in the settlement board—so per-member refunds look like the
obvious model. We rejected that.

A **Credit** is the *net household position* (household paid − household owed),
one **Refund** is issued per household, and the close-gate checks households.
This stays consistent with the existing settlement gate, which already counts
households not individuals (`calculateSettlementMetrics`, `src/lib/calculations.js`),
and with the reality that the administrator makes one payout to one human.

Internal imbalance between members in a household—one member under-paid while
another over-paid—is deliberately invisible to credit, refund, and the gate.
It is the primary member's concern, not the administrator's.

## Considered options

- **Per-member credit and refund**—rejected: inconsistent with the
  household-based gate, and implies multiple payouts where one happens.
- **Household net position**—chosen.
