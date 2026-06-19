# Closed years are corrected forward, not reopened

Once a billing year is Closed it is read-only (`_guardReadOnly`,
`src/lib/BillingYearService.js`), and the new adjustment mutations (refund, usage
charge, service credit, off-cycle bill) are guarded the same way. The natural
question—"must I reopen a closed year to refund last year's credit or bill a
late charge?"—has a deliberate answer: **almost never.**

Because undisposed adjustments auto-carry at close (ADR 0006), by the time a year
is Closed every actionable balance—credits, deferred charges—has already
moved into the next year. So refunds, off-cycle bills, service credits, and
follow-ups all happen in the current/next open year, acting on the carried
balances. The closed year is left settled. (If no next year exists yet, the
carried balance is pending and materializes when the next year is created—still
forward, still no reopen.)

Reopening (Settings → Billing Controls → Reopen to Settling) is reserved for
**correcting the closed year's own ledger**—e.g., reversing a payment
mis-recorded in that year. That is editing settled history, so it is deliberately
friction-ful and rare.

A `not_received` on a refund issued before close is a non-blocking follow-up
(ADR 0003): resolve it forward (a fresh credit/refund in the open year) by
default, reopening only if the closed year's record must reflect the re-send.

## Consequence

- The new adjustment mutations stay `_guardReadOnly`-guarded for consistency with
  `recordPayment`/`reversePayment`; the guard rarely bites because the work is
  forward, in the open year.
