// Browser preference for limiting optional online actions. Business data is
// always saved in IndexedDB. This is not a network firewall: first-time or
// uncached browser libraries may still need an internet connection.
import { useEffect, useState } from '../vanilla/dom.js';

export const OFFLINE_KEY = 'gst_offlineMode';
const EVENT = 'fgsb-offline-mode';

export const isOfflineMode = () => {
  try { return localStorage.getItem(OFFLINE_KEY) === '1'; } catch { return false; }
};

export const setOfflineMode = (on) => {
  try {
    if (on) localStorage.setItem(OFFLINE_KEY, '1');
    else localStorage.removeItem(OFFLINE_KEY);
  } catch { /* storage blocked */ }
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
