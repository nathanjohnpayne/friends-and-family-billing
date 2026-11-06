# Friends & Family Billing

The shared context for splitting recurring bills among family and friends,
invoicing them, and settling who has paid what across a billing year.

## Language

### People & money

**Administrator**:
The account owner (a Firebase-auth user) who manages bills, members, and
settlement for their own billing years.
_Avoid_: User, owner, admin

**Member**:
A person who owes a share of the bills and against whom payments are recorded.
The canonical money record is always per individual member.
_Avoid_: User, payer, family member

**Primary Member**:
The stored member record that carries a household's `linkedMembers`—the one
other members link to. Shown in the UI as the **Household contact**.
Settlement and the close-gate count primary and independent members, never
individuals within a household.
_Avoid_: Parent member, head of household

**Household contact**:
The UI name of the Primary Member: the household's point of contact, where its
optional name is stored and to whom household-level actions (a Refund) go. It is
a label, not a rank—any member of the household can be made the contact, and
doing so moves no money (ADR 0011).
_Avoid_: Head of household, owner, parent

**Linked Member**:
A member attached to a primary member's household via the primary's
`linkedMembers` list. Has their own per-member balance but settles as part of
the household.
_Avoid_: Child member, sub-member, dependent

**Household**:
A primary member plus their linked members, treated as one settlement unit.
Not a stored entity—it is computed from a primary member and their
`linkedMembers`. The unit that a credit is owned by and a refund clears. It may
carry an optional name, stored as `householdName` on the household contact's
record; without one it is called by its members' shared surname (ADR 0011).
_Avoid_: Group, family, linked group

**Credit**:
The net amount a household has overpaid—household paid minus household owed,
when positive. Owned at the household level; internal imbalance between members
is invisible to it (the household's concern, not the administrator's).
_Avoid_: Overpayment (as the amount), negative balance

**Refund**:
A recorded outgoing disbursement that returns a household's credit. The money
moves out-of-band (Venmo, Zelle, …); the app only records that it was sent.
*Recording* a refund—not the member confirming it—is what clears the credit
for settlement.
_Avoid_: Reversal, payout, reimbursement

**Carry-forward**:
Applying a household's credit to its next billing year instead of sending it
back—the household starts next year owing that much less. One of the two ways
(with Refund) to clear a credit. There is deliberately no path for the
administrator to simply keep or write off an overpayment. At rollover the
Year-End Review carries every undisposed Credit and deferred Usage Charge (True-ups
included) as itemized Carried items on one `carry_opening` seed per household, and
carries on an incoming credit the year's bills did not use. That credit is money the
household paid in an earlier year, so it is never forfeited; it leaves no new
disposition record in this year because it is not part of this year's Net
Contribution (it was disposed in the year it was paid).
_Avoid_: Roll-over, waiver, write-off

**Net Contribution**:
What a household has actually paid toward its bills, net of money
returned—gross payments minus recorded refunds and carried-forward credits. A household's
settlement status (outstanding / partial / settled / credit) is computed from this, not
from gross payments, so a refunded household reads "Settled" even though its
gross "Paid" still exceeds what it owed.
_Avoid_: Paid (when precision matters), gross paid

**Usage Charge**:
A deferred debit for something incurred mid-year that the advance invoice did
not cover—per-member (e.g. one member's roaming overage, `basis: 'member'`), or
split across a bill's members as a True-up. Recorded against the member for
transparency but settled, gated, and carried forward at the household grain—the
debit mirror of a Credit. Recorded without immediately billing it; defaults to
deferred, and auto-carries into the next year at rollover (ADR 0006).
_Avoid_: Fee, surcharge, overage (as the record)

**True-up**:
The bill-level Usage Charge: a deferred debit for the months a bill's members
were under-billed because its price went up partway through the year
(`basis: 'price_change'`) or the subscription started partway through the year
(`basis: 'late_start'`). Computed at month granularity, split among the bill's
members with the same remainder rule as a Service Credit, tagged with the
formula (`calc`) and a `trueUpId`, and created by the Year-End Review. Members
never see the word: their pages say what happened and when ("Northline Mobile
went from $180 to $198 a month in July. Your share of six months: $12.00.").
_Avoid_: Catch-up charge (in code), back-bill, retro charge, price adjustment

**Service Credit**:
A reduction in what members owe because a service was canceled, reduced,
discounted, or had an issue—the −owed mirror of a Usage Charge, recorded against
a bill (split among its members) so the bill's history stays honest. The
Year-End Review records one for a price decrease (`basis: 'price_change'`) or a
bill that ended mid-year (`basis: 'ended'`), with the same `calc` as a True-up.
Distinct from a Credit: a Service Credit lowers owed and, when the member has
already paid, *produces* a Credit.
_Avoid_: Credit (the overpayment balance), discount, write-down

**Year-End Review**:
The guided, four-step page through which the administrator creates the next
billing year: closing-year bill changes (price changed, ended, next year's
price), subscriptions that started mid-year, member charges, then a per-household
preview and Start. It is the only way a new year is created. Nothing is persisted
until Start, which appends the review's True-ups, Service Credits, and Usage
Charges to the closing year, carries, and seeds the new year in one atomic
commit (ADR 0009).
_Avoid_: Rollover wizard, new-year dialog, reconciliation (in UI copy)

**Carried item**:
One line of a household's opening balance in a new year—a True-up share, a
member's Usage Charge, or the household's net Credit—snapshotted on the
`carry_opening` seed (`items[]`) with its member, bill name, description, and
signed amount, so a member can read "Carried from 2026" line by line. The
household's Credit is one negative item; its detail beneath it lists the Service
Credits this review recorded for the household, any unused credit carried in from
the year before, and one remainder line for everything else (earlier Service
Credits and overpayment); the detail sums to the item and is never added again.
_Avoid_: Opening balance line, carry_opening (in UI copy), adjustment

### Requests

**Request**:
The umbrella for any record that rides the shared member-communication rails:
a member-facing share view, an email, and an optional confirmation round-trip.
Distinguished by its kind and direction (inbound from a member, or outbound
from the administrator).
_Avoid_: Dispute (as the umbrella term)

**Review Request**:
A member-initiated, inbound Request contesting a bill—a message, an optional
proposed correction, and evidence—which the administrator resolves or rejects
and the member may then accept or reject.
_Avoid_: Dispute

**Refund Notice**:
An administrator-initiated, outbound Request informing a member that a credit
is being returned, with the reason and payment details. The member confirms
receipt or reports non-receipt; it never reuses the Review Request resolution
vocabulary.
_Avoid_: Refund dispute, refund request

**Charge Notice**:
The outbound Request the administrator sends when off-cycle-billing a member's
deferred Usage Charges as a single invoice—the debit mirror of a Refund Notice.
It raises the member's owed (settled via the normal payments ledger); the member
pays it or contests it via a Review Request. Excluded from the Open Reviews KPI.
_Avoid_: Invoice (generic), charge request
