// v1.10.77 (#84) - Settings panel for the optional PIN lock (see AppLock.js).
import { useEffect, useState, h, Fragment } from '../vanilla/dom.js';
import { Lock } from '../vanilla/icons.js';
import { getLockStatus, setLockPin } from '../store.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
import { lockNow, UNLOCKED_KEY, lockSettingsChanged } from '../utils/appLock.js';
const digits = (v, n) => v.replace(/\D/g, '').slice(0, n);
export default function AppLockSettings() {
    const [status, setStatus] = useState(null);
    const [mode, setMode] = useState(null); // null | 'set' | 'off'
    const [length, setLength] = useState(6);
    const [pin, setPin] = useState('');
    const [confirm, setConfirm] = useState('');
    const [current, setCurrent] = useState('');
    const [busy, setBusy] = useState(false);
    const load = () => getLockStatus().then(setStatus).catch(() => setStatus({ enabled: false, length: 0 }));
    useEffect(() => { load(); }, []);
    const close = () => { setMode(null); setPin(''); setConfirm(''); setCurrent(''); };
    const save = async (e) => {
        e.preventDefault();
        if (mode === 'set') {
            if (pin.length !== length) {
                toast(`The PIN must be ${length} digits`, 'warning');
                return;
            }
            if (pin !== confirm) {
                toast('The two PINs do not match', 'warning');
                return;
            }
        }
        setBusy(true);
        try {
            await setLockPin(mode === 'off' ? null : pin, status?.enabled ? current : undefined);
            toast(mode === 'off' ? 'PIN lock turned off' : 'PIN saved. It is asked each time the app opens.', 'success');
            // This tab stays unlocked; other tabs and the next start ask for the PIN.
            try {
                sessionStorage.setItem(UNLOCKED_KEY, '1');
            }
            catch { /* storage blocked */ }
            close();
            load();
            lockSettingsChanged();
        }
        catch (err) {
            if (err.status === 401)
                toast('Current PIN is wrong', 'error');
            else if (err.status === 429)
                toast(`Too many wrong tries. Wait ${err.body?.wait || 30} seconds.`, 'error');
            else
                toast('Could not save the PIN', 'error');
        }
        finally {
            setBusy(false);
        }
    };
    if (!status)
        return null;
    const pinInput = (label, value, set, n) => (h("div", { className: "form-group", style: { margin: 0 } },
        h("label", { className: "form-label" }, label),
        h("input", { className: "form-input", type: "password", inputMode: "numeric", autoComplete: "new-password", style: { width: 160 }, value: value, maxLength: n, onChange: (e) => set(digits(e.target.value, n)) })));
    return (h("div", null,
        h("h3", { className: "section-title", style: { marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 } },
            h(Lock, { size: 18 }),
            " App lock (PIN) ",
            h(HelpButton, { title: "App lock (PIN)", doc: "settings#lock", size: 16 })),
        h("p", { style: { fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0 } },
            status.enabled
                ? `On: ${status.length === 8 ? "an" : "a"} ${status.length} digit PIN is asked when the app opens.`
                : 'Off. Turn it on to ask for a 6 or 8 digit PIN when the app opens, for a PC other people also use.',
            ' ',
            "It locks the screen only; it does not encrypt your files. Forgot it? Put a file named RESET-PIN in the Free-GST-Billing folder and reload."),
        !mode && (h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
            h("button", { type: "button", className: "btn btn-secondary", onClick: () => setMode('set') }, status.enabled ? 'Change PIN' : 'Turn on PIN lock'),
            status.enabled && h("button", { type: "button", className: "btn btn-secondary", onClick: () => setMode('off') }, "Turn off"),
            status.enabled && h("button", { type: "button", className: "btn btn-secondary", onClick: lockNow }, "Lock now"))),
        mode && (h("form", { onSubmit: save, style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
            status.enabled && pinInput('Current PIN', current, setCurrent, status.length),
            mode === 'set' && (h(Fragment, null,
                h("div", { className: "form-group", style: { margin: 0 } },
                    h("label", { className: "form-label" }, "Digits"),
                    h("select", { className: "form-input", value: length, onChange: (e) => { setLength(Number(e.target.value)); setPin(''); setConfirm(''); } },
                        h("option", { value: 6 }, "6 digits"),
                        h("option", { value: 8 }, "8 digits"))),
                pinInput('New PIN', pin, setPin, length),
                pinInput('New PIN again', confirm, setConfirm, length))),
            h("button", { type: "submit", className: "btn btn-primary", disabled: busy }, mode === 'off' ? 'Turn off PIN lock' : 'Save PIN'),
            h("button", { type: "button", className: "btn btn-secondary", onClick: close, disabled: busy }, "Cancel")))));
}
