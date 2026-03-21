import { useBillingData } from '../../hooks/useBillingData.js';

export default function MembersTab() {
    const { familyMembers, loading } = useBillingData();

    if (loading) return <p style={{ color: '#666' }}>Loading…</p>;

    return (
        <div className="tab-placeholder">
            <h3>Members ({familyMembers.length})</h3>
            <p>Member cards with full CRUD arrive in Phase 2.</p>
        </div>
    );
}
