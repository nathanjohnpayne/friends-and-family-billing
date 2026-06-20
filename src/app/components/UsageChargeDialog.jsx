/**
 * UsageChargeDialog — record a deferred Usage Charge for a member (#317).
 * Captures amount, description, and incurred date. The charge defaults to
 * `deferred` (recorded + visible, not yet billed) on the service side, so this
 * dialog never touches the payments ledger or current-year settlement.
 */
import { useEffect, useState } from 'react';
import { localDateString } from '../../lib/validation.js';

/**
 * @param {{
 *   open: boolean,
 *   memberName: string,
 *   onSubmit: (data: { amount: number, description: string, incurredDate: string }) => void,
 *   onClose: () => void
 * }} props
 */
export default function UsageChargeDialog({ open, memberName, onSubmit, onClose }) {
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [incurredDate, setIncurredDate] = useState(localDateString());
    const [error, setError] = useState('');

    // Reset fields whenever the dialog (re)opens.
    useEffect(() => {
        if (open) {
            setAmount('');
            setDescription('');
            setIncurredDate(localDateString());
            setError('');
        }
    }, [open]);

    // Close on Escape.
    useEffect(() => {
        if (!open) return;
        function handleKey(e) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, onClose]);

    if (!open) return null;

    function handleSubmit(e) {
        e.preventDefault();
        setError('');
        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            setError('Enter an amount greater than zero.');
            return;
        }
        if (!description.trim()) {
            setError('Enter a description.');
            return;
        }
        if (!incurredDate) {
            setError('Choose the date this charge was incurred.');
            return;
        }
        try {
            onSubmit({ amount: amt, description: description.trim(), incurredDate });
            onClose();
        } catch (err) {
            setError(err.message);
        }
    }

    function handleOverlayClick(e) {
        if (e.target === e.currentTarget) onClose();
    }

    return (
        <div className="dialog-overlay visible" onClick={handleOverlayClick} role="presentation">
            <div className="dialog" role="dialog" aria-modal="true" aria-label="Add Usage Charge">
                <div className="dialog-title">Add Usage Charge</div>
                <form onSubmit={handleSubmit}>
                    <p className="payment-dialog-for">
                        For: <strong>{memberName}</strong>
                    </p>
                    <p className="share-hint">
                        Recorded as a pending (deferred) charge. It is not billed yet and does not change
                        the current balance.
                    </p>
                    <div className="payment-dialog-fields">
                        <div className="payment-field-group">
                            <label htmlFor="usage-charge-amount">Amount ($)</label>
                            <input
                                id="usage-charge-amount"
                                className="composer-input"
                                type="number"
                                step="0.01"
                                min="0.01"
                                placeholder="0.00"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="payment-field-group">
                            <label htmlFor="usage-charge-description">Description</label>
                            <input
                                id="usage-charge-description"
                                className="composer-input"
                                type="text"
                                placeholder="e.g. Roaming overage"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                            />
                        </div>
                        <div className="payment-field-group">
                            <label htmlFor="usage-charge-date">Incurred date</label>
                            <input
                                id="usage-charge-date"
                                className="composer-input"
                                type="date"
                                value={incurredDate}
                                onChange={e => setIncurredDate(e.target.value)}
                            />
                        </div>
                    </div>
                    {error && <p className="composer-error">{error}</p>}
                    <div className="dialog-buttons">
                        <button type="button" className="btn btn-sm btn-header-secondary" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-sm btn-primary">Save Charge</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
