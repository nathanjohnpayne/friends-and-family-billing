/**
 * UpdateToast — polls version.json and shows a refresh banner when a new deploy is detected.
 * Port of checkForUpdate() / showUpdateToast() from main.js:118.
 */
import { useState, useEffect, useRef } from 'react';

const POLL_INTERVAL = 60000; // 60 seconds

export default function UpdateToast() {
    const [visible, setVisible] = useState(false);
    const knownVersion = useRef(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        async function check() {
            try {
                const resp = await fetch('/app/version.json?_=' + Date.now());
                if (!resp.ok) return;
                const data = await resp.json();
                if (knownVersion.current && data.version !== knownVersion.current) {
                    setVisible(true);
                    if (intervalRef.current) {
                        clearInterval(intervalRef.current);
                        intervalRef.current = null;
                    }
                }
                knownVersion.current = data.version;
            } catch (_) {
                // Network errors are fine — user may be offline
            }
        }

        check();
        intervalRef.current = setInterval(check, POLL_INTERVAL);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    if (!visible) return null;

    return (
        <div className="update-toast visible">
            <span className="update-toast-message">
                A new version of Friends &amp; Family Billing is available.
            </span>
            <button className="update-toast-btn" onClick={() => location.reload()}>
                Refresh
            </button>
            <button className="update-toast-dismiss" onClick={() => setVisible(false)} title="Dismiss">
                &times;
            </button>
        </div>
    );
}
