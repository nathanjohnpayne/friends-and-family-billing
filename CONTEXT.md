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
The member at the head of a household—the one other members link to.
Settlement and the close-gate count primary and independent members, never
individuals within a household.
_Avoid_: Parent member, head of household

**Linked Member**:
A member attached to a primary member's household via the primary's
`linkedMembers` list. Has their own per-member balance but settles as part of
the household.
_Avoid_: Child member, sub-member, dependent

**Household**:
A primary member plus their linked members, treated as one settlement unit.
Not a stored entity—it is computed from a primary member and their
`linkedMembers`. The unit that a credit is owned by and a refund clears.
_Avoid_: Group, family, linked group

**Credit**:
The net amount a household has overpaid—household paid minus household owed,
when positive. Owned at the household level; internal imbalance between members
is invisible to it (the primary member's concern, not the administrator's).
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
administrator to simply keep or write off an overpayment.
_Avoid_: Roll-over, waiver, write-off

**Net Contribution**:
What a household has actually paid toward its bills, net of money
returned—gross payments minus recorded refunds and carried-forward credits. A household's
settlement status (outstanding / settled / overpaid) is computed from this, not
from gross payments, so a refunded household reads "Settled" even though its
gross "Paid" still exceeds what it owed.
_Avoid_: Paid (when precision matters), gross paid

**Usage Charge**:
A per-member ad-hoc debit for something one member incurred mid-year (e.g. a
roaming overage), recorded against that member for transparency but settled,
gated, and carried forward at the household grain—the debit mirror of a Credit.
Recorded without immediately billing it; defaults to deferred.
_Avoid_: Fee, surcharge, overage (as the record)

**Service Credit**:
A reduction in what members owe because a service was canceled, reduced,
discounted, or had an issue—the −owed mirror of a Usage Charge, recorded against
a bill (split among its members) so the bill's history stays honest. Distinct
from a Credit: a Service Credit lowers owed and, when the member has already
paid, *produces* a Credit.
_Avoid_: Credit (the overpayment balance), discount, write-down

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
