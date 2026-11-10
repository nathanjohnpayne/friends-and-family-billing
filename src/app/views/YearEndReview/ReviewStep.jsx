/**
 * Step 4 — Review & start. PLACEHOLDER until #609 lands.
 *
 * Seam for #609: replace this component (it receives the whole `review`
 * object from useYearEndReview, the `source` data, and `nextYearLabel`) and
 * flip REVIEW_STEP_READY so the Step 3 footer and the step strip reach it.
 * Use review.actions.acceptSourceFingerprint() once the administrator has
 * seen recomputed totals, and review.actions.clearDraftAfterSuccess() only
 * after the rollover is confirmed.
 */
export const REVIEW_STEP_READY = false;

export default function ReviewStep({ nextYearLabel }) {
    return (
        <section aria-labelledby="yer-step-4" data-testid="year-end-review-step-4">
            <h2 id="yer-step-4" className="yer-step-title">Review &amp; start {nextYearLabel}</h2>
            <p className="yer-hint">The per-household review and the Start button arrive in the next update.</p>
        </section>
    );
}
