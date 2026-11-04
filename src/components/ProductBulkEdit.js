// v1.10.77 (#85) - edit many products at once: the list becomes a grid of
// inputs (name, HSN/SAC, purchase price, selling price, GST %, unit, stock),
// and one Save writes only the rows that changed. Same rules as the single
// product form (a name is required; GST % 0-100; selling price is mirrored to
// `rate` for older readers).
import { useMemo, useState, h, Fragment } from '../vanilla/dom.js';
import { Save, X } from '../vanilla/icons.js';
import { getAllProducts, saveProduct } from '../store.js';
import { toast } from './Toast.js';
import { bulkRowToProduct } from '../utils/products.js';
import { isServiceProduct } from '../utils.js';
import HelpButton from './HelpButton.js';
const FIELDS = [
    ['name', 'Name', 'text', 180],
    ['hsn', 'HSN/SAC', 'text', 90],
    ['purchasePrice', 'Purchase price', 'number', 100],
    ['sellingPrice', 'Selling price', 'number', 100],
    ['taxPercent', 'GST %', 'number', 70],
    ['unit', 'Unit', 'unit', 90],
    ['stock', 'Stock', 'number', 80],
];
const valueOf = (p, k) => {
    if (k === 'sellingPrice')
        return p.sellingPrice ?? p.rate ?? '';
    return p[k] ?? '';
};
export default function ProductBulkEdit({ products, units, onDone }) {
    const [edits, setEdits] = useState({}); // id -> { field: value }
    const [saving, setSaving] = useState(false);
    const changedIds = useMemo(() => Object.keys(edits).filter((id) => Object.keys(edits[id]).length), [edits]);
    const setCell = (p, k, v) => setEdits((prev) => {
        const row = { ...(prev[p.id] || {}) };
        if (String(v) === String(valueOf(p, k)))
            delete row[k];
        else
            row[k] = v;
        return { ...prev, [p.id]: row };
    });
    const saveAll = async () => {
        setSaving(true);
        // Only the changed cells go onto the latest saved copy of each product, so
        // stock that moved meanwhile (an invoice in another tab) is not undone.
        let latest;
        try {
            latest = await getAllProducts();
        }
        catch {
            setSaving(false);
            toast('Could not load products. Try again.', 'error');
            return;
        }
        const plans = changedIds
            .map((id) => (latest || []).find((p) => p.id === id))
            .filter(Boolean) // deleted meanwhile: nothing to update
            .map((p) => bulkRowToProduct(p, edits[p.id]));
        const bad = plans.find((r) => r.error);
        if (bad) {
            setSaving(false);
            toast(`Not saved: ${bad.error}`, 'warning');
            return;
        }
        const results = await Promise.allSettled(plans.map((r) => saveProduct(r.product)));
        setSaving(false);
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed)
            toast(`${plans.length - failed} saved, ${failed} failed. Try again.`, 'error');
        else
            toast(`${plans.length} product${plans.length === 1 ? '' : 's'} updated`, 'success');
        onDone(!failed);
    };
    return (h("div", null,
        h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' } },
            h("strong", { style: { fontSize: '0.9rem' } },
                "Bulk edit ",
                h(HelpButton, { title: "Bulk edit", doc: "products#bulk-edit", size: 16 })),
            h("span", { style: { fontSize: '0.8rem', color: 'var(--text-muted)' } }, changedIds.length ? `${changedIds.length} product${changedIds.length === 1 ? '' : 's'} changed` : 'Change any cells, then save once.'),
            h("span", { style: { marginLeft: 'auto', display: 'flex', gap: '0.5rem' } },
                h("button", { type: "button", className: "btn btn-secondary", onClick: () => onDone(false), disabled: saving },
                    h(X, { size: 15 }),
                    " Cancel"),
                h("button", { type: "button", className: "btn btn-primary", onClick: saveAll, disabled: saving || !changedIds.length },
                    h(Save, { size: 15 }),
                    " ",
                    saving ? 'Saving…' : `Save changes${changedIds.length ? ` (${changedIds.length})` : ''}`))),
        h("div", { className: "table-scroll" },
            h("table", { className: "data-table bulk-edit-table", style: { minWidth: 820 } },
                h("thead", null,
                    h("tr", null, FIELDS.map(([k, label]) => h("th", { key: k }, label)))),
                h("tbody", null, products.map((p) => (h("tr", { key: p.id, style: edits[p.id] && Object.keys(edits[p.id]).length ? { background: 'var(--info-bg)' } : undefined }, FIELDS.map(([k, label, type, w]) => {
                    const v = edits[p.id]?.[k] ?? valueOf(p, k);
                    return (h("td", { key: k, style: { padding: '0.3rem 0.4rem' } }, k === 'stock' && isServiceProduct(p) ? (h("span", { className: "text-muted", style: { fontSize: '0.8rem' }, title: "A service has no stock" }, "Service")) : type === 'unit' ? (h("select", { className: "form-input", style: { width: w, padding: '0.3rem' }, value: v || 'Nos', "aria-label": `${label} of ${p.name}`, onChange: (e) => setCell(p, k, e.target.value) }, [...new Set([...(units || []).map((u) => u.label || u), v].filter(Boolean))].map((u) => h("option", { key: u, value: u }, u)))) : (h("input", { className: "form-input", style: { width: w, padding: '0.3rem 0.45rem' }, type: type, step: "any", value: v, "aria-label": `${label} of ${p.name}`, onChange: (e) => setCell(p, k, e.target.value) }))));
                })))))))));
}
