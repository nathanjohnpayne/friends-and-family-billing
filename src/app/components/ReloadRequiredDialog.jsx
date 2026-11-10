/**
 * ReloadRequiredDialog — the read-only Reload required state (#614 / #669, RD-34,
 * frames #fx-dashboard-stale-desk / -ph). Shown, blocking, when a year-document
 * write was refused as stale (STALE_DOCUMENT) or by the rules (permission-denied):
 * nothing done since the last successful save was written, the tab is read-only,
 * and the unsaved changes are listed with Copy details and Reload. When the list
 * could not be kept on this device, Reload stays disabled until the details were
 * copied or the administrator chose "Reload without copying". Nothing is merged.
 * On a phone the Dialog primitive renders it as a bottom sheet with full-width
 * footer buttons.
 */
import { useState } from 'react';
import Dialog from './Dialog.jsx';
import { formatAnnualSummaryCurrency as formatCurrency } from '../../lib/formatting.js';
import { formatUnsavedDetails } from '../../lib/unsaved-changes.js';

/** "3:09 pm", or "Nov 8, 3:09 pm" when not today. */
export function formatWhen(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return time;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + time;
}

/** The list of unsaved changes, shared by the dialog and the after-reload notice. */
export function UnsavedChangesList({ record }) {
    const changes = record.changes || [];
    const since = record.baselineAt ? formatWhen(record.baselineAt) : '';
    return (
        <div className="unsaved-changes">
            <div className="unsaved-changes-eyebrow">
                {'Not saved since ' + (since || 'this tab loaded') + ' · ' + changes.length + (changes.length === 1 ? ' change' : ' changes')}
            </div>
            {changes.length === 0 ? (
                <p className="unsaved-changes-empty">No unsaved changes were found in this tab.</p>
            ) : (
                <ul className="unsaved-changes-list" aria-label="Unsaved changes">
                    {changes.map((change, i) => (
                        <li key={i} className="unsaved-change">
                            <span className="unsaved-change-text">
                                <b>{change.label}</b>{change.detail ? ' · ' + change.detail : ''}
                                {change.at && <span className="unsaved-change-when">{formatWhen(change.at)}</span>}
                                {!change.at && change.kind !== 'event' && <span className="unsaved-change-when">no event—found by comparing the unsaved data</span>}
                            </span>
                            {typeof change.amount === 'number' && <span className="unsaved-change-amount num">{formatCurrency(change.amount)}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * Copy the details (the summary and the full unsaved payload JSON). Resolves true
 * when the clipboard accepted them.
 */
export async function copyUnsavedDetails(record) {
    const text = formatUnsavedDetails(record);
    try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return { copied: false, text };
        await navigator.clipboard.writeText(text);
        return { copied: true, text };
    } catch (_) {
        return { copied: false, text };
    }
}

export default function ReloadRequiredDialog({ writeBlock, onReload }) {
    const [copied, setCopied] = useState(false);
    const [copyFallback, setCopyFallback] = useState(null);
    const [reloadWithoutCopy, setReloadWithoutCopy] = useState(false);
    if (!writeBlock) return null;

    const kept = writeBlock.keptOnDevice;
    const canReload = kept || copied || reloadWithoutCopy;
    const year = writeBlock.yearLabel || writeBlock.yearId;
    const since = writeBlock.baselineAt
        ? (writeBlock.baselineKind === 'saved' ? 'since your last successful save at ' : 'since this tab loaded at ') + formatWhen(writeBlock.baselineAt)
        : 'since this tab loaded';
    const reload = onReload || (() => window.location.reload());

    async function handleCopy() {
        const result = await copyUnsavedDetails(writeBlock);
        if (result.copied) {
            setCopied(true);
            setCopyFallback(null);
        } else {
            setCopyFallback(result.text);
        }
    }

    return (
        <Dialog
            open
            onClose={() => {}}
            closeOnEscape={false}
            closeOnOverlayClick={false}
            title="Reload to continue"
            className="reload-required-dialog"
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={handleCopy}>
                        {copied ? 'Copied' : 'Copy details'}
                    </button>
                    <button type="button" className="btn btn-ink" onClick={reload} disabled={!canReload}>
                        Reload
                    </button>
                </>
            )}
        >
            <div className="dialog-body-padded">
                <p className="reload-required-lead">
                    {writeBlock.reason === 'permission-denied'
                        ? 'The server refused this tab’s save of ' + year + ' at ' + formatWhen(writeBlock.detectedAt) + ': it was probably changed in another tab or device, or this tab is out of date.'
                        : year + ' was changed in another tab or device (found at ' + formatWhen(writeBlock.detectedAt) + ').'}
                    {' To avoid writing over those changes, nothing you did here ' + since + ' was saved—this tab is read-only until it reloads.'}
                </p>
                <UnsavedChangesList record={writeBlock} />
                {kept ? (
                    <p className="reload-required-note">
                        This list is kept on this device and shown again after you reload, so you can record the changes against the current data. Nothing is merged for you.
                    </p>
                ) : (
                    <div className="inline-alert inline-alert--error" role="alert">
                        <p>This list could not be kept on this device{writeBlock.storageError ? ' (' + writeBlock.storageError + ')' : ''}—copy it before you reload. Nothing is merged for you.</p>
                        {!copied && (
                            <label className="reload-required-skip">
                                <input type="checkbox" checked={reloadWithoutCopy} onChange={e => setReloadWithoutCopy(e.target.checked)} />
                                {' Reload without copying'}
                            </label>
                        )}
                    </div>
                )}
                {copied && <p className="reload-required-note" role="status">Details copied.</p>}
                {copyFallback && (
                    <div className="reload-required-fallback">
                        <p role="alert">Copying failed. Select the text below and copy it yourself.</p>
                        <textarea readOnly aria-label="Unsaved details" value={copyFallback} rows={6} onFocus={e => e.target.select()} />
                    </div>
                )}
            </div>
        </Dialog>
    );
}
