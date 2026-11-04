# The Year-End Review creates the next year; True-ups are the bill-level Usage Charge; the carry is itemized (amends ADR 0005)

A billing year is billed in advance, so anything that changes a subscription's price partway through the year, starts partway through the year, or ends partway through the year leaves members under- or over-billed for the remaining months. Before #322 nothing modeled that gap: editing a bill's amount rewrote what was billed (rejected by ADR 0005), charged twelve months at the new price, and raised present-tense owed so every household on the bill went Outstanding. `addBill` in the closing year did the same for a subscription that started mid-year. `buildNewYearData` copied the closing year's prices verbatim into the new year, and `carry_opening` seeds carried one netted number per household that `invoice.js`, `share.js`, and the Cloud Function folded into a total with no line items.

This record settles four things.

## 1. A True-up is the bill-level variant of a Usage Charge

A **True-up** is a deferred, bill-level debit for the months a bill's members were under-billed: a price increase (`basis: 'price_change'`) or a subscription that started mid-year (`basis: 'late_start'`). It is stored as `kind: 'usage_charge'`, `status: 'deferred'`, split among the bill's members with the same cents-and-remainder helper `recordServiceCredit` uses (extracted into one shared function), and each per-member record carries `billId`, `billName`, `basis`, a `calc` object (`fromMonthly`, `toMonthly`, `firstMonth`, `months`, `computed`, `overridden`), and a `trueUpId` shared by the records of one True-up. A Usage Charge record without `basis` is a `'member'` charge.

This completes ADR 0005's grid: Service Credit already has a bill-level default and a per-member variant; Usage Charge now has the same two shapes, and both share the split. The payoff is that every helper keyed on `usage_charge` + `deferred` already does the right thing: ignored by owed (`getHouseholdFinancials`), carried by `buildCarryForward`, transitioned by `applyCarryForwardToPriorYear`, billable off-cycle by `billDeferredCharges` and `selectBillableCharges`. `src/lib/calculations.js` has no diff. A new `kind` would have forced edits to half a dozen high-risk helpers, where one miss silently drops or double-counts money.

A price decrease or a bill that ended mid-year is the mirror: a **Service Credit** with the same `calc` and `basis: 'price_change'` or `'ended'`. Ended bills are left out of the new year.

## 2. The Year-End Review is the way a new billing year is created

"Start new year" was a label prompt with no review step. It becomes a four-step page (`/year-end-review`): bills (price changed, ended, or unchanged, plus every bill's next-year price), new subscriptions, member charges, then a per-household preview and **Start &lt;year&gt;**. The page is the only entry to `createYear` from the UI. Settings → Billing year opens it; the Dashboard offers it when no next year exists and the year is Closed or the calendar has reached November 1 of the year's label.

Nothing is persisted until Start. Draft state is component state mirrored to `localStorage` (keyed by user and source year, every access in `try/catch`), so ADR 0008's save allowlist is untouched and the billing-year document is never written mid-review. The draft is versioned and bound to the source year and a fingerprint of the reviewed source state; restored storage is untrusted input that is validated, resolved against current members and bills, and recomputed before it is shown.

**The closing year's bills are never edited.** The 2026 bill list stays what was billed in advance; True-up and Service Credit records carry the explanation; the new year's bill history records the price set at rollover.

## 3. One atomic rollover, computed over the updated prior-year state

`createYear(yearId, { reopenedAdjustmentIds, reconciliation })` appends the review's True-ups, Service Credits, and new Usage Charges to the prior year, computes the carry over that updated prior-year state, seeds the new year with the overridden prices, the new bills, and the itemized carry, and marks the prior year, in one commit inside the `SaveQueue`. In the rollover's in-memory calculation the new True-ups are deferred; because creation and carrying commit together, their first persisted state is `carried_forward`. Existing deferred charges shown in the review are reused, not appended again.

An omitted `reconciliation` is the legacy call and behaves exactly as today (one `writeBatch`, same documents, same tests). An explicit, possibly empty, `reconciliation` is the review path: it always writes the source year (a `YEAR_ROLLED_OVER` event with the reconciliation id) and itemizes whatever already carries.

**The review path commits through a Firestore `runTransaction`** (decided 2026-11-04). A `writeBatch` cannot express "the next year must not exist" or "the source must be what I reviewed" in the web SDK, so on its own it is last-writer-wins when two sessions create the same year and blind to source changes after the preview. The transaction reads the source and destination documents before writing, recomputes the source fingerprint from its own reads on every attempt and compares it with the fixed fingerprint the administrator reviewed, stops with a stale-source outcome when they differ (a new fingerprint is never accepted silently), stops and reconciles when the destination exists (never overwrites it), and writes the same two documents through the same `buildSavePayload` allowlist. The transaction callback has no external side effects: no state mutation, no notifications, no network calls other than its own reads and writes, because the SDK may run it more than once. The legacy no-reconciliation path keeps its `writeBatch` byte for byte. The Firestore rules already permit this: `users/{userId}/billingYears/{yearId}` is `allow read, write` on the owner condition alone, with no field or diff constraints, so the transaction's reads (including the absent destination) and writes need no rules change.

Record ids are deterministic (`oadj_tu_<sourceYear>_<trueUpId>_<memberId>`, `oadj_sc_<sourceYear>_<basis>_<billId>_<memberId>`, `oadj_uc_<sourceYear>_<rowId>`, `cadj_carry_<nextYear>_<primaryMemberId>`, `coadj_<sourceYear>_<primaryMemberId>`), stable through draft restoration and retries. Completion is evidenced on both documents: the new year's `YEAR_CREATED_FROM_REVIEW` event and the source year's `YEAR_ROLLED_OVER` event carry the reconciliation id, so an uncertain commit is settled by reading them back before any retry.

## 4. The carry is itemized

`carry_opening` seeds gain `items[]`, a snapshot of each carried source: `{ sourceId, kind, basis, memberId, billName, description, amount }`, built in `billing-year.js` from the ids `buildCarryForward` already returns. A household Credit is a net position (ADR 0001), so it is one negative item attributed to the household (its `memberId` is the household contact, its `kind` is `'credit'`, its `sourceId` is the deterministic `carry_forward` record); Service Credits from the review that produced it are listed beneath it as non-additive `detail[]`. Invariant: the signed top-level items sum to the seed's signed `amount` within `CREDIT_EPSILON`. Seeds written before this change have no `items` and render as one "Carried from &lt;year&gt;" line.

The new year's share page, invoice preview, and invoice email show a **Carried from &lt;year&gt;** section with each line attributed to its member and totaled at the household, in plain language ("Northline Mobile went from $180 to $198 a month in July. Your share of six months: $12.00."). The Cloud Function builds share data independently of `share.js` (`functions/billing.js`, `resolveShareToken`), so it gets the same `carriedItems` builder and the same cache↔function parity test, and it ships before the client renders the section.

## Closed-year rollover

The review may run from a source year that is **Open, Settling, or Closed**, when no next year exists; never from an Archived year. `createYear` already writes the prior-year document regardless of status (it is not `_guardReadOnly`-guarded), and `applyCarryForwardToPriorYear` is the existing rollover-time append exception to ADR 0007.

- **Debit-only records** (True-ups, Usage Charges) are born deferred and carried in the same commit. They never touch the closed year's owed, so its settlement metrics are identical before and after Start.
- **Service Credits** (decrease, ended) lower owed in the closing year. On a Closed year they are permitted only because the resulting Credit is disposed by the carry in the same commit: the closed year never gains an undisposed Credit, no household changes status (a reduction can only turn Settled into a carried surplus), and the close gate is untouched. The accepted consequence is that the closed year's owed total is lower after rollover, visible in its billing events; this is ADR 0007's forward correction, with the record living on the year whose bill it explains.
- No settlement precondition is added: a household still Outstanding in an Open or Settling source year carries its True-ups like any other; its 2026 balance is unchanged.
- Reopening a closed year is never required for the review and is not performed by it.

## Amends

- **ADR 0005**: a Usage Charge is "per-member, or split across a bill's members as a True-up"; the bill-level split helper is shared by Service Credits and True-ups; `carry_opening` seeds carry `items[]`.
- **ADR 0007**: rollover-time appends to a Closed year include the review's records, under the same-commit disposition rule above.

## Considered options

- **A new `kind: 'true_up'`**—rejected: forces edits to every helper keyed on `usage_charge` + `deferred`, each a chance to drop or double-count money.
- **Editing the closing year's bill amounts or adding late-start bills to its `bills[]`**—rejected by ADR 0005 for the same reasons as before, plus twelve months at the new price and a false Outstanding on every household.
- **Keeping one netted `carry_opening` number**—rejected: a member's first invoice jumps with no explanation; the biggest trust risk in the feature.
- **A modal review**—rejected: four steps with tables do not fit a dialog, and phone dialogs are bottom sheets (Redesign 14).
- **Recording review Service Credits in the new year instead of the closed year**—rejected: the bill they explain may not exist in the new year (an ended bill), and the bill's own history would stop being honest.
- **Keeping `writeBatch` for the review path and checking for an existing next year before the commit**—rejected as insufficient: the check and the write are not atomic, so two sessions can still both pass it.
