// v1.10.83 (#115) - simple manufacturing on the Products screen, shown only
// when Settings -> Features -> "Manufacturing (bill of materials)" is on:
//   BomEditor      - "Made here" + raw materials list inside the product form
//   MakeModal      - record production ("Make"): uses up raw materials,
//                    adds the finished product
//   ProductionList - this business's production entries: view, delete
// The arithmetic is in utils/manufacturing.js (unit-tested); the server moves
// the stock in the same request that saves or deletes an entry.
import { useEffect, useState, h, Fragment } from '../vanilla/dom.js';
import { Plus, Trash2, X, Save, Eye, Factory } from '../vanilla/icons.js';
import { getAllProductions, saveProduction, deleteProduction, getProfile } from '../store.js';
import { formatCurrency, formatDateGST, localToday, belongsToProfile, isServiceProduct } from '../utils.js';
import { unitCost, materialsNeeded, buildProduction, shortages } from '../utils/manufacturing.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import TableExport from './TableExport.js';
import HelpButton from './HelpButton.js';
const num = { textAlign: 'right', whiteSpace: 'nowrap' };
const muted = { fontSize: '0.78rem', color: 'var(--text-muted)' };
const qtyText = (q, unit) => `${q} ${unit || 'Nos'}`;
// ---- Bill of materials, inside the Add / Edit Product form ----
export function BomEditor({ productId, madeHere, bom, products, currency, onChange }) {
    const others = products.filter((p) => p.id !== productId && !isServiceProduct(p)); // a service has no stock (#121)
    const setLine = (i, patch) => onChange({ madeHere, bom: bom.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
    const cost = unitCost({ id: productId || '_new', madeHere: true, bom }, products);
    return (h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
        h("div", { style: { display: 'flex', alignItems: 'center' } },
            h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' } },
                h("input", { type: "checkbox", checked: madeHere, style: { width: 15, height: 15, accentColor: 'var(--primary)' }, onChange: (e) => onChange({ madeHere: e.target.checked, bom: bom.length ? bom : [{ productId: '', qty: '' }] }) }),
                "Made here (from raw materials)"),
            h(HelpButton, { title: "Bill of materials", doc: "products#bill-of-materials", size: 16 })),
        madeHere && (h("div", { className: "surface-card", style: { marginTop: '0.5rem' } },
            h("div", { style: { ...muted, marginBottom: '0.5rem' } }, "Raw materials used to make 1 unit of this product"),
            bom.map((line, i) => (h("div", { key: i, style: { display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' } },
                h("select", { className: "form-input", style: { flex: 2, minWidth: 0 }, value: line.productId, "aria-label": `Raw material ${i + 1}`, onChange: (e) => setLine(i, { productId: e.target.value }) },
                    h("option", { value: "" }, "Choose a product\u2026"),
                    others.map((p) => h("option", { key: p.id, value: p.id }, p.name))),
                h("input", { type: "number", className: "form-input", style: { flex: 1, minWidth: 0 }, min: "0", step: "any", placeholder: "Qty", "aria-label": `Quantity per unit ${i + 1}`, value: line.qty, onChange: (e) => setLine(i, { qty: e.target.value }) }),
                h("span", { style: { ...muted, width: '2.6rem', overflow: 'hidden', textOverflow: 'ellipsis' } }, products.find((p) => p.id === line.productId)?.unit || ''),
                h("button", { type: "button", className: "icon-btn icon-btn-red", title: "Remove this material", "aria-label": "Remove this material", onClick: () => onChange({ madeHere, bom: bom.filter((_, j) => j !== i) }) },
                    h(X, { size: 14 }))))),
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' } },
                h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.78rem', padding: '0.3rem 0.6rem' }, onClick: () => onChange({ madeHere, bom: [...bom, { productId: '', qty: '' }] }) },
                    h(Plus, { size: 14 }),
                    " Add material"),
                h("span", { style: { fontSize: '0.82rem' }, title: "Raw materials' purchase prices x quantity per unit" },
                    "Cost per unit: ",
                    h("strong", null, formatCurrency(cost, currency))))))));
}
// ---- "Make": record production ----
export function MakeModal({ products, currency, onClose, onSaved }) {
    const madeHere = products.filter((p) => p.madeHere && p.bom?.length);
    const [productId, setProductId] = useState(madeHere[0]?.id || '');
    const [qty, setQty] = useState('');
    const [date, setDate] = useState(localToday());
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const product = products.find((p) => p.id === productId);
    const made = Number(qty) > 0 ? Number(qty) : 0;
    const rows = product ? materialsNeeded(product, made, products) : [];
    const short = shortages(rows);
    const finishedBefore = Number(product?.stock) || 0;
    const save = async () => {
        const owner = await getProfile().catch(() => null);
        const { entry, error } = buildProduction({ product, qty, date, note, products, owner });
        if (error) {
            toast(error, 'warning');
            return;
        }
        if (short.length && !(await confirmAction({
            title: 'Not enough raw materials in stock',
            message: `${short.map((m) => `${m.name}: needs ${qtyText(m.qtyUsed, m.unit)}, in stock ${qtyText(m.stockBefore, m.unit)}`).join('; ')}. `
                + 'Saving will take their stock below zero. Save anyway? (Fine if you are recording production late and the purchase bill is not entered yet.)',
            confirmLabel: 'Save anyway',
            tone: 'danger',
        })))
            return;
        setSaving(true);
        try {
            await saveProduction(entry);
            toast(`Production saved: ${qtyText(entry.qty, entry.unit)} of ${entry.productName}`, 'success');
            onSaved();
        }
        catch (err) {
            toast(`Could not save production, nothing was changed. ${err.message || ''}`, 'error');
            setSaving(false);
        }
    };
    return (h("div", { className: "modal-overlay", onClick: onClose },
        h("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), style: { maxWidth: 720 } },
            h("h3", { className: "section-title" },
                h(Factory, { size: 18, style: { verticalAlign: '-3px' } }),
                " Make (record production) ",
                h(HelpButton, { title: "Make: record what you made", doc: "products#make-production", size: 16, style: { marginLeft: 6 } })),
            madeHere.length === 0 ? (h("div", { className: "notice notice-note" },
                "No product has a raw materials list yet. Edit a product, tick ",
                h("strong", null, "Made here"),
                " and add its raw materials first.")) : (h(Fragment, null,
                h("div", { className: "grid grid-cols-2 gap-4" },
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label", htmlFor: "mfg-product" }, "Product made *"),
                        h("select", { id: "mfg-product", className: "form-input", value: productId, onChange: (e) => setProductId(e.target.value) }, madeHere.map((p) => h("option", { key: p.id, value: p.id }, p.name)))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label", htmlFor: "mfg-qty" }, "Quantity made *"),
                        h("input", { id: "mfg-qty", type: "number", className: "form-input", min: "0", step: "any", placeholder: "0", value: qty, onChange: (e) => setQty(e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label", htmlFor: "mfg-date" }, "Date *"),
                        h("input", { id: "mfg-date", type: "date", className: "form-input", value: date, onChange: (e) => setDate(e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label", htmlFor: "mfg-note" }, "Note (optional)"),
                        h("input", { id: "mfg-note", type: "text", className: "form-input", placeholder: "e.g. Batch 12", value: note, onChange: (e) => setNote(e.target.value) }))),
                h("div", { className: "table-scroll", style: { marginTop: '0.75rem' } },
                    h("table", { className: "data-table", style: { minWidth: 520 } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Raw material"),
                                h("th", { style: num }, "Per unit"),
                                h("th", { style: num }, "Will use"),
                                h("th", { style: num }, "In stock"),
                                h("th", { style: num }, "Left after"))),
                        h("tbody", null,
                            rows.map((m) => (h("tr", { key: m.productId },
                                h("td", null, m.name),
                                h("td", { style: num }, qtyText(m.qtyPerUnit, m.unit)),
                                h("td", { style: num }, qtyText(m.qtyUsed, m.unit)),
                                h("td", { style: num }, m.stockBefore),
                                h("td", { style: { ...num, color: m.stockAfter < 0 ? 'var(--danger)' : undefined, fontWeight: m.stockAfter < 0 ? 700 : undefined } }, m.stockAfter)))),
                            product && (h("tr", { style: { fontWeight: 600, background: 'var(--bg-secondary)' } },
                                h("td", null,
                                    product.name,
                                    " (made)"),
                                h("td", { style: num }),
                                h("td", { style: num },
                                    "+",
                                    qtyText(made, product.unit)),
                                h("td", { style: num }, finishedBefore),
                                h("td", { style: num }, Math.round((finishedBefore + made) * 1000) / 1000)))))),
                h("p", { style: { ...muted, margin: '0.5rem 0' } },
                    "Cost of materials: ",
                    h("strong", null, formatCurrency(rows.reduce((s, m) => s + m.cost, 0), currency)),
                    ' ',
                    "(",
                    formatCurrency(unitCost(product, products), currency),
                    " per unit, at current purchase prices)"),
                short.length > 0 && made > 0 && (h("div", { className: "notice notice-danger", role: "alert" },
                    h("span", null,
                        "Not enough stock of ",
                        h("strong", null, short.map((m) => m.name).join(', ')),
                        ". Saving will take it below zero; you will be asked to confirm."))))),
            h("div", { className: "flex gap-2 justify-end mt-4" },
                h("button", { className: "btn btn-secondary", onClick: onClose }, "Cancel"),
                madeHere.length > 0 && (h("button", { className: "btn btn-primary", onClick: save, disabled: saving },
                    h(Save, { size: 16 }),
                    " Save production"))))));
}
// ---- Production list (open business only) ----
export function ProductionList({ products, currency, reloadKey, onChanged }) {
    const [rows, setRows] = useState([]);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [viewing, setViewing] = useState(null);
    useEffect(() => {
        Promise.all([getAllProductions(), getProfile().catch(() => null)])
            .then(([list, prof]) => setRows((list || []).filter((r) => belongsToProfile(r, prof))))
            .catch(() => toast('Failed to load production entries', 'error'));
    }, [reloadKey]);
    const nameOf = (id) => products.find((p) => p.id === id)?.name || '(deleted product)';
    const shown = rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
    const remove = async (entry) => {
        const back = Object.entries(entry.stockApplied || {})
            .map(([id, change]) => `${nameOf(id)} ${change > 0 ? '-' : '+'}${Math.abs(change)}`).join(', ');
        if (!(await confirmAction({
            title: 'Delete this production entry?',
            message: `Stock goes back exactly as it was before it: ${back}. To change an entry, delete it and enter it again.`,
            confirmLabel: 'Delete',
            tone: 'danger',
        })))
            return;
        try {
            await deleteProduction(entry.id);
            toast('Production entry deleted, stock put back', 'success');
            setViewing(null);
            onChanged();
        }
        catch (err) {
            toast(`Could not delete, nothing was changed. ${err.message || ''}`, 'error');
        }
    };
    return (h("div", { className: "glass-panel", style: { marginTop: '1.5rem' } },
        h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.75rem' } },
            h("h3", null,
                "Production ",
                h(HelpButton, { title: "The production list", doc: "products#production-list", size: 16, style: { marginLeft: 6 } })),
            h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
                h("label", { style: muted, htmlFor: "mfg-from" }, "From"),
                h("input", { id: "mfg-from", type: "date", className: "form-input", style: { width: 'auto' }, value: from, onChange: (e) => setFrom(e.target.value) }),
                h("label", { style: muted, htmlFor: "mfg-to" }, "To"),
                h("input", { id: "mfg-to", type: "date", className: "form-input", style: { width: 'auto' }, value: to, onChange: (e) => setTo(e.target.value) }),
                h(TableExport, { title: "Production", filename: "Production", headers: ['Date', 'Product', 'Qty made', 'Unit', 'Cost of materials', 'Note'], rows: shown.map((r) => [r.date, r.productName, r.qty, r.unit, r.cost, r.note || '']) }))),
        shown.length === 0 ? (h("p", { style: { ...muted, padding: '1rem 1.25rem', margin: 0 } }, rows.length ? 'No production entries in these dates.' : 'No production entries yet. Use Make to record what you made.')) : (h("div", { className: "table-scroll" },
            h("table", { className: "data-table", style: { minWidth: 560 } },
                h("thead", null,
                    h("tr", null,
                        h("th", null, "Date"),
                        h("th", null, "Product"),
                        h("th", { style: num }, "Qty made"),
                        h("th", { style: num }, "Cost of materials"),
                        h("th", null, "Note"),
                        h("th", { className: "col-center" }, "Actions"))),
                h("tbody", null, shown.map((r) => (h("tr", { key: r.id },
                    h("td", { style: { whiteSpace: 'nowrap' } }, formatDateGST(r.date)),
                    h("td", { className: "font-medium" }, r.productName),
                    h("td", { style: num }, qtyText(r.qty, r.unit)),
                    h("td", { style: num }, formatCurrency(r.cost || 0, currency)),
                    h("td", { className: "text-muted" }, r.note || '-'),
                    h("td", null,
                        h("div", { className: "table-actions" },
                            h("button", { className: "icon-btn icon-btn-blue", onClick: () => setViewing(r), title: "View", "aria-label": "View" },
                                h(Eye, { size: 15 })),
                            h("button", { className: "icon-btn icon-btn-red", onClick: () => remove(r), title: "Delete", "aria-label": "Delete" },
                                h(Trash2, { size: 15 }))))))))))),
        viewing && (h("div", { className: "modal-overlay", onClick: () => setViewing(null) },
            h("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), style: { maxWidth: 640 } },
                h("h3", { className: "section-title" },
                    "Made ",
                    qtyText(viewing.qty, viewing.unit),
                    " of ",
                    viewing.productName,
                    " ",
                    h(HelpButton, { title: "Viewing a production entry", doc: "products#production-entry", size: 16 })),
                h("p", { style: muted },
                    formatDateGST(viewing.date),
                    viewing.note ? ` · ${viewing.note}` : ''),
                h("div", { className: "table-scroll" },
                    h("table", { className: "data-table", style: { minWidth: 460 } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Raw material used"),
                                h("th", { style: num }, "Qty"),
                                h("th", { style: num }, "Rate"),
                                h("th", { style: num }, "Cost"))),
                        h("tbody", null,
                            (viewing.materials || []).map((m) => (h("tr", { key: m.productId },
                                h("td", null, m.name),
                                h("td", { style: num }, qtyText(m.qtyUsed, m.unit)),
                                h("td", { style: num }, formatCurrency(m.rate || 0, currency)),
                                h("td", { style: num }, formatCurrency(m.cost || 0, currency))))),
                            h("tr", { style: { fontWeight: 700, background: 'var(--bg-secondary)' } },
                                h("td", { colSpan: 3 }, "Total cost of materials"),
                                h("td", { style: num }, formatCurrency(viewing.cost || 0, currency)))))),
                h("p", { style: muted }, "Rates are the purchase prices on the day it was saved. To change this entry, delete it and enter it again."),
                h("div", { className: "flex gap-2 justify-end mt-4" },
                    h("button", { className: "btn btn-secondary", onClick: () => remove(viewing) },
                        h(Trash2, { size: 15 }),
                        " Delete"),
                    h("button", { className: "btn btn-primary", onClick: () => setViewing(null) }, "Close")))))));
}
