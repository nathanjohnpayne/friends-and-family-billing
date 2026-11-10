/**
 * UnsavedChangesNotice — after a reload, the Dashboard shows the unsaved changes a
 * tab kept on this device when it entered the Reload required state (#614 / #669,
 * RD-34): "You had unsaved changes from <time>", the same list, Copy details, and
 * Dismiss (which removes the record). Nothing is merged; the administrator records
 * the changes again against the current data. Every storage access is guarded.
 */
import { useState } from 'react';
import { readUnsavedRecords, clearUnsavedRecord } from '../../lib/unsaved-changes.js';
import { UnsavedChangesList, copyUnsavedDetails, formatWhen } from './ReloadRequiredDialog.jsx';

function NoticeRecord({ record, onDismiss }) {
    const [copyState, setCopyState] = useState('idle'); // idle | copied | failed
    const [fallback, setFallback] = useState(null);
    async function handleCopy() {
        const result = await copyUnsavedDetails(record);
        setCopyState(result.copied ? 'copied' : 'failed');
        setFallback(result.copied ? null : result.text);
    }
    return (
        <div className="status-banner status-banner--warning unsaved-notice" role="region" aria-label={'Unsaved changes in ' + (record.yearLabel || record.yearId)}>
            <p>
                <b>{'You had unsaved changes from ' + formatWhen(record.detectedAt)}</b>
                {' in ' + (record.yearLabel || record.yearId) + '. They were not saved because '
                    + (record.reason === 'permission-denied' ? 'the save was refused' : 'the year was changed in another tab or device')
                    + '. Record them again if they are still needed; nothing was merged.'}
            </p>
            <UnsavedChangesList record={record} />
            {copyState === 'copied' && <p role="status">Details copied.</p>}
            {fallback && (
                <div className="reload-required-fallback">
                    <p role="alert">Copying failed. Select the text below and copy it yourself.</p>
                    <textarea readOnly aria-label="Unsaved details" value={fallback} rows={6} onFocus={e => e.target.select()} />
                </div>
            )}
            <div className="unsaved-notice-actions">
                <button type="button" className="btn btn-sm btn-secondary" onClick={handleCopy}>Copy details</button>
                <button type="button" className="btn btn-sm btn-tertiary" onClick={onDismiss}>Dismiss</button>
            </div>
        </div>
    );
}

export default function UnsavedChangesNotice({ uid, hidden = false }) {
    const [records, setRecords] = useState(() => readUnsavedRecords(uid));
    if (hidden || !uid || records.length === 0) return null;
    return (
        <>
            {records.map(record => (
                <NoticeRecord
                    key={record.yearId + ':' + record.detectedAt}
                    record={record}
                    onDismiss={() => {
                        clearUnsavedRecord(uid, record.yearId);
                        setRecords(current => current.filter(r => r !== record));
                    }}
                />
            ))}
        </>
    );
}
