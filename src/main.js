import { StrictMode, h, Fragment } from './vanilla/dom.js';
import { createRoot } from './vanilla/client.js';
import App from './App.js';
import { installLocalApi, initialiseLocalDatabase } from './services/localApi.js';
import AppLockGate from './components/AppLock.js';
import ErrorBoundary from './components/ErrorBoundary.js';
import { toast } from './components/Toast.js';
import { logProblem } from './utils/problemLog.js';
import { isChunkLoadError } from './utils/errorReport.js';

// Intercept legacy /api/* calls and store business data in this browser's IndexedDB.
installLocalApi();
// Static browser edition: register the hand-written service worker directly.
// No bundler plugin or application runtime is needed; this is native browser JavaScript.
window.__fgsbSwUpdateReady = false;
window.__fgsbApplyUpdate = () => {
    if (!('serviceWorker' in navigator)) { window.location.reload(); return; }
    navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        else window.location.reload();
    }).catch(() => window.location.reload());
};
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
        const announceUpdate = () => {
            window.__fgsbSwUpdateReady = true;
            window.dispatchEvent(new CustomEvent('fgsb-sw-update-ready'));
        };
        if (registration.waiting) announceUpdate();
        registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            installing?.addEventListener('statechange', () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) announceUpdate();
            });
        });
    }).catch((error) => console.warn('[Service worker]', error));
}
// v1.10.83 - every other uncaught error goes to the Problem log, with a
// toast that offers Report (Toast adds it for a just-logged problem). The
// chunk-load case above still reloads instead. Two browser messages are
// noise, not problems: ResizeObserver's loop notice, and "Script error."
// from another origin, which carries no details at all.
const NOISE = /ResizeObserver loop|^Script error\.?$/i;
let lastProblemToast = 0;
const recordUncaught = (message, stack, alreadyLogged = false) => {
    const msg = String(message || '');
    if (!msg || NOISE.test(msg) || isChunkLoadError(msg))
        return;
    // apiFetch logs its own failures (with method, path and status) first.
    if (!alreadyLogged)
        logProblem({ kind: 'uncaught', message: msg, stack });
    if (Date.now() - lastProblemToast > 10_000) {
        lastProblemToast = Date.now();
        toast('Something went wrong. Your data is safe.', 'error');
    }
};
window.addEventListener('error', (e) => {
    try {
        recordUncaught(e?.error?.message || e?.message, e?.error?.stack);
    }
    catch { /* never throw from here */ }
});
window.addEventListener('unhandledrejection', (e) => {
    try {
        recordUncaught(e?.reason?.message || e?.reason, e?.reason?.stack, e?.reason?.problemLogged);
    }
    catch { /* never throw from here */ }
});
// Local-first startup. No Google sign-in, OAuth Client ID, Node.js backend or npm runtime.
const rootElement = document.getElementById('root');

function renderApplication() {
    rootElement.innerHTML = '';
    createRoot(rootElement).render(h(StrictMode, null,
        h(ErrorBoundary, null,
            h(AppLockGate, null,
                h(ErrorBoundary, null,
                    h(App, null))))));
    window.__fgsbBooted = true;
    try { sessionStorage.removeItem('fgsb-boot-retry'); } catch { /* storage blocked */ }
}

async function startApplication() {
    try {
        await initialiseLocalDatabase();
        renderApplication();
    } catch (error) {
        console.error('[GST Billing startup]', error);
        rootElement.innerHTML = `
          <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f8fafc;color:#0f172a;font-family:system-ui,sans-serif">
            <section style="max-width:560px;padding:30px;border:1px solid #fecaca;border-radius:16px;background:white;box-shadow:0 16px 50px #0f172a12">
              <h1 style="margin:0 0 12px;font-size:24px">GST Billing could not start</h1>
              <p style="line-height:1.6">The app could not open its local browser database. Use the latest Chrome or Edge and make sure browser storage is enabled.</p>
              <pre style="padding:12px;overflow-wrap:anywhere;white-space:pre-wrap;background:#f1f5f9;border-radius:8px;font-size:12px">${String(error?.message || error)}</pre>
              <button onclick="location.reload()" style="padding:10px 16px;border:0;border-radius:8px;background:#1d4ed8;color:white;font-weight:700;cursor:pointer">Retry</button>
            </section>
          </main>`;
    }
}

startApplication();
