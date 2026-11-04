import { useState, useEffect, useRef, useMemo, lazy, Suspense, h, Fragment } from './vanilla/dom.js';
import { Home, FileText, Settings, Plus, Users, Package, BarChart3, Wallet, RefreshCw, Receipt, BookOpen, Moon, Sun, Download, X, ShoppingCart, ChevronDown, Building2, Pencil, HelpCircle, Search, Command, Bell, Calculator, Menu, Banknote } from './vanilla/icons.js';
import { getProfile, getAllProfiles, saveProfile, getEnabledModules, getMenuOrder, onMenuChanged, getAllBills, getAllProducts, getStockAlertSettings, getAllClients, runUpdateNow, getLockStatus } from './store.js';
import { isModuleEnabled, getUpcomingFilings, countsAsSales, localToday, toLocalIsoDate, DOCS_URL, findLowStock, trackedStock } from './utils.js';
import { orderedMenu } from './utils/businessTypes.js';
// v1.10.4 — Route-level lazy loading. Prior App.js synchronously
// imported all 12 views (~15k LOC combined), so a first-paint on
// Dashboard downloaded and parsed GSTReturns (1952), InvoiceGenerator
// (2409), IncomeTax (1038), SettingsView (1479), PrintSettings (1294)
// etc. before the user even asked for them.
//
// Now:
//  - Dashboard stays eager — it's the default landing route.
//  - InvoiceGenerator stays eager — new-invoice is the primary action
//    reachable from Ctrl+K / manifest shortcut / big blue button.
//  - Every other view is deferred view loader → own JavaScript module → fetched on
//    first navigation only. Suspense fallback is a lightweight spinner.
// Result: smaller initial JS payload; each heavy view chunk-caches
// once fetched.
import Dashboard from './components/Dashboard.js';
import InvoiceGenerator from './components/InvoiceGenerator.js';
import SetupWizard from './components/SetupWizard.js';
import ToastContainer, { toast } from './components/Toast.js';
import ErrorBoundary from './components/ErrorBoundary.js';
import ConfirmModalContainer from './components/ConfirmModal.js';
import WelcomeGuide from './components/WelcomeGuide.js';
const SettingsView = lazy(() => import('./components/SettingsView.js'));
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
import LockButton from './components/LockButton.js';
import OfflineModeButton from './components/OfflineModeButton.js';
import { isOfflineMode } from './utils/offlineMode.js';
import HelpButton from './components/HelpButton.js';
import { lockNow } from './utils/appLock.js';
import { getPrintSettings } from './utils/printSettings.js';
const openDocs = () => window.open(DOCS_URL, '_blank', 'noopener,noreferrer');
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
function App() {
    // v1.9.3 — Setup Wizard shown on first-run (before onboardingComplete = true)
    const [showWizard, setShowWizard] = useState(() => {
        try {
            return !getPrintSettings().onboardingComplete;
        }
        catch {
            return false;
        }
    });
    const [currentView, setCurrentView] = useState(() => {
        // PWA manifest "shortcuts" deep-link in via ?view=X (e.g. right-clicking
        // the pinned taskbar icon → "New Invoice" opens /?view=new). Honour that
        // before falling back to whatever the user was last looking at.
        try {
            const params = new URLSearchParams(window.location.search);
            const v = params.get('view');
            const valid = ['dashboard', 'new', 'clients', 'inventory', 'expenses', 'purchases', 'recurring', 'receipts', 'cashbook', 'reports', 'filing', 'incometax', 'settings'];
            if (v && valid.includes(v)) {
                // Strip the query string so a refresh doesn't keep snapping back to
                // the shortcut target — only the *first* navigation honours it.
                window.history.replaceState({}, '', window.location.pathname);
                return v;
            }
        }
        catch { /* sandboxed history API — fall through */ }
        // 'guide' was the built-in User Guide (removed in v1.10.75).
        const last = sessionStorage.getItem('gst_currentView');
        return last && last !== 'guide' && last !== 'support' ? last : 'dashboard';
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
    const [allProfiles, setAllProfiles] = useState([]);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const profileMenuRef = useRef(null);
    // Update notification state. Auto-checks GitHub on mount + every 6h.
    // The user can dismiss a specific version (stored in localStorage) so the
    // banner doesn't keep nagging once they've seen it. A NEW version released
    // after that dismissal will re-show the banner.
    const [updateInfo, setUpdateInfo] = useState(null);
    const [showUpdateModal, setShowUpdateModal] = useState(false);
    const updateBannerVisible = updateInfo?.updateAvailable
        && localStorage.getItem('freegstbill_dismissedUpdate') !== updateInfo.latest;
    useEffect(() => {
        let cancelled = false;
        const check = async () => {
            // The browser-local adapter skips this when Offline mode is on; releases
            // are checked directly against the public GitHub releases API.
            if (isOfflineMode())
                return;
            try {
                const res = await fetch('/api/check-update');
                const data = await res.json();
                if (!cancelled)
                    setUpdateInfo(data);
            }
            catch { /* offline — quietly skip */ }
        };
        // First check ~5 seconds after mount so it doesn't fight the initial load.
        const initial = setTimeout(check, 5000);
        // Then re-check every 6 hours while the app is open.
        const interval = setInterval(check, 6 * 60 * 60 * 1000);
        return () => { cancelled = true; clearTimeout(initial); clearInterval(interval); };
    }, []);
    // ---- Notification centre ----
    // Computed from locally stored data on app boot + every 10 minutes; tucked under a
    // bell icon next to dark-mode toggle in the sidebar. Each section is one
    // click away from the relevant page.
    const [notifications, setNotifications] = useState({ overdue: [], dueSoon: [], lowStock: [], filings: [], autoFire: null });
    const [showNotifs, setShowNotifs] = useState(false);
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
    }), [notifications]);
    // A section counts toward the badge only when it has content AND that
    // content is not the exact thing the user already dismissed.
    const isLive = (key) => !!notifSignatures[key] && dismissed[key] !== notifSignatures[key];
    const notifTotal = (isLive('overdue') ? notifications.overdue.length : 0)
        + (isLive('dueSoon') ? notifications.dueSoon.length : 0)
        + (isLive('lowStock') ? notifications.lowStock.length : 0)
        + (isLive('filings') ? notifications.filings.length : 0)
        + (isLive('autoFire') ? 1 : 0);
    // How many sections are currently showing something that could be cleared.
    const dismissableCount = ['overdue', 'dueSoon', 'lowStock', 'filings', 'autoFire']
        .filter(isLive).length;
    const markAllNotifsRead = () => {
        const next = { ...dismissed, ...notifSignatures };
        setDismissed(next);
        try {
            localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
        }
        catch { /* private mode */ }
    };
    useEffect(() => {
        let cancelled = false;
        const compute = async () => {
            try {
                const [bills, products, stockAlertCfg] = await Promise.all([
                    getAllBills().catch(() => []),
                    getAllProducts().catch(() => []),
                    getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
                ]);
                if (cancelled)
                    return;
                // Local dates: toISOString() is UTC (yesterday in India until 05:30),
                // while the browser adapter stamps lastRecurringAutoFire with local date.
                const today = localToday();
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 3);
                const tomorrowStr = toLocalIsoDate(tomorrow);
                // v1.10.67 (#66 item 12) — never chase payment for a cancelled invoice;
                // nor for a quotation, proforma, challan or credit note (countsAsSales).
                const overdue = bills.filter(b => {
                    const d = b.data?.details?.dueDate;
                    return d && d < today && b.status !== 'paid' && countsAsSales(b);
                });
                const dueSoon = bills.filter(b => {
                    const d = b.data?.details?.dueDate;
                    return d && d >= today && d <= tomorrowStr && b.status !== 'paid' && countsAsSales(b);
                });
                // Honour the user's stock-alert preferences. When disabled, the filter
                // returns nothing — bell badge drops to 0 for the stock category.
                // When enabled, use the configured threshold (default 5).
                const stockThreshold = Number(stockAlertCfg?.threshold ?? 5);
                const lowStock = stockAlertCfg?.enabled === false
                    ? []
                    : findLowStock(products, stockThreshold); // services and uncounted left out (#121)
                const filings = getUpcomingFilings().filter(f => f.daysAway <= 10);
                // Recurring auto-fire breadcrumb — set by the browser adapter on workspace startup.
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
                setNotifications({ overdue, dueSoon, lowStock, filings, autoFire });
            }
            catch { /* offline / server down — leave previous counts */ }
        };
        compute();
        const interval = setInterval(compute, 10 * 60 * 1000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [currentView]); // recompute on view change so the bell stays fresh after the user records a payment
    // ---- Keyboard shortcuts + command palette ----
    // Ctrl+K opens a Spotlight-style command palette; Ctrl+N starts a new
    // invoice from anywhere; Ctrl+/ shows the full shortcuts list. Ctrl+S /
    // Ctrl+P live in InvoiceGenerator (they need invoice-form context). All
    // global handlers also accept Meta (⌘) for macOS users.
    const [showPalette, setShowPalette] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [paletteIdx, setPaletteIdx] = useState(0);
    // v1.9.4 — pre-load searchable content so Ctrl+K acts as a true global
    // search across invoices, clients, products, and settings sections.
    // Small cost (fires once on mount + when palette opens); big UX win.
    const [searchCorpus, setSearchCorpus] = useState({ bills: [], clients: [], products: [] });
    useEffect(() => {
        Promise.all([
            getAllBills().catch(() => []),
            getAllClients().catch(() => []),
            getAllProducts().catch(() => []),
        ]).then(([bills, clients, products]) => {
            setSearchCorpus({
                bills: bills.slice(0, 100),
                clients: clients.slice(0, 200),
                products: products.slice(0, 200),
            });
        });
    }, [showPalette]); // refresh when palette opens
    const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
    // Palette useMemo + dependent effects are declared further down, AFTER
    // `navItems` and `handleNewInvoice` exist. Declaring them up here would
    // throw "Cannot access 'X' before initialization" at render time because
    // useMemo's dependency array is evaluated synchronously every render.
    // v1.10.69 - see runUpdateNow() in store.js for why this is no longer a link.
    const [updating, setUpdating] = useState(false);
    const handleUpdateNow = async () => {
        setUpdating(true);
        toast('Opening the latest GitHub release. The site owner deploys browser-app updates.', 'info', 8000);
        const result = await runUpdateNow();
        setUpdating(false);
        if (result.ok) {
            toast('GitHub Releases opened. Refresh after a new build is deployed to this site.', 'success', 10000);
        }
        else {
            toast(`Update failed — ${result.error}`, 'error', 10000);
        }
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
    // Load the active business profile and saved profile switcher from the
    // IndexedDB-backed browser data adapter. There is no application server heartbeat.
    useEffect(() => {
        let cancelled = false;
        Promise.all([getProfile(), getAllProfiles()]).then(([active, profiles]) => {
            if (cancelled) return;
            setProfile(active || null);
            setAllProfiles(Array.isArray(profiles) ? profiles : []);
            if (!active?.businessName && !localStorage.getItem('freegstbill_onboarded')) setShowWelcome(true);
        }).catch((error) => {
            if (!cancelled) toast(`Could not load your local billing workspace: ${error?.message || 'Please reload the app.'}`, 'error', 10000);
        });
        return () => { cancelled = true; };
    }, []);
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
    }, [darkMode]);
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
    const handleSwitchProfile = async (bp) => {
        setShowProfileMenu(false);
        const loaded = { ...bp };
        delete loaded.id;
        await saveProfile(loaded);
        setProfile(loaded);
    };
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
        if (picked && !picked.classList.contains('profile-switcher-btn'))
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
    const handleConvertToInvoice = (bill) => {
        setEditorKey((k) => k + 1);
        sessionStorage.removeItem('gst_invoiceDraft');
        const clone = JSON.parse(JSON.stringify(bill));
        clone._isDuplicate = true;
        clone._convertToType = 'tax-invoice';
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
    // Sidebar items in the saved order; hidden ones dropped. `module: null`
    // items (Settings and Lock app) are always shown.
    const menu = orderedMenu(getMenuOrder()).filter(m => !m.module || showIfModule(m.module));
    // If the user just disabled the module backing the current view, kick them to dashboard
    // so they don't land on an empty page after toggling.
    useEffect(() => {
        const map = { new: 'invoicing', clients: 'clients', inventory: 'inventory', expenses: 'expenses', purchases: 'purchases', recurring: 'recurring', receipts: 'receipts', cashbook: 'cashBook', reports: 'reports', filing: 'gstReturns', incometax: 'incomeTax' };
        const moduleForView = map[currentView];
        if (moduleForView && !isModuleEnabled(moduleForView, enabledModules)) {
            setCurrentView('dashboard');
        }
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
        // v1.10.75 - opens the online documentation, which covers every screen
        // and stays current; the old built-in guide had fallen far behind.
        guide: { icon: HelpCircle, label: 'User Guide', onClick: openDocs },
    };
    const navItems = menu.filter(m => m.section === 'main').map(m => ({ id: m.id, ...NAV_EXTRAS[m.id] }));
    const bottomIds = menu.filter(m => m.section === 'bottom').map(m => m.id);
    // v1.10.83 - small buttons at the top right of every screen (asked for:
    // "dark mode button should be on top, not in the sidebar").
    const topIds = menu.filter(m => m.section === 'top').map(m => m.id);
    // v1.10.83 - the business's own name and logo at the top of the menu, when
    // it says so (Settings → Branding, or the first-run setup).
    // The profile comes from the local browser data adapter after first paint; until
    // then the menu uses the name and logo it showed last time (kept in this
    // browser), so a refresh does not flash "GST Billing" before the logo.
    const brand = profile || menuBrandCache;
    const ownBrand = !!brand?.showInMenu && !!String(brand?.businessName || '').trim();
    const topActions = topIds.map(id => ({
        guide: (h("button", { key: id, type: "button", className: "topbar-btn", onClick: openDocs, title: "User guide (opens in your browser)", "aria-label": "User guide" },
            h(HelpCircle, { size: 18 }))),
        /* Opens the list of overdue / due-soon invoices, GST filing deadlines and
           low-stock items, each a click away from the page that fixes it. */
        notifications: (h("button", { key: id, type: "button", className: "topbar-btn", onClick: () => setShowNotifs(s => !s), title: "Notifications", "aria-label": notifTotal > 0 ? `Notifications: ${notifTotal}` : 'Notifications' },
            h(Bell, { size: 18 }),
            notifTotal > 0 && h("span", { className: "topbar-badge" }, notifTotal > 99 ? '99+' : notifTotal))),
        /* v1.10.80 (#98) - only when a PIN is set. */
        lock: h(LockButton, { key: id, className: "topbar-btn", label: null }),
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
    // Command palette actions — declared here (not earlier) because the deps
    // array references `navItems` and `handleNewInvoice`, which are consts.
    // Reading a const before its declaration triggers a Temporal Dead Zone
    // ReferenceError ("Cannot access 'X' before initialization") at runtime.
    const paletteActions = useMemo(() => {
        const acts = [
            { label: 'New Invoice', hint: 'Ctrl+N', category: 'action', run: () => { handleNewInvoice(); } },
        ];
        navItems.forEach(item => {
            if (item.id === 'new')
                return; // already covered above
            acts.push({ label: `Go to ${item.label}`, hint: '', category: 'nav', run: item.onClick || (() => setCurrentView(item.id)) });
        });
        acts.push({ label: 'Go to Settings', hint: '', category: 'nav', run: () => setCurrentView('settings') });
        if (topIds.includes('guide'))
            acts.push({ label: 'Open the User Guide', hint: '', category: 'help', run: openDocs });
        acts.push({ label: 'Toggle dark mode', hint: '', category: 'action', run: () => setDarkMode(d => !d) });
        acts.push({ label: 'Show keyboard shortcuts', hint: 'Ctrl+/', category: 'help', run: () => setShowShortcutsHelp(true) });
        if (updateInfo?.updateAvailable) {
            acts.push({ label: `View update — v${updateInfo.latest}`, hint: '', category: 'update', run: () => setShowUpdateModal(true) });
        }
        // v1.9.4 — cross-app search: invoices, clients, products
        // v1.10.5 — audit H24 fix. Prior code dispatched
        // `CustomEvent('fgsb-open-bill', { detail: b.id })` but no one
        // listened for it — selecting an invoice in the palette silently
        // dropped the ID and just landed on Dashboard. Now: reuse
        // handleEditInvoice() directly, which is already the canonical way
        // to open a bill for editing (works from Dashboard row-click too).
        searchCorpus.bills.forEach(b => {
            acts.push({
                label: `📄 ${b.invoiceNumber || 'INV-?'} — ${b.clientName || 'No client'}`,
                hint: b.invoiceDate ? new Date(b.invoiceDate).toLocaleDateString('en-IN') : '',
                category: 'invoice',
                run: () => handleEditInvoice(b),
            });
        });
        searchCorpus.clients.forEach(c => {
            acts.push({
                label: `👤 ${c.name} — client${c.gstin ? ' · GSTIN: ' + c.gstin : ''}`,
                hint: c.phone || c.email || '',
                category: 'client',
                run: () => setCurrentView('clients'),
            });
        });
        // v1.10.83 - a product result opens Products, so none while it is hidden.
        if (navItems.some(i => i.id === 'inventory'))
            searchCorpus.products.forEach(p => {
                acts.push({
                    label: `📦 ${p.name} — product${p.hsn ? ' · HSN: ' + p.hsn : ''}`,
                    hint: trackedStock(p) === null ? '' : trackedStock(p) + ' in stock',
                    category: 'product',
                    run: () => setCurrentView('inventory'),
                });
            });
        // Settings sections (jump to specific area)
        // v1.10.74 - these all used to just open Settings at the top. Each now
        // names its section id; after Settings mounts (it's lazy-loaded, so retry
        // briefly) we click that section's "Jump to" chip, which already scrolls
        // below the sticky bars.
        const openSettingsAt = (sectionId) => {
            setCurrentView('settings');
            let tries = 0;
            const jump = () => {
                const chip = document.querySelector(`.settings-jumpnav a[href="#${sectionId}"]`);
                if (chip && document.getElementById(sectionId))
                    chip.click();
                else if (++tries < 30)
                    setTimeout(jump, 100);
            };
            setTimeout(jump, 50);
        };
        const settingsJumps = [
            ['Company profile', 'section-company'], ['Payment accounts', 'section-company'],
            ['Print & PDF Settings', 'section-print'], ['PDF Style Editor', 'section-print'],
            ['Business type presets', 'section-print'], ['Section labels', 'section-print'],
            ['Watermarks', 'section-print'], ['Multi-copy print', 'section-print'],
            ['Digital signature', 'section-company'], ['Company letterhead', 'section-print'],
            ['Business type', 'section-biztype'], ['Features', 'section-modules'], ['Region preference', 'section-region'],
            ['Local browser storage', 'section-cloud'], ['App updates', 'section-updates'],
        ];
        settingsJumps.forEach(([s, sectionId]) => {
            acts.push({ label: `⚙️ Settings → ${s}`, hint: '', category: 'settings', run: () => openSettingsAt(sectionId) });
        });
        return acts;
    }, [navItems, bottomIds, topIds, updateInfo, handleNewInvoice, searchCorpus]);
    const filteredPalette = paletteActions.filter(a => !paletteQuery.trim() || a.label.toLowerCase().includes(paletteQuery.toLowerCase()));
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
                setPaletteQuery('');
                setPaletteIdx(0);
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
    // Palette-only arrow / Enter / Esc nav. Filtered list dep keeps the
    // handler in sync with the user's current query.
    useEffect(() => {
        if (!showPalette)
            return;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowPalette(false);
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setPaletteIdx(i => Math.min(i + 1, filteredPalette.length - 1));
            }
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPaletteIdx(i => Math.max(i - 1, 0));
            }
            else if (e.key === 'Enter') {
                e.preventDefault();
                const action = filteredPalette[paletteIdx];
                if (action) {
                    action.run();
                    setShowPalette(false);
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showPalette, paletteIdx, filteredPalette]);
    if (showWelcome) {
        return (h(Fragment, null,
            h(WelcomeGuide, { onComplete: (p) => {
                    if (p)
                        setProfile(p);
                    setShowWelcome(false);
                } }),
            h(ToastContainer, null),
            h(ConfirmModalContainer, null)));
    }
    // v1.10.33 — "Finish setup" bottom-right pill. Shown when the user
    // hit Skip on the wizard (onboardingSkipped=true) so they can come
    // back later without hunting through Settings. Hidden after they
    // finish setup (finish() clears the flag) or if they explicitly said
    // "None of these — I'll configure manually".
    const showResumeSetupPill = (() => {
        try {
            const ps = getPrintSettings();
            return !showWizard && ps.onboardingComplete === true && ps.onboardingSkipped === true;
        }
        catch {
            return false;
        }
    })();
    return (h("div", { className: `app-layout${sidebarAutoHide ? ' sidebar-autohide' : ''}` },
        showWizard && h(SetupWizard, { onClose: () => setShowWizard(false) }),
        showResumeSetupPill && (h("button", { type: "button", onClick: () => setShowWizard(true), title: "Come back to the setup wizard \u2014 pick a business type, paper size, and language.", style: {
                // Above the docked Save bar on Settings, so it never covers Save.
                position: 'fixed', bottom: currentView === 'settings' ? '5.5rem' : '1.25rem', right: '1.25rem', zIndex: 9998,
                padding: '0.6rem 1rem', borderRadius: 999,
                background: 'var(--primary)', color: '#fff', border: 'none',
                fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(30,64,175,0.35), 0 2px 4px rgba(0,0,0,0.15)',
                display: 'flex', alignItems: 'center', gap: '0.4rem',
            } }, "\u2728 Finish setup")),
        h("div", { className: "mobile-topbar" },
            h("button", { type: "button", className: "mobile-topbar-btn", onClick: () => setNavOpen(true), "aria-label": "Open menu", "aria-expanded": navOpen },
                h(Menu, { size: 22 })),
            h("span", { className: "mobile-topbar-title" }, "GST Billing"),
            h("span", { className: "mobile-topbar-business" }, profile?.businessName || ''),
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
                    h("button", { className: "profile-switcher-btn", onClick: () => allProfiles.length > 1 && setShowProfileMenu(v => !v), title: allProfiles.length > 1 ? 'Switch business profile' : profile?.businessName || 'My Business', style: { cursor: allProfiles.length > 1 ? 'pointer' : 'default' } },
                        h(Building2, { size: 14 }),
                        h("span", { className: "profile-switcher-name" }, profile?.businessName || 'My Business'),
                        allProfiles.length > 1 && h(ChevronDown, { size: 13, style: { marginLeft: 'auto', opacity: 0.6 } })),
                    h("button", { className: "profile-switcher-edit", onClick: () => { setShowProfileMenu(false); setCurrentView('settings'); }, title: "Edit business profile" },
                        h(Pencil, { size: 13 }))),
                showProfileMenu && (h("div", { className: "profile-switcher-menu" },
                    allProfiles.map(bp => (h("button", { key: bp.id || bp.businessName, className: `profile-switcher-item${bp.businessName?.trim().toLowerCase() === profile?.businessName?.trim().toLowerCase() ? ' active' : ''}`, onClick: () => handleSwitchProfile(bp) }, bp.businessName))),
                    h("button", { className: "profile-switcher-item profile-switcher-manage", onClick: () => { setShowProfileMenu(false); setCurrentView('settings'); } }, "Manage profiles...")))),
            h("nav", { className: "sidebar-nav" },
                navItems.map(item => (h("button", { key: item.id, className: `nav-btn ${currentView === item.id ? 'nav-btn-active' : ''}`, onClick: item.onClick || (() => setCurrentView(item.id)) },
                    h(item.icon, { size: 18 }),
                    " ",
                    item.label))),
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
                    bottomIds.map(id => ({
                        settings: (h("button", { key: id, className: `nav-btn ${currentView === 'settings' ? 'nav-btn-active' : ''}`, onClick: () => setCurrentView('settings'), style: updateBannerVisible ? { position: 'relative' } : undefined },
                            h(Settings, { size: 18 }),
                            " Settings",
                            updateBannerVisible && (h("span", { className: "nav-badge", style: {
                                    position: 'absolute', top: '8px', right: '12px',
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: '#f59e0b',
                                }, title: "Update available" })))),
                    })[id])))),
        h("div", { className: "main-content" },
            h("div", { className: "app-topbar" },
                topActions),
            h(ErrorBoundary, { key: currentView, onHome: () => setCurrentView('dashboard') },
                currentView !== 'new' && h(StarBanner, null),
                currentView === 'dashboard' && (h(Dashboard, { onNew: handleNewInvoice, onEdit: handleEditInvoice, onPrint: handlePrintInvoice, onDuplicate: handleDuplicateInvoice, onConvert: handleConvertToInvoice, onOpenProducts: () => setCurrentView('inventory'), onOpenSettings: () => setCurrentView('settings'), onOpenGuide: openDocs, activeProfile: profile })),
                currentView === 'new' && (h(InvoiceGenerator, { key: editorKey, onBack: () => { setEditingBill(null); setCurrentView('dashboard'); }, profile: profile, editingBill: editingBill })),
                h(Suspense, { fallback: h(ViewLoading, null) },
                    currentView === 'clients' && (h(ClientsView, { onNew: handleNewInvoice, onEdit: handleEditInvoice, onDuplicate: handleDuplicateInvoice })),
                    currentView === 'inventory' && (
                    // v1.10.83 (#115) - remounted per business, like the screens below, so its production list follows the switch.
                    h(InventoryView, { key: businessKey })),
                    currentView === 'expenses' && (h(ExpenseTracker, { key: businessKey })),
                    currentView === 'purchases' && (h(PurchaseBills, { key: businessKey })),
                    currentView === 'recurring' && (h(RecurringInvoices, { key: businessKey, onEdit: handleEditInvoice })),
                    currentView === 'receipts' && (h(ReceiptVoucher, { key: businessKey })),
                    currentView === 'cashbook' && (h(CashBook, { key: businessKey, onOpenView: setCurrentView })),
                    currentView === 'reports' && (h(ReportsView, { key: businessKey })),
                    currentView === 'filing' && (h(GSTReturns, { key: businessKey })),
                    currentView === 'incometax' && (h(IncomeTax, { key: businessKey })),
                    currentView === 'settings' && (h(SettingsView, { onSaved: (p) => setProfile(p) })),
                ),
            )),
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
        showPalette && (h("div", { className: "modal-overlay", onClick: () => setShowPalette(false) },
            h("div", { className: "modal-content", style: { maxWidth: '520px', padding: 0, overflow: 'hidden' }, onClick: e => e.stopPropagation() },
                h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)' } },
                    h(Search, { size: 16, style: { color: 'var(--text-muted)' } }),
                    h("input", { autoFocus: true, type: "text", placeholder: "Type a command or page name\u2026", value: paletteQuery, onChange: e => { setPaletteQuery(e.target.value); setPaletteIdx(0); }, className: "form-input", style: { border: 0, background: 'transparent', flex: 1, fontSize: '0.95rem' } }),
                    h("span", { style: { fontSize: '0.7rem', color: 'var(--text-muted)' } }, "Esc")),
                h("div", { style: { maxHeight: '360px', overflowY: 'auto' } },
                    filteredPalette.length === 0 && (h("p", { style: { textAlign: 'center', color: 'var(--text-muted)', padding: '1.25rem', margin: 0, fontSize: '0.85rem' } },
                        "Nothing matches \"",
                        paletteQuery,
                        "\".")),
                    filteredPalette.map((a, i) => (h("button", { key: a.label, type: "button", onClick: () => { a.run(); setShowPalette(false); }, onMouseEnter: () => setPaletteIdx(i), style: {
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            width: '100%', padding: '0.6rem 1rem', border: 0, cursor: 'pointer',
                            background: i === paletteIdx ? 'var(--bg-tertiary)' : 'transparent',
                            color: 'var(--text-primary)', textAlign: 'left', fontSize: '0.88rem',
                        } },
                        h("span", null, a.label),
                        a.hint && h("span", { style: { fontSize: '0.7rem', color: 'var(--text-muted)' } }, a.hint))))),
                h("div", { style: { padding: '0.4rem 1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                    h("span", null,
                        h(Command, { size: 11, style: { verticalAlign: 'middle', marginRight: 4 } }),
                        "Ctrl+K to toggle \u00B7 \u2191\u2193 navigate \u00B7 Enter run ",
                        h(HelpButton, { title: "Quick search", doc: "shortcuts#command-palette", size: 16 })),
                    h("button", { type: "button", onClick: () => { setShowPalette(false); setShowShortcutsHelp(true); }, style: { background: 'none', border: 0, color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem' } }, "All shortcuts (Ctrl+/)"))))),
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
                            h("td", null, "Open command palette (jump to any page)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "N")),
                            h("td", null, "New invoice")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "S")),
                            h("td", null, "Save current invoice (when on the invoice form)")),
                        h("tr", null,
                            h("td", null,
                                h("kbd", null, "Ctrl"),
                                "\u00A0+\u00A0",
                                h("kbd", null, "P")),
                            h("td", null, "Download PDF (when on the invoice form)")),
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
                            h("td", null, "Toggle this help")),
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
                        h("code", null, "This browser / GST Billing Software /"),
                        " folder (invoices, clients, products, settings) and ",
                        h("code", null, "This browser / GST Billing Software / Invoices/"),
                        " PDF archive are ",
                        h("strong", null, "never touched"),
                        ". The website owner deploys new static builds; your local browser data stays separate. Refresh the page after a new build is published.")),
                h("div", { className: "surface-card", style: { maxHeight: '320px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: '0.82rem', lineHeight: 1.55, marginBottom: '0.85rem' } }, updateInfo.releaseNotes || (h("span", { style: { color: 'var(--text-muted)' } },
                    "No release notes available \u2014 see the full changelog at",
                    ' ',
                    h("a", { href: updateInfo.releaseUrl || 'https://github.com/IamRamgarhia/Free-GST-Billing-Software/releases', target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--primary)' } }, "GitHub Releases"),
                    "."))),
                h("div", { className: "notice notice-warn", style: { marginBottom: '1rem' } },
                    h("span", { className: "notice-icon" }, "\uD83D\uDCA1"),
                    h("div", null,
                        h("strong", null, "Recommended:"),
                        " export a backup before updating, just in case. ",
                        h("button", { type: "button", className: "btn-link", onClick: () => { setShowUpdateModal(false); setCurrentView('settings'); }, style: { background: 'none', border: 0, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: 0 } }, "Open Settings \u2192 Data Management"),
                        " and click ",
                        h("em", null, "Export Backup\u2026"),
                        ".")),
                h("div", { className: "flex gap-2 justify-end", style: { flexWrap: 'wrap' } },
                    h("button", { type: "button", className: "btn btn-secondary", onClick: dismissUpdate }, "Skip this version"),
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => setShowUpdateModal(false) }, "Remind me later"),
                    updateInfo.releaseUrl && (h("a", { href: updateInfo.releaseUrl, target: "_blank", rel: "noopener noreferrer", className: "btn btn-secondary", style: { textDecoration: 'none' } }, "View on GitHub")),
                    h("button", { type: "button", className: "btn btn-primary", disabled: updating, onClick: handleUpdateNow },
                        h(Download, { size: 16 }),
                        " ",
                        updating ? 'Opening…' : 'View Release')),
                h("p", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.6rem', marginBottom: 0 } },
                    h("em", null, "View Release"),
                    " opens the latest GitHub release in a new tab. The website owner deploys new builds; refresh this page after a new build is published.")))),
        h(ToastContainer, null),
        h(ConfirmModalContainer, null)));
}
export default App;
