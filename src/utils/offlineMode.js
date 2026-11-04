// v1.10.83 - Offline mode (the Wi-Fi button at the top, and Settings →
// Privacy & internet). On: the app never goes online by itself - no update
// check and no automatic online requests while the app is in local-only mode.
// What the user clicks (help pages, WhatsApp, Report) still works. The
// The local database remains available while this mode is enabled.
import { useEffect, useState } from '../vanilla/dom.js';
export const OFFLINE_KEY = 'gst_offlineMode';
const EVENT = 'fgsb-offline-mode';
export const isOfflineMode = () => {
    try {
        return localStorage.getItem(OFFLINE_KEY) === '1';
    }
    catch {
        return false;
    }
};
export const setOfflineMode = (on) => {
    try {
        if (on)
            localStorage.setItem(OFFLINE_KEY, '1');
        else
            localStorage.removeItem(OFFLINE_KEY);
    }
    catch { /* storage blocked */ }
    window.dispatchEvent(new Event(EVENT));
};
// The switch's state, kept in step wherever it is shown.
export function useOfflineMode() {
    const [on, setOn] = useState(isOfflineMode);
    useEffect(() => {
        const sync = () => setOn(isOfflineMode());
        window.addEventListener(EVENT, sync);
        return () => window.removeEventListener(EVENT, sync);
    }, []);
    return [on, setOfflineMode];
}
