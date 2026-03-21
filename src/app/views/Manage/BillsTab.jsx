import { useBillingData } from '../../hooks/useBillingData.js';

export default function BillsTab() {
    const { bills, loading } = useBillingData();

    if (loading) return <p style={{ color: '#666' }}>Loading…</p>;

    return (
        <div className="tab-placeholder">
            <h3>Bills ({bills.length})</h3>
            <p>Bill cards with full CRUD arrive in Phase 2.</p>
        </div>
    );
}
