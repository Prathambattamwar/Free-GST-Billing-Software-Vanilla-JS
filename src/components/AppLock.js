import { h, Fragment } from '../vanilla/dom.js';
import { useEffect, useRef, useState } from '../vanilla/dom.js';
import { Lock } from '../vanilla/icons.js';
import { getLockStatus, verifyPin, resetAppLock } from '../store.js';
import { UNLOCKED_KEY, LOCK_EVENT } from '../utils/appLock.js';

// Browser-only app lock. It is a convenience screen lock, not encryption.
// The records remain in this browser's IndexedDB and are not deleted when
// the PIN is reset.
function ForgotPin({ onUnlock }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const reset = async () => {
    if (busy) return;
    const confirmed = window.confirm('Remove only the app PIN from this browser? Your invoices, customers and other saved records will remain.');
    if (!confirmed) return;
    setBusy(true);
    setNote('');
    try {
      await resetAppLock();
      onUnlock();
    } catch (error) {
      setNote(error?.message || 'Could not remove the PIN. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return h('div', { className: 'app-lock-help' },
    h('p', null, 'This PIN is a screen lock for this browser, not encryption. Forgot it? You can remove the PIN without deleting your invoices or business records.'),
    h('p', { className: 'text-muted' }, 'Keep a backup of your data. Anyone with access to this browser profile can use its browser storage tools to bypass a screen lock.'),
    h('button', { type: 'button', className: 'btn btn-secondary btn-sm', onClick: reset, disabled: busy }, busy ? 'Removing PIN…' : 'Remove PIN and keep my data'),
    note && h('p', { className: 'app-lock-error', role: 'alert' }, note));
}
function LockScreen({ length, onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const input = useRef(null);
  const submit = async (value) => {
    if (busy) return;
    setBusy(true);
    try {
      await verifyPin(value);
      onUnlock();
    } catch (err) {
      setPin('');
      setError(err.status === 401 ? 'Wrong PIN. Try again.' : 'Could not check the PIN. Please try again.');
      setTimeout(() => input.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  };
  const onChange = (e) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, length);
    setPin(value);
    setError('');
    if (value.length === length) submit(value);
  };
  return h('div', { className: 'app-lock-screen' },
    h('form', { className: 'glass-panel app-lock-card', onSubmit: (e) => { e.preventDefault(); if (pin.length === length) submit(pin); } },
      h(Lock, { size: 32, 'aria-hidden': 'true' }),
      h('h1', null, 'Enter your PIN'),
      h('p', { className: 'text-muted' }, 'GST Billing is locked.'),
      h('input', { ref: input, className: 'form-input app-lock-input', type: 'password', inputMode: 'numeric', autoComplete: 'off', autoFocus: true, 'aria-label': `${length} digit PIN`, placeholder: '•'.repeat(length), value: pin, onChange, disabled: busy, maxLength: length }),
      h('p', { className: 'app-lock-error', role: 'alert' }, error),
      h('button', { type: 'button', className: 'app-lock-link', onClick: () => setShowHelp((value) => !value) }, 'Forgot PIN?'),
      showHelp && h(ForgotPin, { onUnlock })));
}
// Shows the app only after the PIN, when a PIN is set. Asked once per
// browser tab: a reload in the same tab does not ask again.
export default function AppLockGate({ children }) {
    const [lock, setLock] = useState({ checked: false, enabled: false, length: 6 });
    const [unlocked, setUnlocked] = useState(() => {
        try {
            return sessionStorage.getItem(UNLOCKED_KEY) === '1';
        }
        catch {
            return false;
        }
    });
    // The app has been on screen once (it stays mounted from then on).
    const [shown, setShown] = useState(unlocked);
    useEffect(() => {
        // If browser storage cannot be reached, the app remains available so its
        // own startup diagnostics can be shown.
        getLockStatus()
            .then((s) => { setLock({ checked: true, enabled: !!s.enabled, length: s.length === 8 ? 8 : 6 }); if (!s.enabled)
            setShown(true); })
            .catch(() => { setLock((l) => ({ ...l, checked: true })); setShown(true); });
        const relock = () => {
            setUnlocked(false);
            getLockStatus().then((s) => setLock({ checked: true, enabled: !!s.enabled, length: s.length === 8 ? 8 : 6 })).catch(() => { });
        };
        window.addEventListener(LOCK_EVENT, relock);
        return () => window.removeEventListener(LOCK_EVENT, relock);
    }, []);
    if (!lock.checked)
        return null;
    const locked = lock.enabled && !unlocked;
    const onUnlock = () => {
        try {
            sessionStorage.setItem(UNLOCKED_KEY, '1');
        }
        catch { /* storage blocked */ }
        setUnlocked(true);
        setShown(true);
    };
    // Locked before the app was ever shown: the app is not rendered at all.
    if (locked && !shown)
        return h(LockScreen, { length: lock.length, onUnlock: onUnlock });
    // Locked again (Lock now): the app stays mounted but hidden, so anything
    // typed and not yet saved is still there after the PIN. display: contents
    // keeps the wrapper out of the layout.
    return (h(Fragment, null,
        h("div", { style: { display: locked ? 'none' : 'contents' }, "aria-hidden": locked || undefined }, children),
        locked && h(LockScreen, { length: lock.length, onUnlock: onUnlock })));
}
