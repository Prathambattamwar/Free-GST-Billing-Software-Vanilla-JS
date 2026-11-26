import { h, Fragment } from '../vanilla/dom.js';
import { useState, useEffect } from '../vanilla/dom.js';
import { Package, Search, Plus, Edit3, Trash2, X, Save, Upload, FileUp, Table2, Factory, Barcode, SlidersHorizontal, ClipboardList } from '../vanilla/icons.js';
import { getAllProducts, saveProduct, deleteProduct, getProfile, getStockAlertSettings, getEnabledModules, activePriceLevels } from '../store.js';
import { cleanLevelPrices, levelCsvHeaders, levelCsvCells } from '../utils/priceLevels.js';
import { PriceLevelPrices } from './PriceLevelFields.js';
import { getAllUnits, getCountryConfig, formatCurrency, isModuleEnabled, isServiceProduct, trackedStock, filterUnitsByMode, getDefaultUnitForMode } from '../utils.js';
import { productsCsvToList, PRODUCTS_SAMPLE } from '../utils/listCsv.js';
import CsvListImport from './CsvListImport.js';
import { bomError, unitCost } from '../utils/manufacturing.js';
import { BomEditor, MakeModal, ProductionList } from './Manufacturing.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import HelpButton from './HelpButton.js';
import PageHeader, { BarButton } from './PageHeader.js';
import ProductBulkEdit from './ProductBulkEdit.js';
import TableExport from './TableExport.js';
import ProductUpdateImport from './ProductUpdateImport.js';
import BarcodeLabels from './BarcodeLabels.js';
import { barcodeProblem, normaliseBarcode, nextInternalCode } from '../utils/barcode.js';
import { normaliseCategory, categoryProblem, altUnitProblem, altUnitText, hasAltUnit, productMatches, reorderLines } from '../utils/stock.js';
import { putReorderDraft } from '../utils/reorderDraft.js';
// v1.10.86 - sort by a column header, remembered in this browser.
import { useListSort, sortRows } from '../utils/listPrefs.js';
import SortTh from './SortTh.js';
const SORT_GETTERS = {
    name: (p) => p.name,
    hsn: (p) => p.hsn,
    rate: (p) => Number(p.rate) || 0,
    gst: (p) => Number(p.taxPercent) || 0,
    stock: (p) => trackedStock(p),
};
import { CategoryBrandFields, AltUnitFields, ProductFilters, StockAdjustModal } from './StockFields.js';
// v1.10.29 — reported: "here purchase price and selling price need".
// Product now carries BOTH: `purchasePrice` (what we paid the supplier) and
// `sellingPrice` (what we charge the customer). Legacy `rate` field is
// still written on save (mirrors sellingPrice) so any pre-v1.10.29 reader
// still gets a valid number, but the form no longer edits it directly —
// dead state removed for clarity.
// The Barcode column of the export: only while Barcodes is on.
const barcodeCols = (on) => (on ? ['Barcode'] : []);
const emptyForm = {
    // kind: v1.10.83 (#121) - 'goods' or 'service' (a service has no stock).
    kind: 'goods', name: '', hsn: '', purchasePrice: '', sellingPrice: '', taxPercent: '', gstTreatment: '', unit: 'Pcs', stock: '', description: '',
    mrp: '', // v1.10.86 - (#189, #192) optional printed price (information only)
    madeHere: false, bom: [],
    barcode: '', // v1.10.85 (#137) - optional, one per product
    levelPrices: {}, // v1.10.85 - price per level, { '1': 90 } (Price levels on)
    // v1.10.85 (#142, #148) - category path, brand, and a second unit (Box = 12 Pcs).
    category: '', brand: '', altUnit: '', altFactor: '', altPrice: '',
};
export default function InventoryView({ onOpenPurchases }) {
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    // v1.10.77 (#85) - edit many products at once (see ProductBulkEdit).
    const [bulkEdit, setBulkEdit] = useState(false);
    // v1.10.84 (#177) - tick products, then delete them in one go.
    const [picked, setPicked] = useState(() => new Set());
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ ...emptyForm });
    const [units, setUnits] = useState(getAllUnits());
    const [profileCountry, setProfileCountry] = useState('India');
    const profileCurrency = getCountryConfig(profileCountry).currency;
    // The colour-coded stock badge in the table respects the user's threshold
    // — defaults to 5 if no setting saved yet. When alerts are disabled
    // entirely, items at or below threshold render in the same plain colour
    // as everything else (still "Out of Stock" red for 0 — that's a hard fact,
    // not an alert preference).
    const [stockAlerts, setStockAlerts] = useState({ enabled: true, threshold: 5 });
    // v1.10.83 (#115) - manufacturing (Settings -> Features). When off, nothing
    // below changes: no Make button, no BOM in the form, no production list.
    const mfgOn = isModuleEnabled('manufacturing', getEnabledModules());
    // v1.10.85 - [] unless Settings -> Features -> Price levels is on.
    const levels = activePriceLevels();
    const [showMake, setShowMake] = useState(false);
    const [mfgReload, setMfgReload] = useState(0);
    const afterProduction = () => { setShowMake(false); setMfgReload((n) => n + 1); loadProducts(); };
    // v1.10.85 (#137, #158) - barcodes (Settings -> Features). When off, the
    // form, list and selection bar show nothing about them.
    const barcodesOn = isModuleEnabled('barcodes', getEnabledModules());
    const [labelIds, setLabelIds] = useState(null);
    // v1.10.85 (#142, #148) - list filters, and the product whose stock is being adjusted.
    const [filters, setFilters] = useState({ category: '', brand: '', lowStock: false });
    const [adjusting, setAdjusting] = useState(null);
    const poOn = isModuleEnabled('purchaseOrders', getEnabledModules());
    const loadProducts = async () => {
        try {
            const data = await getAllProducts();
            setProducts(data);
        }
        catch {
            toast('Failed to load products', 'error');
        }
    };
    useEffect(() => {
        loadProducts();
        setUnits(getAllUnits());
        getProfile().then(p => { if (p?.country)
            setProfileCountry(p.country); }).catch(() => { });
        getStockAlertSettings().then(setStockAlerts).catch(() => { });
    }, []);
    const isLow = (p) => trackedStock(p) !== null && trackedStock(p) <= Number(stockAlerts.threshold ?? 5);
    const filtered = (search.trim()
        ? products.filter(p => (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (p.hsn || '').toLowerCase().includes(search.toLowerCase()) ||
            (barcodesOn && (p.barcode || '').toLowerCase().includes(search.trim().toLowerCase())) // #137
        )
        : products)
        // #142 - category (with its sub-levels) and brand; low stock at the alert level.
        .filter((p) => productMatches(p, filters) && (!filters.lowStock || isLow(p)));
    // Low stock -> a purchase order for what the list shows, opened on Purchases.
    const makeReorderPo = () => {
        const lines = reorderLines(filtered.filter(isLow), stockAlerts.threshold ?? 5);
        if (!lines.length) {
            toast('No low-stock goods in the list', 'info');
            return;
        }
        putReorderDraft(lines);
        onOpenPurchases?.();
    };
    const pickedShown = filtered.filter((p) => picked.has(p.id));
    const { sort, toggle: toggleSort } = useListSort('products', Object.keys(SORT_GETTERS));
    const sortedProducts = sortRows(filtered, sort, SORT_GETTERS);
    const openAdd = () => {
        setForm({ ...emptyForm });
        setEditingId(null);
        setShowForm(true);
    };
    const openEdit = (product) => {
        // v1.10.29 — Backward-compat: pre-v1.10.29 products only had `rate`.
        // Read `sellingPrice` if set, else fall back to `rate`. `purchasePrice`
        // is new — starts empty for legacy products until the user fills it.
        setForm({
            kind: isServiceProduct(product) ? 'service' : 'goods',
            name: product.name || '',
            hsn: product.hsn || '',
            purchasePrice: product.purchasePrice ?? '',
            sellingPrice: product.sellingPrice ?? product.rate ?? '',
            mrp: product.mrp ?? '',
            taxPercent: product.taxPercent || '',
            gstTreatment: product.gstTreatment || '',
            unit: product.unit || 'Nos',
            stock: product.stock ?? '', // v1.10.74 - was `|| ''`, which blanked a stock of 0
            description: product.description || '',
            madeHere: !!product.madeHere,
            bom: (product.bom || []).map((l) => ({ productId: l.productId, qty: String(l.qty ?? '') })),
            barcode: product.barcode || '',
            levelPrices: product.levelPrices || {},
            category: product.category || '',
            brand: product.brand || '',
            altUnit: product.altUnit || '',
            altFactor: product.altFactor ?? '',
            altPrice: product.altPrice ?? '',
        });
        setEditingId(product.id);
        setShowForm(true);
    };
    const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm({ ...emptyForm });
    };
    const handleSave = async () => {
        if (!form.name.trim()) {
            toast('Product name is required', 'warning');
            return;
        }
        // v1.10.74 - the input's min/max are not enforced by the browser on save.
        const gst = form.taxPercent === '' ? 0 : Number(form.taxPercent);
        if (!Number.isFinite(gst) || gst < 0 || gst > 100) {
            toast('GST % must be between 0 and 100', 'warning');
            return;
        }
        // v1.10.83 (#115) - a raw materials list must be complete, positive and loop-free.
        const bom = form.bom.map((l) => ({ productId: l.productId, qty: Number(l.qty) }));
        if (mfgOn && form.madeHere && form.kind !== 'service') {
            const err = bomError(editingId || '_new', bom, products);
            if (err) {
                toast(err, 'warning');
                return;
            }
        }
        // v1.10.85 (#137) - a barcode another product has is refused (a scan must
        // find one product).
        const barcode = normaliseBarcode(form.barcode);
        if (barcodesOn) {
            // Checked against the latest list too: two devices pressing Make one at
            // the same moment would otherwise both get the same code.
            const latest = barcode ? await getAllProducts().catch(() => products) : products;
            const problem = barcodeProblem(barcode, latest, editingId);
            if (problem) {
                toast(problem, 'warning');
                return;
            }
        }
        // v1.10.85 (#142, #148) - category levels and the second unit.
        const catProblem = categoryProblem(form.category);
        if (catProblem) {
            toast(catProblem, 'warning');
            return;
        }
        const altProblem = form.kind === 'service' ? '' : altUnitProblem(form);
        if (altProblem) {
            toast(altProblem, 'warning');
            return;
        }
        const alt = form.kind !== 'service' && String(form.altUnit || '').trim();
        try {
            // v1.10.29 — Persist both prices. `rate` mirrors sellingPrice so any
            // old caller reading .rate still gets the right number.
            const sellingPrice = form.sellingPrice ? parseFloat(form.sellingPrice) : 0;
            const purchasePrice = form.purchasePrice ? parseFloat(form.purchasePrice) : 0;
            const service = form.kind === 'service';
            const product = {
                // Fields this form does not show (cess % from purchase bills, etc.)
                // are kept: the record used to be rebuilt from the form alone.
                ...(editingId ? (products.find(p => p.id === editingId) || {}) : {}),
                ...(editingId ? { id: editingId } : {}),
                name: form.name.trim(),
                hsn: form.hsn.trim(),
                purchasePrice,
                sellingPrice,
                rate: sellingPrice, // mirror for legacy readers
                // v1.10.86 - (#189) blank MRP: the field goes (undefined is not saved).
                mrp: Number(form.mrp) > 0 ? Number(form.mrp) : undefined,
                taxPercent: form.taxPercent ? parseFloat(form.taxPercent) : 0,
                gstTreatment: form.gstTreatment || '',
                unit: form.unit,
                kind: service ? 'service' : 'goods',
                // #121 - a service has no stock; blank stock is "not tracked" (it used
                // to save 0, which showed Out of Stock for things never counted).
                stock: service || form.stock === '' ? undefined : parseFloat(form.stock),
                description: form.description.trim(),
                // Only written while the feature is on; otherwise the fields a product
                // already has are kept as they are (spread above).
                ...(mfgOn ? (form.madeHere && !service ? { madeHere: true, bom } : { madeHere: false }) : {}),
                // Same rule: written only while Barcodes is on.
                ...(barcodesOn ? { barcode } : {}),
                ...(levels.length ? { levelPrices: cleanLevelPrices(form.levelPrices) } : {}),
                category: normaliseCategory(form.category),
                brand: String(form.brand || '').trim(),
                // Blank second unit: the fields go (undefined is not saved).
                altUnit: alt || undefined,
                altFactor: alt ? Number(form.altFactor) : undefined,
                altPrice: alt && String(form.altPrice ?? '').trim() !== '' ? Number(form.altPrice) : undefined,
            };
            await saveProduct(product);
            toast(editingId ? 'Product updated' : 'Product added', 'success');
            closeForm();
            loadProducts();
        }
        catch {
            toast('Failed to save product', 'error');
        }
    };
    const handleDelete = async (id) => {
        // v1.10.83 (#115) - say so when a made product uses it as a raw material.
        const usedIn = mfgOn ? products.filter((p) => p.madeHere && (p.bom || []).some((l) => l.productId === id)).map((p) => p.name) : [];
        if (await confirmAction({
            title: 'Delete this product?',
            message: 'Existing invoices that used this product keep their line items unchanged. This just removes the product from your catalog.'
                + (usedIn.length ? ` It is a raw material of ${usedIn.join(', ')}: remove it from their raw materials list too.` : ''),
            confirmLabel: 'Delete',
            tone: 'danger',
        })) {
            try {
                await deleteProduct(id);
                toast('Product deleted', 'success');
                loadProducts();
            }
            catch {
                toast('Failed to delete', 'error');
            }
        }
    };
    // #177 - only ticked products the list shows now (the search) are deleted.
    const deletePicked = async (list) => {
        if (!list.length)
            return;
        const ids = new Set(list.map((p) => p.id));
        const usedIn = mfgOn ? products.filter((p) => p.madeHere && !ids.has(p.id) && (p.bom || []).some((l) => ids.has(l.productId))).map((p) => p.name) : [];
        if (!(await confirmAction({
            title: `Delete ${list.length} product${list.length === 1 ? '' : 's'}?`,
            message: `${list.slice(0, 5).map((p) => p.name).join(', ')}${list.length > 5 ? ` and ${list.length - 5} more` : ''}. `
                + 'Existing invoices that used them keep their line items unchanged. This just removes them from your catalog.'
                + (usedIn.length ? ` Some are raw materials of ${usedIn.join(', ')}: remove them from their raw materials list too.` : ''),
            confirmLabel: 'Delete',
            tone: 'danger',
        })))
            return;
        let done = 0;
        for (const p of list) {
            try {
                await deleteProduct(p.id);
                done += 1;
            }
            catch { /* counted below */ }
        }
        toast(done === list.length ? `${done} product${done === 1 ? '' : 's'} deleted` : `${done} of ${list.length} deleted; the rest could not be deleted`, done === list.length ? 'success' : 'error');
        setPicked(new Set());
        loadProducts();
    };
    const updateField = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };
    // A service starts on a service unit (Hrs) unless its unit is one already.
    const serviceUnits = filterUnitsByMode(units, 'services');
    const setKind = (kind) => setForm(prev => ({
        ...prev, kind,
        ...(kind === 'service' && !serviceUnits.some(u => u.label === prev.unit) ? { unit: getDefaultUnitForMode('services') } : {}),
    }));
    const [showImport, setShowImport] = useState(false);
    const [showUpdates, setShowUpdates] = useState(false);
    return (h("div", { className: "dashboard-container" },
        h(PageHeader, { title: "Products", help: { title: 'Products — how to use', doc: 'products' }, subtitle: "Manage your products and services catalog", secondary: h(Fragment, null,
                h(BarButton, { icon: Upload, label: "Import CSV", onClick: () => setShowImport(true), title: "Import CSV: add products from a CSV, an Excel file (.xlsx, such as Vyapar's) or Tally's masters export (.xml)" }),
                h(BarButton, { icon: FileUp, label: "Import product updates", onClick: () => { setShowImport(false); setShowUpdates(true); }, disabled: !products.length || bulkEdit, title: "Import product updates: change prices, HSN/SAC and (optional) stock of products you already have, from an edited CSV" }),
                h(BarButton, { icon: Table2, label: "Bulk edit", onClick: () => setBulkEdit(true), disabled: !products.length || bulkEdit, title: "Bulk edit: change name, HSN, prices, GST %, unit and stock of many products at once" }),
                mfgOn && (h(BarButton, { icon: Factory, label: "Make", onClick: () => setShowMake(true), disabled: bulkEdit, title: "Make: record production - uses up raw materials and adds the finished product to stock" }))), primary: h("button", { className: "btn btn-primary", onClick: openAdd },
                h(Plus, { size: 18 }),
                " Add Product") }),
        showUpdates && h(ProductUpdateImport, { onClose: () => setShowUpdates(false), onDone: (result) => { setShowUpdates(false); loadProducts(); toast(`${result.updated} products updated`, 'success'); } }),
        showImport && (h(CsvListImport, { what: "products", sample: PRODUCTS_SAMPLE, sampleName: "Products-sample.csv", doc: "products#import", intro: `One product or service per row: Name (required), Type (Goods or Service), HSN/SAC, Unit, Purchase Price, Selling Price, MRP (optional), GST %, Stock (leave Stock blank for a service) and Barcode (optional).${levels.length ? ` With price levels: ${levelCsvHeaders(levels).join(', ')}.` : ''} For a product already saved, details that are empty on it are filled in from the file; nothing already filled is changed.`, parse: (rows) => { const r = productsCsvToList(rows, products, levels, { barcodes: barcodesOn }); return { list: r.products, updates: r.updates, skipped: r.skipped, errors: r.errors }; }, save: saveProduct, onClose: () => setShowImport(false), onDone: () => { setShowImport(false); loadProducts(); } })),
        adjusting && h(StockAdjustModal, { product: adjusting, onClose: () => setAdjusting(null), onSaved: () => { setAdjusting(null); loadProducts(); } }),
        labelIds && h(BarcodeLabels, { productIds: labelIds, onClose: () => setLabelIds(null), onSaved: loadProducts }),
        showMake && h(MakeModal, { products: products, currency: profileCurrency, onClose: () => setShowMake(false), onSaved: afterProduction }),
        showForm && (h("div", { className: "modal-overlay", onClick: closeForm },
            h("div", { className: "modal-content", onClick: e => e.stopPropagation() },
                h("h3", { className: "section-title" },
                    editingId ? 'Edit Product' : 'Add Product',
                    " ",
                    h(HelpButton, { title: "Adding a product or service", doc: "products#add-product", size: 16 })),
                h("div", { className: "grid grid-cols-2 gap-4" },
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label" }, "Product / Service Name *"),
                        h("input", { type: "text", className: "form-input", value: form.name, onChange: e => updateField('name', e.target.value), placeholder: "e.g. Web Development" })),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("span", { className: "form-label", id: "product-kind-label" },
                            "This is a ",
                            h(HelpButton, { title: "Goods or service", doc: "products#goods-or-service", size: 14 })),
                        h("div", { role: "radiogroup", "aria-labelledby": "product-kind-label", style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } }, [['goods', 'Goods (stock counted)'], ['service', 'Service (no stock)']].map(([id, label]) => (h("button", { key: id, type: "button", role: "radio", "aria-checked": form.kind === id, className: `type-chip ${form.kind === id ? 'type-chip-active' : ''}`, onClick: () => setKind(id) }, label))))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, form.kind === 'service' ? 'SAC Code' : 'HSN / SAC Code'),
                        h("input", { type: "text", className: "form-input", value: form.hsn, onChange: e => updateField('hsn', e.target.value), placeholder: form.kind === 'service' ? 'e.g. 998314' : 'e.g. 4802' })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Purchase Price"),
                        h("input", { type: "number", className: "form-input", value: form.purchasePrice, onChange: e => updateField('purchasePrice', e.target.value), placeholder: "0.00", min: "0", step: "any", title: "What you pay the supplier. Auto-fills on new Purchase Bills." })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Selling Price"),
                        h("input", { type: "number", className: "form-input", value: form.sellingPrice, onChange: e => updateField('sellingPrice', e.target.value), placeholder: "0.00", min: "0", step: "any", title: "What you charge the customer. Auto-fills on new Invoices." })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "MRP (optional)"),
                        h("input", { type: "number", className: "form-input", value: form.mrp, onChange: e => updateField('mrp', e.target.value), placeholder: "0.00", min: "0", step: "any", title: "Maximum retail price printed on the pack. Comes onto the invoice line; it never changes the rate or GST." })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "GST %"),
                        h("input", { type: "number", className: "form-input", value: form.taxPercent, onChange: e => updateField('taxPercent', e.target.value), placeholder: "18", min: "0", max: "100" })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label", htmlFor: "gst-treatment" }, "If no GST is charged"),
                        h("select", { id: "gst-treatment", className: "form-input", value: form.gstTreatment, onChange: e => updateField('gstTreatment', e.target.value), title: "How GSTR-1 reports this item when it is sold at 0% or on a bill of supply" },
                            h("option", { value: "" }, "Automatic (0% = nil-rated, bill of supply = exempt)"),
                            h("option", { value: "nil" }, "Nil-rated"),
                            h("option", { value: "exempt" }, "Exempt"),
                            h("option", { value: "nongst" }, "Non-GST supply"))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Unit"),
                        h("select", { className: "form-input", value: form.unit, onChange: e => updateField('unit', e.target.value) },
                            form.unit && !units.some(u => u.label === form.unit) && (h("option", { value: form.unit }, form.unit)),
                            (form.kind === 'service' ? serviceUnits : units).map(u => h("option", { key: u.label, value: u.label },
                                u.label,
                                u.custom ? ' ★' : '')))),
                    form.kind !== 'service' && (h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Stock Quantity"),
                        h("input", { type: "number", className: "form-input", value: form.stock, onChange: e => updateField('stock', e.target.value), placeholder: "Blank = not counted", min: "0" }))),
                    barcodesOn && (h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label", htmlFor: "product-barcode" },
                            "Barcode (optional) ",
                            h(HelpButton, { title: "Barcodes", doc: "products#barcodes", size: 14 })),
                        h("div", { style: { display: 'flex', gap: '0.5rem' } },
                            h("input", { id: "product-barcode", type: "text", className: "form-input", value: form.barcode, maxLength: 40, onChange: e => updateField('barcode', e.target.value), placeholder: "Scan or type the code on the pack", autoComplete: "off" }),
                            !form.barcode.trim() && (h("button", { type: "button", className: "btn btn-secondary", style: { whiteSpace: 'nowrap' }, title: "Gives this product the next code of the shop's own (20000001, 20000002, ...), to print on labels", onClick: () => updateField('barcode', nextInternalCode(products)) },
                                h(Barcode, { size: 15 }),
                                " Make one"))))),
                    h(CategoryBrandFields, { form: form, products: products, onChange: updateField }),
                    form.kind !== 'service' && h(AltUnitFields, { form: form, units: units, onChange: updateField }),
                    h(PriceLevelPrices, { levels: levels, prices: form.levelPrices, onChange: (v) => updateField('levelPrices', v) }),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label" }, "Description (optional)"),
                        h("input", { type: "text", className: "form-input", value: form.description, onChange: e => updateField('description', e.target.value), placeholder: "Brief description..." })),
                    mfgOn && form.kind !== 'service' && (h(BomEditor, { productId: editingId, madeHere: form.madeHere, bom: form.bom, products: products, currency: profileCurrency, onChange: ({ madeHere, bom }) => setForm((prev) => ({ ...prev, madeHere, bom })) }))),
                h("div", { className: "flex gap-2 justify-end mt-4" },
                    h("button", { className: "btn btn-secondary", onClick: closeForm }, "Cancel"),
                    h("button", { className: "btn btn-primary", onClick: handleSave },
                        h(Save, { size: 16 }),
                        " ",
                        editingId ? 'Update' : 'Save'))))),
        h("div", { className: "glass-panel" },
            h("div", { className: "table-header table-toolbar" },
                h("h3", null,
                    "Products & Services ",
                    h(HelpButton, { title: "The product list", doc: "products#product-list", size: 16 })),
        h("div", { className: "table-toolbar-controls product-toolbar-controls", style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' } },
            h("div", { className: "search-box", style: { maxWidth: '400px', flex: '1 1 260px' } },
                h(Search, { size: 16, className: "search-icon" }),
                h("input", { type: "text", placeholder: barcodesOn ? 'Search by name, HSN or barcode...' : 'Search by name or HSN...', value: search, onChange: e => setSearch(e.target.value), className: "search-input", disabled: bulkEdit, title: bulkEdit ? 'Save or cancel the bulk edit first' : undefined }),
                search && h("button", { className: "icon-btn", onClick: () => setSearch(''), title: "Clear search", "aria-label": "Clear search" },
                    h(X, { size: 14 }))),
            !bulkEdit && h(ProductFilters, { products: products, value: filters, onChange: setFilters }),
            filters.lowStock && poOn && !bulkEdit && filtered.some(isLow) && (h("button", { type: "button", className: "btn btn-secondary", onClick: makeReorderPo, title: "A purchase order for these products, enough to reach twice the low-stock level; you check it before saving" },
                h(ClipboardList, { size: 15 }),
                " Make purchase order"))),
                !bulkEdit && (h(TableExport, { title: "Products", filename: "Products", headers: ['Name', 'Type', 'HSN/SAC', 'Purchase price', 'Selling price', 'MRP', 'GST %', 'Unit', 'Stock', ...barcodeCols(barcodesOn), 'Category', 'Brand', ...levelCsvHeaders(levels)], rows: filtered.map((p) => [p.name, isServiceProduct(p) ? 'Service' : 'Goods', p.hsn || '', Number(p.purchasePrice) || 0, Number(p.sellingPrice ?? p.rate) || 0, Number(p.mrp) > 0 ? Number(p.mrp) : '', Number(p.taxPercent) || 0, p.unit || 'Nos', trackedStock(p) ?? '', ...(barcodesOn ? [p.barcode || ''] : []), p.category || '', p.brand || '', ...levelCsvCells(p, levels)]) }))),
            bulkEdit && filtered.length > 0 ? (h(ProductBulkEdit, { products: filtered, units: units, onDone: (saved) => { setBulkEdit(false); if (saved)
                    loadProducts(); } })) : filtered.length === 0 ? (h("div", { className: "empty-state" },
                h(Package, { size: 48 }),
                h("p", null, products.length === 0 ? 'No products yet. Add your first product.' : 'No products match your search or filters.'),
                products.length === 0 && (h("button", { className: "btn btn-secondary empty-state-action", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Add Product")))) : (h("div", { className: "table-scroll" },
                pickedShown.length > 0 && (h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.5rem 0.75rem', margin: '0 0 0.5rem', background: 'var(--primary-light)', borderRadius: 8 } },
                    h("strong", { style: { fontSize: '0.88rem' } },
                        pickedShown.length,
                        " selected"),
                    h("button", { type: "button", className: "btn btn-secondary", style: { color: '#dc2626', borderColor: '#dc2626' }, onClick: () => deletePicked(pickedShown) },
                        h(Trash2, { size: 14 }),
                        " Delete selected"),
                    barcodesOn && (h("button", { type: "button", className: "btn btn-secondary", onClick: () => setLabelIds(pickedShown.map((p) => p.id)), title: "Barcode labels for the ticked products: choose how many of each" },
                        h(Barcode, { size: 14 }),
                        " Print labels")),
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => setPicked(new Set()) }, "Clear"))),
                h("table", { className: "data-table" },
                    h("thead", null,
                        h("tr", null,
                            h("th", { style: { width: 36 } },
                                h("input", { type: "checkbox", "aria-label": "Select all products shown", checked: pickedShown.length === filtered.length, onChange: (e) => setPicked(e.target.checked ? new Set(filtered.map((p) => p.id)) : new Set()) })),
                            h(SortTh, { col: "name", label: "Name", sort: sort, onSort: toggleSort }),
                            h(SortTh, { col: "hsn", label: "HSN/SAC", sort: sort, onSort: toggleSort }),
                            h(SortTh, { col: "rate", label: "Rate", sort: sort, onSort: toggleSort }),
                            h(SortTh, { col: "gst", label: "GST %", sort: sort, onSort: toggleSort }),
                            h("th", null, "Unit"),
                            h(SortTh, { col: "stock", label: "Stock", sort: sort, onSort: toggleSort }),
                            h("th", { className: "col-center" }, "Actions"))),
                    h("tbody", null, sortedProducts.map(product => (h("tr", { key: product.id },
                        h("td", null,
                            h("input", { type: "checkbox", "aria-label": `Select ${product.name}`, checked: picked.has(product.id), onChange: (e) => setPicked((prev) => { const next = new Set(prev); if (e.target.checked)
                                    next.add(product.id);
                                else
                                    next.delete(product.id); return next; }) })),
                        h("td", { className: "font-medium", title: product.description || '' },
                            product.name,
                            (product.category || product.brand) && (h("div", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 } }, [product.category, product.brand].filter(Boolean).join(' · '))),
                            barcodesOn && product.barcode && (h("div", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 } }, product.barcode)),
                            mfgOn && product.madeHere && (h("div", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 } },
                                "Made here \u00B7 cost ",
                                formatCurrency(unitCost(product, products), profileCurrency),
                                " per ",
                                product.unit || 'unit'))),
                        h("td", { className: "text-muted" }, product.hsn || '-'),
                        h("td", { className: "font-bold" },
                            product.rate ? formatCurrency(product.rate, profileCurrency) : '-',
                            Number(product.mrp) > 0 && h("div", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 } },
                                "MRP ",
                                formatCurrency(product.mrp, profileCurrency))),
                        h("td", null, product.taxPercent ? `${product.taxPercent}%` : '-'),
                        h("td", { className: "text-muted" },
                            product.unit || 'Nos',
                            hasAltUnit(product) && h("div", { style: { fontSize: '0.72rem' } }, altUnitText(product))),
                        h("td", null, isServiceProduct(product) ? (h("span", { className: "text-muted", title: "A service has no stock" }, "Service")) : trackedStock(product) === null ? (h("span", { className: "text-muted", title: "No stock entered, so it is not counted" }, "-")) : trackedStock(product) <= 0 ? (h("span", { style: { color: '#dc2626', fontWeight: 600 } }, "Out of Stock")) : (stockAlerts.enabled !== false && trackedStock(product) <= Number(stockAlerts.threshold ?? 5)) ? (h("span", { style: { color: '#d97706', fontWeight: 600 } }, product.stock)) : (product.stock)),
                        h("td", null,
                            h("div", { className: "table-actions" },
                                h("button", { className: "icon-btn icon-btn-blue", onClick: () => openEdit(product), title: "Edit" },
                                    h(Edit3, { size: 15 })),
                                !isServiceProduct(product) && (h("button", { className: "icon-btn", onClick: () => setAdjusting(product), title: "Adjust stock (damaged, lost, found...)", "aria-label": `Adjust stock of ${product.name}` },
                                    h(SlidersHorizontal, { size: 15 }))),
                                h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDelete(product.id), title: "Delete" },
                                    h(Trash2, { size: 15 })))))))))))),
        mfgOn && h(ProductionList, { products: products, currency: profileCurrency, reloadKey: mfgReload, onChanged: afterProduction })));
}
