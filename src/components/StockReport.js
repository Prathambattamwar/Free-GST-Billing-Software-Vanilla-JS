// v1.10.77 (#85) - closing stock and its value at the end of any month.
// Calculation lives in utils/products.js (unit-tested); this file only shows
// and exports it. Products and stock are shared by all your businesses, so
// this report reads every invoice and purchase, not just the open company's.
import { useEffect, useState, h, Fragment } from '../vanilla/dom.js';
import { Package } from '../vanilla/icons.js';
import { getAllBills, getAllProducts, getAllPurchases, getAllProductions } from '../store.js';
import { localToday } from '../utils.js';
import { closingStock, stockValueOf } from '../utils/products.js';
import { toast } from './Toast.js';
import TableExport from './TableExport.js';
import HelpButton from './HelpButton.js';
const amt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Last day of a YYYY-MM month, or today while that month is still running.
const monthEnd = (ym) => {
    const [y, m] = ym.split('-').map(Number);
    const last = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const today = localToday();
    return last > today ? today : last;
};
export default function StockReport({ businessName }) {
    const [data, setData] = useState(null);
    const [month, setMonth] = useState(localToday().slice(0, 7));
    useEffect(() => {
        // v1.10.83 (#115) - production entries move stock too (always read, even
        // with the feature off: entries saved earlier still moved stock).
        Promise.all([getAllProducts(), getAllBills(), getAllPurchases(), getAllProductions().catch(() => [])])
            .then(([products, bills, purchases, productions]) => setData({
            products: products || [],
            bills: bills || [],
            purchases: purchases || [],
            productions: productions || [],
        }))
            .catch(() => toast('Failed to load stock', 'error'));
    }, []);
    if (!data)
        return h("div", { className: "glass-panel", style: { padding: '1.25rem' } }, "Loading stock\u2026");
    const asOf = monthEnd(month);
    const qty = closingStock(data.products, data.bills, data.purchases, asOf, data.productions);
    const rows = data.products
        .filter((p) => qty.has(p.id)) // services have no stock (#121)
        .map((p) => ({ p, q: qty.get(p.id) ?? 0, ...stockValueOf(p, qty.get(p.id)) }))
        .sort((a, b) => String(a.p.name || '').localeCompare(String(b.p.name || '')));
    const total = rows.reduce((s, r) => s + (r.q > 0 ? r.value : 0), 0);
    const asOfLabel = new Date(`${asOf}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const exportRows = [
        ...rows.map((r) => [r.p.name, r.p.hsn || '', r.p.unit || 'Nos', r.q, r.price, r.q > 0 ? r.value : 0]),
        ['Total', '', '', '', '', Math.round(total * 100) / 100],
    ];
    const num = { textAlign: 'right', whiteSpace: 'nowrap' };
    // A select, not <input type="month">: Firefox shows that as a plain text box.
    const lastMonths = Array.from({ length: 36 }, (_, i) => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })];
    });
    return (h("div", { className: "glass-panel" },
        h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.75rem' } },
            h("h3", null,
                "Closing stock as on ",
                asOfLabel,
                h(HelpButton, { title: "Closing stock", doc: "reports#stock", size: 16 })),
            h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
                h("select", { className: "form-input", style: { width: 'auto' }, value: month, "aria-label": "Month", onChange: (e) => setMonth(e.target.value) }, lastMonths.map(([v, label]) => h("option", { key: v, value: v }, label))),
                h(TableExport, { title: `Closing stock ${asOfLabel}`, filename: `Closing-stock-${asOf}`, subtitle: `${businessName ? `${businessName}, ` : ''}closing stock as on ${asOfLabel}, valued at purchase price`, headers: ['Product', 'HSN/SAC', 'Unit', 'Closing qty', 'Rate', 'Value'], rows: rows.length ? exportRows : [] }))),
        rows.length === 0 ? (h("div", { className: "empty-state" },
            h(Package, { size: 48 }),
            h("p", null, "No products yet. Add them under Products."))) : (h("div", { className: "table-scroll" },
            h("table", { className: "data-table", style: { minWidth: 640 } },
                h("thead", null,
                    h("tr", null,
                        h("th", null, "Product"),
                        h("th", null, "HSN/SAC"),
                        h("th", null, "Unit"),
                        h("th", { style: num }, "Closing qty"),
                        h("th", { style: num }, "Rate"),
                        h("th", { style: num }, "Value"))),
                h("tbody", null,
                    rows.map((r) => (h("tr", { key: r.p.id },
                        h("td", { className: "font-medium" }, r.p.name),
                        h("td", null, r.p.hsn || '-'),
                        h("td", null, r.p.unit || 'Nos'),
                        h("td", { style: { ...num, color: r.q < 0 ? 'var(--danger)' : undefined } }, r.q),
                        h("td", { style: num, title: r.atCost ? 'Purchase price' : 'No purchase price, so selling price' },
                            amt(r.price),
                            r.atCost ? '' : ' *'),
                        h("td", { style: num }, r.q > 0 ? amt(r.value) : '-')))),
                    h("tr", { style: { fontWeight: 700, background: 'var(--bg-secondary)' } },
                        h("td", { colSpan: 5 }, "Total stock value"),
                        h("td", { style: num }, amt(total))))))),
        h("p", { style: { fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0 1.25rem 1rem', margin: 0 } },
            "Worked back from today's stock using the dates of your invoices, purchase bills",
            data.productions.length ? ' and production entries' : '',
            ". Stock you typed in by hand on the Products screen has no date, so it counts as if it changed today. Value is at purchase price; * means no purchase price is saved, so the selling price is used. Negative stock is shown in red and not counted in the total.")));
}
