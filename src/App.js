import { h, Fragment } from './vanilla/dom.js';
import { useState, useEffect, useRef, useMemo, lazy, Suspense } from './vanilla/dom.js';
import { Home, FileText, Settings, Plus, Users, Package, BarChart3, Wallet, RefreshCw, Receipt, BookOpen, Moon, Sun, Download, X, ShoppingCart, ChevronDown, Building2, Pencil, Search, Command, Bell, Calculator, Menu, Heart, Banknote } from './vanilla/icons.js';
import { getAllProfilesWithHidden, saveProfile, getEnabledModules, getMenuOrder, getMenuHidden, getMenuDots, onMenuChanged, getAllBills, getAllProducts, getAllRecurring, getStockAlertSettings, runUpdateNow, getLockStatus, visibleProfiles, hasHiddenProfiles, openHiddenCompanies, hideCompaniesAgain, isOpenedHidden, DATA_SAVED_EVENT } from './store.js';
import { isModuleEnabled, localToday, trackedStock } from './utils.js';
import { orderedMenu } from './utils/businessTypes.js';
import SidebarMenu, { NavDot } from './components/SidebarMenu.js';
import MenuCustomise, { onOpenCustomiseMenu } from './components/MenuCustomise.js';
import { hiddenItems } from './utils/menuGroups.js';
import { findAttention, menuDots, rollupDot, readFiledMarks, readNewSeen, markNewSeen, NEW_IN } from './utils/attention.js';
import { getPrintSettings } from './utils/printSettings.js';
import { notifyUpdate, canAskToNotify, askToNotify } from './utils/updateNotice.js';
// v1.10.4 — Route-level lazy loading. Prior App.jsx synchronously
// imported all 12 views (~15k LOC combined), so a first-paint on
// Dashboard downloaded and parsed GSTReturns (1952), InvoiceGenerator
// (2409), IncomeTax (1038), SettingsView (1479), PrintSettings (1294)
// etc. before the user even asked for them.
//
// Now:
//  - Dashboard stays eager — it's the default landing route.
//  - InvoiceGenerator stays eager — new-invoice is the primary action
//    reachable from Ctrl+K / manifest shortcut / big blue button.
//  - Every other view is React.lazy → own Vite chunk → fetched on
//    first navigation only. Suspense fallback is a lightweight spinner.
// Result: smaller initial JS payload; each heavy view chunk-caches
// once fetched.
import Dashboard from './components/Dashboard.js';
import InvoiceGenerator from './components/InvoiceGenerator.js';
import ToastContainer, { toast } from './components/Toast.js';
import UpdateOverlay from './components/UpdateOverlay.js';
import { releaseNoteTitles } from './utils/changelog.js';
import ErrorBoundary from './components/ErrorBoundary.js';
import ConfirmModalContainer, { promptAction } from './components/ConfirmModal.js';
import WelcomeGuide from './components/WelcomeGuide.js';
import { WhatsNewAfterUpdate, SEEN_KEY as WHATS_NEW_SEEN_KEY } from './components/WhatsNewSlides.js';
const SettingsView = lazy(() => import('./components/SettingsView.js'));
// v1.10.86 - loaded on first Ctrl+K (it carries the How do I… list and the help index).
const QuickSearch = lazy(() => import('./components/QuickSearch.js'));
const ClientsView = lazy(() => import('./components/ClientsView.js'));
const InventoryView = lazy(() => import('./components/InventoryView.js'));
const ReportsView = lazy(() => import('./components/ReportsView.js'));
const ExpenseTracker = lazy(() => import('./components/ExpenseTracker.js'));
const RecurringInvoices = lazy(() => import('./components/RecurringInvoices.js'));
const ReceiptVoucher = lazy(() => import('./components/ReceiptVoucher.js'));
const CashBook = lazy(() => import('./components/CashBook.js'));
const GSTReturns = lazy(() => import('./components/GSTReturns.js'));
const IncomeTax = lazy(() => import('./components/IncomeTax.js'));
const PurchaseBills = lazy(() => import('./components/PurchaseBills.js'));
import StarBanner from './components/StarBanner.js';
import AppFooter from './components/AppFooter.js';
import OfflineModeButton from './components/OfflineModeButton.js';
import { startView } from './utils/listPrefs.js';
import HelpButton from './components/HelpButton.js';
import ActionsMenu from './components/ActionsMenu.js';
import { lockNow } from './utils/appLock.js';
import { PageBarSlots, fitPageBar } from './components/pageBarSlots.js';
// v1.10.4 — Lightweight Suspense fallback shown while a lazy view
// downloads. Purely visual — no data fetching, no state.
function ViewLoading() {
    return (h("div", { style: { padding: '3rem', display: 'flex', justifyContent: 'center', alignItems: 'center' } },
        h("div", { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' } },
            h("span", { style: {
                    display: 'inline-block', width: 14, height: 14, border: '2px solid var(--border)',
                    borderTopColor: 'var(--primary)', borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                } }),
            "Loading\u2026")));
}
const MENU_BRAND_KEY = 'gst_menuBrand';
// v1.10.86 - the Control Panel moved into Settings -> App & updates: an old
// ?view=controlpanel link or a saved gst_currentView opens that tab instead.
const fromControlPanel = (view) => {
    if (view !== 'controlpanel')
        return view;
    try {
        sessionStorage.setItem('gst_settingsTab', 'section-updates');
    }
    catch { /* storage blocked */ }
    return 'settings';
};
function App() {
    // v1.10.86 - the second first-run window (SetupWizard: business type, paper,
    // language) is gone; the welcome asks the business type itself.
    const [currentView, setCurrentView] = useState(() => {
        // PWA manifest "shortcuts" deep-link in via ?view=X (e.g. right-clicking
        // the pinned taskbar icon → "New Invoice" opens /?view=new). Honour that
        // before falling back to whatever the user was last looking at.
        try {
            const params = new URLSearchParams(window.location.search);
            const v = params.get('view');
            // v1.10.74 - 'controlpanel' added so ?view=controlpanel deep links work too.
            const valid = ['dashboard', 'new', 'clients', 'inventory', 'expenses', 'purchases', 'recurring', 'receipts', 'cashbook', 'reports', 'filing', 'incometax', 'settings'];
            if (v && valid.includes(v)) {
                // Strip the query string so a refresh doesn't keep snapping back to
                // the shortcut target — only the *first* navigation honours it.
                window.history.replaceState({}, '', window.location.pathname);
                return fromControlPanel(v);
            }
        }
        catch { /* sandboxed history API — fall through */ }
        // 'guide' was the built-in User Guide (removed in v1.10.75).
        const last = sessionStorage.getItem('gst_currentView');
        // v1.10.86 - a new tab or window opens on the screen chosen in Customise
        // Dashboard ("Open the app on"); a reload keeps the screen it was on.
        return last && last !== 'guide' && last !== 'support' ? fromControlPanel(last) : startView();
    });
    const [profile, setProfile] = useState(null);
    // v1.10.83 - the menu's own name and logo, as last shown (see `brand` below).
    const [menuBrandCache] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(MENU_BRAND_KEY) || 'null');
        }
        catch {
            return null;
        }
    });
    useEffect(() => {
        if (!profile)
            return; // not loaded yet: keep what was there
        try {
            const name = String(profile.businessName || '').trim();
            if (!profile.showInMenu || !name) {
                localStorage.removeItem(MENU_BRAND_KEY);
                return;
            }
            const keep = { showInMenu: true, businessName: name, logo: profile.logo || '' };
            try {
                localStorage.setItem(MENU_BRAND_KEY, JSON.stringify(keep));
            }
            catch {
                localStorage.setItem(MENU_BRAND_KEY, JSON.stringify({ ...keep, logo: '' }));
            } // a very large logo: the name at least
        }
        catch { /* browser storage off: the menu simply waits for the profile */ }
    }, [profile]);
    const [editingBill, setEditingBill] = useState(() => {
        try {
            const saved = sessionStorage.getItem('gst_editingBill');
            return saved ? JSON.parse(saved) : null;
        }
        catch {
            return null;
        }
    });
    const [darkMode, setDarkMode] = useState(() => {
        return localStorage.getItem('freegstbill_theme') === 'dark';
    });
    const [showWelcome, setShowWelcome] = useState(false);
    const [serverDown, setServerDown] = useState(false);
    const retryTimer = useRef(null);
    const [serverStatus, setServerStatus] = useState('checking'); // 'checking' | 'online' | 'offline'
    const profileLoaded = useRef(false);
    const [allProfiles, setAllProfiles] = useState([]);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const profileMenuRef = useRef(null);
    // Update notification state. Auto-checks GitHub on mount + every 6h.
    // The user can dismiss a specific version (stored in localStorage) so the
    // banner doesn't keep nagging once they've seen it. A NEW version released
    // after that dismissal will re-show the banner.
    const [updateInfo, setUpdateInfo] = useState(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const [notifyAsked, setNotifyAsked] = useState(false);
    const updateBannerVisible = false; // Static edition updates are deployed with the site files.
    useEffect(() => { setUpdateInfo(null); }, []);
    // ---- Notification centre ----
    // Computed from server data on app boot + every 10 minutes; tucked under a
    // bell icon next to dark-mode toggle in the sidebar. Each section is one
    // click away from the relevant page.
    const [notifications, setNotifications] = useState({ overdue: [], dueSoon: [], lowStock: [], filings: [], autoFire: null, recurringDue: [] });
    const [showNotifs, setShowNotifs] = useState(false);
    // v1.10.86 - "New" dots on screens with new features (utils/attention.js
    // NEW_IN), until each is opened once. A new install (no What's new seen,
    // setup not done) starts with all of them seen.
    const [newSeen, setNewSeen] = useState(() => {
        let fresh = false;
        try {
            fresh = !localStorage.getItem(WHATS_NEW_SEEN_KEY) && getPrintSettings().onboardingComplete !== true;
        }
        catch { /* storage blocked */ }
        return readNewSeen(fresh);
    });
    useEffect(() => { setNewSeen(s => markNewSeen(s, currentView)); }, [currentView]);
    // v1.10.62 — reported (#53, @sangwanmail-eng): "Notifications should clear
    // after check."
    //
    // They never did, and the reason is that these are not messages — they are
    // computed live from your data every time the app loads ("3 invoices are
    // overdue", "2 products are low on stock"). There was no notion of having
    // read one, so the badge simply reported what was true and stayed lit
    // forever.
    //
    // Marking them read cannot just hide them, though: if an invoice goes
    // overdue tomorrow you must be told, even if you dismissed yesterday's
    // overdue notice. So dismissal is recorded per section as a SIGNATURE of
    // what was actually shown — the specific invoice numbers, the specific
    // products. Dismissing stores that signature; the section stays quiet only
    // while the signature is unchanged. The moment the underlying facts differ
    // — a new overdue invoice, a different product running low — the signature
    // changes and the alert comes back on its own.
    //
    // Kept in localStorage: it is a per-machine reading preference, not
    // business data, and it must not travel in a backup or sync to another PC.
    const DISMISS_KEY = 'fgsb_dismissedNotifs';
    const [dismissed, setDismissed] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}');
        }
        catch {
            return {};
        }
    });
    const notifSignatures = useMemo(() => ({
        overdue: notifications.overdue.map(b => b.invoiceNumber || b.id).sort().join('|'),
        dueSoon: notifications.dueSoon.map(b => b.invoiceNumber || b.id).sort().join('|'),
        lowStock: notifications.lowStock.map(p => `${p.id || p.name}:${p.stock ?? ''}`).sort().join('|'),
        filings: notifications.filings.map(f => f.label || f.id || String(f)).sort().join('|'),
        autoFire: notifications.autoFire?.count > 0 ? `autofire:${notifications.autoFire.count}` : '',
        recurringDue: notifications.recurringDue.map(t => `${t.id}:${t.nextDate}`).sort().join('|'),
    }), [notifications]);
    // A section counts toward the badge only when it has content AND that
    // content is not the exact thing the user already dismissed.
    const isLive = (key) => !!notifSignatures[key] && dismissed[key] !== notifSignatures[key];
    const notifTotal = (isLive('overdue') ? notifications.overdue.length : 0)
        + (isLive('dueSoon') ? notifications.dueSoon.length : 0)
        + (isLive('lowStock') ? notifications.lowStock.length : 0)
        + (isLive('filings') ? notifications.filings.length : 0)
        + (isLive('autoFire') ? 1 : 0)
        + (isLive('recurringDue') ? notifications.recurringDue.length : 0);
    // How many sections are currently showing something that could be cleared.
    const dismissableCount = ['overdue', 'dueSoon', 'lowStock', 'filings', 'autoFire', 'recurringDue']
        .filter(isLive).length;
    const markAllNotifsRead = () => {
        const next = { ...dismissed, ...notifSignatures };
        setDismissed(next);
        try {
            localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
        }
        catch { /* private mode */ }
    };
    // v1.10.86 - the bell and the menu's red dots both come from findAttention
    // (utils/attention.js). Looked at on start, on every screen change, a moment
    // after a bill / product / template / purchase is saved, and every 10 min.
    const profileRef = useRef(null);
    profileRef.current = profile;
    const profileKey = `${profile?.gstin || ''}|${profile?.businessName || ''}`;
    useEffect(() => {
        let cancelled = false;
        let saveTimer = null;
        const compute = async () => {
            try {
                const [bills, products, stockAlertCfg, templates] = await Promise.all([
                    getAllBills().catch(() => []),
                    getAllProducts().catch(() => []),
                    getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
                    getAllRecurring().catch(() => []),
                ]);
                if (cancelled)
                    return;
                // Local dates: toISOString() is UTC (yesterday in India until 05:30),
                // while the server stamps lastRecurringAutoFire with its local date.
                const today = localToday();
                const prof = profileRef.current;
                const { overdue, dueSoon, lowStock, filings, recurringDue } = findAttention({
                    bills, products, stockCfg: stockAlertCfg, templates, profile: prof, filed: readFiledMarks(prof),
                });
                // Recurring auto-fire breadcrumb — set by server.js processDueRecurring().
                // Only "fresh" (today's) auto-fires count as a notification; older ones
                // would otherwise stay sticky forever.
                let autoFire = null;
                try {
                    const r = await fetch('/api/meta/lastRecurringAutoFire');
                    if (r.ok) {
                        const j = await r.json();
                        if (j.value && j.value.date === today && j.value.count > 0)
                            autoFire = j.value;
                    }
                }
                catch { /* fine */ }
                setNotifications({ overdue, dueSoon, lowStock, filings, autoFire, recurringDue });
            }
            catch { /* offline / server down — leave previous counts */ }
        };
        compute();
        const interval = setInterval(compute, 10 * 60 * 1000);
        // Not while an invoice is open: its auto-save would redraw the app
        // between keystrokes. Leaving the editor looks again anyway.
        const onSaved = () => { if (currentView === 'new')
            return; clearTimeout(saveTimer); saveTimer = setTimeout(compute, 1500); };
        window.addEventListener(DATA_SAVED_EVENT, onSaved);
        return () => { cancelled = true; clearInterval(interval); clearTimeout(saveTimer); window.removeEventListener(DATA_SAVED_EVENT, onSaved); };
    }, [currentView, profileKey]); // recompute on view change so the bell stays fresh after the user records a payment
    // ---- Keyboard shortcuts + command palette ----
    // Ctrl+K opens a Spotlight-style command palette; Ctrl+N starts a new
    // invoice from anywhere; Ctrl+/ shows the full shortcuts list. Ctrl+S /
    // Ctrl+P live in InvoiceGenerator (they need invoice-form context). All
    // global handlers also accept Meta (⌘) for macOS users.
    // v1.10.86 - the search itself (results, "How do I…", keyboard) is
    // components/QuickSearch.jsx; it reads invoices, clients and products each
    // time it opens.
    const [showPalette, setShowPalette] = useState(false);
    const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
    // v1.10.69 - see runUpdateNow() in store.js for why this is no longer a link.
    const [updating, setUpdating] = useState(false);
    // v1.10.86 - the progress window (UpdateOverlay) shows the steps and any
    // error; on success the page reloads on the new version by itself.
    const handleUpdateNow = async () => {
        setUpdating(true);
        setShowUpdateModal(false);
        const result = await runUpdateNow();
        setUpdating(false);
        if (result.hint)
            toast(result.error, 'info', 10000);
    };
    const dismissUpdate = () => {
        if (updateInfo?.latest) {
            localStorage.setItem('freegstbill_dismissedUpdate', updateInfo.latest);
            // v1.10.6 — audit L10: was `setUpdateInfo(prev => prev ? { ...prev }
            // : prev)` "to trigger re-render". No-op — `setShowUpdateModal(false)`
            // below already re-renders, and `updateBannerVisible` reads
            // localStorage every render so the new dismissal is picked up.
        }
        setShowUpdateModal(false);
    };
    // Confirm the browser-local API adapter is available — continuously monitors
    useEffect(() => {
        let cancelled = false;
        // v1.10.73 - a busy or older PC can take a few seconds to answer. One
        // slow reply used to replace the whole app with "Needs a Quick Start"
        // mid-invoice. Once the app has loaded, it now takes 3 missed checks in a
        // row (about 15 s) before saying the app is not running; before the first
        // load it still says so straight away.
        let misses = 0;
        const checkServer = async () => {
            try {
                            // The browser-local API adapter answers this check when IndexedDB is ready.
                const live = await fetch('/api/profile', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(8000) });
                if (live.ok) {
                    if (cancelled)
                        return;
                    misses = 0;
                    setServerDown(false);
                    setServerStatus('online');
                    if (!profileLoaded.current) {
                        const res = await fetch('/api/profile', { signal: AbortSignal.timeout(8000) });
                        if (!res.ok)
                            throw new Error('not ok');
                        profileLoaded.current = true;
                        const p = await res.json();
                        setProfile(p);
                        if (!p.businessName && !localStorage.getItem('freegstbill_onboarded')) {
                            setShowWelcome(true);
                        }
                    }
                    return;
                }
                throw new Error('not ok');
            }
            catch {
                if (cancelled)
                    return;
                misses += 1;
                if (!profileLoaded.current || misses >= 3) {
                    setServerDown(true);
                    setServerStatus('offline');
                }
            }
        };
        checkServer();
        // Keep checking every 5 seconds (fast when down, normal heartbeat when up)
        retryTimer.current = setInterval(checkServer, 5000);
        return () => {
            cancelled = true;
            if (retryTimer.current)
                clearInterval(retryTimer.current);
        };
    }, []);
    // Static browser edition: no desktop server launcher or install banner is used.
    useEffect(() => {
        sessionStorage.setItem('gst_currentView', currentView);
    }, [currentView]);
    useEffect(() => {
        if (editingBill) {
            // _printOnOpen is a one-shot request; a refresh must not print again.
            const { _printOnOpen, ...toKeep } = editingBill;
            sessionStorage.setItem('gst_editingBill', JSON.stringify(toKeep));
        }
        else {
            sessionStorage.removeItem('gst_editingBill');
        }
    }, [editingBill]);
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
        localStorage.setItem('freegstbill_theme', darkMode ? 'dark' : 'light');
        // v1.10.85 - the Windows Setup's window turns its title bar dark too.
        try {
            window.chrome?.webview?.postMessage(`theme:${darkMode ? 'dark' : 'light'}`);
        }
        catch { /* not the Setup's window */ }
    }, [darkMode]);
    // Load all saved business profiles
    useEffect(() => {
        if (serverStatus === 'online') {
            getAllProfilesWithHidden().then(setAllProfiles).catch(() => { });
        }
        // v1.10.85 (#125) - Settings hid or showed a company.
        const reload = () => getAllProfilesWithHidden().then(setAllProfiles).catch(() => { });
        window.addEventListener('fgsb:profiles-changed', reload);
        return () => window.removeEventListener('fgsb:profiles-changed', reload);
    }, [serverStatus]);
    // v1.10.85 - a save refused because the books are closed for its date:
    // the server's reason, once, whatever screen it came from.
    useEffect(() => {
        const say = (e) => toast(e.detail?.error || 'The books are closed for that date (Settings -> Data).', 'error');
        window.addEventListener('fgsb:period-locked', say);
        return () => window.removeEventListener('fgsb:period-locked', say);
    }, []);
    // Close profile menu on outside click
    useEffect(() => {
        if (!showProfileMenu)
            return;
        const handler = (e) => {
            if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
                setShowProfileMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showProfileMenu]);
    // v1.10.85 (#125) - companies hidden behind their own PIN stay out of the
    // list until it is typed; a switch elsewhere hides them again.
    const shownProfiles = visibleProfiles(allProfiles);
    const anyHidden = hasHiddenProfiles(allProfiles);
    const openHidden = async () => {
        setShowProfileMenu(false);
        const pin = await promptAction({ title: 'Open a hidden company', message: 'Type the PIN of the company you want to open.', inputType: 'password', placeholder: '6 or 8 digits', confirmLabel: 'Open' });
        if (!pin)
            return;
        try {
            const ids = await openHiddenCompanies(pin.trim());
            const list = await getAllProfilesWithHidden();
            setAllProfiles(list);
            const first = visibleProfiles(list).find((p) => p.id === ids[0]);
            if (first)
                await handleSwitchProfile(first);
        }
        catch (e) {
            toast(e?.body?.code === 'wait' ? `Too many wrong tries. Wait ${e.body.wait} seconds.` : 'That PIN does not open a company.', 'error');
        }
    };
    const handleSwitchProfile = async (bp) => {
        hideCompaniesAgain(bp.id);
        setShowProfileMenu(false);
        const loaded = { ...bp };
        delete loaded.id;
        delete loaded.hidden;
        delete loaded.isActive;
        await saveProfile(loaded);
        setProfile(loaded);
    };
    // A restart while a hidden company was open must not reopen it: move to the
    // first company that is not hidden. Once, on the first list from the server
    // (review: run on every switch, a stale `isActive` kept switching for ever).
    const hiddenStartChecked = useRef(false);
    useEffect(() => {
        if (hiddenStartChecked.current || !allProfiles.length)
            return;
        hiddenStartChecked.current = true;
        if (!allProfiles.some((p) => p.hidden && p.isActive && !isOpenedHidden(p.id)))
            return;
        const fallback = shownProfiles.find((p) => !p.hidden);
        if (fallback)
            handleSwitchProfile(fallback);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allProfiles]);
    // v1.10.66 (#64 item 1) — identifies the active business for the screens
    // keyed on it below. GSTIN first, the same rule belongsToProfile() uses to
    // decide which records a business owns; the name covers a business that has
    // no GSTIN yet.
    const businessKey = String(profile?.gstin || profile?.businessName || '').trim().toUpperCase();
    // v1.10.66 (#59) — on a phone the sidebar is a slide-in menu. It closes as
    // soon as something in it is chosen, so picking a page never leaves the menu
    // covering the page that was just asked for. Opening the business list is
    // the one exception: that choice is not finished yet.
    const [navOpen, setNavOpen] = useState(false);
    const closeNavAfterPick = (e) => {
        const picked = e.target.closest('button');
        // v1.10.86 - nor opening / closing a menu group or arranging the menu.
        if (picked && !picked.classList.contains('profile-switcher-btn') && !picked.hasAttribute('data-keep-open'))
            setNavOpen(false);
    };
    // v1.10.76 - a fresh editor for every invoice opened, so nothing (such as
    // the stock record of the last invoice) carries over to the next one.
    const [editorKey, setEditorKey] = useState(0);
    // v1.10.77 (#84) - sidebar auto-hide (desktop): a slim strip of icons that
    // opens over the page when pointed at, for more room on small screens.
    const [sidebarAutoHide, setSidebarAutoHide] = useState(() => {
        try {
            return localStorage.getItem('freegstbill_sidebarAutoHide') === '1';
        }
        catch {
            return false;
        }
    });
    const toggleSidebarAutoHide = (on) => {
        setSidebarAutoHide(on);
        try {
            localStorage.setItem('freegstbill_sidebarAutoHide', on ? '1' : '0');
        }
        catch { /* private mode */ }
    };
    const handleNewInvoice = () => {
        setEditorKey((k) => k + 1);
        sessionStorage.removeItem('gst_invoiceDraft');
        setEditingBill(null);
        setCurrentView('new');
    };
    // v1.10.86 - from a client's account: a new invoice with that client filled
    // in (InvoiceGenerator picks it up once its defaults are loaded), and the
    // payment receipt form opened for them.
    const handleNewInvoiceFor = (client) => {
        try {
            sessionStorage.setItem('gst_newInvoiceFor', JSON.stringify({ id: client?.id || '', name: client?.name || '' }));
        }
        catch { /* storage blocked */ }
        handleNewInvoice();
    };
    const handleRecordPaymentFor = (clientName) => {
        try {
            sessionStorage.setItem('gst_receiptFor', clientName || '');
        }
        catch { /* storage blocked */ }
        setCurrentView('receipts');
    };
    const handleEditInvoice = (bill) => {
        setEditorKey((k) => k + 1);
        sessionStorage.removeItem('gst_invoiceDraft');
        setEditingBill(bill);
        setCurrentView('new');
    };
    // v1.10.77 (#86) - Print from the Dashboard row: opens the invoice just long
    // enough to build the same PDF the invoice screen prints (same pages, HD),
    // prints it, and comes back.
    const handlePrintInvoice = (bill) => {
        setEditorKey((k) => k + 1);
        sessionStorage.removeItem('gst_invoiceDraft');
        setEditingBill({ ...bill, _printOnOpen: true });
        setCurrentView('new');
    };
    const handleDuplicateInvoice = (bill) => {
        setEditorKey((k) => k + 1);
        sessionStorage.removeItem('gst_invoiceDraft');
        const clone = JSON.parse(JSON.stringify(bill));
        clone._isDuplicate = true;
        setEditingBill(clone);
        setCurrentView('new');
    };
    // v1.10.85 (#135) - also quotation -> sales order, and a sales order's
    // challan / invoice (prepared by utils/salesOrders.js dispatchDraft).
    const handleConvertToInvoice = (bill, type = 'tax-invoice') => {
        setEditorKey((k) => k + 1);
        sessionStorage.removeItem('gst_invoiceDraft');
        const clone = JSON.parse(JSON.stringify(bill));
        clone._isDuplicate = true;
        clone._convertToType = clone._convertToType || type;
        setEditingBill(clone);
        setCurrentView('new');
    };
    // Pull the user's module preferences once per render. Re-mount happens
    // when settings save, which triggers a re-render via the profile state.
    const enabledModules = getEnabledModules();
    const showIfModule = (moduleId) => isModuleEnabled(moduleId, enabledModules);
    // v1.10.83 - a switch or a new order in Settings → Features redraws the
    // sidebar straight away.
    const [, setMenuTick] = useState(0);
    useEffect(() => onMenuChanged(() => setMenuTick(t => t + 1)), []);
    // v1.10.86 - "Customise menu" (the pencil at the top of the sidebar, or
    // Settings -> Features). Items taken out there leave the sidebar only:
    // navItems / bottomIds keep them, so Ctrl+K search still finds them.
    const [showMenuEditor, setShowMenuEditor] = useState(false);
    useEffect(() => onOpenCustomiseMenu(() => setShowMenuEditor(true)), []);
    const menuHidden = hiddenItems(getMenuHidden());
    // Sidebar items in the saved order; hidden ones dropped. Core settings and lock entries remain available.
    const menu = orderedMenu(getMenuOrder()).filter(m => !['guide', 'support', 'phone'].includes(m.id) && (!m.module || showIfModule(m.module)));
    // Never surface the removed documentation/help entries, even if an old menu preference contains them.
    // If the user just disabled the module backing the current view, kick them to dashboard
    // so they don't land on an empty page after toggling.
    useEffect(() => {
        const map = { new: 'invoicing', clients: 'clients', inventory: 'inventory', expenses: 'expenses', purchases: 'purchases', recurring: 'recurring', receipts: 'receipts', cashbook: 'cashBook', reports: 'reports', filing: 'gstReturns', incometax: 'incomeTax' };
        const moduleForView = map[currentView];
        if (moduleForView && !isModuleEnabled(moduleForView, enabledModules)) {
            setCurrentView('dashboard');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentView, JSON.stringify(enabledModules)]);
    // v1.10.83 - order, labels and switches come from MENU_ITEMS (utils.js);
    // only the icons and click handlers live here.
    const NAV_EXTRAS = {
        dashboard: { icon: Home, label: 'Dashboard' },
        new: { icon: Plus, label: 'New Invoice', onClick: handleNewInvoice },
        clients: { icon: Users, label: 'Clients' },
        inventory: { icon: Package, label: 'Products' },
        expenses: { icon: Wallet, label: 'Expenses' },
        purchases: { icon: ShoppingCart, label: 'Purchases' },
        recurring: { icon: RefreshCw, label: 'Recurring' },
        receipts: { icon: Receipt, label: 'Receipts' },
        cashbook: { icon: Banknote, label: 'Cash book' },
        reports: { icon: BarChart3, label: 'Reports' },
        filing: { icon: BookOpen, label: 'GST Returns' },
        incometax: { icon: Calculator, label: 'Income Tax' },
    };
    const navItems = menu.filter(m => m.section === 'main').map(m => ({ id: m.id, ...NAV_EXTRAS[m.id] }));
    const bottomIds = menu.filter(m => m.section === 'bottom').map(m => m.id);
    // v1.10.86 - red dots in the menu: the bell's live sections (so "Mark all
    // as read" clears both), an update, and "New" on screens still in the menu.
    // Only items that are switched on; one taken out of the menu shows on its
    // group's header (SidebarMenu), and anything at all on the phone's ☰ button.
    const shownIds = [...navItems.map(i => i.id), ...bottomIds];
    const allDots = getMenuDots() ? menuDots(notifications, {
        live: isLive, autoFire: notifications.autoFire,
        update: updateBannerVisible ? updateInfo.latest : null,
        unseenNew: Object.keys(NEW_IN.items).filter(id => !newSeen.includes(id) && !menuHidden.includes(id)),
    }) : {};
    const dots = Object.fromEntries(Object.entries(allDots).filter(([id]) => shownIds.includes(id)));
    const anyDot = rollupDot(Object.keys(dots), dots);
    // v1.10.86 - icons and names for the Customise menu window, as in the sidebar.
    const menuExtras = { ...NAV_EXTRAS, settings: { icon: Settings, label: 'Settings' } };
    // v1.10.86 - a Settings tab / section from the sidebar (as openSettingsAt below).
    const openSettingsSection = (sectionId) => {
        try {
            sessionStorage.setItem('gst_settingsTab', sectionId);
        }
        catch { /* storage blocked */ }
        setCurrentView('settings');
        setTimeout(() => window.dispatchEvent(new CustomEvent('fgsb:settings-open', { detail: sectionId })), 80);
    };
    // v1.10.83 - small buttons at the top right of every screen (asked for:
    // "dark mode button should be on top, not in the sidebar").
    const topIds = menu.filter(m => m.section === 'top').map(m => m.id);
    // v1.10.83 - the business's own name and logo at the top of the menu, when
    // it says so (Settings → Branding, or the first-run setup).
    // The profile comes from the server a moment after the first paint; until
    // then the menu uses the name and logo it showed last time (kept in this
    // browser), so a refresh does not flash "GST Billing" before the logo.
    const brand = profile || menuBrandCache;
    const ownBrand = !!brand?.showInMenu && !!String(brand?.businessName || '').trim();
    // The window's title bar shows the page and the business, like a desktop
    // program ("Invoices - Dice Codes"), not the long search-engine title.
    const pageLabel = (NAV_EXTRAS[currentView] || menu.find(m => m.id === currentView))?.label;
    const windowName = String(brand?.businessName || '').trim() || 'GST Billing';
    // v1.10.84 - and says so when an update is waiting (the taskbar shows it too).
    const updateNote = updateBannerVisible ? ` (update ${updateInfo.latest} available)` : '';
    useEffect(() => {
        document.title = (pageLabel ? `${pageLabel} - ${windowName}` : windowName) + updateNote;
    }, [pageLabel, windowName, updateNote]);
    // v1.10.86 - a search box you can see (it opens the Ctrl+K quick search);
    // a search icon on a phone (CSS hides the words).
    const openPalette = () => setShowPalette(true);
    const searchBox = (h("button", { type: "button", className: "topbar-search", onClick: openPalette, title: "Search or jump to a page (Ctrl+K)", "aria-label": "Search or jump to a page (Ctrl+K)" },
        h(Search, { size: 16 }),
        h("span", { className: "topbar-search-text" }, "Search\u2026"),
        h("kbd", { className: "topbar-search-kbd" }, "Ctrl+K")));
    // v1.10.86 - the page title and the page's buttons sit in the top bar, in
    // these two boxes (components/PageHeader.jsx fills them). The bar steps down
    // (search icon, then a ⋯ menu, then a second line) only when it must.
    const [barTitleEl, setBarTitleEl] = useState(null);
    const [barActionsEl, setBarActionsEl] = useState(null);
    const barSlots = useMemo(() => (barTitleEl && barActionsEl ? { title: barTitleEl, actions: barActionsEl } : null), [barTitleEl, barActionsEl]);
    const barRef = useRef(null);
    useEffect(() => {
        const bar = barRef.current;
        if (!bar || typeof ResizeObserver === 'undefined')
            return undefined;
        const ro = new ResizeObserver(() => fitPageBar(bar));
        ro.observe(bar);
        for (const el of bar.children)
            ro.observe(el); // the title and buttons change with the screen
        return () => ro.disconnect();
    }, [barTitleEl, barActionsEl]);
    const topActions = topIds.map(id => ({
        /* Opens the list of overdue / due-soon invoices, GST filing deadlines and
           low-stock items, each a click away from the page that fixes it. */
        notifications: (h("button", { key: id, type: "button", className: "topbar-btn", onClick: () => setShowNotifs(s => !s), title: "Notifications", "aria-label": notifTotal > 0 ? `Notifications: ${notifTotal}` : 'Notifications' },
            h(Bell, { size: 18 }),
            notifTotal > 0 && h("span", { className: "topbar-badge" }, notifTotal > 99 ? '99+' : notifTotal))),
        /* v1.10.83 - Offline mode on / off, and what it changes. */
        offline: h(OfflineModeButton, { key: id, className: "topbar-btn", onOpenSettings: () => {
                try {
                    sessionStorage.setItem('gst_settingsTab', 'section-privacy');
                }
                catch { /* storage blocked */ }
                setCurrentView('settings');
            } }),
        darkMode: (h("button", { key: id, type: "button", className: "topbar-btn", onClick: () => setDarkMode(d => !d), title: darkMode ? 'Switch to light mode' : 'Switch to dark mode', "aria-label": darkMode ? 'Light mode' : 'Dark mode' }, darkMode ? h(Sun, { size: 18 }) : h(Moon, { size: 18 }))),
    })[id]);
    // Global keyboard shortcuts. Lives down here for the same TDZ reason —
    // the handler closes over `handleNewInvoice` which is declared above only.
    useEffect(() => {
        const onKey = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod)
                return;
            const tag = (e.target?.tagName || '').toLowerCase();
            const editable = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
            if (e.key === 'k' || e.key === 'K') {
                e.preventDefault();
                setShowPalette(p => !p);
            }
            else if (e.key === '/') {
                e.preventDefault();
                setShowShortcutsHelp(s => !s);
            }
            else if ((e.key === 'l' || e.key === 'L') && e.shiftKey) {
                // v1.10.80 (#98) - lock now; does nothing when no PIN is set.
                e.preventDefault();
                getLockStatus().then((st) => { if (st?.enabled)
                    lockNow(); }).catch(() => { });
            }
            else if ((e.key === 'n' || e.key === 'N') && !editable) {
                e.preventDefault();
                handleNewInvoice();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // v1.9.4 — Accessibility hooks (v1.10.4/1.10.6 updated):
    //   1. Mirror `title` → `aria-label` on every icon button that lacks one.
    //      Runs on mount + via a MutationObserver when the DOM adds new
    //      icon buttons (bulk toolbars, modals, etc.). See M15.
    //   2. Global ESC handler for any open `.modal-overlay` — clicks the
    //      backdrop (which triggers the overlay's own close). No CSS
    //      class is added; the earlier `.esc-closable` idea was never
    //      implemented, comment cleaned up (audit L7).
    useEffect(() => {
        // v1.10.4 — audit M15. Prior code polled the DOM every 3 seconds
        // to mirror title→aria-label on new .icon-btn elements. Constant
        // idle-time work for a paper-thin accessibility win. Replaced with
        // a MutationObserver that fires ONLY when new buttons enter the
        // DOM. Existing buttons get the treatment once at mount.
        const mirrorTitleToAria = (root = document) => {
            root.querySelectorAll('button.icon-btn[title]:not([aria-label])').forEach(btn => {
                btn.setAttribute('aria-label', btn.getAttribute('title'));
            });
        };
        mirrorTitleToAria();
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.addedNodes.length) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType === 1) { // Element
                            if (node.matches?.('button.icon-btn[title]:not([aria-label])')) {
                                node.setAttribute('aria-label', node.getAttribute('title'));
                            }
                            mirrorTitleToAria(node);
                        }
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Global ESC → click the topmost modal-overlay (dismisses it).
        const onEsc = (e) => {
            if (e.key !== 'Escape')
                return;
            const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
            const top = overlays[overlays.length - 1];
            if (!top)
                return;
            if (showPalette)
                return;
            top.click();
        };
        window.addEventListener('keydown', onEsc);
        return () => { observer.disconnect(); window.removeEventListener('keydown', onEsc); };
    }, [showPalette]);
    // Static browser edition: show a local-storage error only if the IndexedDB
    // adapter is unavailable. There is no local server to start or restart.
    if (serverDown) {
        return h("main", { className: "server-down-overlay", role: "alert", style: { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' } },
            h("section", { className: "server-down-modal", style: { maxWidth: 560, width: '100%' } },
                h(FileText, { size: 42, color: "#3b82f6" }),
                h("h2", null, "Browser storage is unavailable"),
                h("p", null, "GST Billing saves records in this browser profile. Check that site storage is enabled, close other GST Billing tabs, and reload the page."),
                h("p", { className: "server-down-safe" }, "Your saved records are not intentionally deleted by this message. If the issue continues, export or restore a backup after storage becomes available."),
                h("button", { type: "button", className: "btn btn-primary", onClick: () => window.location.reload() }, "Reload app")));
    }
    if (showWelcome) {
        return (h(Fragment, null,
            h(WelcomeGuide, { onComplete: (p) => {
                    if (p)
                        setProfile(p);
                    setShowWelcome(false);
                } }),
            h(WhatsNewAfterUpdate, { blocked: true }),
            h(ToastContainer, null),
            h(ConfirmModalContainer, null)));
    }
    return (h("div", { className: `app-layout${sidebarAutoHide ? ' sidebar-autohide' : ''}` },
        h(WhatsNewAfterUpdate, { blocked: showWelcome }),
        h("div", { className: "mobile-topbar" },
            h("button", { type: "button", className: "mobile-topbar-btn", onClick: () => setNavOpen(true), "aria-label": anyDot ? `Open menu: ${anyDot.text}` : 'Open menu', title: anyDot?.text, "aria-expanded": navOpen },
                h(Menu, { size: 22 }),
                h(NavDot, { dot: anyDot })),
            h("span", { className: "mobile-topbar-title" }, "GST Billing"),
            h("span", { className: "mobile-topbar-business" }, profile?.businessName || ''),
            searchBox,
            topActions),
        navOpen && h("div", { className: "sidebar-backdrop", onClick: () => setNavOpen(false), "aria-hidden": "true" }),
        h("div", { className: `sidebar${navOpen ? ' sidebar-open' : ''}`, onClick: closeNavAfterPick },
            h("div", { className: "sidebar-brand" },
                h("div", { className: `sidebar-logo${ownBrand && brand.logo ? ' sidebar-logo-own' : ''}` }, ownBrand && brand.logo ? h("img", { src: brand.logo, alt: "" })
                    : ownBrand ? h("span", { className: "sidebar-logo-letter" }, brand.businessName.trim().charAt(0).toUpperCase())
                        : h(FileText, { size: 22 })),
                h("div", { className: "sidebar-brand-text" },
                    h("h2", { className: `sidebar-title${ownBrand ? ' sidebar-title-own' : ''}`, title: ownBrand ? `${brand.businessName} - GST Billing` : undefined }, ownBrand ? brand.businessName : 'GST Billing'),
                    h("p", { className: "sidebar-subtitle" }, "by DiceCodes")),
                h("button", { type: "button", className: `sidebar-autohide-toggle${sidebarAutoHide ? ' on' : ''}`, "aria-pressed": sidebarAutoHide, "aria-label": "Auto-hide menu", title: sidebarAutoHide ? 'Keep this menu open' : 'Auto-hide this menu: icons only, it opens when you point at it', onClick: (e) => { e.stopPropagation(); toggleSidebarAutoHide(!sidebarAutoHide); } },
                    h(Menu, { size: 18 }))),
            h("div", { className: "profile-switcher", ref: profileMenuRef, style: { position: 'relative' } },
                h("div", { className: "profile-switcher-row" },
                    h("button", { className: "profile-switcher-btn", onClick: () => setShowProfileMenu(v => !v), title: shownProfiles.length > 1 || anyHidden ? 'Switch business, or edit its details' : 'Edit business details', "aria-haspopup": "menu", "aria-expanded": showProfileMenu },
                        h(Building2, { size: 14 }),
                        h("span", { className: "profile-switcher-name" }, profile?.businessName || 'My Business'),
                        h(ChevronDown, { size: 13, style: { marginLeft: 'auto', opacity: 0.6 } })),
                    h("button", { type: "button", className: "profile-switcher-edit", onClick: () => { setShowProfileMenu(false); setShowMenuEditor(true); }, title: "Customise menu", "aria-label": "Customise menu" },
                        h(Pencil, { size: 13 }))),
                showProfileMenu && (h("div", { className: "profile-switcher-menu" },
                    shownProfiles.map(bp => (h("button", { key: bp.id || bp.businessName, className: `profile-switcher-item${bp.businessName?.trim().toLowerCase() === profile?.businessName?.trim().toLowerCase() ? ' active' : ''}`, onClick: () => handleSwitchProfile(bp) }, bp.businessName))),
                    h("button", { className: "profile-switcher-item profile-switcher-details", onClick: () => { setShowProfileMenu(false); openSettingsSection('section-company'); } },
                        h(Pencil, { size: 13 }),
                        " Edit business details"),
                    anyHidden && (h("button", { className: "profile-switcher-item profile-switcher-manage", onClick: openHidden }, "Open a hidden company...")),
                    h("button", { className: "profile-switcher-item profile-switcher-manage", onClick: () => { setShowProfileMenu(false); setCurrentView('settings'); } }, "Manage profiles...")))),
            h("nav", { className: "sidebar-nav" },
                h(SidebarMenu, { items: navItems.filter(i => !menuHidden.includes(i.id)), currentView: currentView, dots: dots, onPick: (item) => (item.onClick ? item.onClick() : setCurrentView(item.id)) }),
                h("div", { style: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
                    updateBannerVisible && (h("button", { className: "nav-btn", onClick: () => setShowUpdateModal(true), title: `v${updateInfo.latest} is available`, style: {
                            background: 'var(--info-bg)',
                            borderColor: 'var(--info-border)',
                            color: 'var(--info-text)',
                            fontWeight: 600,
                            position: 'relative',
                        } },
                        h(Download, { size: 18 }),
                        h("span", { style: { flex: 1, textAlign: 'left' } },
                            "Update to v",
                            updateInfo.latest),
                        h("span", { style: {
                                width: 8, height: 8, borderRadius: '50%',
                                background: '#f59e0b', boxShadow: '0 0 0 3px rgba(245,158,11,0.25)',
                                flexShrink: 0,
                            } }))),
                    bottomIds.filter(id => !menuHidden.includes(id)).map(id => ({
                        settings: (h("button", { key: id, className: `nav-btn ${currentView === 'settings' ? 'nav-btn-active' : ''}`, onClick: () => setCurrentView('settings'), title: dots.settings?.text },
                            h(Settings, { size: 18 }),
                            " Settings",
                            h(NavDot, { dot: dots.settings }))),
                    })[id])))),
        showMenuEditor && (h(MenuCustomise, { extras: menuExtras, onClose: () => setShowMenuEditor(false), onOpenFeatures: () => { setShowMenuEditor(false); openSettingsSection('section-modules'); } })),
        h("div", { className: "main-content" },
            h("div", { className: "app-topbar", ref: barRef },
                h("div", { className: "page-bar-title", ref: setBarTitleEl }),
                searchBox,
                h("div", { className: "page-bar-actions", ref: setBarActionsEl }),
                h("div", { className: "topbar-global" }, topActions)),
            h(PageBarSlots.Provider, { value: barSlots },
                h(ErrorBoundary, { key: currentView, onHome: () => setCurrentView('dashboard') },
                    currentView !== 'new' && h(StarBanner, null),
                    currentView === 'dashboard' && (h(Dashboard, { onNew: handleNewInvoice, onEdit: handleEditInvoice, onPrint: handlePrintInvoice, onDuplicate: handleDuplicateInvoice, onConvert: handleConvertToInvoice, onOpenProducts: () => setCurrentView('inventory'), onOpenPurchases: () => setCurrentView('purchases'), onOpenSettings: () => setCurrentView('settings'), activeProfile: profile })),
                    currentView === 'new' && (h(InvoiceGenerator, { key: editorKey, onBack: () => { setEditingBill(null); setCurrentView('dashboard'); }, profile: profile, editingBill: editingBill })),
                    h(Suspense, { fallback: h(ViewLoading, null) },
                        currentView === 'clients' && (h(ClientsView, { key: businessKey, onNew: handleNewInvoice, onNewFor: handleNewInvoiceFor, onRecordPayment: handleRecordPaymentFor, onEdit: handleEditInvoice, onDuplicate: handleDuplicateInvoice, onPrint: handlePrintInvoice })),
                        currentView === 'inventory' && (
                        // v1.10.83 (#115) - remounted per business, like the screens below, so its production list follows the switch.
                        h(InventoryView, { key: businessKey, onOpenPurchases: () => setCurrentView('purchases') })),
                        currentView === 'expenses' && (h(ExpenseTracker, { key: businessKey })),
                        currentView === 'purchases' && (h(PurchaseBills, { key: businessKey, onOpenGstReturns: () => setCurrentView('filing') })),
                        currentView === 'recurring' && (h(RecurringInvoices, { key: businessKey, onEdit: handleEditInvoice })),
                        currentView === 'receipts' && (h(ReceiptVoucher, { key: businessKey })),
                        currentView === 'cashbook' && (h(CashBook, { key: businessKey, onOpenView: setCurrentView })),
                        currentView === 'reports' && (h(ReportsView, { key: businessKey })),
                        currentView === 'filing' && (h(GSTReturns, { key: businessKey, onOpenPurchases: () => setCurrentView('purchases') })),
                        currentView === 'incometax' && (h(IncomeTax, { key: businessKey })),
                        currentView === 'settings' && (h(SettingsView, { onSaved: (p) => setProfile(p) })),
                        currentView === 'support' && (null)),
                    currentView === 'dashboard' && null))),
        showNotifs && (h("div", { className: "modal-overlay", onClick: () => setShowNotifs(false) },
            h("div", { className: "modal-content", style: { maxWidth: '480px' }, onClick: e => e.stopPropagation() },
                h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' } },
                    h("h3", { className: "section-title", style: { margin: 0 } },
                        "Notifications ",
                        h(HelpButton, { title: "Notifications", doc: "shortcuts#notifications", size: 16 })),
                    h("span", { style: { display: 'flex', alignItems: 'center', gap: '0.35rem' } },
                        dismissableCount > 0 && (h("button", { type: "button", className: "btn", onClick: markAllNotifsRead, style: { fontSize: '0.78rem', padding: '0.3rem 0.6rem' }, title: "Clear these notifications. They return if something new happens." }, "Mark all as read")),
                        h("button", { className: "icon-btn", onClick: () => setShowNotifs(false), title: "Close" },
                            h(X, { size: 18 })))),
                notifTotal === 0 ? (h("p", { style: { textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem 0', margin: 0 } }, "All clear \u2728 \u2014 nothing needs your attention right now.")) : (h("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem' } },
                    isLive('autoFire') && (h("button", { type: "button", className: "notice notice-info", onClick: () => { setShowNotifs(false); setCurrentView('dashboard'); }, style: { cursor: 'pointer', border: 'none', textAlign: 'left' } },
                        h("span", { className: "notice-icon" }, "\uD83D\uDD01"),
                        h("div", { style: { flex: 1 } },
                            h("strong", null,
                                notifications.autoFire.count,
                                " recurring invoice",
                                notifications.autoFire.count !== 1 ? 's' : '',
                                " auto-generated today"),
                            h("div", { style: { fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' } }, "Check the Dashboard for the new bills \u00B7 review and download PDFs as needed")))),
                    isLive('recurringDue') && (h("button", { type: "button", className: "notice notice-warn", onClick: () => { setShowNotifs(false); setCurrentView('recurring'); }, style: { cursor: 'pointer', border: 'none', textAlign: 'left' } },
                        h("span", { className: "notice-icon" }, "\uD83D\uDD01"),
                        h("div", { style: { flex: 1 } },
                            h("strong", null,
                                notifications.recurringDue.length,
                                " recurring invoice",
                                notifications.recurringDue.length !== 1 ? 's' : '',
                                " due to be made"),
                            h("div", { style: { fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' } },
                                notifications.recurringDue.slice(0, 3).map(t => t.clientName || 'No client').join(' · '),
                                " \u00B7 open Recurring and use Generate Now")))),
                    isLive('overdue') && (h("button", { type: "button", className: "notice notice-danger", onClick: () => { setShowNotifs(false); setCurrentView('dashboard'); }, style: { cursor: 'pointer', border: 'none', textAlign: 'left' } },
                        h("span", { className: "notice-icon" }, "\u26A0"),
                        h("div", { style: { flex: 1 } },
                            h("strong", null,
                                notifications.overdue.length,
                                " overdue invoice",
                                notifications.overdue.length !== 1 ? 's' : ''),
                            h("div", { style: { fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' } },
                                notifications.overdue.slice(0, 3).map(b => b.invoiceNumber).join(' · '),
                                notifications.overdue.length > 3 ? ` · +${notifications.overdue.length - 3} more` : '')))),
                    isLive('dueSoon') && (h("button", { type: "button", className: "notice notice-warn", onClick: () => { setShowNotifs(false); setCurrentView('dashboard'); }, style: { cursor: 'pointer', border: 'none', textAlign: 'left' } },
                        h("span", { className: "notice-icon" }, "\u23F0"),
                        h("div", { style: { flex: 1 } },
                            h("strong", null,
                                notifications.dueSoon.length,
                                " invoice",
                                notifications.dueSoon.length !== 1 ? 's' : '',
                                " due in next 3 days"),
                            h("div", { style: { fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' } }, notifications.dueSoon.slice(0, 3).map(b => `${b.invoiceNumber} (${b.clientName})`).join(' · '))))),
                    isLive('filings') && (h("button", { type: "button", className: "notice notice-info", onClick: () => { setShowNotifs(false); setCurrentView('filing'); }, style: { cursor: 'pointer', border: 'none', textAlign: 'left' } },
                        h("span", { className: "notice-icon" }, "\uD83D\uDCCB"),
                        h("div", { style: { flex: 1 } },
                            h("strong", null,
                                notifications.filings.length,
                                " GST filing",
                                notifications.filings.length !== 1 ? 's' : '',
                                " due in next 10 days"),
                            h("div", { style: { fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' } }, notifications.filings.slice(0, 3).map(f => `${f.label} (${f.daysAway === 0 ? 'today' : f.daysAway + 'd'})`).join(' · '))))),
                    isLive('lowStock') && (h("button", { type: "button", className: "notice notice-note", onClick: () => { setShowNotifs(false); setCurrentView('inventory'); }, style: { cursor: 'pointer', border: 'none', textAlign: 'left' } },
                        h("span", { className: "notice-icon" }, "\uD83D\uDCE6"),
                        h("div", { style: { flex: 1 } },
                            h("strong", null,
                                notifications.lowStock.length,
                                " product",
                                notifications.lowStock.length !== 1 ? 's' : '',
                                " low on stock"),
                            h("div", { style: { fontSize: '0.72rem', opacity: 0.85, marginTop: '0.2rem' } }, notifications.lowStock.slice(0, 3).map(p => `${p.name} (${trackedStock(p)} left)`).join(' · ')))))))))),
        showPalette && (h(Suspense, { fallback: null },
            h(QuickSearch, { onClose: () => setShowPalette(false), navItems: navItems, topIds: topIds, updateInfo: null, onNewInvoice: handleNewInvoice, onEditInvoice: handleEditInvoice, onView: setCurrentView, onSettings: openSettingsSection, onDarkMode: () => setDarkMode(d => !d), onShortcuts: () => setShowShortcutsHelp(true), onUpdate: () => { } }))),
        showShortcutsHelp && (h("div", { className: "modal-overlay", onClick: () => setShowShortcutsHelp(false) },
            h("div", { className: "modal-content", style: { maxWidth: '480px' }, onClick: e => e.stopPropagation() },
                h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' } },
                    h("h3", { className: "section-title", style: { margin: 0 } },
                        "Keyboard Shortcuts ",
                        h(HelpButton, { title: "Keyboard shortcuts", doc: "shortcuts#keyboard", size: 16 })),
                    h("button", { className: "icon-btn", onClick: () => setShowShortcutsHelp(false), title: "Close" },
                        h(X, { size: 18 }))),
                h("table", { className: "kv-list" },
                    h("tbody", null,
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "K")),
                            h("td", null, "Search or jump to a page (the search box at the top)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "N")),
                            h("td", null, "New invoice (when not typing in a box)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "S")),
                            h("td", null, "Save the invoice (on New Invoice)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "P")),
                            h("td", null, "Download the PDF (on New Invoice)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "Enter")),
                            h("td", null, "Add an item row (on New Invoice)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "Shift"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "D")),
                            h("td", null, "Copy the last item row (on New Invoice)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "Shift"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "F")),
                            h("td", null, "Hide or show the preview (on New Invoice)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "Shift"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "L")),
                            h("td", null, "Lock the app (when a PIN is set)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "/")),
                            h("td", null, "Show or hide this list")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Esc")),
                            h("td", null, "Close any open modal")))),
                h("p", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 } },
                    "On macOS, use ",
                    h("kbd", null, "\u2318"),
                    " instead of ",
                    h("kbd", null, "Ctrl"),
                    ".")))),
        showUpdateModal && updateInfo && (h("div", { className: "modal-overlay", onClick: () => setShowUpdateModal(false) },
            h("div", { className: "modal-content", style: { maxWidth: '640px' }, onClick: e => e.stopPropagation() },
                h("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' } },
                    h("div", null,
                        h("h3", { className: "section-title", style: { marginTop: 0, marginBottom: '0.25rem' } },
                            "Update available \u2014 v",
                            updateInfo.latest,
                            " ",
                            h(HelpButton, { title: "Updating the app", doc: "update#update-window", size: 16 })),
                        h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 } },
                            "You're on v",
                            updateInfo.current,
                            updateInfo.releasePublishedAt && ` · released ${new Date(updateInfo.releasePublishedAt).toLocaleDateString()}`)),
                    h("button", { className: "icon-btn", onClick: () => setShowUpdateModal(false), title: "Close" },
                        h(X, { size: 18 }))),
                h("div", { className: "notice notice-info", style: { marginBottom: '0.85rem' } },
                    h("span", { className: "notice-icon" }, "\uD83D\uDD12"),
                    h("div", null,
                        h("strong", null, "Your data is safe."),
                        " Updates only refresh the app code and dependencies \u2014 your ",
                        h("code", null, "data/"),
                        " folder (invoices, clients, products, settings) and ",
                        h("code", null, "Saved Invoices/"),
                        " PDF archive are ",
                        h("strong", null, "never touched"),
                        ". The updater downloads this release from GitHub, backs up your data, puts the new version in place and restarts the app.")),
                h("div", { className: "surface-card", style: { maxHeight: '320px', overflowY: 'auto', fontSize: '0.82rem', lineHeight: 1.55, marginBottom: '0.85rem' } }, releaseNoteTitles(updateInfo.releaseNotes).length > 0 ? (h(Fragment, null,
                    h("strong", { style: { display: 'block', marginBottom: '0.35rem' } },
                        "What's new in v",
                        updateInfo.latest),
                    h("ul", { style: { margin: 0, paddingLeft: '1.2rem' } }, releaseNoteTitles(updateInfo.releaseNotes).map((t) => h("li", { key: t, style: { marginBottom: '0.2rem' } }, t))),
                    h("a", { href: updateInfo.releaseUrl || 'https://github.com/IamRamgarhia/Free-GST-Billing-Software/releases/latest', target: "_blank", rel: "noopener noreferrer", style: { display: 'inline-block', marginTop: '0.5rem', color: 'var(--primary)' } }, "Read the full notes on GitHub"))) : updateInfo.releaseNotes ? h("div", { style: { whiteSpace: 'pre-wrap' } }, updateInfo.releaseNotes) : (h("span", { style: { color: 'var(--text-muted)' } },
                    "No release notes available \u2014 see the full changelog at",
                    ' ',
                    h("a", { href: updateInfo.releaseUrl || 'https://github.com/IamRamgarhia/Free-GST-Billing-Software/releases', target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--primary)' } }, "GitHub Releases"),
                    "."))),
                h("div", { className: "notice notice-warn", style: { marginBottom: '1rem' } },
                    h("span", { className: "notice-icon" }, "\uD83D\uDCA1"),
                    h("div", null,
                        h("strong", null, "Recommended:"),
                        " export a backup before updating, just in case. ",
                        h("button", { type: "button", className: "btn-link", onClick: () => { setShowUpdateModal(false); openSettingsSection('section-data'); }, style: { background: 'none', border: 0, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 } }, "Open Settings \u2192 Data & Backups"),
                        " and click ",
                        h("em", null, "Export Backup\u2026"),
                        ".")),
                h("div", { className: "flex gap-2 justify-end", style: { flexWrap: 'wrap' } },
                    h("button", { type: "button", className: "btn btn-secondary", onClick: dismissUpdate }, "Skip this version"),
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => setShowUpdateModal(false) }, "Remind me later"),
                    updateInfo.releaseUrl && (h("a", { href: updateInfo.releaseUrl, target: "_blank", rel: "noopener noreferrer", className: "btn btn-secondary", style: { textDecoration: 'none' } }, "View on GitHub")),
                    updateInfo.downloadUrl && (h("a", { href: updateInfo.downloadUrl, target: "_blank", rel: "noopener noreferrer", className: "btn btn-primary", style: { textDecoration: 'none' } },
                        h(Download, { size: 16 }),
                        " Download the new Mac app")),
                    !updateInfo.updateHint && (h("button", { type: "button", className: "btn btn-primary", disabled: updating, onClick: handleUpdateNow },
                        h(Download, { size: 16 }),
                        " ",
                        updating ? 'Updating…' : 'Update Now'))),
                !notifyAsked && canAskToNotify() && (h("p", { style: { fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 } },
                    h("button", { type: "button", className: "btn-link", onClick: () => { setNotifyAsked(true); askToNotify(updateInfo.latest); }, style: { background: 'none', border: 0, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 } }, "Tell me with a Windows notification when the next update comes out"))),
                h("p", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.6rem', marginBottom: 0 } }, updateInfo.updateHint || h(Fragment, null,
                    h("em", null, "Update Now"),
                    " backs up your data, then fetches the newest release. It takes about a minute \u2014 leave this window open; the app opens again on the new version by itself."))))),
        h(ToastContainer, null),
        h(ConfirmModalContainer, null),
        h(UpdateOverlay, null)));
}
export default App;
