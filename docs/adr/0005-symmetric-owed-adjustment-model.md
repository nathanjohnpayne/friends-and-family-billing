# Off-cycle adjustments: the symmetric owed-modifier model

Members incur ad-hoc debits mid-year (e.g. roaming overages), and services get
canceled or cheaper mid-year. Billing each debit as it happens means a stream of
tiny Venmo asks and awkward heads-up texts; rewriting a bill's amount to reflect
a cancellation lies about what the bill was. Both are modeled instead as
**owed-adjustments**.

- **Usage Charge**—a `+owed`, per-member ad-hoc debit (the roaming overage).
- **Service Credit**—a `−owed`, bill-level reduction (a service canceled,
  discounted, or with an issue), split among the bill's members so the bill's
  history stays honest.

**Grain follows ADR 0001.** Adjustments are recorded per-member for transparency
(a linked member sees their own pending charges on their share page) but settle,
gate, and carry forward at the household grain. The household remains the
settlement unit.

**Settlement.** A billed Usage Charge raises the member's owed and is settled
through the existing `payments[]` ledger—incoming money, unlike a refund, which
leaves and stays out of the ledger (#314). A Service Credit lowers owed and, when
the member has already paid, produces an overpayment **Credit** that rides #314's
refund/carry pipeline. Neither needs a new disposition path, and the debit gate
is just the existing Outstanding check once billed charges land in owed.

**Data model: two arrays split by layer, not direction.**

- `owedAdjustments[]`—Usage Charges (`+`) and Service Credits (`−`): both
  signed modifiers of owed, grain- and reason-tagged.
- `creditAdjustments[]`—refund/carry, the disposition of a resulting balance
  (#314). Kept separate because a disposition is not an owed-modifier.

The carry-forward seam takes two feeds—still-deferred items from
`owedAdjustments[]` and carried credits from `creditAdjustments[]`—and nets
them to one household opening balance. Designed once; used by both directions.

**Communication.** Off-cycle billing emits a **Charge Notice** (outbound Request,
the debit mirror of a Refund Notice), fire-and-forget. The member pays it
(`payments[]`) or contests it via the existing **Review Request** path—no new
acknowledgment Cloud Function. Charge Notices are excluded from the "Open
Reviews" KPI, like Refund Notices.

Append-only integrity, single source of truth on the adjustment, and the
lossless-serialization discipline all carry over from #314.

## Considered options

- **Bill each charge as incurred**—rejected: this is the social problem the
  feature exists to remove.
- **Edit or remove the bill for a cancellation/reduction**—rejected: the flat
  annual/monthly bill model can't prorate, it rewrites bill history, and it loses
  the reason.
- **One unified `adjustments[]` for everything** (charges + credits +
  dispositions)—rejected: mixes owed-modifiers with balance-dispositions and
  muddies the gate math.
- **Fully per-member charges** (reopen ADR 0001)—rejected: keeps the household
  as the settlement unit.
