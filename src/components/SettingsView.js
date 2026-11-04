import { useState, useEffect, useRef, h, Fragment } from '../vanilla/dom.js';
import { getProfile, saveProfile, exportAllData, importData, inspectBackup, getTermsTemplates, saveTermsTemplate, deleteTermsTemplate, getAllProfiles, saveBusinessProfile, deleteBusinessProfile, getRegionMode, setRegionMode, getStockAlertSettings, saveStockAlertSettings, renameNumberSeries, getInvoiceDisplayOptions, saveInvoiceDisplayOptions, getCostCentres, saveCostCentres } from '../store.js';
import { getCountryConfig, getStatesForCountry, validateTaxId, getCountriesForRegion, isModuleEnabled, getPaymentAccounts, createEmptyAccount, maskAccountNumber, reorderAccounts, setDefaultAccount, isValidUpiId, findSameBusiness, businessKeyOf, stockDelta, localToday } from '../utils.js';
import { normaliseLutArn, isLikelyLutArn, lutFyOptions, fyOf } from '../utils/lut.js';
// v1.10.36 — lucide's `Image` icon was imported as `Image`, which
// SHADOWED the browser's `HTMLImageElement` constructor. Reported:
// "Uncaught TypeError: et is not a constructor at onChange" on logo
// upload — the minified `et` was our imported image component, and
// `new Image()` inside handleImageUpload was trying to construct a
// image icon. Aliased to `ImageIcon` so `new Image()` resolves to
// the browser primitive again.
import { Save, Upload, Download, Plus, Trash2, Edit3, Image as ImageIcon, PenTool, Building2, Hash, RefreshCw, Save as SaveIcon } from '../vanilla/icons.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import PrintSettings from './PrintSettings.js';
import HelpButton from './HelpButton.js';
import AppLockSettings from './AppLockSettings.js';
import PrivacyInternet from './PrivacyInternet.js';
import CostCentreSettings from './CostCentreSettings.js';
import { BusinessTypePanel, FeaturesPanel, useFeatureDraft } from './FeatureSettings.js';
import { rekeyCentres } from '../utils/costCentres.js';
import InvoiceNumberSettings from './InvoiceNumberSettings.js';
import SignatureImages, { SIGN_LAYOUTS } from './SignatureImages.js';
import { PURPOSE_CODES } from '../utils/purposeCodes.js';
import { getBackupsList, restoreBackup, triggerBackup, deleteBackup, getTrashedBills, restoreTrashedBill, purgeTrashedBill, runUpdateNow, saveBill, applyStockChanges } from '../store.js';
// v1.10.36 — Section order for the jump-nav pill bar. Keeping this at
// module scope so the scroll-spy effect below can reference it without
// re-computing on every render.
// v1.10.83 - "Business type comes first": it decides which features show.
const JUMP_NAV_SECTIONS = [
    ['section-biztype', 'Business type'],
    ['section-company', 'Company'],
    ['section-profiles', 'Profiles'],
    ['section-terms', 'Terms'],
    ['section-print', 'Print & PDF'],
    ['section-modules', 'Features'],
    ['section-stock', 'Stock'],
    ['section-region', 'Region'],
    ['section-lock', 'App lock'],
    ['section-privacy', 'Privacy & internet'],
    ['section-backups', 'Backups'],
    ['section-cloud', 'Local storage'],
    ['section-data', 'Import/Export'],
    ['section-updates', 'Updates'],
];
// v1.10.83 - the ? button opens the guide for the tab that is open.
// Each card inside a tab has its own ? next to its title too. The docs build
// (docs-site/build.mjs) checks that every one of these exists.
const SETTINGS_TAB_DOCS = {
    'section-biztype': 'settings#business-type',
    'section-company': 'settings#company-details', 'section-profiles': 'settings#business-profiles',
    'section-terms': 'settings#terms', 'section-print': 'print-settings', 'section-modules': 'settings#features',
    'section-stock': 'settings#stock', 'section-region': 'settings#region', 'section-lock': 'settings#lock', 'section-privacy': 'security#offline-mode',
    'section-backups': 'backup#automatic-backups', 'section-cloud': 'backup#export-import', 'section-data': 'backup#export-import',
    'section-updates': 'settings#updates',
};
export default function SettingsView({ onSaved }) {
    const [profile, setProfile] = useState({
        businessName: '', address: '', state: '', gstin: '', pan: '',
        email: '', phone: '', bankName: '', accountNumber: '', ifsc: '',
        logo: '', logoHeight: 48, signature: '', signatureHeight: 60, stamp: '', stampHeight: 70, upiId: '',
    });
    // v1.10.83 - Settings is tabbed: each tab shows only its own page (asked
    // for: "instead of bigger setting pages it should load as tab pages").
    // Hidden tabs stay mounted, so an unsaved change on one tab is kept when
    // switching and the one Save bar still covers every tab. The open tab is
    // remembered for this browser session.
    const TAB_KEY = 'gst_settingsTab';
    const [activeSection, setActiveSectionState] = useState(() => {
        try {
            const saved = sessionStorage.getItem(TAB_KEY);
            if (JUMP_NAV_SECTIONS.some(([id]) => id === saved))
                return saved;
        }
        catch { /* storage blocked */ }
        return JUMP_NAV_SECTIONS[0][0];
    });
    const setActiveSection = (id) => {
        setActiveSectionState(id);
        try {
            sessionStorage.setItem(TAB_KEY, id);
        }
        catch { /* storage blocked */ }
    };
    // v1.10.55 — reported (#43, @sangwanmail-eng): "Some time details not save
    // after update in setting tab", and the title said there was no save button
    // at all.
    //
    // There is one, but the Company form runs ~450 lines of UI and its only
    // Save button sits at the very bottom. Edit your GSTIN near the top, scroll
    // on to another section, and nothing on screen tells you the change is
    // still unsaved — leave the page and it is gone.
    //
    // It reads as "sometimes" because this page mixes three persistence models
    // with no visible difference between them: Features toggles save silently
    // on click, Region saves on click and shows a toast, while Company, Invoice
    // Numbers and Terms each need their own button. Some edits stick, some
    // vanish, and the UI gives the user no way to predict which.
    //
    // Fix: track whether the profile differs from what was last persisted and
    // surface a sticky bar while it does, so the save is reachable from
    // anywhere on the page and unsaved work is never silent.
    const savedProfileRef = useRef(null);
    const [profileDirty, setProfileDirty] = useState(false);
    // v1.10.75 - the Company form stays locked until the saved profile has
    // loaded. On a slow PC, anything typed before then was silently replaced
    // when the load finished (found by the release gate on a busy machine).
    const [profileLoaded, setProfileLoaded] = useState(false);
    // Both the save bar and the "Jump to" bar stick to the top. They used to
    // share top: 0, so the save bar sat on top of the jump bar and hid it. The
    // jump bar now sticks just below the save bar, measured live because the
    // save bar wraps to two lines on narrow screens.
    // v1.10.83 - its height only set where a scrolled-to section stopped; tabs
    // open each page at the top, so that measurement went.
    const saveBarRef = useRef(null);
    // v1.10.56 — reported (#44, @sangwanmail-eng): "Firm profile setting not
    // saved. every time show popup".
    //
    // The profile was in fact saving fine. The v1.10.55 unsaved-changes
    // tracker was wrong: it recorded the on-disk baseline in handleSave only,
    // but the profile is persisted from THREE places —
    //   1. handleSave              (the Save Profile button)
    //   2. updateAccounts          (payment accounts auto-persist, v1.10.16)
    //   3. handleLoadProfile       (switching business profile)
    // After 2 or 3, the data was on disk but the baseline still held the older
    // copy, so the bar insisted there were unsaved changes forever — and the
    // beforeunload guard then threw a browser confirm dialog on every close.
    // That popup is what the user was seeing.
    //
    // Fix: one helper, called from every path that persists, so the baseline
    // can never drift from what is actually stored.
    const markProfileSaved = (p) => {
        savedProfileRef.current = JSON.stringify(p);
        setActiveBusiness(p);
        setProfileDirty(false);
    };
    // Recompute against the persisted baseline whenever the form changes.
    // Compared by value, not by "did an onChange fire", so typing a character
    // and deleting it again correctly leaves you clean.
    useEffect(() => {
        if (savedProfileRef.current === null)
            return; // profile not loaded yet
        setProfileDirty(JSON.stringify(profile) !== savedProfileRef.current);
    }, [profile]);
    // v1.10.56 — the beforeunload confirm added in v1.10.55 is GONE.
    // Even with the baseline bug fixed it was the wrong tool: it hijacks the
    // browser's own close dialog for a form the user may have no intention of
    // saving, and any future drift in the dirty check turns straight into a
    // popup on every exit. The sticky bar already makes unsaved work visible
    // without interrupting anyone.
    const [saving, setSaving] = useState(false);
    const [termsTemplates, setTermsTemplates] = useState([]);
    const [editingTemplate, setEditingTemplate] = useState(null);
    const [businessProfiles, setBusinessProfiles] = useState([]);
    // v1.10.79 - Invoice Number Format is its own component (InvoiceNumberSettings);
    // the page's "Save all" bar talks to it through this ref and two flags.
    const invNumRef = useRef(null);
    const [invNumDirty, setInvNumDirty] = useState(false);
    const [invNumSaving, setInvNumSaving] = useState(false);
    // The business this page belongs to (as saved), for its own numbering (#95).
    const [activeBusiness, setActiveBusiness] = useState(null);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    // v1.10.69 - see runUpdateNow() in store.js: this used to be a link to a URL
    // protocol that no current install registers, so it did nothing at all.
    const [updatingNow, setUpdatingNow] = useState(false);
    const handleSettingsUpdateNow = async () => {
        setUpdatingNow(true);
        toast('Opening the latest GitHub release. The site owner deploys browser-app updates.', 'info', 8000);
        const result = await runUpdateNow();
        setUpdatingNow(false);
        toast(result.ok ? 'GitHub Releases opened. Refresh after a new build is deployed to this site.' : `Could not open release page — ${result.error}`, result.ok ? 'success' : 'error', 10000);
    };
    const [regionMode, setRegionModeState] = useState(getRegionMode());
    // v1.10.83 - Business type + Features: a draft, applied by "Save all changes".
    const features = useFeatureDraft();
    const [stockAlerts, setStockAlerts] = useState({ enabled: true, threshold: 5 });
    const [stockAlertsSaving, setStockAlertsSaving] = useState(false);
    // v1.10.75 - what is on disk for the forms that have their own Save, so
    // the bottom "Save all changes" bar knows what is still unsaved.
    const [stockSaved, setStockSaved] = useState(null);
    const fileInputRef = useRef(null);
    const logoInputRef = useRef(null);
    const sigInputRef = useRef(null);
    const stampInputRef = useRef(null);
    const companyFormRef = useRef(null);
    const visibleCountries = getCountriesForRegion(regionMode);
    const handleRegionChange = (mode) => {
        setRegionModeState(mode);
        setRegionMode(mode);
        toast(`Region preference: ${mode === 'india' ? 'India only' : mode === 'international' ? 'International only' : 'Both'}`, 'success');
    };
    useEffect(() => {
        getProfile().then((p) => {
            setProfile(p);
            // Baseline for the unsaved-changes check — what is currently on disk.
            savedProfileRef.current = JSON.stringify(p);
            setActiveBusiness(p);
        }).catch(() => { }).finally(() => setProfileLoaded(true));
        loadTemplates();
        loadBusinessProfiles();
        getStockAlertSettings().then((v) => { setStockAlerts(v); setStockSaved(JSON.stringify(v)); }).catch(() => { });
    }, []);
    const loadTemplates = async () => setTermsTemplates(await getTermsTemplates());
    const loadBusinessProfiles = async () => setBusinessProfiles(await getAllProfiles());
    const handleChange = (e) => {
        const { name, value } = e.target;
        setProfile(prev => ({ ...prev, [name]: value }));
    };
    // ---- Payment Accounts manager ----
    // `editingAccount` = null ⇒ closed; an account object ⇒ form open for that
    // account; a fresh `createEmptyAccount()` ⇒ Add new flow. Saving merges back
    // into profile.paymentAccounts; profile.upiId/bankName/etc. are mirrored to
    // the DEFAULT account on save so legacy code paths and v1.4.x backups keep
    // working without a data migration.
    const [editingAccount, setEditingAccount] = useState(null);
    const [accountUpiWarning, setAccountUpiWarning] = useState('');
    const updateAccounts = (nextAccounts) => {
        // Mirror the default account's fields onto the profile's flat bank/UPI
        // fields. Means: a v1.4.x reader of the same profile.json still sees the
        // current default account's details, and the existing flat-field code
        // paths (e.g. legacy fallback in InvoicePreview) continue to work.
        const def = nextAccounts.find(a => a.isDefault) || nextAccounts[0];
        setProfile(prev => {
            const next = {
                ...prev,
                paymentAccounts: nextAccounts,
                ...(def ? {
                    bankName: def.bankName || '',
                    accountNumber: def.accountNumber || '',
                    ifsc: def.ifsc || '',
                    swift: def.swift || '',
                    upiId: def.upiId || '',
                } : {}),
            };
            // v1.10.16 — reported: "also set default is not working". Root cause:
            // this function only updated profile state via setProfile — the caller
            // was expected to click the main "Save Profile" button afterwards to
            // persist. Users clicked the ⭐ inline button, saw the star move, and
            // assumed it was saved. Reloading the page reverted it. Now every
            // account-level change (mark-default, add, delete, reorder, toggle
            // active) auto-persists to the server without needing the main Save
            // button. Fire-and-forget — the same handler that awaits saveProfile
            // in handleSave already exists for the "save everything" path.
            // v1.10.56 (#44) — refresh the baseline on success, or the bar would
            // keep claiming unsaved changes for something already on disk.
            saveProfile(next)
                .then(() => markProfileSaved(next))
                .catch(() => { });
            return next;
        });
    };
    const openAddAccount = () => {
        const fresh = createEmptyAccount();
        const existing = getPaymentAccounts(profile);
        // First account auto-marks Primary so the user never sees a "no default" state.
        if (existing.length === 0)
            fresh.isDefault = true;
        setEditingAccount(fresh);
        setAccountUpiWarning('');
    };
    const openEditAccount = (acc) => {
        setEditingAccount({ ...acc });
        setAccountUpiWarning('');
    };
    const cancelAccount = () => { setEditingAccount(null); setAccountUpiWarning(''); };
    const saveAccountForm = () => {
        if (!editingAccount)
            return;
        const existing = getPaymentAccounts(profile).filter(a => a.id !== 'legacy');
        const idx = existing.findIndex(a => a.id === editingAccount.id);
        const next = idx >= 0 ? existing.map((a, i) => i === idx ? editingAccount : a) : [...existing, editingAccount];
        // Enforce: exactly one default (or zero if list empty).
        if (editingAccount.isDefault) {
            next.forEach(a => { if (a.id !== editingAccount.id)
                a.isDefault = false; });
        }
        else if (!next.some(a => a.isDefault) && next.length > 0) {
            next[0].isDefault = true;
        }
        updateAccounts(next);
        setEditingAccount(null);
        setAccountUpiWarning('');
        toast(idx >= 0 ? 'Account updated' : 'Account added', 'success');
    };
    const removeAccount = async (acc) => {
        if (!await confirmAction({
            title: `Delete payment account "${acc.label || acc.bankName || 'this account'}"?`,
            message: 'Existing invoices that used this account keep their bank details as they were saved, so their PDFs stay exactly as printed.',
            confirmLabel: 'Delete account',
            tone: 'danger',
        }))
            return;
        const next = getPaymentAccounts(profile).filter(a => a.id !== 'legacy' && a.id !== acc.id);
        if (next.length > 0 && !next.some(a => a.isDefault))
            next[0].isDefault = true;
        updateAccounts(next);
        toast('Account removed', 'success');
    };
    const markDefault = (acc) => {
        const next = setDefaultAccount(getPaymentAccounts(profile).filter(a => a.id !== 'legacy'), acc.id);
        updateAccounts(next);
        toast(`Default → ${acc.label || acc.bankName || 'account'}`, 'success');
    };
    const toggleAccountActive = (acc) => {
        const next = getPaymentAccounts(profile)
            .filter(a => a.id !== 'legacy')
            .map(a => a.id === acc.id ? { ...a, isActive: !(a.isActive !== false) } : a);
        updateAccounts(next);
    };
    const moveAccountIdx = (idx, delta) => {
        const list = getPaymentAccounts(profile).filter(a => a.id !== 'legacy');
        const next = reorderAccounts(list, idx, idx + delta);
        updateAccounts(next);
    };
    const importLegacyAsAccount = () => {
        const fresh = createEmptyAccount(profile.bankName || 'Default account');
        fresh.bankName = profile.bankName || '';
        fresh.accountNumber = profile.accountNumber || '';
        fresh.ifsc = profile.ifsc || '';
        fresh.swift = profile.swift || '';
        fresh.upiId = profile.upiId || '';
        fresh.isDefault = true;
        updateAccounts([fresh]);
        toast('Imported existing bank details as your first account', 'success');
    };
    const handleImageUpload = (field, e) => {
        const file = e.target.files?.[0];
        // v1.10.36 — Reset the input so re-selecting the SAME file re-fires
        // onChange. Without this, if a user's upload silently failed once
        // (browser can't decode HEIC etc.) they had to pick a DIFFERENT file
        // to try again; picking the same file was a no-op.
        try {
            e.target.value = '';
        }
        catch { /* ignore */ }
        if (!file)
            return;
        // v1.10.36 — Reported "not able to set logo it show nothing".
        // Previous strict MIME whitelist (png/jpeg/webp/svg) silently
        // rejected HEIC/HEIF (iPhone default), GIF, BMP, TIFF with a
        // one-line toast users often missed. Now: accept anything the
        // browser can decode. The <img>.onerror fallback catches truly
        // undecodable files with a clearer message. Non-image files are
        // still caught by the .type prefix guard.
        if (!file.type.startsWith('image/') && file.type !== '') {
            toast(`This doesn't look like an image (type: ${file.type || 'unknown'}). Try a PNG or JPEG.`, 'warning', 6000);
            return;
        }
        // Size ceiling relaxed to 5MB (server body limit) so a phone photo
        // doesn't hit the arbitrary 2MB gate before downscaling gets to run.
        if (file.size > 5 * 1024 * 1024) {
            toast(`Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — over the 5MB cap. Try compressing at tinypng.com.`, 'warning', 6000);
            return;
        }
        // SVGs are vector — embed as-is (no canvas needed).
        if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                setProfile(prev => ({ ...prev, [field]: ev.target.result }));
                toast(`${({ logo: 'Logo', signature: 'Signature', stamp: 'Stamp' })[field] || 'Image'} uploaded — click Save Profile to keep it.`, 'success', 4000);
            };
            reader.onerror = () => toast('Could not read the SVG file.', 'error');
            reader.readAsDataURL(file);
            return;
        }
        // Raster: load into an Image, downscale to max 1024px on the longer edge
        // v1.10.36 — Explicit `window.Image` so a future import (e.g. lucide's
        // `Image` icon) can't shadow the browser primitive again.
        const url = URL.createObjectURL(file);
        const img = new window.Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const MAX = 1024;
            let { width, height } = img;
            if (!width || !height) {
                toast(`Image has zero dimensions — cannot use as logo.`, 'error');
                return;
            }
            if (width > MAX || height > MAX) {
                const ratio = MAX / Math.max(width, height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            // Fill white for JPEG so transparent PNGs don't come out with black
            // backgrounds on printers that can't render alpha.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            // Keep PNG for images that had alpha (so signature on transparent
            // stays transparent when placed on invoice), JPEG otherwise.
            const preservesAlpha = /png|webp|svg/i.test(file.type) && field !== 'logo';
            const dataUrl = canvas.toDataURL(preservesAlpha ? 'image/png' : 'image/jpeg', 0.92);
            setProfile(prev => ({ ...prev, [field]: dataUrl }));
            toast(`${({ logo: 'Logo', signature: 'Signature', stamp: 'Stamp' })[field] || 'Image'} uploaded — click Save Profile to keep it.`, 'success', 4000);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            // v1.10.36 — better error message. Common cause of the silent
            // "logo not showing" report on iOS: user uploads a HEIC file from
            // Photos, Chrome/desktop Safari can't decode it, we ended up here
            // with a generic error. Now the toast names likely fixes.
            toast(`Could not decode this image (type: ${file.type || 'unknown'}). If it's a HEIC from iPhone, share it as JPEG — in Photos: Share → Copy Photo → Files → paste, or set Camera Format = "Most Compatible".`, 'error', 10000);
        };
        img.src = url;
    };
    const removeImage = (field) => setProfile(prev => ({ ...prev, [field]: '' }));
    const handleSave = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            await saveProfile(profile);
            // v1.10.79 (#95) - saved under a new GSTIN or name: its own numbering follows.
            const oldKey = businessKeyOf(activeBusiness);
            const newKey = businessKeyOf(profile);
            if (oldKey && newKey && oldKey !== newKey)
                await renameNumberSeries(oldKey, newKey).catch(() => { });
            // v1.10.83 (#112) - and its cost centres.
            if (oldKey && newKey && oldKey !== newKey) {
                await getCostCentres()
                    .then((list) => list.some((c) => c.business === oldKey) && saveCostCentres(rekeyCentres(list, oldKey, newKey)))
                    .catch(() => { });
            }
            // v1.10.16 — reported: "uploaded logo and saved but it's not showing on
            // invoice". Root cause was a stale `freegstbill_invoiceOptions.showLogo`
            // in localStorage from before the upload — DEFAULT_OPTIONS has it true,
            // but a false persisted from an earlier state kept it hidden even after
            // the upload. Now: whenever the user saves a profile that has a logo,
            // we force `showLogo: true` in the persisted invoice options. Same for
            // signature. Users who consciously want to hide the logo can still
            // uncheck it in the Customize panel — this fix only rescues the
            // silent-fail case.
            //
            // v1.10.36 — Reported again: "not able to set logo it show nothing
            // after saving". Root cause of the recurrence: v1.10.16 only wrote
            // to localStorage, but InvoiceGenerator fetches display options
            // from the SERVER on mount (see line ~631) and merges those over
            // the localStorage value. So a stale server-side `showLogo:false`
            // kept overriding the local override. Fix: PUSH the updated
            // display options to the server too — one API call keeps both
            // stores in sync. Non-blocking (.catch()) so a slow server
            // doesn't delay the "Profile saved" toast.
            if (profile.logo || profile.signature) {
                try {
                    const raw = localStorage.getItem('freegstbill_invoiceOptions');
                    const opts = raw ? JSON.parse(raw) : {};
                    if (profile.logo)
                        opts.showLogo = true;
                    if (profile.signature)
                        opts.showSignature = true;
                    localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify(opts));
                    // Also sync to server so InvoiceGenerator's mount-load doesn't
                    // overwrite our fix with a stale server-side value.
                    try {
                        const serverOpts = await getInvoiceDisplayOptions().catch(() => null);
                        const merged = { ...(serverOpts || {}), ...opts };
                        saveInvoiceDisplayOptions(merged).catch(() => { });
                    }
                    catch { /* server unreachable — localStorage still updated */ }
                }
                catch { /* localStorage full or blocked — skip */ }
            }
            if (onSaved)
                onSaved(profile);
            // v1.10.55 (#43) — mark this state as the persisted baseline so the
            // unsaved-changes bar disappears.
            markProfileSaved(profile);
            toast('Profile saved!', 'success');
        }
        catch {
            toast('Failed to save profile', 'error');
        }
        finally {
            setSaving(false);
        }
    };
    // Export / Import (granular)
    const ALL_BACKUP_PARTS = [
        { id: 'profile', label: 'Active business profile', hint: 'Name, address, GSTIN, bank, logo, signature' },
        { id: 'profiles', label: 'All business profiles', hint: 'Multi-business switcher entries' },
        { id: 'bills', label: 'Invoices / bills', hint: 'Tax invoices, proforma, credit notes, etc.' },
        { id: 'clients', label: 'Clients', hint: 'Saved client directory' },
        { id: 'products', label: 'Products / Inventory', hint: 'Product catalog with HSN, rate, stock' },
        { id: 'expenses', label: 'Expenses', hint: 'Expense tracker entries and the cash book' },
        { id: 'purchases', label: 'Purchase bills', hint: 'Vendor bills used for ITC, and purchase orders' },
        { id: 'recurring', label: 'Recurring invoices', hint: 'Auto-billing schedule entries' },
        { id: 'receipts', label: 'Receipts', hint: 'Payment receipts' },
        { id: 'termsTemplates', label: 'Terms templates', hint: 'Reusable T&C library' },
        { id: 'meta', label: 'App settings', hint: 'Region, modules, invoice number format, display options' },
        { id: 'localStorage', label: 'Local preferences', hint: 'Custom units, theme, last region preference' },
    ];
    const [showExportModal, setShowExportModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [exportSel, setExportSel] = useState(() => Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, true])));
    const [importSel, setImportSel] = useState(() => Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, true])));
    const [importInspection, setImportInspection] = useState(null);
    const [importJsonText, setImportJsonText] = useState('');
    const toggleExport = (id) => setExportSel(prev => ({ ...prev, [id]: !prev[id] }));
    const toggleImport = (id) => setImportSel(prev => ({ ...prev, [id]: !prev[id] }));
    const exportToggleAll = (val) => setExportSel(Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, val])));
    // v1.10.74 - "Select all (with data)" ticks only categories that have data in the file
    const importToggleAll = (val) => setImportSel(Object.fromEntries(ALL_BACKUP_PARTS.map(p => [p.id, val && (importInspection?.counts?.[p.id] || 0) > 0])));
    const runExport = async () => {
        try {
            const json = await exportAllData(exportSel);
            const fileName = `freegstbill-backup-${new Date().toISOString().split('T')[0]}.json`;
            // Local download (always)
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            URL.revokeObjectURL(url);
            toast('Backup downloaded', 'success');
            setShowExportModal(false);
        }
        catch (err) {
            console.error(err);
            toast('Export failed: ' + (err.message || 'unknown error'), 'error');
        }
    };
    const handleImportPick = async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        try {
            const text = await file.text();
            const inspection = inspectBackup(text);
            if (!inspection.valid) {
                toast("This file doesn't look like a Free GST Billing backup.", 'error');
                return;
            }
            setImportInspection(inspection);
            setImportJsonText(text);
            // Auto-tick only the parts that actually have data in the file
            const auto = {};
            ALL_BACKUP_PARTS.forEach(p => { auto[p.id] = (inspection.counts[p.id] || 0) > 0; });
            setImportSel(auto);
            setShowImportModal(true);
        }
        catch {
            toast('Could not read the file', 'error');
        }
        if (fileInputRef.current)
            fileInputRef.current.value = '';
    };
    const runImport = async () => {
        try {
            const result = await importData(importJsonText, importSel);
            // v1.10.74 - list every restored category, not just five of them
            const parts = [];
            if (result.billCount)
                parts.push(`${result.billCount} invoice(s)`);
            if (result.hasProfile)
                parts.push('profile');
            if (result.profileCount)
                parts.push(`${result.profileCount} business profile(s)`);
            if (result.templateCount)
                parts.push(`${result.templateCount} template(s)`);
            if (result.clientCount)
                parts.push(`${result.clientCount} client(s)`);
            if (result.productCount)
                parts.push(`${result.productCount} product(s)`);
            if (result.expenseCount)
                parts.push(`${result.expenseCount} expense(s)`);
            if (result.purchaseCount)
                parts.push(`${result.purchaseCount} purchase bill(s)`);
            if (result.recurringCount)
                parts.push(`${result.recurringCount} recurring invoice(s)`);
            if (result.receiptCount)
                parts.push(`${result.receiptCount} receipt(s)`);
            const lsCount = importSel.localStorage ? (importInspection?.counts?.localStorage || 0) : 0;
            if (lsCount)
                parts.push(`${lsCount} local preference(s)`);
            toast(parts.length ? `Restored: ${parts.join(', ')}` : 'Restore complete', 'success');
            if (importSel.profile) {
                const p = await getProfile();
                setProfile(p);
                if (onSaved)
                    onSaved(p);
            }
            if (importSel.termsTemplates)
                loadTemplates();
            if (importSel.profiles)
                loadBusinessProfiles();
            setShowImportModal(false);
            setImportInspection(null);
            setImportJsonText('');
        }
        catch (err) {
            console.error(err);
            toast('Import failed: ' + (err.message || 'unknown error'), 'error');
        }
    };
    const saveStockAlerts = async () => {
        setStockAlertsSaving(true);
        try {
            await saveStockAlertSettings(stockAlerts);
            setStockSaved(JSON.stringify(stockAlerts));
            toast('Low-stock alert settings saved', 'success');
        }
        catch {
            toast('Failed to save', 'error');
        }
        setStockAlertsSaving(false);
    };
    // Terms templates
    const handleSaveTemplate = async () => {
        if (!editingTemplate.name.trim()) {
            toast('Name required', 'warning');
            return;
        }
        await saveTermsTemplate({ ...editingTemplate });
        toast('Template saved!', 'success');
        setEditingTemplate(null);
        loadTemplates();
    };
    const handleDeleteTemplate = async (id) => {
        if (await confirmAction({
            title: 'Delete this template?',
            message: 'Existing invoices that used this Terms preset keep their text — this only removes the reusable template.',
            confirmLabel: 'Delete',
            tone: 'danger',
        })) {
            await deleteTermsTemplate(id);
            toast('Deleted', 'success');
            loadTemplates();
        }
    };
    // Multi-business profiles
    // The saved profile the form was last loaded from (see findSameBusiness).
    const loadedProfileId = useRef(null);
    const sameSavedBusiness = () => findSameBusiness(businessProfiles, profile, businessProfiles.find((bp) => bp.id === loadedProfileId.current));
    const handleSaveAsProfile = async () => {
        if (!profile.businessName.trim()) {
            toast('Business name required', 'warning');
            return;
        }
        // Update the saved profile of this same business, or create a new one
        const existing = sameSavedBusiness();
        await saveBusinessProfile({ ...profile, id: existing?.id || undefined });
        toast(existing ? 'Profile updated!' : 'Profile saved!', 'success');
        loadBusinessProfiles();
    };
    const handleLoadProfile = async (bp) => {
        // Auto-save current profile before switching (so it's not lost)
        if (profile.businessName?.trim()) {
            const existing = sameSavedBusiness();
            await saveBusinessProfile({ ...profile, id: existing?.id || undefined });
        }
        loadedProfileId.current = bp.id;
        const loaded = { ...bp };
        delete loaded.id;
        setProfile(loaded);
        await saveProfile(loaded);
        // v1.10.56 (#44) — switching profiles persists immediately, so this IS
        // the saved state now.
        markProfileSaved(loaded);
        if (onSaved)
            onSaved(loaded);
        toast(`Switched to ${bp.businessName}`, 'success');
    };
    const handleDeleteProfile = async (id) => {
        if (await confirmAction({
            title: 'Delete this saved business profile?',
            message: 'Invoices already saved under this profile stay untouched. Only removes the profile from your saved list.',
            confirmLabel: 'Delete profile',
            tone: 'danger',
        })) {
            await deleteBusinessProfile(id);
            toast('Profile deleted', 'success');
            loadBusinessProfiles();
        }
    };
    // v1.10.67 (#66 item 3, @sangwanmail-eng) — park the company that is on
    // screen into Business Profiles BEFORE clearing the form. This used to just
    // blank the fields, so the next Save wrote the new company over the old one
    // - and on a fresh install the old one had never been saved as a profile,
    // which meant it was gone for good. Clearing also resets the unsaved-changes
    // baseline, so an empty form no longer claims you have unsaved work.
    const handleAddNewProfile = async () => {
        const current = profile.businessName?.trim();
        if (current) {
            const existing = sameSavedBusiness();
            try {
                await saveBusinessProfile({ ...profile, id: existing?.id || undefined });
                loadedProfileId.current = null; // the form is about to be a new company
                await loadBusinessProfiles();
            }
            catch {
                toast('Could not save the current company, so nothing was cleared. Try Save Profile first.', 'error');
                return;
            }
        }
        // #66 item 2 — a second company is almost always in the same country as
        // the first, and this is an India-first app; the browser locale guessed
        // United States on an Indian shop and started them on a US form.
        const blank = {
            businessName: '', address: '', city: '', state: '', pin: '', country: profile.country || 'India',
            gstin: '', pan: '', email: '', phone: '', bankName: '', accountNumber: '', ifsc: '', swift: '',
            logo: '', logoHeight: 48, signature: '', signatureHeight: 60, stamp: '', stampHeight: 70, upiId: '',
        };
        setProfile(blank);
        markProfileSaved(blank);
        setTaxIdWarning('');
        toast(current ? `${current} is safe under the Profiles tab - fill in the new company and press Save Profile` : 'Fill in the new company, then press Save Profile', 'info', 6000);
        setActiveSection('section-company');
        setTimeout(() => companyFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    };
    // v1.10.75 - one Save for the whole page (asked for: "a global save button
    // at the bottom, sticky, that saves all data filled anywhere"). Bank
    // accounts, Region and Print & PDF already save as they change; these wait
    // for a Save. v1.10.83 - Business type and Features joined them (asked for:
    // "just checkbox and save button to apply").
    const unsaved = [
        profileDirty && 'Company Details',
        invNumDirty && 'Invoice Number Format',
        stockSaved !== null && JSON.stringify(stockAlerts) !== stockSaved && 'Low-stock alerts',
        !!editingTemplate && 'Terms template',
        ...features.unsaved,
    ].filter(Boolean);
    const saveAll = async () => {
        if (!unsaved.length) {
            toast('Everything is already saved', 'info');
            return;
        }
        // The Company form goes through its own submit, so its checks still run.
        if (profileDirty)
            companyFormRef.current?.requestSubmit();
        const jobs = [];
        if (unsaved.includes('Invoice Number Format'))
            jobs.push(invNumRef.current?.save());
        if (unsaved.includes('Low-stock alerts'))
            jobs.push(saveStockAlerts());
        if (editingTemplate)
            jobs.push(handleSaveTemplate());
        if (features.unsaved.length)
            features.save();
        await Promise.all(jobs);
    };
    const discardAll = () => {
        if (profileDirty && savedProfileRef.current)
            setProfile(JSON.parse(savedProfileRef.current));
        invNumRef.current?.discard();
        if (stockSaved !== null)
            setStockAlerts(JSON.parse(stockSaved));
        setEditingTemplate(null);
        features.discard();
    };
    const [taxIdWarning, setTaxIdWarning] = useState('');
    const handleTaxIdBlur = () => {
        const result = validateTaxId(profile.country, profile.gstin);
        setTaxIdWarning(result.ok ? '' : result.message);
    };
    return (h("div", { className: "settings-container" },
        h("div", { className: "page-header", style: {
                padding: '1.1rem 1.35rem',
                background: 'linear-gradient(135deg, rgba(var(--primary-rgb), 0.12), var(--card-bg))',
                border: '1px solid var(--border)',
                borderRadius: 12,
                marginBottom: '1.25rem',
            } },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.85rem' } },
                h("div", { style: {
                        width: 44, height: 44,
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, var(--primary), var(--primary-darker))',
                        color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.15rem',
                        boxShadow: '0 6px 18px rgba(var(--primary-rgb), 0.35)',
                    } }, "\u2699"),
                h("div", { style: { flex: 1, minWidth: 0 } },
                    h("h1", { className: "page-title", style: { margin: 0 } },
                        "Settings ",
                        h(HelpButton, { title: "Settings", doc: SETTINGS_TAB_DOCS[activeSection] || 'settings', size: 16 })),
                    h("p", { className: "page-subtitle", style: { margin: '0.15rem 0 0' } },
                        "Business profile, branding, integrations & data",
                        h("span", { style: { fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: 999, background: 'var(--bg-secondary)', border: '1px solid var(--border)', marginLeft: '0.55rem', fontWeight: 600 } },
                            JUMP_NAV_SECTIONS.length,
                            " sections"))))),
        h("div", { ref: saveBarRef, className: "settings-bar", style: {
                position: 'sticky',
                zIndex: 30,
                padding: '0.45rem 0.55rem',
                marginBottom: '1.25rem',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--bg-secondary)', // solid: content must not show through
                boxShadow: '0 4px 20px rgba(15, 23, 42, 0.08)',
            } },
            h("style", null, JUMP_NAV_SECTIONS.map(([id]) => id)
                .concat('section-costcentres')
                .filter((id) => id !== activeSection && !(id === 'section-costcentres' && activeSection === 'section-modules'))
                .map((id) => `#${id}`).join(', ') + ' { display: none !important; }'),
            h("nav", { className: "settings-jumpnav", "aria-label": "Settings sections", style: {
                    display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center',
                } }, JUMP_NAV_SECTIONS.map(([id, label]) => {
                const active = activeSection === id;
                return (h("a", { key: id, href: `#${id}`, "aria-current": active ? 'page' : undefined, onClick: (e) => {
                        e.preventDefault();
                        setActiveSection(id);
                        window.scrollTo({ top: 0 });
                    }, style: {
                        fontSize: '0.76rem',
                        fontWeight: active ? 700 : 600,
                        padding: '0.38rem 0.8rem',
                        borderRadius: 999,
                        background: active
                            ? 'linear-gradient(135deg, var(--primary), var(--primary-darker))'
                            : 'var(--bg-secondary)',
                        color: active ? '#fff' : 'var(--text)',
                        textDecoration: 'none',
                        border: active ? '1px solid transparent' : '1px solid var(--border)',
                        transition: 'all 0.18s ease',
                        whiteSpace: 'nowrap',
                        boxShadow: active ? '0 4px 12px rgba(var(--primary-rgb), 0.4)' : 'none',
                    }, onMouseEnter: (e) => {
                        if (!active) {
                            e.currentTarget.style.background = 'var(--primary-light, rgba(30,64,175,0.08))';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }
                    }, onMouseLeave: (e) => {
                        if (!active) {
                            e.currentTarget.style.background = 'var(--bg-secondary)';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }
                    } }, label));
            }))),
        h("div", { style: { display: 'flex', flexDirection: 'column' } },
            h("div", { id: "section-stock", className: "glass-panel p-6 mb-6", style: { order: 6 } },
                h("div", { style: { display: 'flex', alignItems: 'flex-start', gap: '0.9rem', marginBottom: '0.9rem' } },
                    h("div", { style: {
                            width: 40, height: 40, flexShrink: 0,
                            borderRadius: 10,
                            background: 'rgba(245, 158, 11, 0.18)',
                            color: '#d97706',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '1.15rem',
                        } }, "\uD83D\uDD14"),
                    h("div", null,
                        h("h3", { className: "section-title", style: { marginTop: 0, marginBottom: '0.25rem' } },
                            "Low-stock alerts ",
                            h(HelpButton, { title: "Low-stock alerts", doc: "settings#stock", size: 16, style: { marginLeft: 6 } })),
                        h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 } }, "Powers the \uD83D\uDD14 sidebar badge and the Dashboard low-stock list. The Inventory page colour-codes products against this threshold too."))),
                h("div", { style: {
                        padding: '0.75rem 0.9rem',
                        background: 'var(--bg-secondary)',
                        borderRadius: 8,
                        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                        marginBottom: stockAlerts.enabled ? '0.85rem' : 0,
                    } },
                    h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 } },
                        h("input", { type: "checkbox", checked: !!stockAlerts.enabled, onChange: e => setStockAlerts(prev => ({ ...prev, enabled: e.target.checked })), style: { width: 18, height: 18, accentColor: 'var(--primary)' } }),
                        "Show low-stock alerts"),
                    h("span", { style: { fontSize: '0.75rem', color: 'var(--text-muted)', flex: 1, minWidth: 200 } }, stockAlerts.enabled
                        ? 'Notifications fire when a product\'s stock falls to or below the threshold.'
                        : 'Alerts are silenced. Inventory still tracks stock; it just doesn\'t nag you.')),
                stockAlerts.enabled && (h("div", { style: { marginBottom: '0.85rem' } },
                    h("div", { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.55rem' } },
                        h("label", { style: { fontSize: '0.85rem', fontWeight: 600 } }, "Threshold"),
                        h("span", { style: { fontSize: '0.72rem', color: 'var(--text-muted)' } },
                            "Alert when stock \u2264 ",
                            h("strong", { style: { color: 'var(--text)' } }, stockAlerts.threshold))),
                    h("div", { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' } },
                        [
                            { val: 0, label: '0', hint: 'Only when fully out' },
                            { val: 3, label: '3', hint: 'Very tight' },
                            { val: 5, label: '5', hint: 'Recommended' },
                            { val: 10, label: '10', hint: 'Loose' },
                        ].map(p => {
                            const active = stockAlerts.threshold === p.val;
                            return (h("button", { key: p.val, type: "button", onClick: () => setStockAlerts(prev => ({ ...prev, threshold: p.val })), title: p.hint, style: {
                                    padding: '0.45rem 0.85rem',
                                    borderRadius: 999,
                                    background: active
                                        ? 'linear-gradient(135deg, var(--primary), var(--primary-darker))'
                                        : 'var(--bg-secondary)',
                                    color: active ? '#fff' : 'var(--text)',
                                    border: active ? '1px solid transparent' : '1px solid var(--border)',
                                    fontSize: '0.85rem', fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                    minWidth: 44,
                                    boxShadow: active ? '0 4px 10px rgba(var(--primary-rgb), 0.35)' : 'none',
                                } },
                                p.label,
                                h("span", { style: { display: 'block', fontSize: '0.6rem', fontWeight: 500, opacity: 0.85, marginTop: 1 } }, p.hint)));
                        }),
                        h("span", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '0.4rem' } }, "or"),
                        h("input", { type: "number", min: "0", max: "9999", step: "1", className: "form-input", style: { width: 90 }, value: stockAlerts.threshold, onChange: e => setStockAlerts(prev => ({ ...prev, threshold: Math.max(0, parseInt(e.target.value, 10) || 0) })) })))),
                h("div", { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.75rem' } },
                    h("span", { style: { fontSize: '0.72rem', color: 'var(--text-muted)' } }, "Changes take effect after saving"),
                    h("button", { type: "button", className: "btn btn-primary", disabled: stockAlertsSaving, onClick: saveStockAlerts },
                        h(Save, { size: 16 }),
                        " ",
                        stockAlertsSaving ? 'Saving…' : 'Save'))),
            h("div", { id: "section-print", style: { order: 4 } },
                h(PrintSettings, null)),
            h("div", { id: "section-backups", style: { order: 8 } },
                h(BackupAndTrashPanel, null)),
            h(BusinessTypePanel, { features: features }),
            h(FeaturesPanel, { features: features, regionMode: regionMode }),
            isModuleEnabled('costCentres', features.saved.modules) && (h("div", { id: "section-costcentres", style: { order: 5 } },
                h(CostCentreSettings, { profile: activeBusiness }))),
            h("div", { id: "section-region", className: "glass-panel p-6 mb-6", style: { order: 7 } },
                h("h3", { className: "section-title", style: { marginTop: 0 } },
                    "Region Preference ",
                    h(HelpButton, { title: "Region Preference", doc: "settings#region", size: 16, style: { marginLeft: 6 } })),
                h("p", { style: { fontSize: '0.85rem', color: '#64748b', marginBottom: '0.85rem' } }, "Choose how the app behaves. You can change this any time without losing data."),
                h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } }, [
                    { id: 'india', label: '🇮🇳 India only', desc: 'GST flows, INR-first, GSTR-1/3B, E-Way Bill, UPI QR' },
                    { id: 'international', label: '🌍 International', desc: 'VAT/SST/TVA labels, multi-currency, no India-only flows' },
                    { id: 'both', label: '🌐 Both / Auto', desc: 'Show all countries — pick per invoice (default)' },
                ].map(opt => (h("button", { key: opt.id, type: "button", onClick: () => handleRegionChange(opt.id), className: `type-chip ${regionMode === opt.id ? 'type-chip-active' : ''}`, title: opt.desc, style: { flex: '1 1 200px', minWidth: '200px', textAlign: 'left', padding: '0.6rem 0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem' } },
                    h("span", { style: { fontWeight: 600 } }, opt.label),
                    h("span", { style: { fontSize: '0.72rem', color: regionMode === opt.id ? 'inherit' : '#94a3b8', fontWeight: 400 } }, opt.desc)))))),
            h("div", { id: "section-lock", className: "glass-panel p-6 mb-6", style: { order: 7 } },
                h(AppLockSettings, null)),
            h("div", { id: "section-privacy", className: "glass-panel p-6 mb-6", style: { order: 7 } },
                h(PrivacyInternet, null)),
            h("form", { id: "section-company", onSubmit: handleSave, className: "glass-panel p-6 mb-6", ref: companyFormRef, style: { order: 1 } },
                h("fieldset", { disabled: !profileLoaded, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
                    h("h3", { className: "section-title" },
                        "Company Details ",
                        h(HelpButton, { title: "Company Details", doc: "settings#company-details", size: 16, style: { marginLeft: 6 } })),
                    (() => {
                        const cc = getCountryConfig(profile.country);
                        return (h("div", { className: "grid grid-cols-2 gap-4" },
                            h("div", { className: "form-group full-width" },
                                h("label", { className: "form-label" }, "Business Name *"),
                                h("input", { required: true, type: "text", name: "businessName", className: "form-input", value: profile.businessName, onChange: handleChange })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Country"),
                                h("select", { name: "country", className: "form-input", value: profile.country || 'India', onChange: handleChange },
                                    profile.country && !visibleCountries.some(c => c.name === profile.country) && (h("option", { value: profile.country }, profile.country)),
                                    visibleCountries.map(c => h("option", { key: c.code, value: c.name }, c.name)))),
                            h("div", { className: "form-group full-width" },
                                h("label", { className: "form-label" }, "Address"),
                                h("textarea", { rows: "2", name: "address", className: "form-input", value: profile.address, onChange: handleChange })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "City"),
                                h("input", { type: "text", name: "city", className: "form-input", value: profile.city || '', onChange: handleChange, placeholder: "e.g. Mumbai" })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, cc.postalLabel),
                                h("input", { type: "text", name: "pin", className: "form-input", value: profile.pin || '', onChange: handleChange, placeholder: cc.postalLabel })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, cc.stateLabel),
                                (() => {
                                    const stateOpts = getStatesForCountry(profile.country || 'India');
                                    return stateOpts.length > 0 ? (h("select", { name: "state", className: "form-input", value: profile.state, onChange: handleChange },
                                        h("option", { value: "" },
                                            "Select ",
                                            cc.stateLabel),
                                        stateOpts.map(s => h("option", { key: s, value: s }, s)))) : (h("input", { type: "text", name: "state", className: "form-input", value: profile.state || '', onChange: handleChange, placeholder: cc.stateLabel }));
                                })()),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, cc.taxIdLabel),
                                h("input", { type: "text", name: "gstin", className: "form-input", style: taxIdWarning ? { borderColor: '#f59e0b' } : undefined, value: profile.gstin, onChange: (e) => { handleChange(e); if (taxIdWarning)
                                        setTaxIdWarning(''); }, onBlur: handleTaxIdBlur, placeholder: cc.taxIdPlaceholder, maxLength: 20 }),
                                taxIdWarning && h("small", { style: { color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' } },
                                    "\u26A0 ",
                                    taxIdWarning)),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Email"),
                                h("input", { type: "email", name: "email", className: "form-input", value: profile.email, onChange: handleChange })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Phone"),
                                h("input", { type: "text", name: "phone", className: "form-input", value: profile.phone, onChange: handleChange })),
                            (profile.country || 'India') === 'India' && (h("div", { className: "form-group full-width", style: { background: 'var(--bg-secondary)', padding: '0.85rem 1rem', borderRadius: 8, border: '1px solid var(--border)' } },
                                h("label", { className: "form-label", style: { marginBottom: 6 } },
                                    "GSTR filing details (used only for GSTR-1 / GSTR-3B JSON export) ",
                                    h(HelpButton, { title: "GSTR filing details", doc: "settings#gstr-details", size: 16, style: { marginLeft: 6 } })),
                                h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 8 } },
                                    h("input", { type: "checkbox", id: "aato-above-5cr", name: "aatoAbove5Cr", checked: !!profile.aatoAbove5Cr, onChange: (e) => setProfile(p => ({ ...p, aatoAbove5Cr: e.target.checked })) }),
                                    h("label", { htmlFor: "aato-above-5cr", style: { fontSize: '0.82rem', margin: 0 } },
                                        "Aggregate turnover (AATO) is ",
                                        h("strong", null, "above \u20B95 crore"))),
                                h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' } },
                                    "Drives HSN reporting rule \u2014 ",
                                    h("strong", null, profile.aatoAbove5Cr ? '6-digit HSN' : '4-digit HSN'),
                                    " minimum on every item. Since Jan 2025 the portal blocks GSTR-1 if any HSN falls short."))),
                            (profile.country || 'India') === 'India' && (h("div", { id: "lut", className: "form-group full-width", style: { background: 'var(--bg-secondary)', padding: '0.85rem 1rem', borderRadius: 8, border: '1px solid var(--border)' } },
                                h("label", { className: "form-label", style: { marginBottom: 6 } },
                                    "LUT for exports and SEZ supplies ",
                                    h(HelpButton, { title: "LUT for exports", doc: "settings#lut", size: 16, style: { marginLeft: 6 } })),
                                h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' } }, "With a Letter of Undertaking (filed free on the GST portal, Form GST RFD-11, once per financial year) you bill exports and SEZ supplies without IGST. Invoices dated in the year below tick \u201Cunder LUT\u201D by themselves and print its ARN."),
                                h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem' } },
                                    h("div", null,
                                        h("label", { className: "form-label", htmlFor: "lut-arn", style: { fontSize: '0.72rem' } }, "LUT ARN (acknowledgement number)"),
                                        h("input", { id: "lut-arn", type: "text", name: "lutArn", className: "form-input", maxLength: 20, value: profile.lutArn || '', onChange: (e) => setProfile(p => ({ ...p, lutArn: normaliseLutArn(e.target.value) })), placeholder: "e.g. AD290426123456X", style: profile.lutArn && !isLikelyLutArn(profile.lutArn) ? { borderColor: '#f59e0b' } : undefined }),
                                        profile.lutArn && !isLikelyLutArn(profile.lutArn) && (h("small", { style: { color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' } }, "\u26A0 An ARN is usually 15 letters and digits, starting with AD. Check it against the portal's acknowledgement."))),
                                    h("div", null,
                                        h("label", { className: "form-label", htmlFor: "lut-fy", style: { fontSize: '0.72rem' } }, "Financial year it covers"),
                                        h("select", { id: "lut-fy", name: "lutFy", className: "form-input", value: profile.lutFy || '', onChange: handleChange },
                                            h("option", { value: "" }, "Choose the year"),
                                            [...new Set([...lutFyOptions(), profile.lutFy].filter(Boolean))].map(fy => h("option", { key: fy, value: fy },
                                                "FY ",
                                                fy)))),
                                    h("div", null,
                                        h("label", { className: "form-label", htmlFor: "lut-date", style: { fontSize: '0.72rem' } }, "Date filed (optional)"),
                                        h("input", { id: "lut-date", type: "date", name: "lutDate", className: "form-input", value: profile.lutDate || '', onChange: handleChange }))),
                                profile.lutArn && profile.lutFy && profile.lutFy !== fyOf(localToday()) && (h("p", { style: { fontSize: '0.72rem', color: 'var(--warn-text)', margin: '0.5rem 0 0' } },
                                    "This LUT is for FY ",
                                    profile.lutFy,
                                    "; today is in FY ",
                                    fyOf(localToday()),
                                    ". File a fresh LUT for the current year before your next export."))))));
                    })(),
                    (() => {
                        const bankCC = getCountryConfig(profile.country);
                        const isIndia = (profile.country || 'India') === 'India';
                        // Show real accounts only — never the synthesised legacy entry, since this
                        // panel is for editing the persistent array.
                        const accounts = (profile.paymentAccounts || []).filter(a => a && a.id !== 'legacy');
                        const hasLegacyFlat = !accounts.length && (profile.bankName || profile.accountNumber || profile.ifsc || profile.swift || profile.upiId);
                        return (h(Fragment, null,
                            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.5rem', marginTop: '2rem' } },
                                h("div", null,
                                    h("h3", { className: "section-title", style: { margin: 0 } },
                                        "Payment Accounts ",
                                        h(HelpButton, { title: "Payment Accounts", doc: "settings#payment-accounts", size: 16, style: { marginLeft: 6 } })),
                                    h("p", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' } }, "Multiple bank / UPI accounts per profile. Pick one per invoice in the Customize panel. The \u2B50 default account is preselected on new invoices.")),
                                h("button", { type: "button", className: "btn btn-primary", onClick: openAddAccount },
                                    h(Plus, { size: 16 }),
                                    " Add account")),
                            hasLegacyFlat && (h("div", { className: "notice notice-warn", style: { marginTop: '0.85rem' } },
                                h("span", { className: "notice-icon" }, "\uD83D\uDCCB"),
                                h("div", { style: { flex: 1 } },
                                    h("strong", null, "Your existing bank details are still on this profile."),
                                    " Click below to import them as the first Payment Account, then add more.",
                                    h("div", { style: { marginTop: '0.5rem' } },
                                        h("button", { type: "button", className: "btn btn-secondary", onClick: importLegacyAsAccount, style: { fontSize: '0.78rem', padding: '0.3rem 0.7rem' } }, "Import & continue \u2192"))))),
                            accounts.length === 0 && !hasLegacyFlat && (h("div", { className: "surface-card", style: { marginTop: '0.85rem', textAlign: 'center', padding: '1.5rem' } },
                                h("p", { style: { fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 } }, "No payment accounts yet. Add the first one \u2014 it's auto-marked \u2B50 Primary."))),
                            accounts.length > 0 && (h("div", { style: { marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' } }, accounts.map((a, idx) => (h("div", { key: a.id, className: "surface-card", style: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', opacity: a.isActive === false ? 0.55 : 1 } },
                                h("div", { style: { flex: 1, minWidth: '220px' } },
                                    h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' } },
                                        a.isDefault && h("span", { title: "Default account", style: { fontSize: '0.95rem' } }, "\u2B50"),
                                        h("strong", { style: { fontSize: '0.92rem' } }, a.label || a.bankName || 'Untitled account'),
                                        a.isActive === false && h("span", { className: "status-pill", style: { '--pill-color': 'var(--text-muted)' } }, "Inactive")),
                                    h("div", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.55 } },
                                        a.bankName && h("span", null,
                                            a.bankName,
                                            " \u00B7 "),
                                        a.accountNumber && h("span", null,
                                            "A/C ",
                                            maskAccountNumber(a.accountNumber),
                                            " \u00B7 "),
                                        a.ifsc && h("span", null,
                                            bankCC.bankLabel || 'IFSC',
                                            " ",
                                            a.ifsc),
                                        a.swift && h("span", null,
                                            " \u00B7 SWIFT ",
                                            a.swift),
                                        a.iban && h("span", null,
                                            " \u00B7 IBAN ",
                                            a.iban),
                                        a.purposeCode && h("span", null,
                                            " \u00B7 Purpose code ",
                                            a.purposeCode),
                                        a.paymentLink && h("span", null,
                                            " \u00B7 \uD83D\uDD17 ",
                                            a.paymentLink),
                                        a.upiId && h("span", null,
                                            " \u00B7 \uD83D\uDCF1 ",
                                            a.upiId))),
                                h("div", { style: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap' } },
                                    !a.isDefault && (h("button", { type: "button", className: "icon-btn", onClick: () => markDefault(a), title: "Set as default" }, "\u2B50")),
                                    h("button", { type: "button", className: "icon-btn", onClick: () => moveAccountIdx(idx, -1), disabled: idx === 0, title: "Move up" }, "\u2191"),
                                    h("button", { type: "button", className: "icon-btn", onClick: () => moveAccountIdx(idx, 1), disabled: idx === accounts.length - 1, title: "Move down" }, "\u2193"),
                                    h("button", { type: "button", className: "icon-btn", onClick: () => toggleAccountActive(a), title: a.isActive === false ? 'Activate' : 'Deactivate' }, a.isActive === false ? '✓' : '∅'),
                                    h("button", { type: "button", className: "icon-btn icon-btn-blue", onClick: () => openEditAccount(a), title: "Edit" },
                                        h(Edit3, { size: 15 })),
                                    h("button", { type: "button", className: "icon-btn icon-btn-red", onClick: () => removeAccount(a), title: "Delete" },
                                        h(Trash2, { size: 15 })))))))),
                            isIndia && (h("div", { className: "form-group", style: { marginTop: '1rem', maxWidth: '300px' } },
                                h("label", { className: "form-label" }, "PAN Number (business-level)"),
                                h("input", { type: "text", name: "pan", className: "form-input", value: profile.pan || '', onChange: handleChange, placeholder: "e.g. AAAAA1234A", maxLength: 10 }))),
                            editingAccount && (h("div", { className: "modal-overlay", onClick: cancelAccount },
                                h("div", { className: "modal-content", style: { maxWidth: '560px' }, onClick: e => e.stopPropagation() },
                                    h("h3", { className: "section-title", style: { marginTop: 0 } },
                                        getPaymentAccounts(profile).some(a => a.id === editingAccount.id) ? 'Edit account' : 'Add account',
                                        " ",
                                        h(HelpButton, { title: "Add or edit a payment account", doc: "settings#add-account", size: 16, style: { marginLeft: 6 } })),
                                    h("div", { className: "grid grid-cols-2 gap-4" },
                                        h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                                            h("label", { className: "form-label" }, "Label (shown in the dropdown)"),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.label, onChange: e => setEditingAccount(a => ({ ...a, label: e.target.value })), placeholder: "e.g. HDFC Current \u2014 1234" })),
                                        h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                                            h("label", { className: "form-label" },
                                                "Account Holder Name ",
                                                h("span", { style: { fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.72rem' } }, "(name printed on the cheque / registered with the bank)")),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.accountHolderName || '', onChange: e => setEditingAccount(a => ({ ...a, accountHolderName: e.target.value })), placeholder: `Leave blank to use "${profile.businessName || 'Business Name'}"` })),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" }, "Bank Name"),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.bankName, onChange: e => setEditingAccount(a => ({ ...a, bankName: e.target.value })) })),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" },
                                                "Account Type ",
                                                h("span", { style: { fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.72rem' } }, "(optional)")),
                                            h("select", { className: "form-input", value: editingAccount.accountType || '', onChange: e => setEditingAccount(a => ({ ...a, accountType: e.target.value })) },
                                                h("option", { value: "" }, "\u2014 Not specified \u2014"),
                                                h("option", { value: "savings" }, "Savings Account"),
                                                h("option", { value: "current" }, "Current Account"),
                                                h("option", { value: "cc" }, "Cash Credit (CC)"),
                                                h("option", { value: "od" }, "Overdraft (OD)"),
                                                h("option", { value: "nre" }, "NRE Account"),
                                                h("option", { value: "nro" }, "NRO Account"))),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" },
                                                "Account Number ",
                                                !isIndia && '/ IBAN'),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.accountNumber, onChange: e => setEditingAccount(a => ({ ...a, accountNumber: e.target.value })) })),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" }, bankCC.bankLabel || 'IFSC Code'),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.ifsc, onChange: e => setEditingAccount(a => ({ ...a, ifsc: e.target.value })), placeholder: bankCC.bankLabel })),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" }, "SWIFT / BIC (optional)"),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.swift, onChange: e => setEditingAccount(a => ({ ...a, swift: e.target.value })), placeholder: "e.g. HDFCINBB" })),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" },
                                                "IBAN (optional) ",
                                                h(HelpButton, { title: "Getting paid from abroad", doc: "settings#paid-from-abroad", size: 14 })),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.iban || '', onChange: e => setEditingAccount(a => ({ ...a, iban: e.target.value.toUpperCase() })), placeholder: "Only if a foreign bank gave you one" })),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" },
                                                "Purpose code for payments from abroad (optional) ",
                                                h(HelpButton, { title: "Purpose codes", doc: "settings#paid-from-abroad", size: 14 })),
                                            h("input", { type: "text", className: "form-input", list: "purpose-codes", value: editingAccount.purposeCode || '', onChange: e => setEditingAccount(a => ({ ...a, purposeCode: e.target.value.toUpperCase().trim() })), placeholder: "e.g. P0802 for software work" }),
                                            h("datalist", { id: "purpose-codes" }, PURPOSE_CODES.map(p => h("option", { key: p.code, value: p.code }, `${p.code} - ${p.label}`))),
                                            h("small", { style: { color: 'var(--text-muted)', fontSize: '0.7rem' } }, "The RBI code for what you are paid for. Printed with these bank details on invoices to clients abroad, so they can quote it on the transfer. Your bank can confirm it.")),
                                        h("div", { className: "form-group" },
                                            h("label", { className: "form-label" }, "Online payment link (optional)"),
                                            h("input", { type: "text", className: "form-input", value: editingAccount.paymentLink || '', onChange: e => setEditingAccount(a => ({ ...a, paymentLink: e.target.value })), placeholder: "PayPal, Wise or Payoneer link" }),
                                            h("small", { style: { color: 'var(--text-muted)', fontSize: '0.7rem' } }, "Printed on invoices in a foreign currency.")),
                                        h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                                            h("label", { className: "form-label" }, "UPI ID (optional \u2014 drives the QR for this account)"),
                                            h("input", { type: "text", className: "form-input", style: accountUpiWarning ? { borderColor: '#f59e0b' } : undefined, value: editingAccount.upiId, onChange: e => { setEditingAccount(a => ({ ...a, upiId: e.target.value })); if (accountUpiWarning)
                                                    setAccountUpiWarning(''); }, onBlur: () => {
                                                    const v = (editingAccount.upiId || '').trim();
                                                    setAccountUpiWarning(v && !isValidUpiId(v) ? "Doesn't look like a UPI ID. Expected like merchant@hdfcbank or 9876543210@paytm." : '');
                                                }, placeholder: "e.g. yourbusiness@hdfcbank" }),
                                            accountUpiWarning && h("small", { style: { color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' } },
                                                "\u26A0 ",
                                                accountUpiWarning)),
                                        h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                                            h("label", { className: "form-label" }, "Internal notes (not printed on the PDF)"),
                                            h("textarea", { rows: "2", className: "form-input", value: editingAccount.notes, onChange: e => setEditingAccount(a => ({ ...a, notes: e.target.value })), placeholder: "e.g. Use for export clients only" })),
                                        h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                                            h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' } },
                                                h("input", { type: "checkbox", checked: !!editingAccount.isDefault, onChange: e => setEditingAccount(a => ({ ...a, isDefault: e.target.checked })), style: { width: 16, height: 16, accentColor: 'var(--primary)' } }),
                                                h("span", null,
                                                    h("strong", null, "\u2B50 Set as default account"),
                                                    " \u2014 preselected on every new invoice")))),
                                    h("div", { className: "flex gap-2 justify-end mt-4" },
                                        h("button", { type: "button", className: "btn btn-secondary", onClick: cancelAccount }, "Cancel"),
                                        h("button", { type: "button", className: "btn btn-primary", onClick: saveAccountForm },
                                            h(Save, { size: 16 }),
                                            " Save account")))))));
                    })(),
                    h(InvoiceNumberSettings, { ref: invNumRef, businessKey: businessKeyOf(activeBusiness), businessName: activeBusiness?.businessName, showScope: businessProfiles.length > 1, businesses: businessProfiles.map((bp) => ({ key: businessKeyOf(bp), name: bp.businessName || bp.gstin || 'Unnamed business' })), onDirtyChange: setInvNumDirty, onSavingChange: setInvNumSaving }),
                    h("h3", { className: "section-title mt-8" },
                        "Branding ",
                        h(HelpButton, { title: "Branding: logo, signature and stamp", doc: "settings#branding", size: 16, style: { marginLeft: 6 } })),
                    h("div", { className: "grid grid-cols-2 gap-4" },
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Business Logo"),
                            h("div", { className: "upload-area" },
                                profile.logo ? (h("div", { className: "logo-upload-section" },
                                    h("div", { className: "logo-preview-box" },
                                        h("img", { src: profile.logo, alt: "Logo", style: { height: `${profile.logoHeight || 48}px`, maxWidth: '180px', objectFit: 'contain', display: 'block' } }),
                                        h("button", { type: "button", className: "icon-btn icon-btn-red upload-remove", onClick: () => removeImage('logo') },
                                            h(Trash2, { size: 14 }))),
                                    h("div", { className: "logo-size-control" },
                                        h("label", { className: "form-label", style: { fontSize: '0.75rem', marginBottom: '0.25rem' } }, "Logo Size on Invoice"),
                                        h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                                            h("span", { style: { fontSize: '0.7rem', color: '#94a3b8' } }, "S"),
                                            h("input", { type: "range", min: "24", max: "80", value: profile.logoHeight || 48, onChange: (e) => setProfile(prev => ({ ...prev, logoHeight: Number(e.target.value) })), className: "logo-slider" }),
                                            h("span", { style: { fontSize: '0.7rem', color: '#94a3b8' } }, "L")),
                                        h("span", { style: { fontSize: '0.65rem', color: '#94a3b8' } },
                                            profile.logoHeight || 48,
                                            "px height")),
                                    h("button", { type: "button", className: "upload-change-btn", onClick: () => logoInputRef.current?.click() }, "Change Logo"))) : (h("button", { type: "button", className: "upload-btn", onClick: () => logoInputRef.current?.click() },
                                    h(ImageIcon, { size: 20 }),
                                    h("span", null, "Upload Logo"),
                                    h("span", { className: "upload-hint" }, "PNG or JPG, square or wide (up to 5 MB)"))),
                                h("input", { ref: logoInputRef, type: "file", accept: "image/*", style: { display: 'none' }, onChange: (e) => handleImageUpload('logo', e) })),
                            h("label", { style: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', marginTop: '0.6rem' } },
                                h("input", { type: "checkbox", checked: !!profile.showInMenu, onChange: (e) => setProfile(prev => ({ ...prev, showInMenu: e.target.checked })), style: { width: 16, height: 16, marginTop: 2, accentColor: 'var(--primary)' } }),
                                h("span", null, "Show my business name and logo in the app's menu (top left)"))),
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Signature"),
                            h("div", { className: "upload-area" },
                                profile.signature ? (h("div", { className: "logo-upload-section" },
                                    h("div", { className: "logo-preview-box" },
                                        h("img", { src: profile.signature, alt: "Signature", style: { height: `${profile.signatureHeight || 60}px`, maxWidth: '180px', objectFit: 'contain', display: 'block' } }),
                                        h("button", { type: "button", className: "icon-btn icon-btn-red upload-remove", onClick: () => removeImage('signature') },
                                            h(Trash2, { size: 14 }))),
                                    h("div", { className: "logo-size-control" },
                                        h("label", { className: "form-label", style: { fontSize: '0.75rem', marginBottom: '0.25rem' } }, "Signature Size on Invoice"),
                                        h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                                            h("span", { style: { fontSize: '0.7rem', color: '#94a3b8' } }, "S"),
                                            h("input", { type: "range", min: "30", max: "110", value: profile.signatureHeight || 60, onChange: (e) => setProfile(prev => ({ ...prev, signatureHeight: Number(e.target.value) })), className: "logo-slider" }),
                                            h("span", { style: { fontSize: '0.7rem', color: '#94a3b8' } }, "L")),
                                        h("span", { style: { fontSize: '0.65rem', color: '#94a3b8' } },
                                            profile.signatureHeight || 60,
                                            "px height")),
                                    h("button", { type: "button", className: "upload-change-btn", onClick: () => sigInputRef.current?.click() }, "Change Signature"))) : (h("button", { type: "button", className: "upload-btn", onClick: () => sigInputRef.current?.click() },
                                    h(PenTool, { size: 20 }),
                                    h("span", null, "Upload Signature"),
                                    h("span", { className: "upload-hint" }, "PNG or JPG (up to 5 MB)"))),
                                h("input", { ref: sigInputRef, type: "file", accept: "image/*", style: { display: 'none' }, onChange: (e) => handleImageUpload('signature', e) }))),
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Company Stamp / Seal"),
                            h("div", { className: "upload-area" },
                                profile.stamp ? (h("div", { className: "logo-upload-section" },
                                    h("div", { className: "logo-preview-box" },
                                        h("img", { src: profile.stamp, alt: "Stamp", style: { height: `${profile.stampHeight || 70}px`, maxWidth: '180px', objectFit: 'contain', display: 'block' } }),
                                        h("button", { type: "button", className: "icon-btn icon-btn-red upload-remove", onClick: () => removeImage('stamp') },
                                            h(Trash2, { size: 14 }))),
                                    h("div", { className: "logo-size-control" },
                                        h("label", { className: "form-label", style: { fontSize: '0.75rem', marginBottom: '0.25rem' } }, "Stamp Size on Invoice"),
                                        h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                                            h("span", { style: { fontSize: '0.7rem', color: '#94a3b8' } }, "S"),
                                            h("input", { type: "range", min: "30", max: "120", value: profile.stampHeight || 70, onChange: (e) => setProfile(prev => ({ ...prev, stampHeight: Number(e.target.value) })), className: "logo-slider" }),
                                            h("span", { style: { fontSize: '0.7rem', color: '#94a3b8' } }, "L")),
                                        h("span", { style: { fontSize: '0.65rem', color: '#94a3b8' } },
                                            profile.stampHeight || 70,
                                            "px height")),
                                    h("button", { type: "button", className: "upload-change-btn", onClick: () => stampInputRef.current?.click() }, "Change Stamp"))) : (h("button", { type: "button", className: "upload-btn", onClick: () => stampInputRef.current?.click() },
                                    h(ImageIcon, { size: 20 }),
                                    h("span", null, "Upload Stamp"),
                                    h("span", { className: "upload-hint" }, "PNG with a transparent background looks best (up to 5 MB)"))),
                                h("input", { ref: stampInputRef, type: "file", accept: "image/*", style: { display: 'none' }, onChange: (e) => handleImageUpload('stamp', e) })),
                            profile.stamp && profile.signature && (h("div", { style: { marginTop: '0.75rem' } },
                                h("label", { className: "form-label", htmlFor: "sign-layout" },
                                    "Signature and stamp layout ",
                                    h(HelpButton, { title: "Signature and stamp layout", doc: "settings#sign-layout", size: 16, style: { marginLeft: 6 } })),
                                h("select", { id: "sign-layout", className: "form-input", value: profile.signLayout || 'side', onChange: (e) => setProfile(prev => ({ ...prev, signLayout: e.target.value })) }, SIGN_LAYOUTS.map((l) => h("option", { key: l.value, value: l.value }, l.label))),
                                h("div", { style: { marginTop: '0.6rem', padding: '0.6rem', background: '#fff', border: '1px solid var(--border-color)', borderRadius: 8, color: '#0f172a', fontSize: '0.8rem' } },
                                    h("div", { style: { textAlign: 'center', marginBottom: '0.3rem', color: '#64748b' } }, "Preview"),
                                    h(SignatureImages, { sigImg: profile.signature, stampImg: profile.stamp, sigHeight: profile.signatureHeight || 60, stampHeight: profile.stampHeight || 70, layout: profile.signLayout || 'side' })))))),
                    h("div", { className: "mt-6 flex justify-end" },
                        h("button", { type: "submit", className: "btn btn-primary", disabled: saving },
                            h(Save, { size: 18 }),
                            " ",
                            saving ? 'Saving...' : 'Save Profile')))),
            h("div", { id: "section-profiles", className: "glass-panel p-6 mb-6", style: { order: 2 } },
                h("div", { className: "flex justify-between items-center mb-4" },
                    h("h3", { className: "section-title", style: { margin: 0 } },
                        "Business Profiles ",
                        h(HelpButton, { title: "Business Profiles", doc: "settings#business-profiles", size: 16, style: { marginLeft: 6 } })),
                    h("div", { className: "flex gap-2" },
                        h("button", { type: "button", className: "btn btn-secondary", onClick: handleAddNewProfile },
                            h(Plus, { size: 16 }),
                            " Add New Profile"),
                        h("button", { type: "button", className: "btn btn-primary", onClick: handleSaveAsProfile },
                            h(Building2, { size: 16 }),
                            " Save as Profile"))),
                h("p", { className: "page-subtitle mb-4" }, "Save multiple business profiles and switch between them instantly. Switching auto-saves your current profile first."),
                businessProfiles.length === 0 ? (h("p", { className: "text-muted", style: { fontSize: '0.85rem' } }, "No saved profiles yet. Fill in your business details above and click \"Save as Profile\".")) : (h("div", { className: "template-list" }, businessProfiles.map(bp => {
                    const isActive = bp.businessName?.trim().toLowerCase() === profile.businessName?.trim().toLowerCase();
                    return (h("div", { key: bp.id, className: "template-card", style: isActive ? { borderColor: 'var(--primary)', borderWidth: '2px' } : {} },
                        h("div", { className: "template-card-header" },
                            h("div", null,
                                h("strong", null, bp.businessName),
                                isActive && h("span", { style: { fontSize: '0.68rem', background: 'var(--primary)', color: '#fff', borderRadius: '4px', padding: '0.1rem 0.4rem', marginLeft: '0.5rem' } }, "Active"),
                                h("span", { style: { fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' } },
                                    bp.state,
                                    bp.gstin ? ` | ${bp.gstin}` : '')),
                            h("div", { className: "flex gap-2" },
                                h("button", { className: "btn btn-secondary", style: { padding: '0.35rem 0.75rem', fontSize: '0.78rem' }, onClick: () => handleLoadProfile(bp), disabled: isActive }, isActive ? 'Current' : 'Switch'),
                                h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDeleteProfile(bp.id), title: "Delete" },
                                    h(Trash2, { size: 14 })))),
                        bp.address && h("p", { className: "template-card-preview" }, bp.address)));
                })))),
            h("div", { id: "section-cloud", className: "glass-panel p-6 mb-6", style: { order: 9 } },
                h("h3", { className: "section-title" }, "Local browser storage"),
                h("p", { className: "page-subtitle mb-4" }, "Your business records are saved on this computer in this browser profile. No Google sign-in, OAuth, app server or cloud account is required."),
                h("div", { style: { background: 'var(--bg-secondary, #f8fafc)', borderRadius: '10px', padding: '1.25rem', marginBottom: '1rem', border: '1px solid var(--border)' } },
                    h("h4", { style: { fontSize: '0.95rem', marginBottom: '0.5rem' } }, "Private to this browser profile"),
                    h("p", { style: { fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 } },
                        "Invoices, customers, products, GST records, settings, saved PDFs and automatic snapshots are stored in IndexedDB on this device. They remain in this browser profile and are not sent to an application server."),
                    h("p", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.75rem', marginBottom: 0 } },
                        "Important: browser data can be cleared by browser cleanup or a device reset. Use Import / Export to download a backup regularly. To move data to another device, export a backup here and import it there."))),
            h("div", { id: "section-terms", className: "glass-panel p-6 mb-6", style: { order: 3 } },
                h("div", { className: "flex justify-between items-center mb-4" },
                    h("h3", { className: "section-title", style: { margin: 0 } },
                        "Terms & Conditions Templates ",
                        h(HelpButton, { title: "Terms & Conditions Templates", doc: "settings#terms", size: 16, style: { marginLeft: 6 } })),
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => setEditingTemplate({ id: '', name: '', content: '' }) },
                        h(Plus, { size: 16 }),
                        " New Template")),
                h("p", { className: "page-subtitle mb-4" }, "Create reusable templates or pick from ready-made ones below."),
                !editingTemplate && (h("div", { className: "quick-templates-section" },
                    h("p", { className: "form-label", style: { marginBottom: '0.5rem' } }, "Quick Start \u2014 Pick a template for your business:"),
                    h("div", { className: "quick-templates-grid" }, [
                        { name: 'Services (IT, Consulting, Freelance)', content: '1. Payment is due within 15 days of invoice date via NEFT/RTGS/UPI unless otherwise agreed.\n2. Late payment interest of 18% per annum will apply on overdue amounts as per MSME Act, 2006.\n3. All amounts are exclusive of GST (CGST/SGST/IGST) as applicable under the GST Act, 2017.\n4. Services rendered are non-refundable once delivered and accepted by the client.\n5. TDS (if applicable) must be deducted as per Income Tax Act. Please share TDS certificate (Form 16A) within 15 days.\n6. All deliverables remain the intellectual property of the service provider until full payment is received.\n7. Any disputes shall be subject to the exclusive jurisdiction of courts in the service provider\'s city.\n8. This is a computer-generated invoice and does not require a physical signature.' },
                        { name: 'Goods & Products (Retail, Wholesale)', content: '1. Goods once sold will not be taken back or exchanged unless defective as per Consumer Protection Act, 2019.\n2. Payment is due on delivery via Cash/UPI/NEFT unless credit terms are agreed in advance.\n3. Warranty (if applicable) covers manufacturing defects only as per terms mentioned on the product.\n4. All prices are inclusive of GST (CGST + SGST / IGST) as shown on this invoice.\n5. Claims for damaged or missing items must be reported within 48 hours of delivery with photos.\n6. E-way bill is generated for consignments exceeding Rs. 50,000 as per GST rules.\n7. Risk of loss passes to the buyer upon dispatch from our godown/warehouse.\n8. Subject to jurisdiction of courts at the seller\'s place of business.\n9. This is a computer-generated invoice and does not require a physical signature.' },
                        { name: 'Manufacturing & Trading', content: '1. All prices are ex-factory/ex-godown unless otherwise specified.\n2. Payment terms: 50% advance via NEFT/RTGS, balance before dispatch (or as per agreed credit terms).\n3. Goods dispatched only after full payment or confirmed credit arrangement.\n4. Quality complaints must be raised within 7 days of receipt with photographic evidence.\n5. Returns accepted only for manufacturing defects, subject to inspection at our premises.\n6. GST, freight, insurance, loading/unloading charges are as per agreement or additional to quoted price.\n7. E-way bill will be generated as per Section 68 of CGST Act for applicable consignments.\n8. Force majeure: Delays due to natural calamities, strikes, or government orders shall not be held against us.\n9. Interest @ 18% p.a. on overdue payments as per MSME Development Act, 2006.\n10. Subject to exclusive jurisdiction of courts at the seller\'s registered office.\n11. This is a computer-generated invoice and does not require a physical signature.' },
                        { name: 'Export / International', content: '1. All prices are in the agreed currency (USD/EUR/GBP) and exclusive of local taxes/duties in buyer\'s country.\n2. Payment via wire transfer (SWIFT/TT) within 30 days of invoice date as per RBI guidelines.\n3. Supply is zero-rated under GST — exported under Letter of Undertaking (LUT) / Bond.\n4. Title and risk pass to buyer upon delivery to carrier (FOB/CIF as per Incoterms 2020).\n5. Buyer is responsible for import duties, customs clearance, and local compliance in destination country.\n6. Claims for shortage or damage must be filed within 14 days of receipt with supporting documents.\n7. All payments to be received in INR equivalent or foreign currency as per FEMA regulations.\n8. Disputes shall be resolved through arbitration in India under the Arbitration & Conciliation Act, 1996.\n9. This is a computer-generated invoice and does not require a physical signature.' },
                        { name: 'Freelancer (Simple)', content: '1. Payment due within 7 days of invoice via UPI/NEFT/IMPS.\n2. Late payments attract interest @ 2% per month.\n3. 50% advance required before project commencement.\n4. Scope changes after agreement will be quoted and billed separately.\n5. All work remains property of the freelancer until full payment is received.\n6. Cancellation after work begins: completed portion will be billed proportionally.\n7. TDS (if applicable) to be deducted at source. Share Form 16A within 15 days of deduction.\n8. Subject to jurisdiction of courts in the freelancer\'s city.\n9. This is a computer-generated invoice.' },
                    ].map((qt, i) => (h("button", { key: i, type: "button", className: "quick-template-btn", onClick: async () => {
                            // v1.10.74 - don't add a second copy when clicked twice
                            if (termsTemplates.some(t => t.name === qt.name)) {
                                toast('You already have this template', 'info');
                                return;
                            }
                            await saveTermsTemplate({ name: qt.name, content: qt.content });
                            toast(`Added: ${qt.name}`, 'success');
                            loadTemplates();
                        } },
                        h(Plus, { size: 14 }),
                        " ",
                        qt.name)))))),
                editingTemplate && (h("div", { className: "template-editor" },
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Template Name"),
                        h("input", { type: "text", className: "form-input", value: editingTemplate.name, onChange: e => setEditingTemplate({ ...editingTemplate, name: e.target.value }), placeholder: "e.g. Standard Terms, Export Terms" })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Content (paste your terms here)"),
                        h("textarea", { rows: "8", className: "form-input", value: editingTemplate.content, onChange: e => setEditingTemplate({ ...editingTemplate, content: e.target.value }), placeholder: "Paste or type your terms & conditions..." })),
                    h("div", { className: "flex gap-2 justify-end" },
                        h("button", { type: "button", className: "btn btn-secondary", onClick: () => setEditingTemplate(null) }, "Cancel"),
                        h("button", { type: "button", className: "btn btn-primary", onClick: handleSaveTemplate },
                            h(Save, { size: 16 }),
                            " Save Template")))),
                termsTemplates.length === 0 && !editingTemplate ? (h("p", { className: "text-muted", style: { fontSize: '0.85rem' } }, "No templates yet.")) : (h("div", { className: "template-list" }, termsTemplates.map(tpl => (h("div", { key: tpl.id, className: "template-card" },
                    h("div", { className: "template-card-header" },
                        h("strong", null, tpl.name),
                        h("div", { className: "flex gap-2" },
                            h("button", { className: "icon-btn icon-btn-blue", onClick: () => setEditingTemplate({ ...tpl }), title: "Edit" },
                                h(EditIcon, { size: 14 })),
                            h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDeleteTemplate(tpl.id), title: "Delete" },
                                h(Trash2, { size: 14 })))),
                    h("p", { className: "template-card-preview" }, tpl.content))))))),
            h("div", { id: "section-updates", className: "glass-panel p-6 mb-6", style: { order: 11 } },
                h("h3", { className: "section-title" },
                    "App Updates ",
                    h(HelpButton, { title: "App Updates", doc: "settings#updates", size: 16, style: { marginLeft: 6 } })),
                h("p", { className: "page-subtitle mb-4" }, "Check if a newer version is available."),
                h("div", { className: "flex gap-4 items-center" },
                    h("button", { type: "button", className: "btn btn-secondary", disabled: checkingUpdate, onClick: async () => {
                            setCheckingUpdate(true);
                            try {
                                const res = await fetch('/api/check-update?now=1');
                                const data = await res.json();
                                setUpdateInfo(data);
                                if (data.updateAvailable) {
                                    toast(`Update available: v${data.latest}`, 'info');
                                }
                                else if (data.error) {
                                    toast('Could not check for updates. Check internet connection.', 'warning');
                                }
                                else {
                                    toast('You are on the latest version!', 'success');
                                }
                            }
                            catch {
                                toast('Could not check for updates.', 'error');
                            }
                            setCheckingUpdate(false);
                        } },
                        h(RefreshCw, { size: 18, className: checkingUpdate ? 'spin' : '' }),
                        " ",
                        checkingUpdate ? 'Checking...' : 'Check for Updates'),
                    updateInfo && (h("span", { style: { fontSize: '0.85rem', color: 'var(--text-muted)' } },
                        "Current: v",
                        updateInfo.current,
                        updateInfo.latest ? ` | Latest: v${updateInfo.latest}` : ''))),
                updateInfo?.updateAvailable && (h("div", { className: "update-available-box" },
                    h("p", null,
                        h("strong", null,
                            "New version v",
                            updateInfo.latest,
                            " is available!")),
                    h("p", null, "The app is delivered as a static website. Open the release details here; the website owner publishes updates to the hosted app. Your local browser data is separate and is not affected."),
                    h("button", { type: "button", className: "btn btn-primary", disabled: updatingNow, onClick: handleSettingsUpdateNow, style: { marginTop: '0.5rem', display: 'inline-flex' } },
                        h(Download, { size: 18 }),
                        " ",
                        updatingNow ? 'Opening…' : 'View Release')))),
            h("div", { id: "section-data", className: "glass-panel p-6 mb-6", style: { order: 10 } },
                h("h3", { className: "section-title" },
                    "Data Management ",
                    h(HelpButton, { title: "Data Management: Export and Import Backup", doc: "backup#export-import", size: 16, style: { marginLeft: 6 } })),
                h("div", { className: "notice notice-info", style: { marginBottom: '1rem' } },
                    h("span", { className: "notice-icon" }, "\uD83D\uDD12"),
                    h("div", null,
                        h("strong", null, "Your business data is stored locally in this browser."),
                        " Invoices, clients, products, GST records, settings and automatic backups are saved in the private ",
                        h("code", null, "Free GST Billing Software"),
                        " browser profile using IndexedDB. The app does not require a Google account and does not send business records to an application server. See Privacy & internet for the complete data flow.")),
                h("p", { className: "page-subtitle mb-6" }, "Choose what to back up or restore \u2014 invoices, clients, products, settings, custom units, or just specific parts. Backup files are plain JSON and download directly to your computer."),
                h("div", { className: "flex gap-4", style: { flexWrap: 'wrap' } },
                    h("button", { type: "button", className: "btn btn-primary", onClick: () => setShowExportModal(true) },
                        h(Download, { size: 18 }),
                        " Export Backup\u2026"),
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => fileInputRef.current?.click() },
                        h(Upload, { size: 18 }),
                        " Import Backup\u2026"),
                    h("input", { ref: fileInputRef, type: "file", accept: ".json", onChange: handleImportPick, style: { display: 'none' } }))),
            showExportModal && (h("div", { className: "modal-overlay", onClick: () => setShowExportModal(false) },
                h("div", { className: "modal-content", style: { maxWidth: '600px' }, onClick: e => e.stopPropagation() },
                    h("h3", { className: "section-title", style: { marginTop: 0 } },
                        "Export Backup ",
                        h(HelpButton, { title: "Export Backup", doc: "backup#export-backup", size: 16, style: { marginLeft: 6 } })),
                    h("p", { style: { fontSize: '0.82rem', color: '#64748b', marginBottom: '0.75rem' } }, "Choose what to include. Everything is on by default \u2014 uncheck anything you don't want."),
                    h("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' } },
                        h("button", { type: "button", className: "btn btn-secondary", onClick: () => exportToggleAll(true), style: { fontSize: '0.72rem', padding: '0.25rem 0.55rem' } }, "Select all"),
                        h("button", { type: "button", className: "btn btn-secondary", onClick: () => exportToggleAll(false), style: { fontSize: '0.72rem', padding: '0.25rem 0.55rem' } }, "Clear all")),
                    h("div", { className: "cbx-list" }, ALL_BACKUP_PARTS.map(p => (h("label", { key: p.id, className: "cbx-row" },
                        h("input", { type: "checkbox", checked: !!exportSel[p.id], onChange: () => toggleExport(p.id) }),
                        h("span", null,
                            h("span", { className: "cbx-label" }, p.label),
                            h("span", { className: "cbx-hint" }, p.hint)))))),
                    h("div", { className: "flex gap-2 justify-end mt-4" },
                        h("button", { type: "button", className: "btn btn-secondary", onClick: () => setShowExportModal(false) }, "Cancel"),
                        h("button", { type: "button", className: "btn btn-primary", onClick: runExport, disabled: !Object.values(exportSel).some(Boolean) }, h(Fragment, null,
                            h(Download, { size: 16 }),
                            " Download Backup"))))))),
        showImportModal && importInspection && (h("div", { className: "modal-overlay", onClick: () => setShowImportModal(false) },
            h("div", { className: "modal-content", style: { maxWidth: '600px' }, onClick: e => e.stopPropagation() },
                h("h3", { className: "section-title", style: { marginTop: 0 } },
                    "Restore from Backup ",
                    h(HelpButton, { title: "Restore from Backup", doc: "backup#restore-from-backup", size: 16, style: { marginLeft: 6 } })),
                h("div", { style: { fontSize: '0.78rem', color: '#64748b', marginBottom: '0.75rem' } },
                    "File contents preview",
                    importInspection.exportedAt && h("span", null,
                        " \u2014 exported ",
                        new Date(importInspection.exportedAt).toLocaleString()),
                    importInspection.version && h("span", null,
                        " \u00B7 v",
                        importInspection.version)),
                h("div", { style: {
                        padding: '0.6rem 0.85rem', borderRadius: '6px',
                        background: 'var(--warn-bg)', border: '1px solid var(--warn-border)',
                        fontSize: '0.78rem', color: 'var(--warn-text)', marginBottom: '0.75rem',
                    } },
                    "\u26A0 Restoring will ",
                    h("strong", null, "overwrite matching records by ID"),
                    " in the categories you select. Records you didn't tick are untouched. We recommend exporting a fresh backup of your current data first."),
                h("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' } },
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => importToggleAll(true), style: { fontSize: '0.72rem', padding: '0.25rem 0.55rem' } }, "Select all (with data)"),
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => importToggleAll(false), style: { fontSize: '0.72rem', padding: '0.25rem 0.55rem' } }, "Clear all")),
                h("div", { className: "cbx-list" }, ALL_BACKUP_PARTS.map(p => {
                    const count = importInspection.counts[p.id] || 0;
                    return (h("label", { key: p.id, className: `cbx-row${count === 0 ? ' is-disabled' : ''}` },
                        h("input", { type: "checkbox", checked: !!importSel[p.id], disabled: count === 0, onChange: () => toggleImport(p.id) }),
                        h("span", { style: { flex: 1 } },
                            h("span", { className: "cbx-label" }, p.label),
                            h("span", { className: "cbx-hint" }, p.hint)),
                        h("span", { className: "cbx-meta", style: count > 0 ? { color: 'var(--success)', fontWeight: 600 } : undefined }, count > 0 ? `${count} item${count !== 1 ? 's' : ''}` : 'empty')));
                })),
                h("div", { className: "flex gap-2 justify-end mt-4" },
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => setShowImportModal(false) }, "Cancel"),
                    h("button", { type: "button", className: "btn btn-primary", onClick: runImport, disabled: !Object.values(importSel).some(Boolean) },
                        h(Upload, { size: 16 }),
                        " Restore selected"))))),
        h("div", { className: "settings-savebar", style: {
                zIndex: 40,
                display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                padding: '0.6rem 1.5rem',
                borderTop: unsaved.length ? '2px solid #f59e0b' : '1px solid var(--border)',
                background: unsaved.length ? 'color-mix(in srgb, #f59e0b 8%, var(--bg-secondary))' : 'var(--bg-secondary)',
                boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.10)',
            } },
            h("span", { style: { flex: '1 1 220px', fontSize: '0.85rem', fontWeight: 600, color: unsaved.length ? '#f59e0b' : 'var(--text-muted)' }, title: "Payment accounts, Print & PDF, Region and App lock save as you change them. Business type and Features wait for Save all changes." }, unsaved.length ? h(Fragment, null,
                "\u25CF Unsaved changes in ",
                unsaved.join(', ')) : '✓ All changes saved'),
            unsaved.length > 0 && (h("button", { type: "button", className: "btn", onClick: discardAll, style: { fontSize: '0.85rem' } }, "Discard")),
            h("button", { type: "button", className: "btn btn-primary", disabled: saving || invNumSaving || stockAlertsSaving, onClick: saveAll, style: { fontSize: '0.85rem' } },
                h(Save, { size: 16 }),
                " ",
                saving || invNumSaving || stockAlertsSaving ? 'Saving…' : 'Save all changes'))));
}
function EditIcon({ size }) {
    return (h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" }),
        h("path", { d: "m15 5 4 4" })));
}
// ============================================================
// v1.9.5 — Backup Management + Trash Bin
// ============================================================
function BackupAndTrashPanel() {
    const [backups, setBackups] = useState([]);
    const [trash, setTrash] = useState([]);
    const [loading, setLoading] = useState(false);
    const loadAll = async () => {
        setLoading(true);
        try {
            const [b, t] = await Promise.all([
                getBackupsList().catch(() => []),
                getTrashedBills().catch(() => []),
            ]);
            setBackups(b);
            setTrash(t);
        }
        catch { /* ignore */ }
        setLoading(false);
    };
    useEffect(() => { loadAll(); }, []);
    const handleRestoreBackup = async (date) => {
        if (!await confirmAction({
            title: `Restore all data from backup ${date}?`,
            message: 'This OVERWRITES your current local browser data. Download a current export first if you need an additional safety copy.',
            confirmLabel: 'Restore backup',
            tone: 'warning',
        }))
            return;
        try {
            await triggerBackup().catch(() => { }); // today's daily backup, if not made yet
            const res = await restoreBackup(date);
            toast(`Backup restored from local browser storage. Your pre-restore snapshot is ${res?.snapshot || 'also retained locally'}. Reload the page to see the restored data.`, 'success', 10000);
        }
        catch (err) {
            toast('Restore failed: ' + err.message, 'error');
        }
    };
    const handleRestoreTrash = async (id) => {
        try {
            await restoreTrashedBill(id);
            // Back in the books, so the stock its delete put back is taken out again.
            // Only what that delete recorded (stockReturnedOnDelete): invoices
            // deleted before it was recorded never had their stock put back.
            const { _trashedAt, ...bill } = trash.find((b) => b.id === id) || {};
            const back = bill.data?.stockReturnedOnDelete;
            if (back && Object.keys(back).length) {
                const { stockReturnedOnDelete: _gone, ...data } = bill.data;
                await saveBill({ ...bill, data: { ...data, stockApplied: back } }, { overwrite: true });
                await applyStockChanges(stockDelta({}, back)).catch(() => { });
            }
            toast('Invoice restored', 'success');
            loadAll();
        }
        catch (err) {
            toast('Restore failed: ' + err.message, 'error');
        }
    };
    const handlePurgeTrash = async (id) => {
        if (!await confirmAction({
            title: 'Permanently delete this invoice?',
            message: 'This bypasses the 30-day Trash grace period. The invoice record is removed from this browser's local data for good. Downloaded PDF copies saved outside the app are unaffected.',
            confirmLabel: 'Delete permanently',
            tone: 'danger',
        }))
            return;
        try {
            await purgeTrashedBill(id);
            toast('Invoice permanently deleted', 'info');
            loadAll();
        }
        catch (err) {
            toast('Purge failed: ' + err.message, 'error');
        }
    };
    // v1.10.22 — reported: "add here delete option i know u added 30 days
    // auto delete but manual delete also u add". Individual backup delete.
    const handleDeleteBackup = async (date) => {
        if (!await confirmAction({
            title: `Delete backup ${date}?`,
            message: 'Auto-backups still run daily, so future data will be safe. This just removes the archived snapshot.',
            confirmLabel: 'Delete backup',
            tone: 'danger',
        }))
            return;
        try {
            await deleteBackup(date);
            toast(`Backup ${date} deleted`, 'info');
            loadAll();
        }
        catch (err) {
            toast('Delete failed: ' + err.message, 'error');
        }
    };
    return (h("div", { className: "glass-panel p-6 mb-6" },
        h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.75rem' } },
            h("div", null,
                h("h3", { className: "section-title", style: { marginTop: 0, marginBottom: '0.25rem' } },
                    "\uD83D\uDCBE Backup Management + \uD83D\uDDD1 Trash Bin ",
                    h(HelpButton, { title: "Backup Management + Trash Bin", doc: "backup#automatic-backups", size: 16, style: { marginLeft: 6 } })),
                h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 } }, "Automatic daily snapshots kept for 30 days \u00B7 Deleted invoices stay in the trash for 30 days.")),
            h("button", { className: "btn btn-secondary", style: { fontSize: '0.82rem' }, onClick: async () => {
                    // v1.10.74 - show an error instead of failing silently
                    try {
                        await triggerBackup();
                        toast('Manual backup triggered', 'success');
                        loadAll();
                    }
                    catch (err) {
                        toast('Backup failed: ' + (err.message || 'unknown error'), 'error');
                    }
                } },
                h(SaveIcon, { size: 14 }),
                " Backup now")),
        h("div", { style: { padding: '0.85rem', background: 'var(--bg-secondary)', borderRadius: 8, marginTop: '0.75rem' } },
            h("p", { className: "field-hint", style: { margin: 0 } },
                "Daily snapshots are stored in this browser's local database. The latest 30 days are retained; the app checks and creates today's snapshot when you open the workspace.")),
        h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginTop: '1rem' } },
            h("div", { style: { padding: '0.85rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.9rem' } },
                    "\uD83D\uDCC5 Daily backups (",
                    backups.length,
                    ") ",
                    h(HelpButton, { title: "Daily backups", doc: "backup#restore-daily-backup", size: 16, style: { marginLeft: 6 } })),
                loading && backups.length === 0 && h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)' } }, "Loading\u2026"),
                !loading && backups.length === 0 && h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)' } }, "No backups yet \u2014 the first will be created when you next open the workspace, or click \"Backup now\" above."),
                h("div", { style: { maxHeight: 260, overflowY: 'auto' } }, backups.map(b => (h("div", { key: b.date, style: {
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.4rem 0.6rem', marginBottom: '0.25rem',
                        background: 'var(--card)', borderRadius: 4, fontSize: '0.82rem',
                    } },
                    h("div", null,
                        h("strong", null, b.date),
                        h("div", { style: { fontSize: '0.7rem', color: 'var(--text-muted)' } },
                            b.createdAt ? new Date(b.createdAt).toLocaleTimeString('en-IN') : '',
                            '')),
                    h("div", { style: { display: 'flex', gap: '0.25rem' } },
                        h("button", { className: "btn btn-secondary", style: { fontSize: '0.72rem', padding: '0.2rem 0.5rem' }, onClick: () => handleRestoreBackup(b.date) }, "Restore"),
                        !b.protected && h("button", { className: "btn btn-secondary", style: { fontSize: '0.72rem', padding: '0.2rem 0.5rem', color: '#dc2626', borderColor: '#fca5a5' }, onClick: () => handleDeleteBackup(b.date), title: "Delete this backup snapshot" }, "Delete"))))))),
            h("div", { style: { padding: '0.85rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.9rem' } },
                    "\uD83D\uDDD1 Trash bin (",
                    trash.length,
                    ") ",
                    h(HelpButton, { title: "Trash bin", doc: "backup#trash", size: 16, style: { marginLeft: 6 } })),
                loading && trash.length === 0 && h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)' } }, "Loading\u2026"),
                !loading && trash.length === 0 && h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)' } }, "No deleted invoices. Anything you delete lands here for 30 days."),
                h("div", { style: { maxHeight: 260, overflowY: 'auto' } }, trash.map(bill => (h("div", { key: bill.id, style: {
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.4rem 0.6rem', marginBottom: '0.25rem',
                        background: 'var(--card)', borderRadius: 4, fontSize: '0.82rem',
                    } },
                    h("div", { style: { flex: 1, minWidth: 0 } },
                        h("strong", null, bill.invoiceNumber),
                        h("div", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                            bill.clientName,
                            " \u00B7 deleted ",
                            bill._trashedAt ? new Date(bill._trashedAt).toLocaleDateString('en-IN') : '')),
                    h("div", { style: { display: 'flex', gap: '0.25rem' } },
                        h("button", { className: "btn btn-secondary", style: { fontSize: '0.7rem', padding: '0.2rem 0.4rem' }, onClick: () => handleRestoreTrash(bill.id) }, "Restore"),
                        h("button", { className: "btn btn-secondary", style: { fontSize: '0.7rem', padding: '0.2rem 0.4rem', color: '#dc2626', borderColor: '#fca5a5' }, onClick: () => handlePurgeTrash(bill.id) }, "Delete forever"))))))))));
}
