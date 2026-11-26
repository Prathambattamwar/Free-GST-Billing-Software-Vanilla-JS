import { h, Fragment } from '../vanilla/dom.js';
// v1.10.85 (#148, #142) - the stock parts of the Products screen, kept out of
// InventoryView.jsx: category and brand in the product form, a second unit
// (Box = 12 Pcs) behind a small link, the list's filters, and the Adjust
// stock window. The rules are in utils/stock.js.
import { useState } from '../vanilla/dom.js';
import { X, Save } from '../vanilla/icons.js';
import { categoryOptions, brandOptions, ADJUST_REASONS, adjustmentProblem, makeAdjustment } from '../utils/stock.js';
import { localToday, trackedStock } from '../utils.js';
import { saveStockAdjustment } from '../store.js';
import HelpButton from './HelpButton.js';
import { toast } from './Toast.js';
import ComboInput from './ComboInput.js';
// Category (any level, typed with >) and brand, each with the ones already used.
export function CategoryBrandFields({ form, products, onChange }) {
    return (h(Fragment, null,
        h("div", { className: "form-group" },
            h("label", { className: "form-label", htmlFor: "product-category" },
                "Category (optional) ",
                h(HelpButton, { title: "Categories and brands", doc: "products#categories", size: 14 })),
            h(ComboInput, { id: "product-category", type: "text", className: "form-input", options: categoryOptions(products), listLabel: "Categories used before", value: form.category, onChange: (e) => onChange('category', e.target.value), placeholder: "e.g. Garments > Men > Shirts", title: "A main category, and up to 3 sub-levels after >" })),
        h("div", { className: "form-group" },
            h("label", { className: "form-label", htmlFor: "product-brand" }, "Brand (optional)"),
            h(ComboInput, { id: "product-brand", type: "text", className: "form-input", options: brandOptions(products), listLabel: "Brands used before", value: form.brand, onChange: (e) => onChange('brand', e.target.value), placeholder: "e.g. DiceCodes" }))));
}
// #148 - "+ Second unit": one row, Box = 12 Pcs, and an optional box price.
export function AltUnitFields({ form, units, onChange }) {
    const [open, setOpen] = useState(!!form.altUnit);
    if (!open) {
        return (h("div", { className: "form-group", style: { gridColumn: 'span 2', margin: 0 } },
            h("button", { type: "button", className: "btn-link", onClick: () => setOpen(true), style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-muted)' } },
                "+ Also sold or bought in a second unit (e.g. Box = 12 ",
                form.unit || 'Pcs',
                ")")));
    }
    return (h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
        h("span", { className: "form-label" },
            "Second unit (optional) ",
            h(HelpButton, { title: "Alternate units", doc: "products#alternate-units", size: 14 })),
        h("div", { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
            h("span", null, "1"),
            h("select", { className: "form-input", style: { width: 'auto' }, "aria-label": "Second unit", value: form.altUnit, onChange: (e) => onChange('altUnit', e.target.value) },
                h("option", { value: "" }, "None"),
                units.filter((u) => u.label !== form.unit).map((u) => h("option", { key: u.label, value: u.label }, u.label))),
            h("span", null, "="),
            h("input", { type: "number", className: "form-input", style: { width: 90 }, min: "0", step: "any", "aria-label": "How many in the second unit", value: form.altFactor, onChange: (e) => onChange('altFactor', e.target.value), placeholder: "12" }),
            h("span", null, form.unit || 'Nos'),
            h("input", { type: "number", className: "form-input", style: { width: 150 }, min: "0", step: "any", "aria-label": "Selling price per second unit", value: form.altPrice, onChange: (e) => onChange('altPrice', e.target.value), placeholder: form.altUnit ? `Price per ${form.altUnit}` : 'Price', title: "Leave blank to charge the number above x the selling price" }))));
}
// The list's filters: category and brand (each only once a product has one),
// and low stock.
export function ProductFilters({ products, value, onChange }) {
    const cats = categoryOptions(products);
    const brands = brandOptions(products);
    const set = (k, v) => onChange({ ...value, [k]: v });
    return (h(Fragment, null,
        cats.length > 0 && (h("select", { className: "form-input", style: { width: 'auto', maxWidth: 260 }, "aria-label": "Category", value: value.category, onChange: (e) => set('category', e.target.value) },
            h("option", { value: "" }, "All categories"),
            cats.map((c) => h("option", { key: c, value: c }, c)))),
        brands.length > 0 && (h("select", { className: "form-input", style: { width: 'auto' }, "aria-label": "Brand", value: value.brand, onChange: (e) => set('brand', e.target.value) },
            h("option", { value: "" }, "All brands"),
            brands.map((b) => h("option", { key: b, value: b }, b)))),
        h("label", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' } },
            h("input", { type: "checkbox", checked: !!value.lowStock, onChange: (e) => set('lowStock', e.target.checked) }),
            " Low stock only")));
}
// Adjust stock: add or remove a quantity (in the product's unit) with a reason.
export function StockAdjustModal({ product, onClose, onSaved }) {
    const [f, setF] = useState({ direction: 'remove', quantity: '', reason: 'damaged', note: '', date: localToday() });
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
    const pickReason = (id) => {
        const r = ADJUST_REASONS.find((x) => x.id === id);
        setF((prev) => ({ ...prev, reason: id, ...(r?.out === true ? { direction: 'remove' } : r?.out === false ? { direction: 'add' } : {}) }));
    };
    const now = trackedStock(product) ?? 0;
    const after = Math.round((now + (f.direction === 'remove' ? -1 : 1) * (Number(f.quantity) || 0)) * 1000) / 1000;
    const save = async () => {
        const problem = adjustmentProblem({ product, ...f });
        if (problem) {
            toast(problem, 'warning');
            return;
        }
        setSaving(true);
        try {
            await saveStockAdjustment(makeAdjustment({ product, ...f }));
            toast(`Stock of ${product.name} is now ${after}`, 'success');
            onSaved();
        }
        catch (err) {
            toast(err?.message || 'Could not save the adjustment', 'error');
            setSaving(false);
        }
    };
    return (h("div", { className: "modal-overlay", onClick: onClose },
        h("div", { className: "modal-content", style: { maxWidth: 480 }, onClick: (e) => e.stopPropagation(), role: "dialog", "aria-label": "Adjust stock" },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' } },
                h("h3", { className: "section-title", style: { margin: 0 } },
                    "Adjust stock ",
                    h(HelpButton, { title: "Adjusting stock", doc: "products#stock-adjust", size: 16 })),
                h("button", { type: "button", className: "icon-btn", onClick: onClose, title: "Close", "aria-label": "Close" },
                    h(X, { size: 18 }))),
            h("p", { style: { margin: '0 0 0.75rem', fontSize: '0.88rem' } },
                h("strong", null, product.name),
                " \u00B7 in stock now: ",
                now,
                " ",
                product.unit || 'Nos'),
            h("div", { className: "grid grid-cols-2 gap-3" },
                h("div", { className: "form-group" },
                    h("label", { className: "form-label", htmlFor: "adj-reason" }, "Reason"),
                    h("select", { id: "adj-reason", className: "form-input", value: f.reason, onChange: (e) => pickReason(e.target.value) }, ADJUST_REASONS.map((r) => h("option", { key: r.id, value: r.id }, r.label)))),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label", htmlFor: "adj-direction" }, "Add or remove"),
                    h("select", { id: "adj-direction", className: "form-input", value: f.direction, onChange: (e) => set('direction', e.target.value) },
                        h("option", { value: "remove" }, "Remove from stock"),
                        h("option", { value: "add" }, "Add to stock"))),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label", htmlFor: "adj-qty" },
                        "Quantity (",
                        product.unit || 'Nos',
                        ")"),
                    h("input", { id: "adj-qty", type: "number", className: "form-input", min: "0", step: "any", value: f.quantity, onChange: (e) => set('quantity', e.target.value) })),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label", htmlFor: "adj-date" }, "Date"),
                    h("input", { id: "adj-date", type: "date", className: "form-input", value: f.date, onChange: (e) => set('date', e.target.value) })),
                h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                    h("label", { className: "form-label", htmlFor: "adj-note" }, "Note (optional)"),
                    h("input", { id: "adj-note", type: "text", className: "form-input", value: f.note, onChange: (e) => set('note', e.target.value), placeholder: "e.g. 2 broken in transit" }))),
            h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' } },
                "Stock after: ",
                h("strong", null, after),
                " ",
                product.unit || 'Nos',
                ". Listed in Reports \u2192 Stock."),
            h("div", { className: "flex gap-2 justify-end mt-4" },
                h("button", { type: "button", className: "btn btn-secondary", onClick: onClose }, "Cancel"),
                h("button", { type: "button", className: "btn btn-primary", onClick: save, disabled: saving },
                    h(Save, { size: 16 }),
                    " Save adjustment")))));
}
