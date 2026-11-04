import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { Package, Search, Plus, Edit3, Trash2, X, Save, Upload, Table2, Factory } from '../vanilla/icons.js';
import { getAllProducts, saveProduct, deleteProduct, getProfile, getStockAlertSettings, getEnabledModules } from '../store.js';
import { getAllUnits, getCountryConfig, formatCurrency, isModuleEnabled, isServiceProduct, trackedStock, filterUnitsByMode, getDefaultUnitForMode } from '../utils.js';
import { productsCsvToList, PRODUCTS_SAMPLE } from '../utils/listCsv.js';
import CsvListImport from './CsvListImport.js';
import { bomError, unitCost } from '../utils/manufacturing.js';
import { BomEditor, MakeModal, ProductionList } from './Manufacturing.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import HelpButton from './HelpButton.js';
import ProductBulkEdit from './ProductBulkEdit.js';
import TableExport from './TableExport.js';
// v1.10.29 — reported: "here purchase price and selling price need".
// Product now carries BOTH: `purchasePrice` (what we paid the supplier) and
// `sellingPrice` (what we charge the customer). Legacy `rate` field is
// still written on save (mirrors sellingPrice) so any pre-v1.10.29 reader
// still gets a valid number, but the form no longer edits it directly —
// dead state removed for clarity.
const emptyForm = {
    // kind: v1.10.83 (#121) - 'goods' or 'service' (a service has no stock).
    kind: 'goods', name: '', hsn: '', purchasePrice: '', sellingPrice: '', taxPercent: '', unit: 'Pcs', stock: '', description: '',
    madeHere: false, bom: [],
};
export default function InventoryView() {
    const [products, setProducts] = useState([]);
    const [search, setSearch] = useState('');
    // v1.10.77 (#85) - edit many products at once (see ProductBulkEdit).
    const [bulkEdit, setBulkEdit] = useState(false);
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
    const [showMake, setShowMake] = useState(false);
    const [mfgReload, setMfgReload] = useState(0);
    const afterProduction = () => { setShowMake(false); setMfgReload((n) => n + 1); loadProducts(); };
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
    const filtered = search.trim()
        ? products.filter(p => (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
            (p.hsn || '').toLowerCase().includes(search.toLowerCase()))
        : products;
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
            taxPercent: product.taxPercent || '',
            unit: product.unit || 'Nos',
            stock: product.stock ?? '', // v1.10.74 - was `|| ''`, which blanked a stock of 0
            description: product.description || '',
            madeHere: !!product.madeHere,
            bom: (product.bom || []).map((l) => ({ productId: l.productId, qty: String(l.qty ?? '') })),
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
        // v1.10.83 (#115) - a raw materials list must be complete, positive and avoid dependency loops.
        const bom = form.bom.map((l) => ({ productId: l.productId, qty: Number(l.qty) }));
        if (mfgOn && form.madeHere && form.kind !== 'service') {
            const err = bomError(editingId || '_new', bom, products);
            if (err) {
                toast(err, 'warning');
                return;
            }
        }
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
                taxPercent: form.taxPercent ? parseFloat(form.taxPercent) : 0,
                unit: form.unit,
                kind: service ? 'service' : 'goods',
                // #121 - a service has no stock; blank stock is "not tracked" (it used
                // to save 0, which showed Out of Stock for things never counted).
                stock: service || form.stock === '' ? undefined : parseFloat(form.stock),
                description: form.description.trim(),
                // Only written while the feature is on; otherwise the fields a product
                // already has are kept as they are (spread above).
                ...(mfgOn ? (form.madeHere && !service ? { madeHere: true, bom } : { madeHere: false }) : {}),
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
    return (h("div", { className: "dashboard-container" },
        h("div", { className: "page-header" },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h("div", null,
                    h("h1", { className: "page-title" },
                        "Products ",
                        h(HelpButton, { title: "Products \u2014 how to use", doc: "products", size: 16 })),
                    h("p", { className: "page-subtitle" }, "Manage your products and services catalog"))),
            h("div", { className: "flex gap-2", style: { flexWrap: 'wrap' } },
                h("button", { className: "btn btn-secondary", onClick: () => setShowImport(true) },
                    h(Upload, { size: 16 }),
                    " Import CSV"),
                h("button", { className: "btn btn-secondary", onClick: () => setBulkEdit(true), disabled: !products.length || bulkEdit, title: "Edit name, HSN, prices, GST %, unit and stock of many products at once" },
                    h(Table2, { size: 16 }),
                    " Bulk edit"),
                mfgOn && (h("button", { className: "btn btn-secondary", onClick: () => setShowMake(true), disabled: bulkEdit, title: "Record production: uses up raw materials and adds the finished product to stock" },
                    h(Factory, { size: 16 }),
                    " Make")),
                h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Add Product"))),
        showImport && (h(CsvListImport, { what: "products", sample: PRODUCTS_SAMPLE, sampleName: "Products-sample.csv", doc: "products#import", intro: "One product or service per row: Name (required), Type (Goods or Service), HSN/SAC, Unit, Purchase Price, Selling Price, GST % and Stock (leave Stock blank for a service).", parse: (text) => { const r = productsCsvToList(text, products); return { list: r.products, skipped: r.skipped, errors: r.errors }; }, save: saveProduct, onClose: () => setShowImport(false), onDone: () => { setShowImport(false); loadProducts(); } })),
        showMake && h(MakeModal, { products: products, currency: profileCurrency, onClose: () => setShowMake(false), onSaved: afterProduction }),
        h("div", { className: "glass-panel p-4 mb-6" },
            h("div", { className: "search-box", style: { maxWidth: '400px' } },
                h(Search, { size: 16, className: "search-icon" }),
                h("input", { type: "text", placeholder: "Search by name or HSN...", value: search, onChange: e => setSearch(e.target.value), className: "search-input", disabled: bulkEdit, title: bulkEdit ? 'Save or cancel the bulk edit first' : undefined }),
                search && h("button", { className: "icon-btn", onClick: () => setSearch(''), title: "Clear search", "aria-label": "Clear search" },
                    h(X, { size: 14 })))),
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
                        h("label", { className: "form-label" }, "GST %"),
                        h("input", { type: "number", className: "form-input", value: form.taxPercent, onChange: e => updateField('taxPercent', e.target.value), placeholder: "18", min: "0", max: "100" })),
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
            h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.5rem' } },
                h("h3", null,
                    "Products & Services ",
                    h(HelpButton, { title: "The product list", doc: "products#product-list", size: 16 })),
                !bulkEdit && (h(TableExport, { title: "Products", filename: "Products", headers: ['Name', 'Type', 'HSN/SAC', 'Purchase price', 'Selling price', 'GST %', 'Unit', 'Stock'], rows: filtered.map((p) => [p.name, isServiceProduct(p) ? 'Service' : 'Goods', p.hsn || '', Number(p.purchasePrice) || 0, Number(p.sellingPrice ?? p.rate) || 0, Number(p.taxPercent) || 0, p.unit || 'Nos', trackedStock(p) ?? '']) }))),
            bulkEdit && filtered.length > 0 ? (h(ProductBulkEdit, { products: filtered, units: units, onDone: (saved) => { setBulkEdit(false); if (saved)
                    loadProducts(); } })) : filtered.length === 0 ? (h("div", { className: "empty-state" },
                h(Package, { size: 48 }),
                h("p", null, products.length === 0 ? 'No products yet. Add your first product.' : 'No products match your search.'),
                products.length === 0 && (h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Add Product")))) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table" },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Name"),
                            h("th", null, "HSN/SAC"),
                            h("th", null, "Rate"),
                            h("th", null, "GST %"),
                            h("th", null, "Unit"),
                            h("th", null, "Stock"),
                            h("th", { className: "col-center" }, "Actions"))),
                    h("tbody", null, filtered.map(product => (h("tr", { key: product.id },
                        h("td", { className: "font-medium", title: product.description || '' },
                            product.name,
                            mfgOn && product.madeHere && (h("div", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 } },
                                "Made here \u00B7 cost ",
                                formatCurrency(unitCost(product, products), profileCurrency),
                                " per ",
                                product.unit || 'unit'))),
                        h("td", { className: "text-muted" }, product.hsn || '-'),
                        h("td", { className: "font-bold" }, product.rate ? formatCurrency(product.rate, profileCurrency) : '-'),
                        h("td", null, product.taxPercent ? `${product.taxPercent}%` : '-'),
                        h("td", { className: "text-muted" }, product.unit || 'Nos'),
                        h("td", null, isServiceProduct(product) ? (h("span", { className: "text-muted", title: "A service has no stock" }, "Service")) : trackedStock(product) === null ? (h("span", { className: "text-muted", title: "No stock entered, so it is not counted" }, "-")) : trackedStock(product) <= 0 ? (h("span", { style: { color: '#dc2626', fontWeight: 600 } }, "Out of Stock")) : (stockAlerts.enabled !== false && trackedStock(product) <= Number(stockAlerts.threshold ?? 5)) ? (h("span", { style: { color: '#d97706', fontWeight: 600 } }, product.stock)) : (product.stock)),
                        h("td", null,
                            h("div", { className: "table-actions" },
                                h("button", { className: "icon-btn icon-btn-blue", onClick: () => openEdit(product), title: "Edit" },
                                    h(Edit3, { size: 15 })),
                                h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDelete(product.id), title: "Delete" },
                                    h(Trash2, { size: 15 })))))))))))),
        mfgOn && h(ProductionList, { products: products, currency: profileCurrency, reloadKey: mfgReload, onChanged: afterProduction })));
}
