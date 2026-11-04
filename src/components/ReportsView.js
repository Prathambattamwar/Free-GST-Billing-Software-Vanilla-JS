import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { TrendingUp, TrendingDown, Wallet, BarChart3, Clock, Search, X, Users, Package, Boxes, Building2, Percent } from '../vanilla/icons.js';
import { getAllBills, getAllExpenses, getProfile } from '../store.js';
import { formatCurrency, getFYOptions, belongsToProfile, isCancelledBill, salesSign, countsAsSales, calculateLineItemTax, roundQty, parseLocalDate, amountDue } from '../utils.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
import PartyOutstandingReport from './PartyOutstandingReport.js';
import StockReport from './StockReport.js';
import TableExport from './TableExport.js';
import { billCurrency } from '../utils/partyOutstanding.js';
import { billsInInr } from '../utils/fx.js';
import CostCentreReport from './CostCentreReport.js';
import { costCentresOn } from './useCostCentres.js';
import TdsTcsReport from './TdsTcsReport.js';
const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];
// v1.10.6 — audit L4: local copy removed, imported from utils above.
const getBillCurrency = billCurrency;
// v1.10.83 - "All, in ₹": every invoice, a foreign-currency one at the
// exchange rate saved on it. The default for an Indian business that bills in
// more than one currency (export income is income).
const ALL_INR = 'ALL_INR';
// The ? at the end of the tab row opens the guide at the tab on screen.
const TAB_HELP = {
    pl: ['Profit & Loss', 'reports#profit-loss'],
    aging: ['Outstanding & Aging', 'reports#outstanding'],
    party: ['Party Outstanding', 'reports#party-outstanding'],
    clients: ['Client Analytics', 'reports#clients'],
    products: ['Product Performance', 'reports#products'],
    stock: ['Stock', 'reports#stock'],
    costcentres: ['By cost centre', 'reports#cost-centres'],
    tds: ['TDS & TCS', 'reports#tds-tcs'],
};
export default function ReportsView() {
    const [bills, setBills] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [activeTab, setActiveTab] = useState('pl');
    const [filterMode, setFilterMode] = useState('fy');
    const [fyFilter, setFyFilter] = useState('');
    const [monthFilter, setMonthFilter] = useState('');
    const [yearFilter, setYearFilter] = useState('');
    const [agingSearch, setAgingSearch] = useState('');
    const [currencyFilter, setCurrencyFilter] = useState(ALL_INR);
    const [businessName, setBusinessName] = useState('');
    // v1.10.83 (#112) - the By cost centre tab needs the business itself.
    const [ownerProfile, setOwnerProfile] = useState(null);
    const [ccOn] = useState(costCentresOn);
    const fyOptions = getFYOptions();
    const currentYear = new Date().getFullYear();
    const yearOptions = [];
    for (let y = currentYear; y >= currentYear - 5; y--)
        yearOptions.push(y);
    const loadData = async () => {
        try {
            const [billData, expData, prof] = await Promise.all([
                getAllBills(), getAllExpenses(), getProfile().catch(() => null),
            ]);
            // v1.10.64 (#55) — reports are per business. Mixing two companies'
            // turnover into one profit figure is simply a wrong number.
            // v1.10.67 (#66 item 12) — cancelled invoices earned nothing.
            setBills((billData || []).filter(b => belongsToProfile(b, prof) && !isCancelledBill(b)));
            // v1.10.66 (#64) — expenses too. Filtering only the invoices left every
            // company's expenses in each company's profit and loss.
            setExpenses((expData || []).filter(e => belongsToProfile(e, prof)));
            setBusinessName(prof?.businessName || '');
            setOwnerProfile(prof);
        }
        catch {
            toast('Failed to load data', 'error');
        }
    };
    useEffect(() => {
        const now = new Date();
        const fy = fyOptions[0];
        if (fy)
            setFyFilter(fy.value);
        setYearFilter(String(now.getFullYear()));
        setMonthFilter(String(now.getMonth()));
        loadData();
    }, []);
    const filterByPeriod = (date) => {
        if (!date)
            return false;
        if (filterMode === 'fy') {
            const fy = fyOptions.find(f => f.value === fyFilter);
            return fy ? date >= fy.from && date <= fy.to : true;
        }
        else {
            const d = parseLocalDate(date); // local date: UTC midnight is the previous day west of Greenwich
            return d.getFullYear() === parseInt(yearFilter) && d.getMonth() === parseInt(monthFilter);
        }
    };
    // Only real sales and credit notes, the same rule as the Dashboard: a
    // proforma is a quote and a challan moves goods without selling them, so
    // neither is revenue; a credit note reduces revenue (salesSign -1).
    const allFilteredBills = bills.filter(bill => bill.data && salesSign(bill) !== 0 && filterByPeriod(bill.invoiceDate));
    // v1.10.1 — Filter expenses by the same currency as the P&L view.
    // Prior code left this unfiltered, so USD-invoice revenue got INR
    // expenses subtracted → nonsense net profit. Expenses without a
    // `currency` field are assumed INR (legacy records).
    // All distinct currencies in the filtered period
    const allCurrencies = [...new Set(allFilteredBills.map(getBillCurrency))].sort();
    const allInInrOffered = allCurrencies.length > 1 && (ownerProfile?.country || 'India') === 'India';
    const currencyChoices = allInInrOffered ? [ALL_INR, ...allCurrencies] : allCurrencies;
    // Set currency filter to first available if current selection not in list
    useEffect(() => {
        if (currencyChoices.length > 0 && !currencyChoices.includes(currencyFilter)) {
            setCurrencyFilter(currencyChoices[0]);
        }
    }, [currencyChoices.join(',')]);
    const allInInr = currencyFilter === ALL_INR;
    // The currency amounts are shown in.
    const shownCurrency = allInInr ? 'INR' : currencyFilter;
    const converted = allInInr ? billsInInr(allFilteredBills) : null;
    const filteredExpenses = expenses.filter(exp => filterByPeriod(exp.date) && ((exp.currency || 'INR') === shownCurrency));
    // The invoices of the chosen currency (all of them, in rupees, for ALL_INR).
    const billsShown = allInInr ? converted.bills : allFilteredBills.filter(b => getBillCurrency(b) === currencyFilter);
    // v1.10.77 (#85) - the period in words, for exported reports.
    const periodLabel = filterMode === 'fy'
        ? (fyOptions.find(f => f.value === fyFilter)?.label || '')
        : `${MONTHS[parseInt(monthFilter)] || ''} ${yearFilter}`;
    // The same period as dates, both days included (By cost centre).
    const periodRange = (() => {
        if (filterMode === 'fy') {
            const fy = fyOptions.find(f => f.value === fyFilter);
            return fy ? { from: fy.from, to: fy.to } : { from: '', to: '' };
        }
        const y = parseInt(yearFilter), m = parseInt(monthFilter) + 1;
        if (!y || !m)
            return { from: '', to: '' };
        const mm = String(m).padStart(2, '0');
        return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
    })();
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const exportSubtitle = (extra = '') => [businessName, periodLabel, allInInr ? 'all currencies in INR' : (currencyFilter !== 'INR' ? currencyFilter : ''), extra].filter(Boolean).join(', ');
    // Bills for P&L — only selected currency
    const plBills = billsShown;
    // P&L
    // TCS on an invoice is collected for the government, like GST: it is in the
    // invoice total but is not income, so it is counted with the tax.
    const tcsOf = (b) => Number(b.data?.totals?.tcsAmount) || 0;
    const totalRevenue = plBills.reduce((s, b) => s + salesSign(b) * (b.totalAmount || 0), 0);
    const totalTaxCollected = plBills.reduce((s, b) => s + salesSign(b) * ((b.totalTaxAmount || 0) + tcsOf(b)), 0);
    const revenueExTax = totalRevenue - totalTaxCollected;
    const totalExpenseAmount = filteredExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const totalExpenseGST = filteredExpenses.reduce((s, e) => s + (e.gstAmount || 0), 0);
    const expenseExGST = totalExpenseAmount - totalExpenseGST;
    const netProfit = revenueExTax - expenseExGST;
    // Monthly breakdown — per selected currency
    const monthlyPL = {};
    plBills.forEach(b => {
        if (!b.invoiceDate)
            return;
        const key = b.invoiceDate.substring(0, 7);
        if (!monthlyPL[key])
            monthlyPL[key] = { revenue: 0, tax: 0, expense: 0, expGst: 0 };
        monthlyPL[key].revenue += salesSign(b) * (b.totalAmount || 0);
        monthlyPL[key].tax += salesSign(b) * ((b.totalTaxAmount || 0) + tcsOf(b));
    });
    filteredExpenses.forEach(e => {
        if (!e.date)
            return;
        const key = e.date.substring(0, 7);
        if (!monthlyPL[key])
            monthlyPL[key] = { revenue: 0, tax: 0, expense: 0, expGst: 0 };
        monthlyPL[key].expense += e.amount || 0;
        monthlyPL[key].expGst += e.gstAmount || 0;
    });
    const monthlyKeys = Object.keys(monthlyPL).sort();
    // ========== Outstanding & Aging ==========
    const today = new Date();
    // Money owed to you: only on sales (a quote, a challan or a credit note is
    // never a receivable).
    const unpaidBills = bills.filter(b => countsAsSales(b) && b.status !== 'paid');
    const agingData = unpaidBills.map(b => {
        // Guard against missing or invalid dates — `new Date(undefined)` returns Invalid Date
        // which propagates as NaN through the aging math and breaks the chart.
        const dueDate = b.data?.details?.dueDate || b.invoiceDate;
        const due = dueDate ? parseLocalDate(dueDate) : null;
        const daysOverdue = (due && !isNaN(due.getTime()))
            ? Math.max(0, Math.floor((today - due) / 86400000))
            : 0;
        // Less TDS the client deducts: they pay Net Receivable.
        const outstanding = amountDue(b) - (b.paidAmount || 0);
        let bucket = 'current';
        if (daysOverdue > 90)
            bucket = '90plus';
        else if (daysOverdue > 60)
            bucket = '61to90';
        else if (daysOverdue > 30)
            bucket = '31to60';
        return {
            clientName: b.clientName || 'Unknown',
            invoiceNumber: b.invoiceNumber,
            invoiceDate: b.invoiceDate,
            dueDate,
            totalAmount: b.totalAmount || 0,
            paidAmount: b.paidAmount || 0,
            outstanding,
            daysOverdue,
            bucket,
            currency: getBillCurrency(b),
        };
    }).filter(r => r.outstanding > 0);
    const agingFiltered = agingSearch.trim()
        ? agingData.filter(r => r.clientName.toLowerCase().includes(agingSearch.toLowerCase()))
        : agingData;
    // Aging summary — group by currency
    const agingByCurrency = {};
    agingFiltered.forEach(r => {
        if (!agingByCurrency[r.currency])
            agingByCurrency[r.currency] = { total: 0, current: 0, '31to60': 0, '61to90': 0, '90plus': 0 };
        agingByCurrency[r.currency].total += r.outstanding;
        agingByCurrency[r.currency][r.bucket] += r.outstanding;
    });
    // Keep INR-first ordering for display
    const agingCurrencies = Object.keys(agingByCurrency).sort((a, b) => a === 'INR' ? -1 : b === 'INR' ? 1 : a.localeCompare(b));
    const agingSorted = [...agingFiltered].sort((a, b) => b.daysOverdue - a.daysOverdue);
    return (h("div", { className: "dashboard-container" },
        h("div", { className: "page-header" },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h("div", null,
                    h("h1", { className: "page-title" },
                        "Reports ",
                        h(HelpButton, { title: "Reports \u2014 how to use", doc: "reports", size: 16 })),
                    h("p", { className: "page-subtitle" }, "Financial reports and receivables analysis")))),
        h("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
            h("button", { className: `btn ${activeTab === 'pl' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('pl') },
                h(BarChart3, { size: 16 }),
                " Profit & Loss"),
            h("button", { className: `btn ${activeTab === 'aging' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('aging') },
                h(Clock, { size: 16 }),
                " Outstanding & Aging"),
            h("button", { className: `btn ${activeTab === 'party' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('party') },
                h(Users, { size: 16 }),
                " Party Outstanding"),
            h("button", { className: `btn ${activeTab === 'clients' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('clients') },
                h(Users, { size: 16 }),
                " Client Analytics"),
            h("button", { className: `btn ${activeTab === 'products' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('products') },
                h(Package, { size: 16 }),
                " Product Performance"),
            h("button", { className: `btn ${activeTab === 'stock' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('stock') },
                h(Boxes, { size: 16 }),
                " Stock"),
            h("button", { className: `btn ${activeTab === 'tds' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('tds') },
                h(Percent, { size: 16 }),
                " TDS & TCS"),
            ccOn && (h("button", { className: `btn ${activeTab === 'costcentres' ? 'btn-primary' : 'btn-secondary'}`, onClick: () => setActiveTab('costcentres') },
                h(Building2, { size: 16 }),
                " By cost centre")),
            h(HelpButton, { title: TAB_HELP[activeTab][0], doc: TAB_HELP[activeTab][1], size: 16, style: { alignSelf: 'center' } })),
        activeTab !== 'aging' && activeTab !== 'party' && activeTab !== 'stock' && activeTab !== 'tds' && (h("div", { className: "glass-panel", style: { padding: '1.25rem', marginBottom: '1.5rem' } },
            h("div", { style: { display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' } },
                h("div", { className: "form-group", style: { margin: 0 } },
                    h("label", { className: "form-label" }, "Filter By"),
                    h("select", { className: "form-input", value: filterMode, onChange: e => setFilterMode(e.target.value) },
                        h("option", { value: "fy" }, "Fiscal Year"),
                        h("option", { value: "month" }, "Month / Year"))),
                filterMode === 'fy' ? (h("div", { className: "form-group", style: { margin: 0 } },
                    h("label", { className: "form-label" }, "Fiscal Year"),
                    h("select", { className: "form-input", value: fyFilter, onChange: e => setFyFilter(e.target.value) }, fyOptions.map(fy => h("option", { key: fy.value, value: fy.value }, fy.label))))) : (h(Fragment, null,
                    h("div", { className: "form-group", style: { margin: 0 } },
                        h("label", { className: "form-label" }, "Month"),
                        h("select", { className: "form-input", value: monthFilter, onChange: e => setMonthFilter(e.target.value) }, MONTHS.map((m, i) => h("option", { key: i, value: i }, m)))),
                    h("div", { className: "form-group", style: { margin: 0 } },
                        h("label", { className: "form-label" }, "Year"),
                        h("select", { className: "form-input", value: yearFilter, onChange: e => setYearFilter(e.target.value) }, yearOptions.map(y => h("option", { key: y, value: y }, y)))))),
                allCurrencies.length > 1 && (h("div", { className: "form-group", style: { margin: 0 } },
                    h("label", { className: "form-label" }, "Currency"),
                    h("select", { className: "form-input", value: currencyFilter, onChange: e => setCurrencyFilter(e.target.value) }, currencyChoices.map(c => h("option", { key: c, value: c }, c === ALL_INR ? 'All, in ₹' : c))))),
                h(HelpButton, { title: "Period and currency", doc: "reports#period", size: 16, style: { marginBottom: 7 } })))),
        activeTab === 'pl' && (h(Fragment, null,
            h("div", { className: "stats-grid", style: { gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '1.5rem' } },
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon stat-icon-green" },
                        h(TrendingUp, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" }, "Revenue (ex. tax)"),
                        h("h2", { className: "stat-value stat-value-green" }, formatCurrency(revenueExTax, shownCurrency)))),
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon stat-icon-purple" },
                        h(TrendingDown, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" }, "Expenses (ex. GST)"),
                        h("h2", { className: "stat-value stat-value-purple" }, formatCurrency(expenseExGST, shownCurrency)))),
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon", style: { background: netProfit >= 0 ? 'var(--success-light)' : 'var(--danger-light)', color: netProfit >= 0 ? 'var(--success)' : 'var(--danger)' } },
                        h(Wallet, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" },
                            "Net ",
                            netProfit >= 0 ? 'Profit' : 'Loss'),
                        h("h2", { className: "stat-value", style: { color: netProfit >= 0 ? 'var(--success)' : 'var(--danger)' } }, formatCurrency(netProfit, shownCurrency)))),
                h("div", { className: "stat-card" },
                    h("div", { className: "stat-icon stat-icon-blue" },
                        h(BarChart3, { size: 22 })),
                    h("div", null,
                        h("p", { className: "stat-label" }, "Margin"),
                        h("h2", { className: "stat-value" },
                            revenueExTax > 0 ? Math.round((netProfit / revenueExTax) * 100) : 0,
                            "%")))),
            h("div", { className: "glass-panel", style: { marginBottom: '1.5rem' } },
                h("div", { className: "table-header" },
                    h("h3", null,
                        "Profit & Loss Statement",
                        h(HelpButton, { title: "Profit & Loss Statement", doc: "reports#pl-statement", size: 16 })),
                    allCurrencies.length > 1 && (h("span", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 } },
                        allInInr ? 'All invoices, in ₹ at each invoice\'s exchange rate' : `Showing ${currencyFilter} invoices only`,
                        allInInr && converted.missing.length > 0 && (h("span", { style: { color: 'var(--warn-text, #b45309)' } },
                            " \u00B7 \u26A0 ",
                            converted.missing.length,
                            " left out, no exchange rate: ",
                            converted.missing.slice(0, 3).map(b => b.invoiceNumber).join(', ')))))),
                h("div", { style: { padding: '1.5rem' } },
                    h("table", { style: { width: '100%', maxWidth: '500px', margin: '0 auto', borderCollapse: 'collapse' } },
                        h("tbody", null,
                            h("tr", { style: { borderBottom: '1px solid var(--border)' } },
                                h("td", { style: { padding: '0.6rem 0', fontWeight: 500, color: 'var(--text-secondary)' } }, "Total Revenue"),
                                h("td", { style: { padding: '0.6rem 0', textAlign: 'right', fontWeight: 600 } }, formatCurrency(totalRevenue, shownCurrency))),
                            h("tr", { style: { borderBottom: '1px solid var(--border)' } },
                                h("td", { style: { padding: '0.6rem 0', fontWeight: 500, color: 'var(--text-secondary)' } }, "Less: GST Collected"),
                                h("td", { style: { padding: '0.6rem 0', textAlign: 'right', color: '#dc2626' } },
                                    "-",
                                    formatCurrency(totalTaxCollected, shownCurrency))),
                            h("tr", { style: { borderBottom: '2px solid var(--border)' } },
                                h("td", { style: { padding: '0.6rem 0', fontWeight: 700 } }, "Net Revenue"),
                                h("td", { style: { padding: '0.6rem 0', textAlign: 'right', fontWeight: 700 } }, formatCurrency(revenueExTax, shownCurrency))),
                            h("tr", { style: { borderBottom: '1px solid var(--border)' } },
                                h("td", { style: { padding: '0.6rem 0', fontWeight: 500, color: 'var(--text-secondary)' } }, "Total Expenses"),
                                h("td", { style: { padding: '0.6rem 0', textAlign: 'right', fontWeight: 600 } }, formatCurrency(totalExpenseAmount, shownCurrency))),
                            h("tr", { style: { borderBottom: '1px solid var(--border)' } },
                                h("td", { style: { padding: '0.6rem 0', fontWeight: 500, color: 'var(--text-secondary)' } }, "Less: GST on Expenses (ITC)"),
                                h("td", { style: { padding: '0.6rem 0', textAlign: 'right', color: '#059669' } },
                                    "-",
                                    formatCurrency(totalExpenseGST, shownCurrency))),
                            h("tr", { style: { borderBottom: '2px solid var(--border)' } },
                                h("td", { style: { padding: '0.6rem 0', fontWeight: 700 } }, "Net Expenses"),
                                h("td", { style: { padding: '0.6rem 0', textAlign: 'right', fontWeight: 700 } }, formatCurrency(expenseExGST, shownCurrency))),
                            h("tr", null,
                                h("td", { style: { padding: '1rem 0', fontWeight: 800, fontSize: '1.1rem' } },
                                    "Net ",
                                    netProfit >= 0 ? 'Profit' : 'Loss'),
                                h("td", { style: { padding: '1rem 0', textAlign: 'right', fontWeight: 800, fontSize: '1.25rem', color: netProfit >= 0 ? '#059669' : '#dc2626' } }, formatCurrency(netProfit, shownCurrency))))))),
            monthlyKeys.length > 0 && (h("div", { className: "glass-panel" },
                h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.5rem' } },
                    h("h3", null,
                        "Monthly Breakdown",
                        h(HelpButton, { title: "Monthly Breakdown", doc: "reports#monthly-breakdown", size: 16 })),
                    h(TableExport, { title: "Profit and loss by month", filename: `Profit-and-loss-${periodLabel}`, subtitle: exportSubtitle('before tax, GST left out'), headers: ['Month', 'Revenue', 'Expenses', 'Profit/Loss'], rows: [
                            ...monthlyKeys.map(key => {
                                const m = monthlyPL[key];
                                const [y, mo] = key.split('-');
                                return [`${MONTHS[parseInt(mo) - 1]} ${y}`, r2(m.revenue - m.tax), r2(m.expense - m.expGst), r2((m.revenue - m.tax) - (m.expense - m.expGst))];
                            }),
                            ['Total', r2(revenueExTax), r2(expenseExGST), r2(netProfit)],
                        ] })),
                h("div", { className: "table-scroll" },
                    h("table", { className: "data-table", style: { minWidth: '600px' } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Month"),
                                h("th", { style: { textAlign: 'right' } }, "Revenue"),
                                h("th", { style: { textAlign: 'right' } }, "Expenses"),
                                h("th", { style: { textAlign: 'right' } }, "Profit/Loss"))),
                        h("tbody", null, monthlyKeys.map(key => {
                            const m = monthlyPL[key];
                            const rev = m.revenue - m.tax;
                            const exp = m.expense - m.expGst;
                            const pl = rev - exp;
                            const [y, mo] = key.split('-');
                            return (h("tr", { key: key },
                                h("td", { className: "font-medium" },
                                    MONTHS[parseInt(mo) - 1],
                                    " ",
                                    y),
                                h("td", { style: { textAlign: 'right' } }, formatCurrency(rev, shownCurrency)),
                                h("td", { style: { textAlign: 'right' } }, formatCurrency(exp, shownCurrency)),
                                h("td", { style: { textAlign: 'right', fontWeight: 700, color: pl >= 0 ? '#059669' : '#dc2626' } }, formatCurrency(pl, shownCurrency))));
                        })))))))),
        activeTab === 'party' && h(PartyOutstandingReport, { bills: bills, businessName: businessName }),
        activeTab === 'costcentres' && ccOn && (h(CostCentreReport, { bills: bills, expenses: expenses, profile: ownerProfile, from: periodRange.from, to: periodRange.to, currency: shownCurrency, subtitle: exportSubtitle('before tax, GST left out'), periodLabel: periodLabel })),
        activeTab === 'stock' && h(StockReport, { businessName: businessName }),
        activeTab === 'tds' && h(TdsTcsReport, { bills: bills, businessName: businessName, onBillsChanged: loadData }),
        activeTab === 'aging' && (h(Fragment, null,
            agingCurrencies.map(cur => (h("div", { key: cur, style: { marginBottom: '1rem' } },
                agingCurrencies.length > 1 && (h("p", { style: { fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' } }, cur)),
                h("div", { className: "stats-grid", style: { gridTemplateColumns: 'repeat(5, 1fr)' } },
                    h("div", { className: "stat-card" },
                        h("div", { className: "stat-icon stat-icon-blue" },
                            h(Wallet, { size: 22 })),
                        h("div", null,
                            h("p", { className: "stat-label" }, "Total Outstanding"),
                            h("h2", { className: "stat-value" }, formatCurrency(agingByCurrency[cur].total, cur)))),
                    h("div", { className: "stat-card" },
                        h("div", null,
                            h("p", { className: "stat-label" }, "Current (0-30d)"),
                            h("h2", { className: "stat-value stat-value-green" }, formatCurrency(agingByCurrency[cur].current, cur)))),
                    h("div", { className: "stat-card" },
                        h("div", null,
                            h("p", { className: "stat-label" }, "31-60 days"),
                            h("h2", { className: "stat-value stat-value-amber" }, formatCurrency(agingByCurrency[cur]['31to60'], cur)))),
                    h("div", { className: "stat-card" },
                        h("div", null,
                            h("p", { className: "stat-label" }, "61-90 days"),
                            h("h2", { className: "stat-value stat-value-purple" }, formatCurrency(agingByCurrency[cur]['61to90'], cur)))),
                    h("div", { className: "stat-card" },
                        h("div", null,
                            h("p", { className: "stat-label" }, "90+ days"),
                            h("h2", { className: "stat-value", style: { color: '#dc2626' } }, formatCurrency(agingByCurrency[cur]['90plus'], cur)))))))),
            agingCurrencies.length === 0 && (h("div", { className: "stats-grid", style: { gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: '1.5rem' } }, ['Total Outstanding', 'Current (0-30d)', '31-60 days', '61-90 days', '90+ days'].map(label => (h("div", { key: label, className: "stat-card" },
                h("div", null,
                    h("p", { className: "stat-label" }, label),
                    h("h2", { className: "stat-value" }, formatCurrency(0)))))))),
            h("div", { className: "glass-panel p-4 mb-6", style: { marginTop: '1rem', marginBottom: '1rem' } },
                h("div", { className: "search-box", style: { maxWidth: '350px' } },
                    h(Search, { size: 16, className: "search-icon" }),
                    h("input", { type: "text", placeholder: "Filter by client name...", value: agingSearch, onChange: e => setAgingSearch(e.target.value), className: "search-input" }),
                    agingSearch && h("button", { className: "icon-btn", onClick: () => setAgingSearch('') },
                        h(X, { size: 14 })))),
            h("div", { className: "glass-panel" },
                h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.5rem' } },
                    h("h3", null,
                        "Outstanding Receivables",
                        h(HelpButton, { title: "Outstanding Receivables", doc: "reports#outstanding-receivables", size: 16 })),
                    h(TableExport, { title: "Outstanding receivables", filename: "Outstanding-receivables", landscape: true, subtitle: [businessName, `unpaid as on ${today.toLocaleDateString('en-IN')}`].filter(Boolean).join(', '), headers: ['Client', 'Invoice No', 'Date', 'Due date', 'Currency', 'Amount', 'Paid', 'Outstanding', 'Days overdue'], rows: agingSorted.map(a => [a.clientName, a.invoiceNumber || '', a.invoiceDate || '', a.dueDate || '', a.currency, r2(a.totalAmount), r2(a.paidAmount), r2(a.outstanding), a.daysOverdue]) })),
                agingSorted.length === 0 ? (h("div", { className: "empty-state" },
                    h(Wallet, { size: 48 }),
                    h("p", null, "No outstanding receivables found."))) : (h("div", { className: "table-scroll" },
                    h("table", { className: "data-table", style: { minWidth: '850px' } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Client"),
                                h("th", null, "Invoice No"),
                                h("th", null, "Date"),
                                h("th", null, "Due Date"),
                                h("th", { style: { textAlign: 'right' } }, "Amount"),
                                h("th", { style: { textAlign: 'right' } }, "Paid"),
                                h("th", { style: { textAlign: 'right' } }, "Outstanding"),
                                h("th", { style: { textAlign: 'right' } }, "Days Overdue"))),
                        h("tbody", null, agingSorted.map((r, i) => (h("tr", { key: i, className: r.daysOverdue > 90 ? 'row-overdue' : r.daysOverdue > 30 ? 'row-warning' : '' },
                            h("td", { className: "font-medium" }, r.clientName),
                            h("td", null,
                                h("span", { className: "invoice-badge" }, r.invoiceNumber)),
                            h("td", { className: "text-muted" }, r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString('en-IN') : '-'),
                            h("td", { className: "text-muted" }, r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-IN') : '-'),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(r.totalAmount, r.currency)),
                            h("td", { style: { textAlign: 'right' }, className: "text-muted" }, r.paidAmount > 0 ? formatCurrency(r.paidAmount, r.currency) : '-'),
                            h("td", { style: { textAlign: 'right', fontWeight: 700, color: '#dc2626' } }, formatCurrency(r.outstanding, r.currency)),
                            h("td", { style: { textAlign: 'right' } },
                                h("span", { style: {
                                        padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                                        background: r.daysOverdue > 90 ? 'rgba(220,38,38,0.15)' : r.daysOverdue > 60 ? 'rgba(139,92,246,0.15)' : r.daysOverdue > 30 ? 'rgba(217,119,6,0.15)' : 'rgba(5,150,105,0.15)',
                                        color: r.daysOverdue > 90 ? '#dc2626' : r.daysOverdue > 60 ? '#8b5cf6' : r.daysOverdue > 30 ? '#d97706' : '#059669',
                                    } }, r.daysOverdue === 0 ? 'Current' : `${r.daysOverdue}d`)))))))))))),
        activeTab === 'clients' && (() => {
            const filteredBills = billsShown;
            // Aggregate revenue + outstanding + count per client
            const byClient = {};
            filteredBills.forEach(b => {
                const name = b.clientName || '—';
                if (!byClient[name])
                    byClient[name] = { name, revenue: 0, paid: 0, outstanding: 0, count: 0, lastInvoiceDate: '' };
                const sign = salesSign(b);
                byClient[name].revenue += sign * (b.totalAmount || 0);
                if (sign > 0) {
                    byClient[name].paid += (b.paidAmount || 0);
                    byClient[name].outstanding += b.status === 'paid' ? 0 : Math.max(0, amountDue(b) - (b.paidAmount || 0));
                    byClient[name].count += 1;
                }
                if (!byClient[name].lastInvoiceDate || b.invoiceDate > byClient[name].lastInvoiceDate) {
                    byClient[name].lastInvoiceDate = b.invoiceDate;
                }
            });
            const clientArr = Object.values(byClient);
            const topByRevenue = [...clientArr].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
            const worstPayers = clientArr.filter(c => c.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 10);
            return (h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1rem' } },
                h("div", { className: "glass-panel", style: { padding: '1.25rem' } },
                    h("h3", { style: { marginTop: 0, fontSize: '1rem' } },
                        "\uD83C\uDFC6 Top clients by revenue",
                        h(HelpButton, { title: "Top clients by revenue", doc: "reports#top-clients", size: 16 })),
                    topByRevenue.length === 0 ? h("p", { className: "text-muted" }, "No client data for this period.") : (h("table", { className: "data-table", style: { marginBottom: 0 } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Client"),
                                h("th", { style: { textAlign: 'right' } }, "Revenue"),
                                h("th", { style: { textAlign: 'right' } }, "Invoices"))),
                        h("tbody", null, topByRevenue.map((c, i) => (h("tr", { key: i },
                            h("td", { className: "font-medium" }, c.name),
                            h("td", { style: { textAlign: 'right', color: '#059669', fontWeight: 600 } }, formatCurrency(c.revenue, shownCurrency)),
                            h("td", { style: { textAlign: 'right' } }, c.count)))))))),
                h("div", { className: "glass-panel", style: { padding: '1.25rem' } },
                    h("h3", { style: { marginTop: 0, fontSize: '1rem' } },
                        "\u26A0\uFE0F Highest outstanding (worst payers)",
                        h(HelpButton, { title: "Highest outstanding", doc: "reports#worst-payers", size: 16 })),
                    worstPayers.length === 0 ? h("p", { className: "text-muted" }, "Everyone is up to date. \uD83C\uDF89") : (h("table", { className: "data-table", style: { marginBottom: 0 } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Client"),
                                h("th", { style: { textAlign: 'right' } }, "Outstanding"),
                                h("th", { style: { textAlign: 'right' } }, "% Unpaid"))),
                        h("tbody", null, worstPayers.map((c, i) => (h("tr", { key: i },
                            h("td", { className: "font-medium" }, c.name),
                            h("td", { style: { textAlign: 'right', color: '#dc2626', fontWeight: 700 } }, formatCurrency(c.outstanding, shownCurrency)),
                            h("td", { style: { textAlign: 'right', color: 'var(--text-muted)' } }, c.revenue > 0 ? `${Math.round((c.outstanding / c.revenue) * 100)}%` : '—')))))))),
                h("div", { className: "glass-panel", style: { padding: '1.25rem', gridColumn: '1 / -1' } },
                    h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' } },
                        h("h3", { style: { margin: 0, fontSize: '1rem' } },
                            "\uD83D\uDCCA All clients breakdown (",
                            clientArr.length,
                            ")",
                            h(HelpButton, { title: "All clients breakdown", doc: "reports#all-clients", size: 16 })),
                        h(TableExport, { title: "Client analytics", filename: `Clients-${periodLabel}`, subtitle: exportSubtitle(), headers: ['Client', 'Invoices', 'Revenue', 'Paid', 'Outstanding', 'Last invoice'], rows: [...clientArr].sort((a, b) => b.revenue - a.revenue).map(c => [c.name, c.count, r2(c.revenue), r2(c.paid), r2(c.outstanding), c.lastInvoiceDate || '']) })),
                    h("div", { style: { overflowX: 'auto' } },
                        h("table", { className: "data-table", style: { marginBottom: 0 } },
                            h("thead", null,
                                h("tr", null,
                                    h("th", null, "Client"),
                                    h("th", { style: { textAlign: 'right' } }, "Invoices"),
                                    h("th", { style: { textAlign: 'right' } }, "Revenue"),
                                    h("th", { style: { textAlign: 'right' } }, "Paid"),
                                    h("th", { style: { textAlign: 'right' } }, "Outstanding"),
                                    h("th", null, "Last Invoice"))),
                            h("tbody", null, clientArr.sort((a, b) => b.revenue - a.revenue).map((c, i) => (h("tr", { key: i },
                                h("td", { className: "font-medium" }, c.name),
                                h("td", { style: { textAlign: 'right' } }, c.count),
                                h("td", { style: { textAlign: 'right' } }, formatCurrency(c.revenue, shownCurrency)),
                                h("td", { style: { textAlign: 'right', color: '#059669' } }, formatCurrency(c.paid, shownCurrency)),
                                h("td", { style: { textAlign: 'right', color: c.outstanding > 0 ? '#dc2626' : 'var(--text-muted)', fontWeight: c.outstanding > 0 ? 600 : 400 } }, c.outstanding > 0 ? formatCurrency(c.outstanding, shownCurrency) : '—'),
                                h("td", { className: "text-muted" }, c.lastInvoiceDate ? new Date(c.lastInvoiceDate).toLocaleDateString('en-IN') : '—'))))))))));
        })(),
        activeTab === 'products' && (() => {
            const filteredBills = billsShown;
            // Aggregate quantity + revenue + last-sold per unique item name
            const byProduct = {};
            filteredBills.forEach(b => {
                (b.data?.items || []).forEach(item => {
                    if (item.isCharge)
                        return; // v1.10.77 (#87) - delivery charges are not a product
                    const name = (item.name || item.description || 'Unnamed').trim();
                    if (!name || name === 'Unnamed')
                        return;
                    if (!byProduct[name])
                        byProduct[name] = { name, hsn: item.hsn || '', qty: 0, revenue: 0, txns: 0, lastSold: '' };
                    // A credit note takes returned quantities back off.
                    const qty = salesSign(b) * (Number(item.quantity) || 0);
                    // v1.10.74 - revenue is the line's taxable value (after discount,
                    // tax backed out of tax-inclusive prices) so it matches the invoices.
                    // totals.taxInclusive is set only when GST was charged: a bill of
                    // supply's prices have no tax in them to back out.
                    const { afterDiscount } = calculateLineItemTax(item, !!(b.data?.totals?.taxInclusive ?? b.data?.taxInclusive));
                    byProduct[name].qty += qty;
                    byProduct[name].revenue += salesSign(b) * afterDiscount;
                    byProduct[name].txns += 1;
                    if (!byProduct[name].lastSold || b.invoiceDate > byProduct[name].lastSold)
                        byProduct[name].lastSold = b.invoiceDate;
                    if (item.hsn && !byProduct[name].hsn)
                        byProduct[name].hsn = item.hsn;
                });
            });
            // #96 - quantities rounded once, after adding up (6356.959999 -> 6356.96).
            const productArr = Object.values(byProduct).map((p) => ({ ...p, qty: roundQty(p.qty) }));
            const bestSellers = [...productArr].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
            const mostSoldByUnits = [...productArr].sort((a, b) => b.qty - a.qty).slice(0, 10);
            return (h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1rem' } },
                h("div", { className: "glass-panel", style: { padding: '1.25rem' } },
                    h("h3", { style: { marginTop: 0, fontSize: '1rem' } },
                        "\uD83D\uDCB0 Top revenue producers",
                        h(HelpButton, { title: "Top revenue producers", doc: "reports#top-products", size: 16 })),
                    bestSellers.length === 0 ? h("p", { className: "text-muted" }, "No product data for this period.") : (h("table", { className: "data-table", style: { marginBottom: 0 } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Product"),
                                h("th", { style: { textAlign: 'right' } }, "Revenue"),
                                h("th", { style: { textAlign: 'right' } }, "Qty sold"))),
                        h("tbody", null, bestSellers.map((p, i) => (h("tr", { key: i },
                            h("td", { className: "font-medium", title: p.hsn ? `HSN ${p.hsn}` : '' }, p.name),
                            h("td", { style: { textAlign: 'right', color: '#059669', fontWeight: 600 } }, formatCurrency(p.revenue, shownCurrency)),
                            h("td", { style: { textAlign: 'right' } }, p.qty)))))))),
                h("div", { className: "glass-panel", style: { padding: '1.25rem' } },
                    h("h3", { style: { marginTop: 0, fontSize: '1rem' } },
                        "\uD83D\uDCE6 Most units sold",
                        h(HelpButton, { title: "Most units sold", doc: "reports#most-units", size: 16 })),
                    mostSoldByUnits.length === 0 ? h("p", { className: "text-muted" }, "No product data.") : (h("table", { className: "data-table", style: { marginBottom: 0 } },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Product"),
                                h("th", { style: { textAlign: 'right' } }, "Qty sold"),
                                h("th", { style: { textAlign: 'right' } }, "Txns"))),
                        h("tbody", null, mostSoldByUnits.map((p, i) => (h("tr", { key: i },
                            h("td", { className: "font-medium" }, p.name),
                            h("td", { style: { textAlign: 'right', fontWeight: 600 } }, p.qty),
                            h("td", { style: { textAlign: 'right', color: 'var(--text-muted)' } }, p.txns)))))))),
                h("div", { className: "glass-panel", style: { padding: '1.25rem', gridColumn: '1 / -1' } },
                    h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' } },
                        h("h3", { style: { margin: 0, fontSize: '1rem' } },
                            "\uD83D\uDCCB All products (",
                            productArr.length,
                            ")",
                            h(HelpButton, { title: "All products", doc: "reports#all-products", size: 16 })),
                        h(TableExport, { title: "Product performance", filename: `Products-sold-${periodLabel}`, subtitle: exportSubtitle('revenue before tax'), headers: ['Product', 'HSN', 'Qty sold', 'Revenue', 'Avg rate', 'Txns', 'Last sold'], rows: [...productArr].sort((a, b) => b.revenue - a.revenue).map(p => [p.name, p.hsn || '', p.qty, r2(p.revenue), p.qty > 0 ? r2(p.revenue / p.qty) : 0, p.txns, p.lastSold || '']) })),
                    h("div", { style: { overflowX: 'auto' } },
                        h("table", { className: "data-table", style: { marginBottom: 0 } },
                            h("thead", null,
                                h("tr", null,
                                    h("th", null, "Product"),
                                    h("th", null, "HSN"),
                                    h("th", { style: { textAlign: 'right' } }, "Qty sold"),
                                    h("th", { style: { textAlign: 'right' } }, "Revenue"),
                                    h("th", { style: { textAlign: 'right' } }, "Avg rate"),
                                    h("th", { style: { textAlign: 'right' } }, "Txns"),
                                    h("th", null, "Last sold"))),
                            h("tbody", null, productArr.sort((a, b) => b.revenue - a.revenue).map((p, i) => (h("tr", { key: i },
                                h("td", { className: "font-medium" }, p.name),
                                h("td", { className: "text-muted", style: { fontSize: '0.78rem' } }, p.hsn || '—'),
                                h("td", { style: { textAlign: 'right' } }, p.qty),
                                h("td", { style: { textAlign: 'right' } }, formatCurrency(p.revenue, shownCurrency)),
                                h("td", { style: { textAlign: 'right', color: 'var(--text-muted)' } }, p.qty > 0 ? formatCurrency(p.revenue / p.qty, shownCurrency) : '—'),
                                h("td", { style: { textAlign: 'right' } }, p.txns),
                                h("td", { className: "text-muted" }, p.lastSold ? new Date(p.lastSold).toLocaleDateString('en-IN') : '—'))))))))));
        })()));
}
