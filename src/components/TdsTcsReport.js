// v1.10.83 - Reports › TDS & TCS: TDS your clients deducted from your sales
// (with a "certificate received" tick to reconcile with Form 26AS / AIS), TCS
// you collected, and TDS you deducted from suppliers on purchase bills. The
// sums are in utils/tdsTcs.js.
import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { getAllPurchases, getProfile, saveBill } from '../store.js';
import { formatCurrency, getFYOptions, belongsToProfile } from '../utils.js';
import { salesTaxRows, purchaseTdsRows, totalsBy, fyQuarterRange } from '../utils/tdsTcs.js';
import HelpButton from './HelpButton.js';
import TableExport from './TableExport.js';
import { toast } from './Toast.js';
const PERIODS = [['', 'Whole year'], ['Q1', 'Q1 (Apr-Jun)'], ['Q2', 'Q2 (Jul-Sep)'], ['Q3', 'Q3 (Oct-Dec)'], ['Q4', 'Q4 (Jan-Mar)'], ['custom', 'Custom dates']];
const right = { textAlign: 'right' };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');
// A small "totals by ..." table under each list.
function TotalsTable({ title, rows, label }) {
    if (!rows.length)
        return null;
    return (h("div", { style: { flex: '1 1 260px', minWidth: 0 } },
        h("p", { style: { margin: '0.75rem 0 0.35rem', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' } }, title),
        h("div", { className: "table-scroll" },
            h("table", { className: "data-table", style: { fontSize: '0.8rem', marginBottom: 0, minWidth: 0 } },
                h("thead", null,
                    h("tr", null,
                        h("th", null, label),
                        h("th", { style: right }, "Bills"),
                        h("th", { style: right }, "Taxable"),
                        h("th", { style: right }, "Amount"))),
                h("tbody", null, rows.map((r) => (h("tr", { key: r.key },
                    h("td", null, r.key),
                    h("td", { style: right }, r.count),
                    h("td", { style: right }, formatCurrency(r.taxable)),
                    h("td", { style: { ...right, fontWeight: 600 } }, formatCurrency(r.amount))))))))));
}
export default function TdsTcsReport({ bills, businessName, onBillsChanged }) {
    const fyOptions = getFYOptions();
    const [fy, setFy] = useState(fyOptions[0]?.value || '');
    const [period, setPeriod] = useState('');
    const [custom, setCustom] = useState({ from: '', to: '' });
    const [purchases, setPurchases] = useState([]);
    const [certs, setCerts] = useState({}); // id -> ticked, until the reload lands
    useEffect(() => {
        let live = true;
        Promise.all([getAllPurchases(), getProfile().catch(() => null)])
            .then(([pur, prof]) => { if (live)
            setPurchases((pur || []).filter((p) => belongsToProfile(p, prof))); })
            .catch(() => toast('Could not load purchase bills', 'error'));
        return () => { live = false; };
    }, []);
    const range = period === 'custom' ? custom : fyQuarterRange(fy, period);
    const fyLabel = fyOptions.find((f) => f.value === fy)?.label || '';
    const periodLabel = period === 'custom'
        ? [custom.from && fmtDate(custom.from), custom.to && fmtDate(custom.to)].filter(Boolean).join(' to ') || 'All dates'
        : `${fyLabel}${period ? ` ${period}` : ''}`;
    const subtitle = [businessName, periodLabel].filter(Boolean).join(', ');
    const tds = salesTaxRows(bills, 'tds', range).map((r) => (r.id in certs ? { ...r, certificate: certs[r.id] } : r));
    const tcs = salesTaxRows(bills, 'tcs', range);
    const own = purchaseTdsRows(purchases, range);
    const sum = (rows) => rows.reduce((s, r) => s + r.amount, 0);
    const certCount = tds.filter((r) => r.certificate).length;
    const toggleCert = async (row, on) => {
        const bill = bills.find((b) => b.id === row.id);
        if (!bill)
            return;
        setCerts((prev) => ({ ...prev, [row.id]: on }));
        try {
            const { tdsCertificate: _old, ...rest } = bill;
            await saveBill(on ? { ...rest, tdsCertificate: true } : rest, { overwrite: true });
            if (onBillsChanged)
                onBillsChanged();
        }
        catch {
            setCerts((prev) => ({ ...prev, [row.id]: !on }));
            toast('Could not save the tick. Try again.', 'error');
        }
    };
    const listHeaders = ['Date', 'Invoice No', 'Party', 'PAN', 'Section', 'Rate %', 'Taxable value', 'Amount'];
    const listRow = (r) => [r.date, r.invoiceNumber, r.party, r.pan, r.section, r.rate, r.taxable, r.amount];
    return (h(Fragment, null,
        h("div", { className: "glass-panel", style: { padding: '1.25rem', marginBottom: '1.5rem' } },
            h("div", { style: { display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' } },
                h("div", { className: "form-group", style: { margin: 0 } },
                    h("label", { className: "form-label", htmlFor: "tds-fy" }, "Financial year"),
                    h("select", { id: "tds-fy", className: "form-input", value: fy, disabled: period === 'custom', onChange: (e) => setFy(e.target.value) }, fyOptions.map((f) => h("option", { key: f.value, value: f.value }, f.label)))),
                h("div", { className: "form-group", style: { margin: 0 } },
                    h("label", { className: "form-label", htmlFor: "tds-period" }, "Period"),
                    h("select", { id: "tds-period", className: "form-input", value: period, onChange: (e) => setPeriod(e.target.value) }, PERIODS.map(([v, l]) => h("option", { key: v, value: v }, l)))),
                period === 'custom' && (h(Fragment, null,
                    h("div", { className: "form-group", style: { margin: 0 } },
                        h("label", { className: "form-label", htmlFor: "tds-from" }, "From"),
                        h("input", { id: "tds-from", type: "date", className: "form-input", value: custom.from, onChange: (e) => setCustom((c) => ({ ...c, from: e.target.value })) })),
                    h("div", { className: "form-group", style: { margin: 0 } },
                        h("label", { className: "form-label", htmlFor: "tds-to" }, "To"),
                        h("input", { id: "tds-to", type: "date", className: "form-input", value: custom.to, onChange: (e) => setCustom((c) => ({ ...c, to: e.target.value })) })))),
                h(HelpButton, { title: "TDS & TCS period", doc: "reports#tds-tcs", size: 16, style: { marginBottom: 7 } }))),
        h("div", { className: "stats-grid", style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1.5rem' } },
            h("div", { className: "stat-card" },
                h("div", null,
                    h("p", { className: "stat-label" }, "TDS by your clients"),
                    h("h2", { className: "stat-value stat-value-green" }, formatCurrency(sum(tds))))),
            h("div", { className: "stat-card" },
                h("div", null,
                    h("p", { className: "stat-label" }, "Certificates received"),
                    h("h2", { className: "stat-value" },
                        certCount,
                        " / ",
                        tds.length))),
            h("div", { className: "stat-card" },
                h("div", null,
                    h("p", { className: "stat-label" }, "TCS you collected"),
                    h("h2", { className: "stat-value stat-value-amber" }, formatCurrency(sum(tcs))))),
            h("div", { className: "stat-card" },
                h("div", null,
                    h("p", { className: "stat-label" }, "TDS you deducted"),
                    h("h2", { className: "stat-value stat-value-purple" }, formatCurrency(sum(own)))))),
        h("div", { className: "glass-panel", style: { padding: '1.25rem', marginBottom: '1.5rem' } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' } },
                h("h3", { style: { margin: 0, fontSize: '1rem' } },
                    "TDS deducted by your clients",
                    h(HelpButton, { title: "TDS deducted by your clients", doc: "reports#tds-by-clients", size: 16 })),
                h(TableExport, { title: "TDS deducted by clients", filename: `TDS-by-clients-${periodLabel}`, subtitle: subtitle, landscape: true, headers: [...listHeaders, 'Certificate received'], rows: tds.map((r) => [...listRow(r), r.certificate ? 'Yes' : 'No']) })),
            h("p", { className: "text-muted", style: { margin: '0 0 0.75rem', fontSize: '0.8rem' } }, "Income tax your clients kept back from your sales invoices. It is credited to your PAN: tick each invoice once its TDS certificate (Form 16A) arrives or it shows in Form 26AS / AIS, and claim the total in your income tax return."),
            tds.length === 0 ? (h("p", { className: "text-muted", style: { fontSize: '0.85rem', textAlign: 'center', padding: '0.75rem' } }, "No sales invoices with TDS in this period. Tick TDS on an invoice under Customize, or record it with a payment.")) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table", style: { minWidth: 820, fontSize: '0.82rem', marginBottom: 0 } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Date"),
                            h("th", null, "Invoice No"),
                            h("th", null, "Client"),
                            h("th", null, "PAN"),
                            h("th", null, "Section"),
                            h("th", { style: right }, "Rate"),
                            h("th", { style: right }, "Taxable"),
                            h("th", { style: right }, "TDS"),
                            h("th", { style: { textAlign: 'center' } }, "Certificate"))),
                    h("tbody", null, tds.map((r) => (h("tr", { key: r.id },
                        h("td", { className: "text-muted" }, fmtDate(r.date)),
                        h("td", null,
                            h("span", { className: "invoice-badge" }, r.invoiceNumber)),
                        h("td", { className: "font-medium" }, r.party || '—'),
                        h("td", { style: { fontFamily: 'monospace', fontSize: '0.75rem' } }, r.pan || '—'),
                        h("td", null, r.section),
                        h("td", { style: right },
                            r.rate,
                            "%"),
                        h("td", { style: right }, formatCurrency(r.taxable)),
                        h("td", { style: { ...right, fontWeight: 700 } }, formatCurrency(r.amount)),
                        h("td", { style: { textAlign: 'center' } },
                            h("input", { type: "checkbox", checked: !!r.certificate, onChange: (e) => toggleCert(r, e.target.checked), "aria-label": `TDS certificate received for ${r.invoiceNumber}`, style: { width: 16, height: 16, accentColor: 'var(--primary)', cursor: 'pointer' } }))))))))),
            h("div", { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
                h(TotalsTable, { title: "By client", label: "Client", rows: totalsBy(tds, (r) => r.party) }),
                h(TotalsTable, { title: "By quarter", label: "Quarter", rows: totalsBy(tds, (r) => r.quarter) }))),
        h("div", { className: "glass-panel", style: { padding: '1.25rem', marginBottom: '1.5rem' } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' } },
                h("h3", { style: { margin: 0, fontSize: '1rem' } },
                    "TCS you collected",
                    h(HelpButton, { title: "TCS you collected", doc: "reports#tcs-collected", size: 16 })),
                h(TableExport, { title: "TCS collected", filename: `TCS-collected-${periodLabel}`, subtitle: subtitle, landscape: true, headers: listHeaders, rows: tcs.map(listRow) })),
            h("p", { className: "text-muted", style: { margin: '0 0 0.75rem', fontSize: '0.8rem' } }, "Tax you added to sales invoices and collected from buyers. You deposit it with the government and report it in your TCS return (Form 27EQ)."),
            tcs.length === 0 ? (h("p", { className: "text-muted", style: { fontSize: '0.85rem', textAlign: 'center', padding: '0.75rem' } }, "No sales invoices with TCS in this period.")) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table", style: { minWidth: 720, fontSize: '0.82rem', marginBottom: 0 } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Date"),
                            h("th", null, "Invoice No"),
                            h("th", null, "Client"),
                            h("th", null, "PAN"),
                            h("th", null, "Section"),
                            h("th", { style: right }, "Rate"),
                            h("th", { style: right }, "Taxable"),
                            h("th", { style: right }, "TCS"))),
                    h("tbody", null, tcs.map((r) => (h("tr", { key: r.id },
                        h("td", { className: "text-muted" }, fmtDate(r.date)),
                        h("td", null,
                            h("span", { className: "invoice-badge" }, r.invoiceNumber)),
                        h("td", { className: "font-medium" }, r.party || '—'),
                        h("td", { style: { fontFamily: 'monospace', fontSize: '0.75rem' } }, r.pan || '—'),
                        h("td", null, r.section),
                        h("td", { style: right },
                            r.rate,
                            "%"),
                        h("td", { style: right }, formatCurrency(r.taxable)),
                        h("td", { style: { ...right, fontWeight: 700 } }, formatCurrency(r.amount))))))))),
            h("div", { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
                h(TotalsTable, { title: "By client", label: "Client", rows: totalsBy(tcs, (r) => r.party) }),
                h(TotalsTable, { title: "By quarter", label: "Quarter", rows: totalsBy(tcs, (r) => r.quarter) }))),
        h("div", { className: "glass-panel", style: { padding: '1.25rem' } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' } },
                h("h3", { style: { margin: 0, fontSize: '1rem' } },
                    "TDS you deducted from suppliers",
                    h(HelpButton, { title: "TDS you deducted from suppliers", doc: "reports#tds-on-purchases", size: 16 })),
                h(TableExport, { title: "TDS deducted from suppliers", filename: `TDS-on-purchases-${periodLabel}`, subtitle: subtitle, landscape: true, headers: [...listHeaders, 'Paid to supplier'], rows: own.map((r) => [...listRow(r), r.paid]) })),
            h("p", { className: "text-muted", style: { margin: '0 0 0.75rem', fontSize: '0.8rem' } }, "TDS you kept back from suppliers' payments (from the purchase bills). Deposit it by the 7th of the next month and report it in your quarterly TDS return (Form 26Q)."),
            own.length === 0 ? (h("p", { className: "text-muted", style: { fontSize: '0.85rem', textAlign: 'center', padding: '0.75rem' } }, "No purchase bills with TDS in this period. Tick TDS deducted on a purchase bill to record it.")) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table", style: { minWidth: 820, fontSize: '0.82rem', marginBottom: 0 } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Date"),
                            h("th", null, "Bill No"),
                            h("th", null, "Supplier"),
                            h("th", null, "PAN"),
                            h("th", null, "Section"),
                            h("th", { style: right }, "Rate"),
                            h("th", { style: right }, "Taxable"),
                            h("th", { style: right }, "TDS"),
                            h("th", { style: right }, "Paid to supplier"))),
                    h("tbody", null, own.map((r) => (h("tr", { key: r.id },
                        h("td", { className: "text-muted" }, fmtDate(r.date)),
                        h("td", null,
                            h("span", { className: "invoice-badge" }, r.invoiceNumber)),
                        h("td", { className: "font-medium" }, r.party || '—'),
                        h("td", { style: { fontFamily: 'monospace', fontSize: '0.75rem' } }, r.pan || '—'),
                        h("td", null, r.section),
                        h("td", { style: right },
                            r.rate,
                            "%"),
                        h("td", { style: right }, formatCurrency(r.taxable)),
                        h("td", { style: { ...right, fontWeight: 700 } }, formatCurrency(r.amount)),
                        h("td", { style: right }, formatCurrency(r.paid))))))))),
            h("div", { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
                h(TotalsTable, { title: "By section", label: "Section", rows: totalsBy(own, (r) => r.section) }),
                h(TotalsTable, { title: "By quarter", label: "Quarter", rows: totalsBy(own, (r) => r.quarter) })))));
}
