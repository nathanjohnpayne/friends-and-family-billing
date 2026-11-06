import { FINANCIAL_UNAVAILABLE, FINANCIAL_CORRECTION } from '../../lib/financial-availability.js';

/** The owner-approved bridge; detailed rendering/recovery stays in M3. */
export default function FinancialUnavailable() {
    return <div className="admin-hint" role="status">
        <strong>{FINANCIAL_UNAVAILABLE}</strong>
        <p>{FINANCIAL_CORRECTION}</p>
    </div>;
}
