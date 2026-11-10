/**
 * SaveStatusNotice — the saving indicator for a year-document write that did not
 * commit (#614): it reads *Not saved* with the reason (offline, a lost response, or
 * the read-only Reload required state) and clears when a later write commits. A
 * write that did not commit is never shown as saved.
 */
export default function SaveStatusNotice({ saveStatus }) {
    if (!saveStatus || saveStatus.state !== 'not_saved') return null;
    return (
        <div className="status-banner status-banner--warning save-status-notice" role="status" aria-label="Save status">
            <p><b>Not saved.</b> {saveStatus.message}</p>
        </div>
    );
}
