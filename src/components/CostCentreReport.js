// v1.10.83 (#112) - Reports > By cost centre: sales, purchases, expenses and
// profit for each branch, site or project in the period chosen above. The
// maths is costCentreReport() in utils/costCentres.js (tested in
// scripts/costcentre-test.mjs).
import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { getAllPurchases } from '../store.js';
import { formatCurrency, belongsToProfile } from '../utils.js';
import { costCentreReport, centreLabel } from '../utils/costCentres.js';
import { billCurrency } from '../utils/partyOutstanding.js';
import { useCostCentres } from './useCostCentres.js';
import TableExport from './TableExport.js';
import HelpButton from './HelpButton.js';
import { toast } from './Toast.js';
const HEADERS = ['Cost centre', 'Sales (taxable)', 'GST on sales', 'Sales total', 'Purchases (ex. GST)', 'Expenses (ex. GST)', 'Profit'];
// bills and expenses come from ReportsView, already narrowed to this business
// with cancelled invoices left out. Purchases have no currency: they count as INR.
export default function CostCentreReport({ bills, expenses, profile, from, to, currency, subtitle, periodLabel }) {
    const { centres } = useCostCentres(profile);
    const [purchases, setPurchases] = useState([]);
    useEffect(() => {
        getAllPurchases()
            .then((rows) => setPurchases((rows || []).filter((p) => belongsToProfile(p, profile))))
            .catch(() => toast('Failed to load purchases', 'error'));
    }, [profile]);
    const { rows, total } = costCentreReport({
        bills: bills.filter((b) => billCurrency(b) === currency),
        purchases: currency === 'INR' ? purchases : [],
        expenses: expenses.filter((e) => (e.currency || 'INR') === currency),
        centres, from, to,
    });
    const nameOf = (r) => centreLabel(r) + (r.archived ? ' (archived)' : '');
    const cells = (r) => [r.salesTaxable, r.salesTax, r.salesTotal, r.purchases, r.expenses, r.profit];
    const money = (n) => formatCurrency(n, currency);
    return (h("div", { className: "glass-panel" },
        h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.5rem' } },
            h("h3", null,
                "By cost centre",
                h(HelpButton, { title: "By cost centre", doc: "reports#cost-centres", size: 16 })),
            h(TableExport, { title: "Profit by cost centre", filename: `Cost-centres-${periodLabel}`, landscape: true, subtitle: subtitle, headers: HEADERS, rows: [...rows.map((r) => [nameOf(r), ...cells(r)]), ['Total', ...cells(total)]] })),
        h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 1.25rem 0.75rem' } }, "Profit = sales (taxable) - purchases - expenses, all without GST. Credit notes are subtracted; cancelled invoices, quotations and challans are left out."),
        h("div", { className: "table-scroll" },
            h("table", { className: "data-table", style: { minWidth: '760px' } },
                h("thead", null,
                    h("tr", null, HEADERS.map((h, i) => h("th", { key: h, style: i ? { textAlign: 'right' } : undefined }, h)))),
                h("tbody", null, rows.map((r) => (h("tr", { key: r.id },
                    h("td", { className: "font-medium", style: r.archived ? { opacity: 0.7 } : undefined }, nameOf(r)),
                    cells(r).map((v, i) => (h("td", { key: i, style: { textAlign: 'right', ...(i === 5 ? { fontWeight: 700, color: v >= 0 ? 'var(--success)' : 'var(--danger)' } : {}) } }, money(v)))))))),
                h("tfoot", null,
                    h("tr", { style: { fontWeight: 'bold', borderTop: '2px solid var(--border)' } },
                        h("td", null, "Total"),
                        cells(total).map((v, i) => h("td", { key: i, style: { textAlign: 'right' } }, money(v)))))))));
}
