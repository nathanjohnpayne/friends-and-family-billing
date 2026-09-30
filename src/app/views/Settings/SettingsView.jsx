import { syncPublicQrCodes, syncPublicSharesPaymentMethods } from '../../../lib/paymentMethodsSync.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useBillingData } from '../../hooks/useBillingData.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import { isYearReadOnly } from '../../../lib/validation.js';
import BillingYearSelector from '../../components/BillingYearSelector.jsx';
import PaymentMethodsManager from '../../components/PaymentMethodsManager.jsx';

/**
 * SettingsView — billing year controls + payment methods management.
 */
export default function SettingsView() {
    const { activeYear, loading, service } = useBillingData();
    const { user } = useAuth();
    const { showToast } = useToast();
    const readOnly = isYearReadOnly(activeYear);
    const settings = service.getState().settings || {};

    return (
        <div>
            <BillingYearSelector />

            {!loading && (<div className="settings-section-divider" />)}
            {!loading && (
                <PaymentMethodsManager
                    settings={settings}
                    readOnly={readOnly}
                    onUpdate={paymentMethods => {
                        service.updateSettings({ paymentMethods });
                        syncPublicQrCodes(user ? user.uid : null, paymentMethods);
                        syncPublicSharesPaymentMethods(user ? user.uid : null, paymentMethods);
                        showToast('Payment methods updated');
                    }}
                />
            )}
        </div>
    );
}
