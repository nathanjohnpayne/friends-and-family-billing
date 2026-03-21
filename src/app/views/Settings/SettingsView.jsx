import BillingYearSelector from '../../components/BillingYearSelector.jsx';

/**
 * SettingsView — billing year controls + future settings panels.
 */
export default function SettingsView() {
    return (
        <div>
            <BillingYearSelector />

            <div className="tab-placeholder">
                <h3>Additional Settings</h3>
                <p>Payment methods, email preferences, and account settings arrive in Phase 2.</p>
            </div>
        </div>
    );
}
