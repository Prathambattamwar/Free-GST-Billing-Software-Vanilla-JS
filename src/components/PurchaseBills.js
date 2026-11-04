import { useState, useEffect, useMemo, useRef, lazy, Suspense, h, Fragment } from '../vanilla/dom.js';
import { ShoppingCart, Plus, Edit3, Trash2, Search, X, Save, Download, Wand2, Eye, ClipboardList, IndianRupee } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
import { getAllPurchases, savePurchase, deletePurchase, getAllProducts, saveProduct, getProfile, getEnabledModules, getAllPurchaseOrders, savePurchaseOrder, getNextPoNumber } from '../store.js';
import { formatCurrency, getFYOptions, belongsToProfile, isUnassignedToBusiness, isInterstateSupply, localToday, roundQty, splitPurchaseTax, isModuleEnabled, businessKeyOf, getAllUnits, TDS_SECTIONS } from '../utils.js';
import { purchaseTdsAmount } from '../utils/tdsTcs.js';
import { purchaseTotals as calcPurchaseTotal, billFormFromPo } from '../utils/purchaseOrders.js';
import PurchaseOrders from './PurchaseOrders.js';
import TableExport from './TableExport.js';
import BulkCsvImport from './BulkCsvImport.js';
import UnassignedBanner from './UnassignedBanner.js';
import { getPrintSettings } from '../utils/printSettings.js';
import { toast } from './Toast.js';
import { confirmAction, promptAction } from './ConfirmModal.js';
import { useCostCentres } from './useCostCentres.js';
import { CostCentreSelect, CostCentreFilter } from './CostCentrePicker.js';
import { matchesCentre, centreFields } from '../utils/costCentres.js';
import { PURCHASE_STATUS_LABEL, OVERPAY_SLACK, purchaseStatus, purchaseBalance, purchasePaid, purchaseOwed, hasPurchasePayments, withPurchasePayments, markPurchasePaid, markPurchaseUnpaid, purchasePaymentModeName } from '../utils/purchasePayments.js';
import PurchasePaymentModal from './PurchasePaymentModal.js';
// v1.10.31 — UI-C3: Same accent-color helper as ClientsView so the
// Purchase Bill PDF header rule + totals line pick up the user's brand.
function getAccentRGB() {
    try {
        const ps = getPrintSettings();
        if (ps.userColorsEnabled && ps.pdfAccent) {
            const hex = String(ps.pdfAccent).replace('#', '');
            if (/^[0-9a-f]{6}$/i.test(hex)) {
                return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
            }
        }
    }
    catch { /* ignore */ }
    return [30, 64, 175];
}
// v1.10.22 — Purchase-bill OCR modal. Lazy-loaded because tesseract.js is
// ~2MB gzipped; we only pay the download cost when the user actually
// opens the OCR flow.
const BillOCR = lazy(() => import('./BillOCR.js'));
const PAYMENT_STATUSES = ['Unpaid', 'Paid', 'Partial'];
// v1.10.69 (#71 item 3) - the same three colours the pill used, now shared
// with the dropdown in the records table.
const PAYMENT_STATUS_COLORS = {
    Unpaid: { bg: 'rgba(245, 158, 11, 0.14)', color: '#f59e0b' },
    Paid: { bg: 'rgba(5, 150, 105, 0.14)', color: '#059669' },
    Partial: { bg: 'rgba(139, 92, 246, 0.14)', color: '#8b5cf6' },
};
// cessPercent added in v1.6.8 (P1 #16) — suppliers of tobacco / aerated
// drinks / motor vehicles / coal charge GST + Cess. Without a slot for it,
// we couldn't reclaim ITC on the cess in GSTR-3B Table 4(A).
// v1.10.83 (#112) - unit is shown on purchase orders only; a bill made from
// a PO keeps it for the products it adds.
// _auto marks the 18% default as not typed by the user (see isOursToReplace),
// so picking a 12% product sets 12%. Before, the default was never replaced
// and every product picked on a new row came in at 18%.
const emptyItem = { name: '', hsn: '', quantity: 1, unit: '', rate: 0, taxPercent: 18, cessPercent: 0, _auto: { taxPercent: 18 } };
const emptyForm = {
    date: '', // v1.10.74 - set to localToday() when the form opens
    supplierName: '',
    // v1.10.29 — supplier address for the PDF header. Optional; blank
    // pre-v1.10.29 records fall through gracefully.
    supplierAddress: '',
    supplierGstin: '',
    invoiceNumber: '',
    items: [{ ...emptyItem }],
    paymentStatus: 'Unpaid',
    interstate: false, // true ⇒ supplier charged IGST; false ⇒ CGST + SGST. Routes ITC correctly in GSTR-3B.
    applyRoundOff: false, // off by default — purchase bill totals are usually pre-rounded by the supplier. Users with suppliers that don't pre-round can opt in here.
    note: '',
    // v1.10.83 (#112) - the same form edits purchase orders (kind 'po'): it
    // already knows suppliers, products and the GST split. fromPo links a bill
    // to the order it was made from.
    kind: 'bill',
    poNumber: '',
    expectedDate: '',
    fromPo: '',
    // v1.10.83 (#112) - optional; see utils/costCentres.js
    costCentre: '',
    costCentreName: '',
    // v1.10.83 - TDS you deduct from the supplier (194C, 194J...): worked out on
    // the value before GST at tdsRate, or the amount typed in tdsAmountManual.
    tdsOn: false,
    tdsSection: '194C',
    tdsRate: 1,
    tdsAmountManual: '',
};
// v1.10.83 (#112) - calcItemTax / calcPurchaseTotal moved to
// utils/purchaseOrders.js unchanged, shared with purchase orders.
// v1.10.6 — audit L4: local copy removed, imported from utils above.
// The TDS fields stored on a purchase bill (cleared when TDS is off).
const purchaseTdsFields = (form, taxable) => {
    if (!form.tdsOn)
        return { tdsAmount: 0, tdsSection: '', tdsRate: 0, tdsManual: false };
    const manual = String(form.tdsAmountManual ?? '').trim();
    return {
        tdsSection: form.tdsSection || '194C',
        tdsRate: parseFloat(form.tdsRate) || 0,
        tdsAmount: purchaseTdsAmount(taxable, form.tdsRate, manual),
        tdsManual: manual !== '',
    };
};
export default function PurchaseBills() {
    const [purchases, setPurchases] = useState([]);
    // v1.10.65 (#58 item 3) — the business these records belong to.
    const [ownerProfile, setOwnerProfile] = useState(null);
    // v1.10.54 (#42) — the Products & Services master, used to seed item
    // suggestions. Loaded on mount alongside purchases.
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    const [fyFilter, setFyFilter] = useState('');
    const [centreFilter, setCentreFilter] = useState('');
    const { on: ccOn, centres } = useCostCentres(ownerProfile);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ ...emptyForm, items: [{ ...emptyItem }] });
    // v1.10.22 — OCR modal state.
    const [showOCR, setShowOCR] = useState(false);
    // v1.10.30 — reported: "add a view only option modal type so can user
    // check the price without downloading the file every time". Holds the
    // purchase being previewed; modal has a Download PDF button inside.
    const [viewPurchase, setViewPurchase] = useState(null);
    // v1.10.83 (#123) - the bill whose supplier payments are open, and the
    // status filter ('' all, 'due' unpaid or partly paid, 'Paid').
    const [payPurchase, setPayPurchase] = useState(null);
    const [statusFilter, setStatusFilter] = useState('');
    // v1.10.83 (#112) - purchase orders, when switched on in Settings -> Features.
    const [poEnabled] = useState(() => isModuleEnabled('purchaseOrders', getEnabledModules()));
    const [tab, setTab] = useState('bills');
    const [orders, setOrders] = useState([]);
    // The number shown on a new PO; only that one is swapped for a reserved
    // number on save, so a number the user typed is kept.
    const previewedPoRef = useRef('');
    const applyOCR = (extracted) => {
        // v1.10.35 — Now consumes the richer payload from BillOCR:
        // extracted.items[] with name/hsn/qty/rate/taxPercent/amount, and
        // extracted.taxBreakdown with cgst/sgst/igst/cess. Falls back to
        // the old single-line-from-grand-total behaviour only if no line
        // items were detected at all.
        setEditingId(null);
        let items;
        if (Array.isArray(extracted.items) && extracted.items.length > 0) {
            // Trust the OCR-extracted line items. Strip the internal match
            // metadata (_matchedProductId etc.) since the purchase form
            // doesn't consume it.
            items = extracted.items.map(it => ({
                name: it.name || '',
                hsn: it.hsn || '',
                quantity: Number(it.quantity) || 1,
                rate: Number(it.rate) || 0,
                taxPercent: Number(it.taxPercent) || 0,
                cessPercent: 0,
            }));
        }
        else if (extracted.grandTotal > 0) {
            // Legacy fallback — no line items detected, seed a single-row
            // placeholder from the grand total so the user has something to
            // split.
            items = [{ name: 'From OCR — split into real items', hsn: '', quantity: 1, rate: extracted.grandTotal, taxPercent: 0, cessPercent: 0 }];
        }
        else {
            items = [{ ...emptyItem }];
        }
        // v1.10.74 - IGST on the bill and no CGST means the supplier is in
        // another state, so open the form with Inter-state ticked.
        const tb = extracted.taxBreakdown || {};
        setForm({
            ...emptyForm,
            date: extracted.date || localToday(),
            supplierName: extracted.supplierName || '',
            supplierGstin: extracted.supplierGstin || '',
            invoiceNumber: extracted.invoiceNumber || '',
            items,
            interstate: Number(tb.igst) > 0 && !Number(tb.cgst),
        });
        setShowForm(true);
        const msg = Array.isArray(extracted.items) && extracted.items.length > 0
            ? `OCR loaded ${extracted.items.length} line item${extracted.items.length === 1 ? '' : 's'} — review HSN + tax rates before saving.`
            : 'OCR values loaded — please review, then break the total into line items with correct GST.';
        toast(msg, 'info');
    };
    const fyOptions = getFYOptions();
    // v1.10.65 (#58 item 3) — assign records saved before businesses were kept
    // separate. Never automatic: only the user knows which business an old
    // record belonged to, so guessing would file it into the wrong books.
    const unassignedPurchases = purchases.filter(isUnassignedToBusiness);
    const assignUnassignedPurchases = async () => {
        await Promise.all(unassignedPurchases.map(r => savePurchase({
            ...r,
            ownerGstin: ownerProfile?.gstin || '',
            ownerName: ownerProfile?.businessName || '',
        })));
        loadPurchases();
    };
    const loadPurchases = async () => {
        try {
            const [rows, prof, pos] = await Promise.all([
                getAllPurchases(),
                getProfile().catch(() => null),
                poEnabled ? getAllPurchaseOrders().catch(() => []) : [],
            ]);
            setOwnerProfile(prof);
            // v1.10.65 (#58 item 3) — show only this business's records. Anything
            // saved before businesses were separated has no owner recorded and is
            // always shown, so nothing disappears from an existing ledger.
            setPurchases((rows || []).filter(r => belongsToProfile(r, prof)));
            setOrders((pos || []).filter(r => belongsToProfile(r, prof)));
        }
        catch {
            toast('Failed to load purchases', 'error');
        }
    };
    // v1.10.54 — reported (#42, @sangwanmail-eng): "Product not show properly
    // in purchase tab". The Products & Services master held Keyboard,
    // motherboard, Mouse, Pen drive — but the purchase item dropdown offered
    // "mouse", "key", "Pen drive": lowercase variants and a half-typed entry
    // from old bills, with two real products missing entirely.
    //
    // Cause: v1.10.50 built the suggestion list purely from what had been
    // TYPED on past purchase bills, and never read the product master. The
    // save path already calls getAllProducts() to update stock, so the data
    // was right there — it just was not being used for suggestions.
    const loadProducts = async () => {
        try {
            setProducts(await getAllProducts());
        }
        catch {
            // Non-fatal: suggestions fall back to purchase history alone.
        }
    };
    useEffect(() => {
        if (fyOptions[0])
            setFyFilter(fyOptions[0].value);
        loadPurchases();
        loadProducts();
    }, []);
    const filtered = purchases.filter(p => {
        if (search.trim()) {
            const q = search.toLowerCase();
            if (!(p.supplierName || '').toLowerCase().includes(q) &&
                !(p.invoiceNumber || '').toLowerCase().includes(q) &&
                !(p.supplierGstin || '').toLowerCase().includes(q))
                return false;
        }
        if (fyFilter) {
            const fy = fyOptions.find(f => f.value === fyFilter);
            if (fy && p.date) {
                if (p.date < fy.from || p.date > fy.to)
                    return false;
            }
        }
        if (statusFilter === 'due' && purchaseStatus(p) === 'Paid')
            return false;
        if (statusFilter === 'Paid' && purchaseStatus(p) !== 'Paid')
            return false;
        return matchesCentre(p, centreFilter);
    });
    const totalStats = filtered.reduce((acc, p) => {
        const t = calcPurchaseTotal(p.items, !!p.applyRoundOff);
        return { taxable: acc.taxable + t.taxable, tax: acc.tax + t.tax, total: acc.total + t.finalTotal, owed: acc.owed + purchaseBalance(p) };
    }, { taxable: 0, tax: 0, total: 0, owed: 0 });
    const openAdd = () => {
        setForm({ ...emptyForm, date: localToday(), items: [{ ...emptyItem }] });
        setEditingId(null);
        setShowForm(true);
    };
    const openEdit = (purchase) => {
        setForm({
            date: purchase.date || '',
            supplierName: purchase.supplierName || '',
            supplierAddress: purchase.supplierAddress || '',
            supplierGstin: purchase.supplierGstin || '',
            invoiceNumber: purchase.invoiceNumber || '',
            items: purchase.items && purchase.items.length > 0 ? purchase.items.map(i => ({ ...i })) : [{ ...emptyItem }],
            paymentStatus: purchase.paymentStatus || 'Unpaid',
            interstate: !!purchase.interstate,
            // Detect round-off from older entries: if roundOff field exists and is
            // non-zero, treat applyRoundOff as on. Older entries without the field
            // just default to off — they won't suddenly change totals on re-save.
            applyRoundOff: !!purchase.applyRoundOff || (typeof purchase.roundOff === 'number' && purchase.roundOff !== 0),
            note: purchase.note || '',
            kind: 'bill',
            poNumber: '',
            expectedDate: '',
            fromPo: purchase.fromPo || '',
            costCentre: purchase.costCentre || '',
            costCentreName: purchase.costCentreName || '',
            tdsOn: (Number(purchase.tdsAmount) || 0) > 0,
            tdsSection: purchase.tdsSection || '194C',
            tdsRate: purchase.tdsRate ?? 1,
            tdsAmountManual: purchase.tdsManual ? String(purchase.tdsAmount) : '',
        });
        setEditingId(purchase.id);
        setShowForm(true);
    };
    // v1.10.83 (#112) - a new purchase order, blank or copied from `from`
    // (Duplicate). The next number is shown at once; it is reserved on save.
    const openNewPo = async (from = null) => {
        const date = localToday();
        previewedPoRef.current = '';
        setForm({
            ...emptyForm,
            kind: 'po',
            date,
            ...(from ? {
                supplierName: from.supplierName || '',
                supplierAddress: from.supplierAddress || '',
                supplierGstin: from.supplierGstin || '',
                interstate: !!from.interstate,
                note: from.note || '',
            } : {}),
            items: from?.items?.length ? from.items.map(i => ({ ...i })) : [{ ...emptyItem }],
        });
        setEditingId(null);
        setShowForm(true);
        try {
            const next = await getNextPoNumber({ peek: true, businessKey: businessKeyOf(ownerProfile), date });
            previewedPoRef.current = next;
            setForm(prev => (prev.kind === 'po' && !prev.poNumber ? { ...prev, poNumber: next } : prev));
        }
        catch { /* offline: the user can type a number */ }
    };
    const openEditPo = (po) => {
        setForm({
            ...emptyForm,
            kind: 'po',
            date: po.date || '',
            expectedDate: po.expectedDate || '',
            poNumber: po.poNumber || '',
            supplierName: po.supplierName || '',
            supplierAddress: po.supplierAddress || '',
            supplierGstin: po.supplierGstin || '',
            interstate: !!po.interstate,
            note: po.note || '',
            costCentre: po.costCentre || '',
            costCentreName: po.costCentreName || '',
            items: po.items?.length ? po.items.map(i => ({ ...i })) : [{ ...emptyItem }],
        });
        setEditingId(po.id);
        setShowForm(true);
    };
    // Convert to purchase bill: the bill form, filled with what is still to
    // come on the order. Stock moves only when that bill is saved.
    const openBillFromPo = (po) => {
        setForm({ ...emptyForm, date: localToday(), ...billFormFromPo(po, purchases) });
        setEditingId(null);
        setShowForm(true);
    };
    const cancelPo = async (po) => {
        if (!await confirmAction({
            title: `Cancel ${po.poNumber || 'this purchase order'}?`,
            message: 'It keeps its number and can still be viewed and duplicated, but no longer edited or turned into a bill. Bills already saved from it stay as they are.',
            confirmLabel: 'Cancel order',
            cancelLabel: 'Keep it',
            tone: 'danger',
        }))
            return;
        try {
            await savePurchaseOrder({ ...po, cancelled: true, cancelledAt: new Date().toISOString() });
            toast(`${po.poNumber || 'Purchase order'} cancelled`, 'success');
            loadPurchases();
        }
        catch {
            toast('Could not cancel the purchase order', 'error');
        }
    };
    const handleSavePo = async () => {
        if (!form.date) {
            toast('PO date is required', 'warning');
            return;
        }
        if (!form.supplierName.trim()) {
            toast('Supplier name is required', 'warning');
            return;
        }
        const items = form.items
            .filter(i => (i.name || '').trim() && (parseFloat(i.quantity) || 0) > 0)
            .map(i => ({
            name: i.name.trim(),
            hsn: (i.hsn || '').trim(),
            quantity: parseFloat(i.quantity) || 0,
            unit: (i.unit || '').trim(),
            rate: parseFloat(i.rate) || 0,
            taxPercent: parseFloat(i.taxPercent) || 0,
            cessPercent: parseFloat(i.cessPercent) || 0,
        }));
        if (!items.length) {
            toast('Add at least one item with a quantity', 'warning');
            return;
        }
        const existing = editingId ? orders.find(o => o.id === editingId) : null;
        let poNumber = (form.poNumber || '').trim();
        try {
            if (!existing && (!poNumber || poNumber === previewedPoRef.current)) {
                poNumber = await getNextPoNumber({ businessKey: businessKeyOf(ownerProfile), date: form.date });
            }
        }
        catch {
            if (!poNumber) {
                toast('Could not get the next PO number. Type one in PO number.', 'error');
                return;
            }
        }
        if (orders.some(o => o.id !== editingId && String(o.poNumber || '').trim().toLowerCase() === poNumber.toLowerCase())) {
            setForm(prev => ({ ...prev, poNumber }));
            toast(`${poNumber} is already used by another purchase order`, 'warning');
            return;
        }
        const t = calcPurchaseTotal(items);
        try {
            await savePurchaseOrder({
                ...(existing || {}),
                poNumber,
                date: form.date,
                expectedDate: form.expectedDate || '',
                supplierName: form.supplierName.trim(),
                supplierAddress: (form.supplierAddress || '').trim(),
                supplierGstin: form.supplierGstin.trim(),
                interstate: !!form.interstate,
                // Same rule as receipts: an edited order keeps the business it had.
                ownerGstin: existing ? (existing.ownerGstin || '') : (ownerProfile?.gstin || ''),
                ownerName: existing ? (existing.ownerName || '') : (ownerProfile?.businessName || ''),
                items,
                note: (form.note || '').trim(),
                // v1.10.83 (#112) - cost centre on the order too (cleared when unpicked:
                // undefined drops the old value from the saved file).
                costCentre: undefined,
                costCentreName: undefined,
                ...centreFields(form.costCentre, form.costCentreName),
                taxableAmount: t.taxable,
                totalTax: t.tax,
                totalCess: t.cess,
                totalAmount: t.finalTotal,
                createdAt: existing?.createdAt || new Date().toISOString(),
            });
            toast(existing ? `${poNumber} updated` : `${poNumber} saved`, 'success');
            closeForm();
            loadPurchases();
        }
        catch {
            toast('Failed to save the purchase order', 'error');
        }
    };
    const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm({ ...emptyForm, items: [{ ...emptyItem }] });
    };
    // v1.10.29 — reported: "option to view as pdf give it that will be
    // better". Generates a simple one-page purchase-bill PDF with header,
    // supplier block, line items table, tax breakdown, and total. Uses
    // jsPDF's built-in text/rect helpers (same as the ledger PDF) so we
    // don't pull autotable and keep the bundle small.
    const viewAsPdf = async (purchase) => {
        try {
            const { jsPDF } = await import('jspdf');
            const t = calcPurchaseTotal(purchase.items, !!purchase.applyRoundOff);
            const doc = new jsPDF({ unit: 'mm', format: 'a4' });
            const marginL = 15, marginR = 195;
            let y = 20;
            const fmt = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text('PURCHASE BILL', marginL, y);
            y += 8;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100);
            doc.text(`Invoice #: ${purchase.invoiceNumber || '-'}`, marginL, y);
            y += 5;
            doc.text(`Date: ${purchase.date ? new Date(purchase.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}`, marginL, y);
            y += 5;
            doc.text(`Payment: ${PURCHASE_STATUS_LABEL[purchaseStatus(purchase)]}   ·   ${purchase.interstate ? 'Interstate (IGST)' : 'Intrastate (CGST+SGST)'}`, marginL, y);
            y += 8;
            doc.setDrawColor(...getAccentRGB());
            doc.setLineWidth(0.5);
            doc.line(marginL, y, marginR, y);
            y += 8;
            doc.setFontSize(11);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0);
            doc.text('Supplier', marginL, y);
            y += 6;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(purchase.supplierName || '-', marginL, y);
            y += 5;
            // v1.10.29 — supplier address (wraps at ~110mm so it doesn't collide
            // with anything on the right side of the header).
            if (purchase.supplierAddress) {
                const wrapped = doc.splitTextToSize(purchase.supplierAddress, 110);
                wrapped.forEach(line => { doc.text(line, marginL, y); y += 5; });
            }
            if (purchase.supplierGstin) {
                doc.text(`GSTIN: ${purchase.supplierGstin}`, marginL, y);
                y += 5;
            }
            y += 4;
            // Items header
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text('#', marginL, y);
            doc.text('Description', marginL + 8, y);
            doc.text('HSN', marginL + 80, y);
            doc.text('Qty', marginL + 100, y, { align: 'right' });
            doc.text('Rate', marginL + 122, y, { align: 'right' });
            doc.text('GST%', marginL + 140, y, { align: 'right' });
            doc.text('Amount', marginR, y, { align: 'right' });
            y += 2;
            doc.setLineWidth(0.2);
            doc.line(marginL, y, marginR, y);
            y += 5;
            doc.setFont('helvetica', 'normal');
            (purchase.items || []).forEach((item, idx) => {
                if (y > 265) {
                    doc.addPage();
                    y = 20;
                }
                const lineTotal = (Number(item.quantity) || 0) * (Number(item.rate) || 0);
                const withTax = lineTotal * (1 + (Number(item.taxPercent) || 0) / 100);
                // v1.10.30 — reported: "in purchase bill pdf long names got cut in
                // pdf fix". Prior code used `.slice(0, 40)` which mid-word truncated
                // "4 Copier Paper (Pack of..." → "4 Copier Paper (Pack o". Now we
                // wrap the description into as many lines as needed (70mm column
                // width). The row height grows to fit the wrapped text so nothing
                // clips into the next line.
                const nameCol = 70; // mm — width of description column
                const nameLines = doc.splitTextToSize(String(item.name || '-'), nameCol);
                const rowH = Math.max(6, nameLines.length * 4.5);
                // Page break if this row won't fit.
                if (y + rowH > 275) {
                    doc.addPage();
                    y = 20;
                }
                doc.text(String(idx + 1), marginL, y);
                // Description wraps top-aligned.
                nameLines.forEach((line, lineIdx) => {
                    doc.text(line, marginL + 8, y + lineIdx * 4.5);
                });
                // Everything else aligns to the top of the row (so it lines up
                // with the first line of the wrapped description).
                doc.text(String(item.hsn || '-'), marginL + 80, y);
                doc.text(String(item.quantity || 0), marginL + 100, y, { align: 'right' });
                doc.text(fmt(item.rate), marginL + 122, y, { align: 'right' });
                doc.text(String(item.taxPercent || 0) + '%', marginL + 140, y, { align: 'right' });
                doc.text(fmt(withTax), marginR, y, { align: 'right' });
                y += rowH;
            });
            // Totals
            y += 4;
            doc.setDrawColor(...getAccentRGB());
            doc.setLineWidth(0.4);
            doc.line(marginL + 100, y, marginR, y);
            y += 6;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(80);
            doc.text('Taxable', marginL + 100, y);
            doc.text(fmt(t.taxable), marginR, y, { align: 'right' });
            y += 5;
            // v1.10.74 - show the tax split instead of one combined line.
            if (purchase.interstate) {
                doc.text('IGST', marginL + 100, y);
                doc.text(fmt(t.tax), marginR, y, { align: 'right' });
                y += 5;
            }
            else {
                const sp = splitPurchaseTax(t.tax, false);
                doc.text('CGST', marginL + 100, y);
                doc.text(fmt(sp.cgst), marginR, y, { align: 'right' });
                y += 5;
                doc.text('SGST', marginL + 100, y);
                doc.text(fmt(sp.sgst), marginR, y, { align: 'right' });
                y += 5;
            }
            if (t.cess > 0.005) {
                doc.text('Cess', marginL + 100, y);
                doc.text(fmt(t.cess), marginR, y, { align: 'right' });
                y += 5;
            }
            if (Math.abs(t.roundOff) > 0.005) {
                doc.text('Round-off', marginL + 100, y);
                doc.text((t.roundOff > 0 ? '+' : '') + fmt(t.roundOff), marginR, y, { align: 'right' });
                y += 5;
            }
            y += 2;
            doc.setDrawColor(0);
            doc.setLineWidth(0.5);
            doc.line(marginL + 100, y, marginR, y);
            y += 6;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text('TOTAL', marginL + 100, y);
            doc.text(fmt(t.finalTotal), marginR, y, { align: 'right' });
            if ((Number(purchase.tdsAmount) || 0) > 0) {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                y += 6;
                doc.text(`Less: TDS (${String(purchase.tdsSection || '').replace(/-(co|tech|pm)$/, '')})`, marginL + 100, y);
                doc.text('-' + fmt(purchase.tdsAmount), marginR, y, { align: 'right' });
                y += 5;
                doc.setFont('helvetica', 'bold');
                doc.text('Paid to supplier', marginL + 100, y);
                doc.text(fmt(t.finalTotal - purchase.tdsAmount), marginR, y, { align: 'right' });
            }
            // v1.10.83 (#123) - payments made to the supplier, and what is left.
            const pays = purchase.payments || [];
            if (pays.length) {
                y += 12;
                if (y + 14 + pays.length * 5 > 280) {
                    doc.addPage();
                    y = 20;
                }
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(10);
                doc.setTextColor(0);
                doc.text('Payments made', marginL, y);
                y += 2;
                doc.setLineWidth(0.2);
                doc.line(marginL, y, marginR, y);
                y += 5;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                for (const x of pays) {
                    if (y > 280) {
                        doc.addPage();
                        y = 20;
                    }
                    const when = x.date ? new Date(`${x.date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                    doc.text(when, marginL, y);
                    doc.text(purchasePaymentModeName(x.mode), marginL + 30, y);
                    doc.text(doc.splitTextToSize([x.reference, x.note].filter(Boolean).join(' · ') || '', 90)[0] || '', marginL + 60, y);
                    doc.text(fmt(x.amount), marginR, y, { align: 'right' });
                    y += 5;
                }
            }
            if (pays.length || purchaseStatus(purchase) === 'Paid') {
                y += pays.length ? 1 : 8;
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(0);
                if (pays.length) {
                    doc.text('Paid', marginL + 100, y);
                    doc.text(fmt(purchasePaid(purchase)), marginR, y, { align: 'right' });
                    y += 5;
                }
                doc.setFont('helvetica', 'bold');
                doc.text('Balance due', marginL + 100, y);
                doc.text(fmt(purchaseBalance(purchase)), marginR, y, { align: 'right' });
            }
            if (purchase.note) {
                y += 14;
                doc.setFontSize(9);
                doc.setFont('helvetica', 'italic');
                doc.setTextColor(90);
                doc.text('Note: ' + purchase.note, marginL, y);
            }
            const safeInv = String(purchase.invoiceNumber || 'purchase').replace(/[^A-Za-z0-9._-]/g, '_');
            const filename = `Purchase-${safeInv}-${purchase.date || 'undated'}.pdf`;
            doc.save(filename);
        }
        catch (err) {
            console.error('Purchase PDF failed:', err);
            toast('Could not generate PDF — see console', 'error');
        }
    };
    const handleSave = async () => {
        if (form.kind === 'po')
            return handleSavePo();
        if (!form.supplierName.trim()) {
            toast('Supplier name is required', 'warning');
            return;
        }
        if (!form.invoiceNumber.trim()) {
            toast('Invoice number is required', 'warning');
            return;
        }
        // v1.10.58 — reported (#47 item 2, @sangwanmail-eng): "Purchase also
        // save without adding any product." Supplier and invoice number were
        // checked, but nothing verified the bill had any line items, so an
        // empty bill saved with a zero total.
        //
        // That is not merely untidy: a purchase bill is the ITC record. A zero
        // bill sits in GSTR-3B reconciliation as a vendor invoice claiming
        // nothing, and the empty rows also feed the stock/product sync on save.
        if (!form.items.some(i => (i.name || '').trim() && (parseFloat(i.quantity) || 0) * (parseFloat(i.rate) || 0) > 0)) {
            toast('Add at least one item with a quantity and rate', 'warning');
            return;
        }
        try {
            const totals = calcPurchaseTotal(form.items, form.applyRoundOff);
            const before = editingId ? purchases.find(p => p.id === editingId) : null;
            const purchaseFields = {
                ...(editingId ? { id: editingId } : {}),
                date: form.date,
                supplierName: form.supplierName.trim(),
                supplierAddress: (form.supplierAddress || '').trim(),
                supplierGstin: form.supplierGstin.trim(),
                invoiceNumber: form.invoiceNumber.trim(),
                // Which of YOUR businesses bought this. Distinct from supplierGstin
                // directly above, which is who sold it.
                ownerGstin: ownerProfile?.gstin || '',
                ownerName: ownerProfile?.businessName || '',
                items: form.items.map(i => ({
                    name: (i.name || '').trim(),
                    hsn: (i.hsn || '').trim(),
                    quantity: parseFloat(i.quantity) || 0,
                    rate: parseFloat(i.rate) || 0,
                    taxPercent: parseFloat(i.taxPercent) || 0,
                    cessPercent: parseFloat(i.cessPercent) || 0,
                    // v1.10.83 (#112) - only lines from a purchase order carry a unit.
                    ...(String(i.unit || '').trim() ? { unit: String(i.unit).trim() } : {}),
                })),
                // The purchase order this bill was made from; its status follows the
                // quantities on the bills linked to it.
                ...(form.fromPo ? { fromPo: form.fromPo } : {}),
                // totalAmount is the grand total INCLUDING round-off so the table
                // sum and GSTR-3B reconciliation both reflect what the supplier
                // actually charged. roundOff stored separately for audit clarity.
                totalAmount: totals.finalTotal,
                totalTax: totals.tax,
                taxableAmount: totals.taxable,
                applyRoundOff: !!form.applyRoundOff,
                roundOff: totals.roundOff,
                paymentStatus: form.paymentStatus,
                interstate: !!form.interstate,
                note: form.note.trim(),
                ...centreFields(form.costCentre, form.costCentreName),
                ...purchaseTdsFields(form, totals.taxable),
            };
            // v1.10.83 (#123) - payments to the supplier stay with the bill when it
            // is edited, and the status follows them (and a new total or TDS). With
            // no payments, choosing Paid records one for the balance, as the list
            // does; an old bill already marked Paid keeps its mark.
            let purchase = purchaseFields;
            if (hasPurchasePayments(before)) {
                purchase = withPurchasePayments(purchaseFields, before.payments);
                if (purchasePaid(purchase) > purchaseOwed(purchase) + OVERPAY_SLACK) {
                    toast(`Payments of ${formatCurrency(purchasePaid(purchase))} are already recorded, more than this bill now comes to (${formatCurrency(purchaseOwed(purchase))}). Change or delete a payment first (₹ button in the list).`, 'warning');
                    return;
                }
            }
            else if (form.paymentStatus === 'Paid' && (before?.paymentStatus || 'Unpaid') !== 'Paid') {
                purchase = markPurchasePaid(purchaseFields, localToday());
            }
            await savePurchase(purchase);
            // v1.10.29 — reported: "items added in purchase bill also available
            // for sale means automatically added to the product page too".
            // On save, upsert each line item into Products. Match by trimmed
            // lowercase name to avoid duplicates. For existing products we
            // update purchasePrice (latest cost) but leave sellingPrice alone
            // so we don't accidentally overwrite the user's margin. For new
            // products we seed sellingPrice = purchasePrice as a starting
            // point (user can raise it in Inventory later). Runs in parallel
            // and non-fatal — a single-item failure doesn't block the
            // purchase-bill save.
            // v1.10.31 — Data-F10.1-3: delta-based stock sync. Previously stock
            // was incremented only on FIRST save (create). If the user edited the
            // purchase later — changing qty from 10 → 20, or removing a line, or
            // renaming a line — the product's stock stayed at 10 (F10.1) or a
            // duplicate product was created (F10.3). Now:
            //   • Save (edit path): compute per-line delta from the pre-edit
            //     snapshot; apply that delta to each existing product's stock.
            //   • Save (create path): increment stock by full quantity.
            //   • Rename detection: match by productId first (persisted below),
            //     then by name — a rename with productId keeps the same product.
            try {
                const existingProducts = await getAllProducts();
                const byName = new Map(existingProducts.map(p => [(p.name || '').trim().toLowerCase(), p]));
                const byId = new Map(existingProducts.map(p => [p.id, p]));
                // Pre-edit snapshot: on edit, compute deltas per productId/name.
                const priorLines = editingId
                    ? (purchases.find(p => p.id === editingId)?.items || [])
                    : [];
                const priorQtyByKey = new Map();
                for (const p of priorLines) {
                    const key = p.productId || `name:${(p.name || '').trim().toLowerCase()}`;
                    priorQtyByKey.set(key, (priorQtyByKey.get(key) || 0) + (Number(p.quantity) || 0));
                }
                // Batch stock adjustments per product so we don't race on parallel saves.
                const stockDeltaById = new Map();
                const productsToUpsert = new Map();
                const seenPriorKeys = new Set();
                for (const it of purchase.items.filter(x => x.name)) {
                    const qty = Number(it.quantity) || 0;
                    // Match order: productId (persisted below) → name (case-insensitive).
                    let existing = it.productId ? byId.get(it.productId) : null;
                    if (!existing) {
                        const key = it.name.trim().toLowerCase();
                        existing = byName.get(key);
                    }
                    if (existing) {
                        // Delta = current qty − prior qty (for this product).
                        const priorKey = it.productId
                            ? it.productId
                            : `name:${(it.name || '').trim().toLowerCase()}`;
                        const priorQty = priorQtyByKey.get(priorKey) || 0;
                        seenPriorKeys.add(priorKey);
                        const delta = qty - priorQty; // may be negative (line reduced) or zero (unchanged)
                        stockDeltaById.set(existing.id, (stockDeltaById.get(existing.id) || 0) + delta);
                        productsToUpsert.set(existing.id, {
                            ...existing,
                            purchasePrice: it.rate,
                            hsn: existing.hsn || it.hsn,
                            taxPercent: existing.taxPercent || it.taxPercent,
                            cessPercent: existing.cessPercent || it.cessPercent || 0,
                            // stock filled after we sum all deltas for this product.
                            _placeholderId: existing.id,
                        });
                    }
                    else {
                        // New product — seed stock with the line qty (all its lines: two
                        // lines of the same new item used to keep only the last one's).
                        const newKey = `__new__::${it.name.trim().toLowerCase()}`;
                        const seeded = Number(productsToUpsert.get(newKey)?.stock) || 0;
                        productsToUpsert.set(newKey, {
                            name: it.name.trim(),
                            hsn: it.hsn || '',
                            purchasePrice: it.rate,
                            sellingPrice: it.rate,
                            rate: it.rate,
                            taxPercent: it.taxPercent || 0,
                            cessPercent: it.cessPercent || 0,
                            unit: it.unit || 'Nos',
                            stock: roundQty(seeded + qty),
                            description: '',
                        });
                    }
                }
                // Rows removed while editing: their stock was added when the bill was
                // first saved, so take it back out (it used to stay in stock forever).
                for (const [key, priorQty] of priorQtyByKey) {
                    if (seenPriorKeys.has(key))
                        continue;
                    const gone = key.startsWith('name:') ? byName.get(key.slice(5)) : byId.get(key);
                    if (!gone)
                        continue;
                    stockDeltaById.set(gone.id, (stockDeltaById.get(gone.id) || 0) - priorQty);
                    if (!productsToUpsert.has(gone.id))
                        productsToUpsert.set(gone.id, { ...gone, _placeholderId: gone.id });
                }
                // Apply deltas + write.
                const upserts = [];
                for (const [, prod] of productsToUpsert) {
                    if (prod._placeholderId) {
                        const existing = byId.get(prod._placeholderId);
                        const delta = stockDeltaById.get(prod._placeholderId) || 0;
                        // Not clamped at 0: sales may take stock below zero, and clamping
                        // here made a purchase edit and its undo leave different stock
                        // (stock 2, reduce a purchase by 5 -> 0, put it back -> 5).
                        const newStock = roundQty((Number(existing.stock) || 0) + delta);
                        upserts.push(saveProduct({ ...prod, stock: newStock, _placeholderId: undefined }));
                    }
                    else {
                        upserts.push(saveProduct(prod));
                    }
                }
                await Promise.all(upserts);
                toast(editingId ? 'Purchase updated' : 'Purchase added — items synced to Products', 'success');
            }
            catch (e) {
                console.warn('Products auto-sync from purchase failed (non-fatal):', e);
                toast('Purchase saved, but updating stock in Products failed - check them there', 'warning');
            }
            closeForm();
            loadPurchases();
            // v1.10.54 — saving a bill upserts its items into the product master
            // (that is what the toast above means by "synced to Products"), so
            // refresh it too. Otherwise a brand-new item would not appear in the
            // suggestions until the page was reloaded.
            loadProducts();
        }
        catch {
            toast('Failed to save purchase', 'error');
        }
    };
    // v1.10.69 (#71 item 3) - change the payment status straight from the list.
    // Saves the whole record back, so nothing else about the bill is disturbed;
    // the list is reloaded afterwards so the supplier-payable totals follow.
    // v1.10.83 (#123) - Paid records one payment for the balance, Unpaid takes
    // that payment back (yours stay), Partly paid opens Record payment for the
    // amount. See utils/purchasePayments.js.
    const changePaymentStatus = async (purchase, paymentStatus) => {
        if (purchaseStatus(purchase) === paymentStatus)
            return;
        if (paymentStatus === 'Partial') {
            setPayPurchase(purchase);
            return;
        }
        const next = paymentStatus === 'Paid' ? markPurchasePaid(purchase, localToday()) : markPurchaseUnpaid(purchase);
        try {
            await savePurchase(next);
            const now = purchaseStatus(next);
            toast(now === paymentStatus ? `Marked ${PURCHASE_STATUS_LABEL[now].toLowerCase()}`
                : `Now ${PURCHASE_STATUS_LABEL[now].toLowerCase()}: payments you recorded stay. Delete them with the ₹ button.`, now === paymentStatus ? 'success' : 'info');
            loadPurchases();
        }
        catch {
            toast('Could not change the status', 'error');
        }
    };
    // Take a deleted bill's quantities back out of product stock.
    // Matches products the same way saving does: productId, then name.
    const revertPurchaseStock = async (bill) => {
        const lines = (bill?.items || []).filter(it => it.name && Number(it.quantity) > 0);
        if (!lines.length)
            return;
        const products = await getAllProducts();
        const byName = new Map(products.map(p => [(p.name || '').trim().toLowerCase(), p]));
        const byId = new Map(products.map(p => [p.id, p]));
        const minus = new Map();
        for (const it of lines) {
            const prod = (it.productId && byId.get(it.productId)) || byName.get(it.name.trim().toLowerCase());
            if (prod)
                minus.set(prod.id, (minus.get(prod.id) || 0) + Number(it.quantity));
        }
        await Promise.all([...minus].map(([pid, qty]) => {
            const prod = byId.get(pid);
            return saveProduct({ ...prod, stock: roundQty((Number(prod.stock) || 0) - qty) });
        }));
    };
    const handleDelete = async (id) => {
        // A bill's payments are kept only on the bill, so they go with it.
        const target = purchases.find(p => p.id === id);
        const paidNote = hasPurchasePayments(target)
            ? ` Its payments of ${formatCurrency(purchasePaid(target))} are deleted with it and leave the Cash book. To re-enter the bill, edit it instead.`
            : '';
        if (await confirmAction({
            title: 'Delete this purchase bill?',
            message: `Stock levels for the products in this bill will be reverted. Any GST ITC already claimed against this bill in past returns stays as filed.${paidNote}`,
            confirmLabel: 'Delete',
            tone: 'danger',
        })) {
            try {
                const bill = purchases.find(p => p.id === id);
                await deletePurchase(id);
                // The confirm above promises this: the bill's quantities were added to
                // stock when it was saved, so deleting it takes them back out.
                let stockOk = true;
                try {
                    await revertPurchaseStock(bill);
                }
                catch (e) {
                    stockOk = false;
                    console.warn('Stock revert failed', e);
                }
                toast(stockOk ? 'Purchase deleted' : 'Purchase deleted, but its stock could not be taken out of Products', stockOk ? 'success' : 'warning');
                loadPurchases();
            }
            catch {
                toast('Failed to delete', 'error');
            }
        }
    };
    // v1.10.50 — reported (#39, @sangwanmail-eng): "In add purchase option
    // previous added supplier and item not shown. So all details need to be
    // fill again, like supplier name, gst number, address, item name etc".
    //
    // Purchase bills store supplier details INLINE (supplierName /
    // supplierGstin / supplierAddress) rather than against a supplier master
    // record, so unlike the invoice side — which has saved clients and
    // product suggestions — there was nothing to recall and every bill meant
    // retyping the GSTIN by hand. For someone entering a stack of bills from
    // the same three or four vendors that is the bulk of the typing, and a
    // mistyped GSTIN quietly breaks ITC reconciliation in GSTR-3B.
    //
    // Rather than introduce a supplier master (a migration, and a second
    // place for the same data to drift), derive the history from the bills
    // already loaded in `purchases`. Newest first, so the most recent
    // spelling of a supplier wins.
    const supplierHistory = useMemo(() => {
        const seen = new Map();
        for (const p of purchases) {
            const name = (p.supplierName || '').trim();
            if (!name)
                continue;
            const key = name.toLowerCase();
            // First wins: `purchases` arrives newest-first, so this keeps the
            // most recent details for a supplier rather than the oldest.
            if (!seen.has(key)) {
                seen.set(key, {
                    name,
                    gstin: (p.supplierGstin || '').trim(),
                    address: (p.supplierAddress || '').trim(),
                    interstate: !!p.interstate,
                });
            }
        }
        return [...seen.values()];
    }, [purchases]);
    // v1.10.54 (#42) — suggestions come from the product master FIRST, then
    // anything else that has been typed on a past bill.
    //
    // Order matters: the master is inserted first and the map is first-wins,
    // so "Mouse" from Products beats a stray "mouse" typed on an old bill.
    // Deduping is case-insensitive for the same reason — the user should see
    // one entry with the spelling they curated, not two differing in case.
    //
    // Purchase-only names are still kept. A one-off item bought once and
    // never added to the catalogue is legitimate history, and there is no
    // reliable way to tell that apart from an old typo — so both stay, and
    // the user decides.
    const itemHistory = useMemo(() => {
        const seen = new Map();
        for (const pr of products) {
            const name = (pr.name || '').trim();
            if (!name)
                continue;
            seen.set(name.toLowerCase(), {
                name,
                hsn: (pr.hsn || '').trim(),
                // purchasePrice is what we PAY a supplier; `rate`/sellingPrice is
                // what we charge a customer. On a purchase bill the former is the
                // sensible prefill.
                rate: Number(pr.purchasePrice) || Number(pr.rate) || 0,
                taxPercent: Number(pr.taxPercent) || 0,
                cessPercent: Number(pr.cessPercent) || 0,
                unit: String(pr.unit || '').trim(),
            });
        }
        for (const p of purchases) {
            for (const it of (p.items || [])) {
                const name = (it.name || '').trim();
                if (!name)
                    continue;
                const key = name.toLowerCase();
                if (!seen.has(key)) {
                    seen.set(key, {
                        name,
                        hsn: (it.hsn || '').trim(),
                        rate: Number(it.rate) || 0,
                        taxPercent: Number(it.taxPercent) || 0,
                        cessPercent: Number(it.cessPercent) || 0,
                        unit: String(it.unit || '').trim(),
                    });
                }
            }
        }
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }, [products, purchases]);
    const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
    // v1.10.76 (#82) - a full supplier GSTIN sets "Inter-state" from the two
    // states, the way sales invoices already work it out. The box stays
    // editable for the rare exception.
    const updateSupplierGstin = (value) => setForm(prev => {
        const interstate = isInterstateSupply(value, ownerProfile);
        return interstate === null ? { ...prev, supplierGstin: value } : { ...prev, supplierGstin: value, interstate };
    });
    // Typing or picking a known supplier fills in the rest of their details.
    //
    // Deliberately only fills fields the user has left BLANK. Overwriting
    // whatever they already typed would be worse than not helping — someone
    // correcting a supplier's new GSTIN would watch the old one reappear as
    // they finished typing the name.
    const updateSupplierName = (value) => {
        const match = supplierHistory.find(s => s.name.toLowerCase() === value.trim().toLowerCase());
        setForm(prev => {
            const next = { ...prev, supplierName: value };
            if (match) {
                // v1.10.55 (#43) — same re-selection bug as the item rows, and worse
                // here: switching supplier used to leave the PREVIOUS supplier's
                // GSTIN in place, so the bill was filed against the wrong taxpayer
                // and ITC reconciliation broke. See isOursToReplace above.
                const last = prev._autoSupplier || {};
                if (isOursToReplace(prev.supplierGstin, last.gstin))
                    next.supplierGstin = match.gstin;
                if (isOursToReplace(prev.supplierAddress, last.address))
                    next.supplierAddress = match.address;
                // Interstate drives CGST+SGST vs IGST, so recall it too — it is a
                // property of where the supplier is, and getting it wrong routes
                // ITC to the wrong GSTR-3B column.
                next.interstate = match.interstate;
                next._autoSupplier = { gstin: match.gstin, address: match.address };
            }
            return next;
        });
    };
    // Same idea for line items: recall HSN, rate and tax rates from the last
    // time this item was purchased. Rate is filled only when still 0 so a
    // price change the user has already typed is never clobbered.
    // v1.10.55 — reported (#43, @sangwanmail-eng): "when we select item all
    // details fetch ok. But when we change item in same field details not
    // change."
    //
    // v1.10.50 filled a field only when it was BLANK, to avoid overwriting
    // something the user had typed. That protected typed input but broke
    // re-selection: pick "Pen drive" (HSN fills to `s`), then change the same
    // row to "Mouse" — HSN is no longer blank, so it stayed on Pen drive's
    // value. The bill then carried the wrong HSN and the wrong rate, silently.
    //
    // The flaw was treating "field is non-empty" as "user typed this". We now
    // record what WE auto-filled on the row (`_auto`, transient — the save
    // path whitelists fields, so it never persists). A field is ours to
    // replace when it is empty or still holds exactly what we last put there;
    // once the user edits it, it stops matching and we leave it alone.
    //
    // So: re-selecting updates the details, and a hand-typed correction still
    // survives — both, rather than one at the cost of the other.
    const isOursToReplace = (current, lastAuto) => {
        const cur = current === undefined || current === null ? '' : String(current).trim();
        if (cur === '' || cur === '0')
            return true; // never filled, or still zero
        if (lastAuto === undefined || lastAuto === null)
            return false;
        return cur === String(lastAuto).trim(); // untouched since we filled it
    };
    const updateItemName = (index, value) => {
        const match = itemHistory.find(i => i.name.toLowerCase() === value.trim().toLowerCase());
        setForm(prev => {
            const items = [...prev.items];
            const cur = { ...items[index], name: value };
            if (match) {
                const last = cur._auto || {};
                if (isOursToReplace(cur.hsn, last.hsn))
                    cur.hsn = match.hsn;
                if (isOursToReplace(cur.rate, last.rate))
                    cur.rate = match.rate;
                // A product with no GST rate saved keeps the row's default (18%), as
                // the invoice screen does, instead of turning it into 0%.
                const hasRate = match.taxPercent !== undefined && match.taxPercent !== null && match.taxPercent !== '';
                if (hasRate && isOursToReplace(cur.taxPercent, last.taxPercent))
                    cur.taxPercent = match.taxPercent;
                if (isOursToReplace(cur.cessPercent, last.cessPercent))
                    cur.cessPercent = match.cessPercent;
                // v1.10.83 (#112) - unit only on a purchase order; bills have no unit field.
                if (prev.kind === 'po' && isOursToReplace(cur.unit, last.unit))
                    cur.unit = match.unit;
                // Remember exactly what we just wrote, so the next re-selection can
                // tell our values apart from the user's.
                cur._auto = {
                    hsn: match.hsn,
                    rate: match.rate,
                    taxPercent: cur.taxPercent,
                    cessPercent: match.cessPercent,
                    unit: match.unit,
                };
            }
            items[index] = cur;
            return { ...prev, items };
        });
    };
    const updateItem = (index, field, value) => {
        setForm(prev => {
            const items = [...prev.items];
            items[index] = { ...items[index], [field]: value };
            return { ...prev, items };
        });
    };
    const addItem = () => {
        // Tag the new row so we can focus its first input after the browser updates the row.
        // Tab → Enter on the Add Item button now keeps the user in keyboard
        // flow instead of forcing a mouse click on the empty row.
        const focusKey = 'new-' + Date.now();
        setForm(prev => ({ ...prev, items: [...prev.items, { ...emptyItem, _focusKey: focusKey }] }));
        requestAnimationFrame(() => {
            const el = document.querySelector(`[data-focus-key="${focusKey}"] input.form-input`);
            if (el)
                el.focus();
        });
    };
    const removeItem = (index) => {
        if (form.items.length <= 1)
            return;
        setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
    };
    // v1.10.77 (#85) - the purchase register as CSV, Excel or Print / PDF, with
    // a total row. v1.10.74 columns kept: Cess and Inter-state; Tax never
    // included cess.
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const registerRows = (() => {
        if (!filtered.length)
            return [];
        const sum = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, roundOff: 0, finalTotal: 0, paid: 0, balance: 0 };
        const rows = [...filtered].sort((x, y) => String(x.date || '').localeCompare(String(y.date || ''))).map(p => {
            const t = { ...calcPurchaseTotal(p.items, !!p.applyRoundOff), paid: purchasePaid(p), balance: purchaseBalance(p) };
            Object.assign(t, splitPurchaseTax(t.tax, !!p.interstate));
            for (const k of Object.keys(sum))
                sum[k] += Number(t[k]) || 0;
            return [p.date || '', p.supplierName || '', p.supplierGstin || '', p.invoiceNumber || '', r2(t.taxable), r2(t.cgst), r2(t.sgst), r2(t.igst), r2(t.cess),
                p.interstate ? 'Y' : 'N', r2(t.roundOff), r2(t.finalTotal), r2(t.paid), r2(t.balance), PURCHASE_STATUS_LABEL[purchaseStatus(p)], p.note || ''];
        });
        return [...rows, ['Total', '', '', '', r2(sum.taxable), r2(sum.cgst), r2(sum.sgst), r2(sum.igst), r2(sum.cess), '', r2(sum.roundOff), r2(sum.finalTotal), r2(sum.paid), r2(sum.balance), '', '']];
    })();
    const isPo = form.kind === 'po';
    const editingBill = !isPo && editingId ? purchases.find(p => p.id === editingId) : null;
    const fromPoNumber = form.fromPo ? orders.find(o => o.id === form.fromPo)?.poNumber : '';
    const formTotals = calcPurchaseTotal(form.items, !isPo && form.applyRoundOff);
    const formTds = !isPo && form.tdsOn ? purchaseTdsFields(form, formTotals.taxable).tdsAmount : 0;
    return (h("div", { className: "dashboard-container" },
        h("div", { className: "page-header" },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h("div", null,
                    h("h1", { className: "page-title" },
                        poEnabled ? 'Purchases' : 'Purchase Bills',
                        " ",
                        h(HelpButton, { title: "Purchase Bills \u2014 how to use", doc: "purchases", size: 16 })),
                    h("p", { className: "page-subtitle" }, "Track supplier invoices for ITC claims in GSTR-3B"))),
            tab === 'orders' ? (h("div", { className: "flex gap-2" },
                h("button", { className: "btn btn-primary", onClick: () => openNewPo() },
                    h(Plus, { size: 18 }),
                    " New purchase order"))) : (h("div", { className: "flex gap-2", style: { flexWrap: 'wrap' } },
                h("button", { className: "btn btn-secondary", onClick: () => setShowOCR(true), title: "Extract fields from a bill photo/scan" },
                    h(Wand2, { size: 16 }),
                    " Import from image (OCR)"),
                h(BulkCsvImport, { kind: "purchase", onDone: () => { loadPurchases(); loadProducts(); } }),
                h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Add Purchase")))),
        poEnabled && (h("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
            h("button", { className: `btn ${tab === 'bills' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setTab('bills'), "aria-pressed": tab === 'bills' },
                h(ShoppingCart, { size: 16 }),
                " Purchase bills"),
            h("button", { className: `btn ${tab === 'orders' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setTab('orders'), "aria-pressed": tab === 'orders' },
                h(ClipboardList, { size: 16 }),
                " Purchase orders"))),
        tab === 'orders' && (h(PurchaseOrders, { orders: orders, purchases: purchases, ownerProfile: ownerProfile, onNew: () => openNewPo(), onEdit: openEditPo, onConvert: openBillFromPo, onDuplicate: openNewPo, onCancel: cancelPo })),
        showOCR && (h(Suspense, { fallback: h("div", { className: "modal-overlay" },
                h("div", { className: "modal-content", style: { maxWidth: 320, textAlign: 'center' } }, "Loading OCR\u2026")) },
            h(BillOCR, { onClose: () => setShowOCR(false), onExtracted: applyOCR }))),
        viewPurchase && (() => {
            const p = viewPurchase;
            const t = calcPurchaseTotal(p.items, !!p.applyRoundOff);
            return (h("div", { className: "modal-overlay", onClick: () => setViewPurchase(null) },
                h("div", { className: "modal-content", onClick: e => e.stopPropagation(), style: { maxWidth: 720 } },
                    h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' } },
                        h("h3", { className: "section-title", style: { margin: 0 } },
                            "Purchase Bill \u00B7 ",
                            p.invoiceNumber || '—',
                            " ",
                            h(HelpButton, { title: "Viewing a purchase bill", doc: "purchases#view-bill", size: 16 })),
                        h("button", { className: "icon-btn", onClick: () => setViewPurchase(null), title: "Close" },
                            h(X, { size: 18 }))),
                    h("div", { style: { fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' } },
                        p.date ? new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
                        " \u00B7 ",
                        PURCHASE_STATUS_LABEL[purchaseStatus(p)],
                        " \u00B7 ",
                        p.interstate ? 'Interstate (IGST)' : 'Intrastate (CGST+SGST)'),
                    h("div", { style: { background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: 6, marginBottom: '1rem' } },
                        h("div", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 } }, "Supplier"),
                        h("div", { style: { fontWeight: 600 } }, p.supplierName || '—'),
                        p.supplierAddress && h("div", { style: { fontSize: '0.85rem', color: 'var(--text-muted)' } }, p.supplierAddress),
                        p.supplierGstin && h("div", { style: { fontSize: '0.82rem' } },
                            "GSTIN: ",
                            h("strong", null, p.supplierGstin))),
                    h("div", { style: { overflowX: 'auto', maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: '1rem' } },
                        h("table", { className: "data-table", style: { fontSize: '0.82rem', width: '100%', minWidth: 500 } },
                            h("thead", null,
                                h("tr", null,
                                    h("th", null, "#"),
                                    h("th", null, "Description"),
                                    h("th", null, "HSN"),
                                    h("th", { style: { textAlign: 'right' } }, "Qty"),
                                    h("th", { style: { textAlign: 'right' } }, "Rate"),
                                    h("th", { style: { textAlign: 'right' } }, "GST%"),
                                    h("th", { style: { textAlign: 'right' } }, "Amount"))),
                            h("tbody", null, (p.items || []).map((it, idx) => {
                                const line = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
                                const withTax = line * (1 + (Number(it.taxPercent) || 0) / 100);
                                return (h("tr", { key: idx },
                                    h("td", { style: { color: 'var(--text-muted)' } }, idx + 1),
                                    h("td", { style: { whiteSpace: 'normal', wordBreak: 'break-word' } }, it.name || '—'),
                                    h("td", { style: { color: 'var(--text-muted)' } }, it.hsn || '—'),
                                    h("td", { style: { textAlign: 'right' } }, it.quantity || 0),
                                    h("td", { style: { textAlign: 'right' } }, formatCurrency(it.rate || 0)),
                                    h("td", { style: { textAlign: 'right' } },
                                        it.taxPercent || 0,
                                        "%"),
                                    h("td", { style: { textAlign: 'right', fontWeight: 600 } }, formatCurrency(withTax))));
                            })))),
                    h("div", { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.35rem 1rem', fontSize: '0.9rem', maxWidth: 320, marginLeft: 'auto' } },
                        h("span", { style: { color: 'var(--text-muted)' } }, "Taxable"),
                        h("span", { style: { textAlign: 'right' } }, formatCurrency(t.taxable)),
                        p.interstate ? (h(Fragment, null,
                            h("span", { style: { color: 'var(--text-muted)' } }, "IGST"),
                            h("span", { style: { textAlign: 'right' } }, formatCurrency(t.tax)))) : (h(Fragment, null,
                            h("span", { style: { color: 'var(--text-muted)' } }, "CGST"),
                            h("span", { style: { textAlign: 'right' } }, formatCurrency(splitPurchaseTax(t.tax, false).cgst)),
                            h("span", { style: { color: 'var(--text-muted)' } }, "SGST"),
                            h("span", { style: { textAlign: 'right' } }, formatCurrency(splitPurchaseTax(t.tax, false).sgst)))),
                        t.cess > 0.005 && h(Fragment, null,
                            h("span", { style: { color: 'var(--text-muted)' } }, "Cess"),
                            h("span", { style: { textAlign: 'right' } }, formatCurrency(t.cess))),
                        Math.abs(t.roundOff) > 0.005 && h(Fragment, null,
                            h("span", { style: { color: 'var(--text-muted)', fontStyle: 'italic' } }, "Round-off"),
                            h("span", { style: { textAlign: 'right', fontStyle: 'italic' } }, (t.roundOff > 0 ? '+' : '') + formatCurrency(t.roundOff))),
                        h("span", { style: { borderTop: '2px solid var(--text)', paddingTop: 6, fontWeight: 700 } }, "TOTAL"),
                        h("span", { style: { borderTop: '2px solid var(--text)', paddingTop: 6, textAlign: 'right', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text)' } }, formatCurrency(t.finalTotal)),
                        (Number(p.tdsAmount) || 0) > 0 && (h(Fragment, null,
                            h("span", { style: { color: 'var(--text-muted)' } },
                                "Less: TDS (",
                                String(p.tdsSection || '').replace(/-(co|tech|pm)$/, ''),
                                p.tdsRate ? ` @ ${p.tdsRate}%` : '',
                                ")"),
                            h("span", { style: { textAlign: 'right' } },
                                "-",
                                formatCurrency(p.tdsAmount)),
                            h("span", { style: { fontWeight: 600 } }, "Paid to supplier"),
                            h("span", { style: { textAlign: 'right', fontWeight: 600 } }, formatCurrency(t.finalTotal - p.tdsAmount)))),
                        hasPurchasePayments(p) && (h(Fragment, null,
                            h("span", { style: { color: 'var(--text-muted)' } }, "Paid"),
                            h("span", { style: { textAlign: 'right' } }, formatCurrency(purchasePaid(p))))),
                        h("span", { style: { fontWeight: 600 } }, "Balance due"),
                        h("span", { style: { textAlign: 'right', fontWeight: 600, color: purchaseBalance(p) > 0.005 ? 'var(--danger)' : 'var(--success)' } }, formatCurrency(purchaseBalance(p)))),
                    hasPurchasePayments(p) && (h("div", { style: { marginTop: '1rem' } },
                        h("div", { className: "form-label" },
                            "Payments made ",
                            h(HelpButton, { title: "Payment history", doc: "purchases#payment-history", size: 14 })),
                        h("div", { className: "payment-history" }, p.payments.map((x, i) => (h("div", { key: x.id || i, className: "payment-row", style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' } },
                            h("span", { style: { minWidth: 90 } }, x.date ? new Date(`${x.date}T00:00:00`).toLocaleDateString('en-IN') : '-'),
                            h("span", { className: "font-bold", style: { minWidth: 100 } }, formatCurrency(x.amount)),
                            h("span", { className: "text-muted" }, purchasePaymentModeName(x.mode)),
                            (x.reference || x.note) && h("span", { className: "text-muted", style: { overflowWrap: 'anywhere' } },
                                "\u00B7 ",
                                [x.reference, x.note].filter(Boolean).join(' · ')))))))),
                    p.note && h("p", { style: { fontSize: '0.82rem', fontStyle: 'italic', color: 'var(--text-muted)', marginTop: '1rem' } },
                        "Note: ",
                        p.note),
                    h("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', flexWrap: 'wrap' } },
                        h("button", { className: "btn btn-secondary", onClick: () => setViewPurchase(null) }, "Close"),
                        h("button", { className: "btn btn-secondary", onClick: () => { setPayPurchase(p); setViewPurchase(null); } },
                            h(IndianRupee, { size: 14 }),
                            " Payments"),
                        h("button", { className: "btn btn-secondary", onClick: () => { openEdit(p); setViewPurchase(null); } },
                            h(Edit3, { size: 14 }),
                            " Edit"),
                        h("button", { className: "btn btn-primary", onClick: () => viewAsPdf(p) },
                            h(Download, { size: 14 }),
                            " Download PDF")))));
        })(),
        payPurchase && (h(PurchasePaymentModal, { purchase: payPurchase, onClose: () => setPayPurchase(null), onChanged: () => loadPurchases() })),
        tab === 'bills' && (h(Fragment, null,
            h(UnassignedBanner, { count: unassignedPurchases.length, businessName: ownerProfile?.businessName, noun: "purchase bill", onAssign: assignUnassignedPurchases }),
            h("div", { className: "stats-grid stats-grid-4" },
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon stat-icon-purple" },
                        h(ShoppingCart, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" }, "Total Purchases"),
                        h("h2", { className: "stat-value stat-value-purple" }, formatCurrency(totalStats.total)))),
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon stat-icon-amber" },
                        h(IndianRupee, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" },
                            "Owed to suppliers ",
                            h(HelpButton, { title: "Owed to suppliers", doc: "purchases#owed-to-suppliers", size: 13 })),
                        h("h2", { className: "stat-value", style: { color: totalStats.owed > 0.005 ? 'var(--danger)' : undefined } }, formatCurrency(totalStats.owed)))),
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon stat-icon-green" },
                        h(ShoppingCart, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" }, "GST (ITC Eligible)"),
                        h("h2", { className: "stat-value stat-value-green" }, formatCurrency(totalStats.tax)))),
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon stat-icon-blue" },
                        h(ShoppingCart, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" }, "Entries"),
                        h("h2", { className: "stat-value" }, filtered.length)))),
            h("div", { className: "glass-panel p-4 mb-6" },
                h("div", { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' } },
                    h("div", { className: "search-box", style: { maxWidth: '300px' } },
                        h(Search, { size: 16, className: "search-icon" }),
                        h("input", { type: "text", placeholder: "Search supplier, invoice...", value: search, onChange: e => setSearch(e.target.value), className: "search-input" })),
                    h("select", { className: "filter-select", value: fyFilter, onChange: e => setFyFilter(e.target.value) },
                        h("option", { value: "" }, "All years"),
                        fyOptions.map(fy => h("option", { key: fy.value, value: fy.value }, fy.label))),
                    h("select", { className: "filter-select", value: statusFilter, onChange: e => setStatusFilter(e.target.value), "aria-label": "Payment status" },
                        h("option", { value: "" }, "All bills"),
                        h("option", { value: "due" }, "Unpaid / Partly paid"),
                        h("option", { value: "Paid" }, "Paid")),
                    ccOn && h(CostCentreFilter, { centres: centres, value: centreFilter, onChange: setCentreFilter }),
                    (search || centreFilter || statusFilter) && (h("button", { className: "icon-btn icon-btn-red", onClick: () => { setSearch(''); setCentreFilter(''); setStatusFilter(''); }, title: "Clear search", "aria-label": "Clear search" },
                        h(X, { size: 15 }))))))),
        showForm && (h("div", { className: "modal-overlay", onClick: closeForm },
            h("div", { className: "modal-content", onClick: e => e.stopPropagation(), style: { maxWidth: '720px' } },
                h("h3", { className: "section-title" },
                    isPo ? (editingId ? 'Edit purchase order' : 'New purchase order') : (editingId ? 'Edit Purchase Bill' : 'Add Purchase Bill'),
                    " ",
                    h(HelpButton, { title: "Purchases", doc: isPo ? 'purchases#new-po' : (fromPoNumber && !editingId) ? 'purchases#convert-po' : 'purchases#add-purchase', size: 16, style: { marginLeft: 6 } })),
                !isPo && fromPoNumber && (h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' } },
                    "From purchase order ",
                    h("strong", null, fromPoNumber),
                    ". Type the supplier's bill number, and change quantities to what actually came.")),
                h("div", { className: "grid grid-cols-2 gap-4" },
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, isPo ? 'PO date *' : 'Date *'),
                        h("input", { type: "date", className: "form-input", value: form.date, onChange: e => updateField('date', e.target.value) })),
                    isPo ? (h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Expected delivery"),
                        h("input", { type: "date", className: "form-input", value: form.expectedDate, onChange: e => updateField('expectedDate', e.target.value) }))) : (h("div", { className: "form-group" },
                        h("label", { className: "form-label" },
                            "Payment Status ",
                            h(HelpButton, { title: "Paying suppliers", doc: "purchases#payment-status", size: 13 })),
                        hasPurchasePayments(editingBill) ? (h("div", { className: "form-input", style: { background: 'var(--bg-secondary)', fontSize: '0.85rem' } },
                            PURCHASE_STATUS_LABEL[purchaseStatus(editingBill)],
                            " \u00B7 ",
                            editingBill.payments.length,
                            " payment",
                            editingBill.payments.length === 1 ? '' : 's',
                            " (\u20B9 button in the list)")) : (h("select", { className: "form-input", value: form.paymentStatus, onChange: e => updateField('paymentStatus', e.target.value) }, PAYMENT_STATUSES.filter(s => s !== 'Partial' || form.paymentStatus === 'Partial').map(s => h("option", { key: s, value: s }, PURCHASE_STATUS_LABEL[s])))))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Supplier Name *"),
                        h("input", { type: "text", className: "form-input", value: form.supplierName, list: "fgsb-supplier-history", autoComplete: "off", onChange: e => updateSupplierName(e.target.value), placeholder: supplierHistory.length ? 'Type or pick a previous supplier' : 'Vendor / Supplier name' }),
                        h("datalist", { id: "fgsb-supplier-history" }, supplierHistory.map(s => h("option", { key: s.name, value: s.name })))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Supplier GSTIN"),
                        h("input", { type: "text", className: "form-input", value: form.supplierGstin, onChange: e => updateSupplierGstin(e.target.value), placeholder: "15-digit GSTIN", maxLength: 15 })),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label" }, "Supplier Address (optional)"),
                        h("input", { type: "text", className: "form-input", value: form.supplierAddress || '', onChange: e => updateField('supplierAddress', e.target.value), placeholder: isPo ? 'Street, City, State — printed on the PO' : 'Street, City, State — printed on the Purchase Bill PDF' })),
                    isPo ? (h(Fragment, null,
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "PO number *"),
                            h("input", { type: "text", className: "form-input", value: form.poNumber, onChange: e => updateField('poNumber', e.target.value), placeholder: "PO/26-27/0001" })),
                        h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                            h("label", { className: "form-label" }, "Notes / terms (optional)"),
                            h("textarea", { className: "form-input", rows: 3, value: form.note, onChange: e => updateField('note', e.target.value), placeholder: "Delivery address, payment terms, packing..." })))) : (h(Fragment, null,
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Invoice Number *"),
                            h("input", { type: "text", className: "form-input", value: form.invoiceNumber, onChange: e => updateField('invoiceNumber', e.target.value), placeholder: "Supplier invoice no." })),
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Note (optional)"),
                            h("input", { type: "text", className: "form-input", value: form.note, onChange: e => updateField('note', e.target.value), placeholder: "Any note..." })))),
                    ccOn && (h("div", { className: "form-group" },
                        h("label", { className: "form-label", htmlFor: "cost-centre" }, "Cost centre"),
                        h(CostCentreSelect, { centres: centres, value: form.costCentre, name: form.costCentreName, onChange: (id, name) => setForm(prev => ({ ...prev, costCentre: id, costCentreName: name })) }))),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' } },
                            h("input", { type: "checkbox", checked: !!form.interstate, onChange: e => updateField('interstate', e.target.checked), style: { width: 16, height: 16, accentColor: 'var(--primary)' } }),
                            h("span", null,
                                h("strong", null, "Inter-state purchase"),
                                " \u2014 supplier charged IGST (different state)",
                                h("span", { style: { color: '#94a3b8', fontSize: '0.72rem', display: 'block' } }, "Routes ITC to IGST in GSTR-3B instead of CGST + SGST. Tip: first 2 digits of supplier GSTIN = their state code."))))),
                h("h4", { style: { marginTop: '1rem', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' } },
                    "Items ",
                    h(HelpButton, { title: "Items on the bill", doc: "purchases#purchase-items", size: 16 })),
                h("datalist", { id: "fgsb-item-history" }, itemHistory.map(i => h("option", { key: i.name, value: i.name }))),
                isPo && (h("datalist", { id: "fgsb-unit-list" }, getAllUnits().map(u => h("option", { key: u.label, value: u.label })))),
                form.items.map((item, idx) => (h("div", { key: idx, "data-focus-key": item._focusKey, style: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
                    h("div", { className: "form-group", style: { flex: isPo ? 1.2 : 2, margin: 0 } },
                        idx === 0 && h("label", { className: "form-label" }, "Name"),
                        h("input", { type: "text", className: "form-input", value: item.name, list: "fgsb-item-history", autoComplete: "off", onChange: e => updateItemName(idx, e.target.value), placeholder: itemHistory.length ? 'Type or pick a previous item' : 'Item name' })),
                    h("div", { className: "form-group", style: { flex: isPo ? 0.8 : 1, margin: 0 } },
                        idx === 0 && h("label", { className: "form-label" }, "HSN"),
                        h("input", { type: "text", className: "form-input", value: item.hsn, onChange: e => updateItem(idx, 'hsn', e.target.value), placeholder: "HSN" })),
                    h("div", { className: "form-group", style: { flex: isPo ? 0.9 : 0.7, margin: 0 } },
                        idx === 0 && h("label", { className: "form-label" }, "Qty"),
                        h("input", { type: "number", className: "form-input", value: item.quantity, min: "0", step: "any", onFocus: e => e.target.select(), onChange: e => updateItem(idx, 'quantity', e.target.value) })),
                    isPo && (h("div", { className: "form-group", style: { flex: 0.8, margin: 0 } },
                        idx === 0 && h("label", { className: "form-label" }, "Unit"),
                        h("input", { type: "text", className: "form-input", value: item.unit || '', list: "fgsb-unit-list", autoComplete: "off", onChange: e => updateItem(idx, 'unit', e.target.value), placeholder: "Nos" }))),
                    h("div", { className: "form-group", style: { flex: 1, margin: 0 } },
                        idx === 0 && h("label", { className: "form-label" }, "Rate"),
                        h("input", { type: "number", className: "form-input", value: item.rate, min: "0", step: "any", onFocus: e => e.target.select(), onChange: e => updateItem(idx, 'rate', e.target.value) })),
                    h("div", { className: "form-group", style: { flex: isPo ? 0.95 : 0.75, margin: 0 } },
                        idx === 0 && h("label", { className: "form-label" }, "Tax %"),
                        h("select", { className: "form-input", value: ['0', '0.1', '0.25', '3', '5', '12', '18', '28', '40'].includes(String(item.taxPercent)) ? String(item.taxPercent) : '__custom__', onChange: async (e) => {
                                if (e.target.value === '__custom__') {
                                    const v = await promptAction({
                                        title: 'Custom tax rate',
                                        message: 'Enter a GST rate between 0% and 100% (up to 2 decimals).',
                                        defaultValue: String(item.taxPercent || 0),
                                        placeholder: 'e.g. 7.5',
                                        inputType: 'number',
                                        confirmLabel: 'Apply rate',
                                    });
                                    const n = parseFloat(v);
                                    if (Number.isFinite(n) && n >= 0 && n <= 100)
                                        updateItem(idx, 'taxPercent', n);
                                }
                                else {
                                    updateItem(idx, 'taxPercent', e.target.value);
                                }
                            } },
                            h("option", { value: "0" }, "0%"),
                            h("option", { value: "0.1" }, "0.1%"),
                            h("option", { value: "0.25" }, "0.25%"),
                            h("option", { value: "3" }, "3%"),
                            h("option", { value: "5" }, "5%"),
                            h("option", { value: "12" }, "12%"),
                            h("option", { value: "18" }, "18%"),
                            h("option", { value: "28" }, "28%"),
                            h("option", { value: "40" }, "40%"),
                            h("option", { value: "__custom__" },
                                "Other\u2026",
                                ['0', '0.1', '0.25', '3', '5', '12', '18', '28', '40'].includes(String(item.taxPercent)) ? '' : ` (${item.taxPercent}%)`))),
                    h("div", { className: "form-group", style: { flex: 0.7, margin: 0 } },
                        idx === 0 && h("label", { className: "form-label", title: "Compensation Cess \u2014 for tobacco, aerated, motor vehicles, coal, etc." }, "Cess %"),
                        h("input", { type: "number", className: "form-input", value: item.cessPercent ?? 0, min: "0", step: "any", onFocus: e => e.target.select(), onChange: e => updateItem(idx, 'cessPercent', e.target.value) })),
                    h("div", { style: { flex: '0 0 auto', marginBottom: idx === 0 ? 0 : 0 } }, form.items.length > 1 && (h("button", { className: "icon-btn icon-btn-red", onClick: () => removeItem(idx), title: "Remove" },
                        h(Trash2, { size: 15 }))))))),
                h("button", { className: "btn btn-secondary", style: { fontSize: '0.8rem', padding: '0.35rem 0.75rem', marginTop: '0.25rem' }, onClick: addItem },
                    h(Plus, { size: 14 }),
                    " Add Item"),
                h("div", { style: { marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' } },
                    h("div", { style: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' } },
                        h("span", null,
                            "Taxable: ",
                            h("strong", null, formatCurrency(formTotals.taxable))),
                        form.interstate ? (h("span", null,
                            "IGST: ",
                            h("strong", null, formatCurrency(formTotals.tax)))) : (h(Fragment, null,
                            h("span", null,
                                "CGST: ",
                                h("strong", null, formatCurrency(splitPurchaseTax(formTotals.tax, false).cgst))),
                            h("span", null,
                                "SGST: ",
                                h("strong", null, formatCurrency(splitPurchaseTax(formTotals.tax, false).sgst))))),
                        formTotals.cess > 0 && (h("span", null,
                            "Cess: ",
                            h("strong", null, formatCurrency(formTotals.cess)))),
                        form.applyRoundOff && Math.abs(formTotals.roundOff) > 0.005 && (h("span", { style: { color: '#475569' } },
                            "Round-off: ",
                            h("strong", null, (formTotals.roundOff >= 0 ? '+' : '') + formatCurrency(formTotals.roundOff)))),
                        h("span", null,
                            "Total: ",
                            h("strong", null, formatCurrency(formTotals.finalTotal))),
                        formTds > 0 && (h(Fragment, null,
                            h("span", null,
                                "Less TDS: ",
                                h("strong", null, formatCurrency(formTds))),
                            h("span", null,
                                "Paid to supplier: ",
                                h("strong", null, formatCurrency(formTotals.finalTotal - formTds)))))),
                    !isPo && (h("div", { style: { marginTop: '0.6rem' } },
                        h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' } },
                            h("input", { type: "checkbox", checked: !!form.tdsOn, onChange: e => updateField('tdsOn', e.target.checked), style: { width: 14, height: 14, accentColor: 'var(--primary)' } }),
                            h("span", null,
                                h("strong", null, "TDS deducted"),
                                " \u2014 you keep back income-tax TDS from this supplier's payment and deposit it yourself"),
                            h(HelpButton, { title: "TDS on a purchase bill", doc: "purchases#purchase-tds", size: 14 })),
                        form.tdsOn && (h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.5rem', marginTop: '0.4rem' } },
                            h("select", { className: "form-input", "aria-label": "TDS section", value: form.tdsSection, onChange: e => {
                                    const code = e.target.value;
                                    const sec = TDS_SECTIONS.find(x => x.code === code);
                                    setForm(prev => ({ ...prev, tdsSection: code, tdsRate: code === 'custom' ? prev.tdsRate : (sec?.rate ?? prev.tdsRate), tdsAmountManual: '' }));
                                } }, TDS_SECTIONS.map(x => h("option", { key: x.code, value: x.code }, x.label))),
                            h("input", { type: "number", step: "any", min: "0", max: "100", className: "form-input", "aria-label": "TDS rate %", placeholder: "Rate %", value: form.tdsRate, onChange: e => setForm(prev => ({ ...prev, tdsRate: e.target.value, tdsAmountManual: '' })) }),
                            h("input", { type: "number", step: "any", min: "0", className: "form-input", "aria-label": "TDS amount", placeholder: `Amount (${formatCurrency(purchaseTdsAmount(formTotals.taxable, form.tdsRate))})`, value: form.tdsAmountManual, onChange: e => updateField('tdsAmountManual', e.target.value) }))))),
                    !isPo && (h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer', marginTop: '0.6rem', color: '#475569' } },
                        h("input", { type: "checkbox", checked: !!form.applyRoundOff, onChange: e => updateField('applyRoundOff', e.target.checked), style: { width: 14, height: 14, accentColor: 'var(--primary)' } }),
                        h("span", null,
                            h("strong", null, "Apply round-off"),
                            " \u2014 round the grand total to the nearest rupee. Use when the supplier's bill is rounded (e.g. \u20B91,234.56 \u2192 \u20B91,235). Off by default \u2014 most suppliers' totals already match what's calculated from line items.")))),
                h("div", { className: "flex gap-2 justify-end mt-4" },
                    h("button", { className: "btn btn-secondary", onClick: closeForm }, "Cancel"),
                    h("button", { className: "btn btn-primary", onClick: handleSave },
                        h(Save, { size: 16 }),
                        " ",
                        editingId ? 'Update' : 'Save'))))),
        tab === 'bills' && (h("div", { className: "glass-panel" },
            h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.5rem' } },
                h("h3", null,
                    "Purchase Records ",
                    h(HelpButton, { title: "Purchase Records", doc: "purchases#purchase-list", size: 16 })),
                h(TableExport, { title: "Purchase register", filename: "Purchases", landscape: true, subtitle: ownerProfile?.businessName || '', headers: ['Date', 'Supplier', 'GSTIN', 'Invoice No', 'Taxable Amount', 'CGST', 'SGST', 'IGST', 'Cess', 'Inter-state', 'Round-off', 'Total', 'Paid', 'Balance due', 'Status', 'Note'], rows: registerRows })),
            filtered.length === 0 ? (h("div", { className: "empty-state" },
                h(ShoppingCart, { size: 48 }),
                h("p", null, purchases.length === 0 ? 'No purchase bills recorded yet.' : 'No purchases match your filters.'),
                purchases.length === 0 && h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Add Purchase"))) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table", style: { minWidth: '800px' } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Date"),
                            h("th", null, "Supplier"),
                            h("th", null, "GSTIN"),
                            h("th", null, "Invoice No"),
                            h("th", { style: { textAlign: 'right' } }, "Taxable"),
                            h("th", { style: { textAlign: 'right' } }, "Tax"),
                            h("th", { style: { textAlign: 'right' } }, "Total"),
                            h("th", { style: { textAlign: 'right' } }, "Balance due"),
                            h("th", null, "Status"),
                            h("th", { className: "col-center" }, "Actions"))),
                    h("tbody", null, filtered.map(p => {
                        const t = calcPurchaseTotal(p.items, !!p.applyRoundOff);
                        const st = purchaseStatus(p);
                        const bal = purchaseBalance(p);
                        return (h("tr", { key: p.id },
                            h("td", { className: "text-muted" }, p.date ? new Date(p.date).toLocaleDateString('en-IN') : ''),
                            h("td", { className: "font-medium" }, p.supplierName),
                            h("td", { className: "text-muted", style: { fontSize: '0.78rem' } }, p.supplierGstin || '-'),
                            h("td", null,
                                h("span", { className: "invoice-badge" }, p.invoiceNumber)),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(t.taxable)),
                            h("td", { style: { textAlign: 'right' }, className: "text-muted" }, formatCurrency(t.tax)),
                            h("td", { style: { textAlign: 'right' }, className: "font-bold" }, formatCurrency(t.finalTotal)),
                            h("td", { style: { textAlign: 'right', color: bal > 0.005 ? 'var(--danger)' : 'var(--text-muted)' } }, bal > 0.005 ? formatCurrency(bal) : '-'),
                            h("td", null,
                                h("select", { className: "status-select", value: st, "aria-label": `Payment status of ${p.invoiceNumber}`, style: { background: PAYMENT_STATUS_COLORS[st].bg, color: PAYMENT_STATUS_COLORS[st].color, borderColor: PAYMENT_STATUS_COLORS[st].color + '44' }, onChange: e => changePaymentStatus(p, e.target.value) }, PAYMENT_STATUSES.map(s => h("option", { key: s, value: s }, PURCHASE_STATUS_LABEL[s])))),
                            h("td", null,
                                h("div", { className: "table-actions" },
                                    h("button", { className: "icon-btn", onClick: () => setViewPurchase(p), title: "View details (no download)" },
                                        h(Eye, { size: 15 })),
                                    h("button", { className: "icon-btn icon-btn-green", onClick: () => setPayPurchase(p), title: st === 'Paid' ? 'Payment history' : 'Record payment to supplier', "aria-label": "Payments to supplier" },
                                        h(IndianRupee, { size: 15 })),
                                    h("button", { className: "icon-btn icon-btn-blue", onClick: () => openEdit(p), title: "Edit" },
                                        h(Edit3, { size: 15 })),
                                    h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDelete(p.id), title: "Delete" },
                                        h(Trash2, { size: 15 }))))));
                    })),
                    h("tfoot", null,
                        h("tr", { style: { fontWeight: 'bold', borderTop: '2px solid var(--border)' } },
                            h("td", { colSpan: 4 }, "Total"),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(totalStats.taxable)),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(totalStats.tax)),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(totalStats.total)),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(totalStats.owed)),
                            h("td", { colSpan: 2 }))))))))));
}
