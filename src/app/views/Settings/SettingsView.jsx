import BillingYearSelector from '../../components/BillingYearSelector.jsx';
import PageHeader from '../../components/PageHeader.jsx';

/**
 * SettingsView — billing year controls + future settings panels.
 */
export default function SettingsView() {
    return (
        <div className="settings-shell">
            <PageHeader
                kicker="Billing Controls"
                title="Settings"
                description="Manage billing-year lifecycle controls now and keep space ready for the rest of the React settings surface."
            />

            <div className="settings-grid">
                <BillingYearSelector />

                <div className="tab-placeholder settings-placeholder">
                    <p className="section-kicker">Coming Next</p>
                    <h3>Additional Settings</h3>
                    <p>Payment methods, email preferences, and account settings arrive in Phase 2.</p>
                </div>
            </div>
        </div>
    );
}
