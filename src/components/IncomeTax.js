import { useState, useEffect, useMemo, h, Fragment } from '../vanilla/dom.js';
import { Calculator, Landmark, FileText, TrendingUp, Upload, Info, Check, X, ChevronRight, Briefcase, Clock, Download } from '../vanilla/icons.js';
import { getAllBills, getAllExpenses, getAllPurchases, getProfile } from '../store.js';
import { formatCurrency } from '../utils.js';
import { getPrintSettings } from '../utils/printSettings.js';
import HelpButton from './HelpButton.js';
// v1.10.31 — Parse the user's chosen PDF accent (hex like "#1e40af") into
// a [r, g, b] tuple for jsPDF's setFillColor / setDrawColor. Falls back to
// the historical Tailwind blue-900 (30,64,175) when the setting is empty or
// the user has explicitly disabled custom colors. Kept local to IncomeTax
// so the module has no runtime cost when the ITR PDF isn't generated.
function getAccentRGB() {
    try {
        const s = getPrintSettings();
        if (!s?.userColorsEnabled)
            return [30, 64, 175];
        const hex = String(s.pdfAccent || '').replace('#', '');
        if (hex.length !== 6)
            return [30, 64, 175];
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if ([r, g, b].some(v => !Number.isFinite(v)))
            return [30, 64, 175];
        return [r, g, b];
    }
    catch {
        return [30, 64, 175];
    }
}
import { compareRegimes, parseBankStatement, AUTO_CATEGORY_RULES, DEDUCTION_CAPS, compute44AD, compute44ADA, compute44AE, computeAdvanceTaxSchedule, compute234BInterest, compute234CInterest, ADVANCE_TAX_SCHEDULE, buildITR4FieldMap, effectiveDeductionCap, CURRENT_FY as ENGINE_FY, } from '../utils/itr.js';
import { getFinancialYearLabel, belongsToProfile, isCancelledBill, salesSign, localToday, parseLocalDate } from '../utils.js';
import { billInInr } from '../utils/fx.js';
// Business income is counted without GST (GST collected is not income, and GST
// paid comes back as credit), in rupees only, from real sales: a quote or a
// challan is not a sale and a credit note reduces sales.
// TCS on the invoice is collected for the government too, so it is not income.
// v1.10.83 - an invoice in USD, EUR... counts at the exchange rate saved on it
// (export income is income); one with no rate cannot be counted.
const billTurnover = (orig) => {
    const b = billInInr(orig);
    return b ? salesSign(b) * ((Number(b.totalAmount) || 0) - (Number(b.totalTaxAmount) || 0) - (Number(b.data?.totals?.tcsAmount) || 0)) : 0;
};
const purchaseCost = (p) => (p.taxableAmount != null ? Number(p.taxableAmount) || 0
    : (Number(p.totalAmount) || 0) - (Number(p.totalTax) || 0));
const expenseCost = (e) => (Number(e.amount) || 0) - (Number(e.gstAmount) || 0);
import { toast } from './Toast.js';
// The Income Tax module has three sub-tabs. Keeping them in one file (rather
// than three separate route components) keeps state co-located — the Regime
// Calculator can see income figures picked up from the Bank Statement
// Import tab, for instance, without going through a global store.
const TABS = [
    { key: 'calculator', label: 'Regime Calculator', icon: Calculator, help: 'Compare Old vs New (Section 115BAC) — auto-picks the cheaper regime', doc: 'income-tax#regime-calculator' },
    { key: 'presumptive', label: 'Presumptive (§44AD/ADA)', icon: Briefcase, help: 'Skip full books — declare 6/8% (business) or 50% (professional) of turnover', doc: 'income-tax#presumptive' },
    { key: 'advance', label: 'Advance Tax', icon: Clock, help: 'Four installment schedule with §234B/C interest calculation', doc: 'income-tax#advance-tax' },
    { key: 'bank', label: 'Bank Statement Import', icon: Upload, help: 'Upload SBI / HDFC / ICICI / Axis / Kotak / PNB / Yes Bank CSV — auto-categorises', doc: 'income-tax#bank-import' },
    { key: 'summary', label: 'ITR Summary', icon: FileText, help: 'Consolidated view + ITR-4 Filing Summary PDF', doc: 'income-tax#itr-summary' },
];
// v1.10.53 — These were local constants reading '2024-25' / '2025-26',
// which SHADOWED the engine's own CURRENT_FY ('2025-26' in utils/itr.js).
// The UI therefore labelled everything FY 2024-25 while the engine
// computed with FY 2025-26 slabs — two different answers to "which year
// is this?" in one screen.
//
// Worse, the prefill below filters bills with `billFY === CURRENT_FY`.
// With the constant frozen two years behind, no current bill ever matched,
// so business income silently prefilled as zero and the user was never
// told why.
//
// Now derived from the engine, so there is exactly one answer. AY is
// always the FY that follows.
const CURRENT_FY = ENGINE_FY;
const CURRENT_AY = (() => {
    const start = parseInt(CURRENT_FY.split('-')[0], 10) + 1;
    return `${start}-${String(start + 1).slice(-2)}`;
})();
export default function IncomeTax() {
    const [tab, setTab] = useState('calculator');
    const [bills, setBills] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [purchases, setPurchases] = useState([]);
    const [profile, setProfile] = useState({});
    // Regime-calculator inputs — persist to localStorage so a returning user
    // doesn't have to re-enter their Form-16 salary + deductions every time
    // they open the tab. Reset button provided.
    const [inputs, setInputs] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('gst_itrCalcInputs') || '{}');
            return { ...defaultInputs(), ...saved };
        }
        catch {
            return defaultInputs();
        }
    });
    const [bankImport, setBankImport] = useState({ bankName: '', transactions: [] });
    // Presumptive taxation state — separate from Regime Calculator inputs
    // because the flow is different: user comes in either wanting to check
    // eligibility, OR to commit to presumptive filing for the year.
    // Persisted separately to localStorage.
    const [presumptiveInputs, setPresumptiveInputs] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('gst_itrPresumptive') || '{}');
            return {
                section: '44AD',
                digitalReceipts: 0, cashReceipts: 0, declaredIncome: 0,
                // v1.10.74 - default 13 t: a heavy vehicle is one over 12,000 kg.
                heavyVehicleMonths: 0, heavyVehicleTonnage: 13, lightVehicleMonths: 0,
                ...saved,
            };
        }
        catch {
            return { section: '44AD', digitalReceipts: 0, cashReceipts: 0, declaredIncome: 0, heavyVehicleMonths: 0, heavyVehicleTonnage: 13, lightVehicleMonths: 0 };
        }
    });
    // Advance Tax state — TDS credit + payments made so far
    const [advanceInputs, setAdvanceInputs] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('gst_itrAdvanceTax') || '{}');
            return { tdsCredit: 0, payments: [], mode: 'regular', ...saved };
        }
        catch {
            return { tdsCredit: 0, payments: [], mode: 'regular' };
        }
    });
    useEffect(() => {
        Promise.all([
            getAllBills().catch(() => []),
            getAllExpenses().catch(() => []),
            getAllPurchases().catch(() => []),
            getProfile().catch(() => ({})),
        ]).then(([b, e, p, prof]) => {
            // v1.10.64 (#55) — income tax is filed per business, so only the active
            // business's invoices may contribute to its figures.
            // v1.10.67 (#66 item 12) — cancelled invoices are not income.
            setBills((b || []).filter(bill => belongsToProfile(bill, prof) && !isCancelledBill(bill)));
            // v1.10.66 (#64) — and only its own expenses and purchases. Left
            // unfiltered, one company's costs reduced another company's income.
            setExpenses((e || []).filter(r => belongsToProfile(r, prof)));
            setPurchases((p || []).filter(r => belongsToProfile(r, prof)));
            setProfile(prof);
        });
    }, []);
    // Prefill Business Income from the app's own sales - purchases - expenses
    // for the current FY. Users can override; this just saves them typing on
    // first use. Only fires when their manual entry is still 0.
    useEffect(() => {
        if (!bills.length && !purchases.length)
            return;
        if (Number(inputs.businessIncome) > 0)
            return;
        const inFY = (dateStr) => {
            if (!dateStr)
                return false;
            return getFinancialYearLabel(parseLocalDate(dateStr)) === CURRENT_FY; // local date, not UTC
        };
        const sales = bills.filter(b => inFY(b.invoiceDate)).reduce((s, b) => s + billTurnover(b), 0);
        const cogs = purchases.filter(p => inFY(p.date)).reduce((s, p) => s + purchaseCost(p), 0);
        const exps = expenses.filter(e => inFY(e.date))
            .filter(e => e.category !== 'Personal / Drawings' && e.category !== 'Asset Purchase')
            .reduce((s, e) => s + expenseCost(e), 0);
        const estimated = Math.max(0, sales - cogs - exps);
        if (estimated > 0) {
            setInputs(prev => ({ ...prev, businessIncome: Math.round(estimated), _autofillHint: true }));
        }
    }, [bills, purchases, expenses]); // eslint-disable-line vanilla-runtime/exhaustive-deps
    // Auto-save calculator inputs whenever they change
    useEffect(() => {
        try {
            const { _autofillHint, ...persist } = inputs;
            void _autofillHint;
            localStorage.setItem('gst_itrCalcInputs', JSON.stringify(persist));
        }
        catch { /* localStorage full — surface via existing quota toast */ }
    }, [inputs]);
    useEffect(() => {
        try {
            localStorage.setItem('gst_itrPresumptive', JSON.stringify(presumptiveInputs));
        }
        catch { /* ignore */ }
    }, [presumptiveInputs]);
    useEffect(() => {
        try {
            localStorage.setItem('gst_itrAdvanceTax', JSON.stringify(advanceInputs));
        }
        catch { /* ignore */ }
    }, [advanceInputs]);
    // Presumptive result — recomputes when the section or inputs change
    const presumptive = useMemo(() => {
        if (presumptiveInputs.section === '44AD')
            return compute44AD(presumptiveInputs);
        if (presumptiveInputs.section === '44ADA')
            return compute44ADA(presumptiveInputs);
        if (presumptiveInputs.section === '44AE')
            return compute44AE(presumptiveInputs);
        return null;
    }, [presumptiveInputs]);
    // Regime comparison recomputes live from inputs. `compareRegimes` runs both
    // scenarios and picks the cheaper. Rendered whether or not the user has
    // filled anything — a zero-input result is still useful.
    //
    // MUST be declared BEFORE advanceSchedule below — v1.8.1 had this reversed,
    // causing a TDZ ReferenceError that blanked the whole Income Tax view.
    const comparison = useMemo(() => compareRegimes(inputs), [inputs]);
    // Advance-tax schedule — depends on the total tax under the RECOMMENDED regime.
    // Defensive: if comparison hasn't yielded a valid shape yet (first render
    // race), fall back to a zero-tax schedule so the Advance Tax tab still
    // renders instead of crashing.
    const advanceSchedule = useMemo(() => {
        const recTotal = comparison?.[comparison?.recommended]?.totalTax ?? 0;
        return computeAdvanceTaxSchedule(recTotal, advanceInputs.tdsCredit, advanceInputs.payments, advanceInputs.mode);
    }, [comparison, advanceInputs]);
    return (h("div", { className: "dashboard-container" },
        h("div", { className: "page-header" },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h("div", null,
                    h("h1", { className: "page-title" },
                        "Income Tax Helper ",
                        h(HelpButton, { title: "Income tax \u2014 how to use", doc: "income-tax", size: 16 })),
                    h("p", { className: "page-subtitle" },
                        "FY ",
                        CURRENT_FY,
                        " \u00B7 AY ",
                        CURRENT_AY,
                        " \u2014 Old vs New Regime, bank-statement import, ITR summary")))),
        getFinancialYearLabel() !== CURRENT_FY && (h("div", { className: "card", style: {
                borderLeft: '4px solid #f59e0b',
                background: 'rgba(245, 158, 11, 0.07)',
                marginBottom: '1rem',
                padding: '0.85rem 1rem',
            } },
            h("div", { style: { display: 'flex', gap: '0.6rem', alignItems: 'flex-start' } },
                h(Info, { size: 18, style: { color: '#b45309', flexShrink: 0, marginTop: 2 } }),
                h("div", { style: { fontSize: '0.88rem', lineHeight: 1.5 } },
                    h("strong", null,
                        "These figures are for FY ",
                        CURRENT_FY,
                        ", not the current FY ",
                        getFinancialYearLabel(),
                        ".",
                        h(HelpButton, { title: "Which year the figures are for", doc: "income-tax#which-year", size: 16 })),
                    h("div", { style: { marginTop: '0.35rem', color: 'var(--text-muted)' } },
                        "The tax slabs, rebate limits and capital-gains rates built into this app go up to FY ",
                        CURRENT_FY,
                        ". Rates for FY ",
                        getFinancialYearLabel(),
                        " are not included yet, so nothing here is calculated against them. Invoices dated in FY ",
                        getFinancialYearLabel(),
                        " are also excluded from the business-income figure below \u2014 enter that income manually, and treat every number on this page as an estimate to check with your CA before filing."))))),
        h("div", { className: "glass-panel", style: { padding: '0.5rem', marginBottom: '1rem' } },
            h("div", { style: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap' } },
                TABS.map(t => (h("button", { key: t.key, className: `btn ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`, style: { fontSize: '0.85rem' }, onClick: () => setTab(t.key), title: t.help },
                    h(t.icon, { size: 15 }),
                    " ",
                    t.label))),
                TABS.filter(t => t.key === tab).map(t => (h(HelpButton, { key: t.key, title: t.label, doc: t.doc, size: 16, style: { alignSelf: 'center' } }))))),
        tab === 'calculator' && (h(RegimeCalculatorTab, { inputs: inputs, setInputs: setInputs, comparison: comparison, onReset: () => setInputs(defaultInputs()) })),
        tab === 'presumptive' && (h(PresumptiveTab, { presumptiveInputs: presumptiveInputs, setPresumptiveInputs: setPresumptiveInputs, presumptive: presumptive, onPushToCalculator: () => {
                if (!presumptive)
                    return;
                setInputs(prev => ({ ...prev, businessIncome: presumptive.presumptiveIncome }));
                // v1.10.74 - 44AD / 44ADA pay advance tax in one go by 15 March, so tick
                // that option on the Advance Tax tab too (still editable there). 44AE
                // does not get the single-instalment rule, so it is left alone.
                if (presumptiveInputs.section === '44AD' || presumptiveInputs.section === '44ADA') {
                    setAdvanceInputs(prev => ({ ...prev, mode: 'presumptive' }));
                }
                setTab('calculator');
                toast(`Presumptive income of ${formatCurrency(presumptive.presumptiveIncome)} pushed to calculator`, 'success');
            } })),
        tab === 'advance' && (h(AdvanceTaxTab, { advanceInputs: advanceInputs, setAdvanceInputs: setAdvanceInputs, schedule: advanceSchedule, totalTax: comparison[comparison.recommended].totalTax, recommended: comparison.recommended })),
        tab === 'bank' && (h(BankImportTab, { bankImport: bankImport, setBankImport: setBankImport, onCommit: (totals) => {
                // The push ADDS to the calculator, so the same statement must
                // only go in once (pushing twice used to double every figure).
                if (bankImport.pushed) {
                    toast('This statement is already in the calculator. Import it again to push a fresh copy.', 'info');
                    setTab('calculator');
                    return;
                }
                setBankImport(prev => ({ ...prev, pushed: true }));
                // Piping the categorised totals into the calculator — user
                // switches to the Calculator tab and their income + interest
                // + rent are pre-filled.
                setInputs(prev => ({
                    ...prev,
                    businessIncome: (prev.businessIncome || 0) + (totals.business_in || 0),
                    otherSources: (prev.otherSources || 0) + (totals.interest || 0),
                    // house-property income is rent - 30% standard deduction (§24a) - loan interest
                    housePropertyIncome: Math.max(0, ((prev.housePropertyIncome || 0) + (totals.rent_received || 0) * 0.7)),
                    deductions: {
                        ...prev.deductions,
                        '80C': (Number(prev.deductions?.['80C']) || 0) + (totals.deduction_80C || 0),
                        '80D': (Number(prev.deductions?.['80D']) || 0) + (totals.deduction_80D || 0),
                        '80TTA': Math.min(10_000, (Number(prev.deductions?.['80TTA']) || 0) + (totals.interest || 0)),
                    },
                }));
                setTab('calculator');
                toast('Numbers pushed to Regime Calculator', 'success');
            } })),
        tab === 'summary' && (h(SummaryTab, { bills: bills, expenses: expenses, purchases: purchases, profile: profile, comparison: comparison, inputs: inputs, presumptive: presumptive, advanceSchedule: advanceSchedule, fy: CURRENT_FY, ay: CURRENT_AY }))));
}
// ============================================================================
// Presumptive Income sub-tab (§44AD / §44ADA / §44AE)
// ============================================================================
function PresumptiveTab({ presumptiveInputs, setPresumptiveInputs, presumptive, onPushToCalculator }) {
    const set = (patch) => setPresumptiveInputs(prev => ({ ...prev, ...patch }));
    return (h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '1rem' } },
        h("div", { className: "glass-panel p-4" },
            h("h3", { className: "section-title", style: { marginTop: 0 } },
                "Section",
                h(HelpButton, { title: "Section: 44AD, 44ADA or 44AE", doc: "income-tax#presumptive-sections", size: 16 })),
            h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' } }, [
                { key: '44AD', label: '§44AD', hint: 'Trading / Retail / Manufacturing' },
                { key: '44ADA', label: '§44ADA', hint: 'Professionals (CA, doctor, lawyer, consultant)' },
                { key: '44AE', label: '§44AE', hint: 'Transporters (goods carriage owners)' },
            ].map(opt => (h("button", { key: opt.key, className: `btn ${presumptiveInputs.section === opt.key ? 'btn-primary' : 'btn-secondary'}`, style: { fontSize: '0.8rem', padding: '0.5rem', flexDirection: 'column', alignItems: 'stretch' }, onClick: () => set({ section: opt.key }) },
                h("strong", null, opt.label),
                h("span", { style: { fontSize: '0.68rem', opacity: 0.75, marginTop: 4 } }, opt.hint))))),
            presumptiveInputs.section === '44AD' && (h(Fragment, null,
                h(NumberInput, { label: "Turnover received DIGITALLY (UPI/NEFT/RTGS/cheque)", hint: "Taxed at 6%. From FY 2023-24, \u2264 \u20B93Cr allowed if cash \u2264 5% of turnover.", value: presumptiveInputs.digitalReceipts, onChange: v => set({ digitalReceipts: v }) }),
                h(NumberInput, { label: "Turnover received in CASH", hint: "Taxed at 8%. Keep cash \u2264 5% of turnover to qualify for the \u20B93Cr limit.", value: presumptiveInputs.cashReceipts, onChange: v => set({ cashReceipts: v }) }),
                h(NumberInput, { label: "Actual profit (optional override)", hint: "If your books show higher profit than 6/8%, declare that instead. You cannot declare less.", value: presumptiveInputs.declaredIncome, onChange: v => set({ declaredIncome: v }) }))),
            presumptiveInputs.section === '44ADA' && (h(Fragment, null,
                h(NumberInput, { label: "Gross receipts (digital)", hint: "Taxed flat at 50% of gross receipts. \u2264 \u20B975L (was \u20B950L) if cash \u2264 5%.", value: presumptiveInputs.digitalReceipts, onChange: v => set({ digitalReceipts: v }) }),
                h(NumberInput, { label: "Gross receipts (cash)", value: presumptiveInputs.cashReceipts, onChange: v => set({ cashReceipts: v }) }),
                h(NumberInput, { label: "Actual profit (optional override)", hint: "If actual profit > 50%, declare that instead. Cannot go below 50%.", value: presumptiveInputs.declaredIncome, onChange: v => set({ declaredIncome: v }) }))),
            presumptiveInputs.section === '44AE' && (h(Fragment, null,
                h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' } }, "Applicable when you own \u2264 10 goods vehicles at any time in the year."),
                h(NumberInput, { label: "Heavy vehicles (> 12,000 kg): sum of vehicle-months", hint: "Example: 2 vehicles \u00D7 12 months = 24. Rate \u20B91,000 / tonne / month.", value: presumptiveInputs.heavyVehicleMonths, onChange: v => set({ heavyVehicleMonths: v }) }),
                h(NumberInput, { label: "Heavy vehicle gross tonnage (avg)", value: presumptiveInputs.heavyVehicleTonnage, onChange: v => set({ heavyVehicleTonnage: v }) }),
                h(NumberInput, { label: "Light vehicles: sum of vehicle-months", hint: "Rate \u20B97,500 / month.", value: presumptiveInputs.lightVehicleMonths, onChange: v => set({ lightVehicleMonths: v }) })))),
        h("div", null,
            presumptive && (h("div", { className: "glass-panel p-4", style: { marginBottom: '1rem' } },
                h("h3", { className: "section-title", style: { marginTop: 0 } },
                    "Presumptive computation",
                    h(HelpButton, { title: "Presumptive computation", doc: "income-tax#presumptive-computation", size: 16 })),
                presumptiveInputs.section !== '44AE' && (h(Fragment, null,
                    h(Row, { label: "Turnover / gross receipts", value: presumptive.turnover }),
                    h(Row, { label: `Deemed income @ ${presumptiveInputs.section === '44ADA' ? '50%' : '6% / 8%'}`, value: presumptive.deemedIncome, muted: true }))),
                presumptiveInputs.section === '44AE' && (h(Fragment, null,
                    h(Row, { label: "Heavy vehicles (\u20B91,000 \u00D7 tonnes \u00D7 months)", value: presumptive.heavyIncome, muted: true }),
                    h(Row, { label: "Light vehicles (\u20B97,500 \u00D7 months)", value: presumptive.lightIncome, muted: true }))),
                h(Row, { label: "Declared income", value: presumptive.presumptiveIncome, bold: true, big: true }),
                presumptive.notes.length > 0 && (h("div", { style: { marginTop: '0.75rem', padding: '0.5rem', background: 'var(--warn-bg, #fffbeb)', borderRadius: 6, fontSize: '0.78rem' } }, presumptive.notes.map((n, i) => (h("p", { key: i, style: { margin: i > 0 ? '0.5rem 0 0' : 0 } }, n))))),
                presumptive.isEligible !== false && (h("button", { className: "btn btn-primary", style: { marginTop: '1rem' }, onClick: onPushToCalculator },
                    h(ChevronRight, { size: 15 }),
                    " Use ",
                    formatCurrency(presumptive.presumptiveIncome),
                    " as Business Income")))),
            h("div", { className: "glass-panel p-4", style: { fontSize: '0.82rem' } },
                h("div", { style: { display: 'flex', gap: '0.5rem', alignItems: 'flex-start' } },
                    h(Info, { size: 16, style: { flexShrink: 0, marginTop: 2, color: 'var(--primary)' } }),
                    h("div", null,
                        h("strong", null,
                            "Why presumptive taxation?",
                            h(HelpButton, { title: "Why presumptive taxation?", doc: "income-tax#why-presumptive", size: 16 })),
                        h("ul", { style: { margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.6 } },
                            h("li", null, "Skip full books of account + audit (\u00A744AB)"),
                            h("li", null, "Skip advance-tax installments \u2014 pay 100% by 15 March"),
                            h("li", null, "Simpler ITR-4 (Sugam) form instead of ITR-3"),
                            h("li", null, "Once opted in, must continue for 5 assessment years \u2014 opting out early disqualifies you from \u00A744AD for the next 5 years"))))))));
}
// ============================================================================
// Advance Tax sub-tab
// ============================================================================
function AdvanceTaxTab({ advanceInputs, setAdvanceInputs, schedule, totalTax, recommended }) {
    const set = (patch) => setAdvanceInputs(prev => ({ ...prev, ...patch }));
    const addPayment = () => {
        const today = localToday(); // local date, not UTC
        set({ payments: [...(advanceInputs.payments || []), { date: today, amount: 0 }] });
    };
    const updatePayment = (idx, patch) => {
        set({ payments: advanceInputs.payments.map((p, i) => i === idx ? { ...p, ...patch } : p) });
    };
    const removePayment = (idx) => {
        set({ payments: advanceInputs.payments.filter((_, i) => i !== idx) });
    };
    const interest234C = compute234CInterest(schedule);
    const interest234B = compute234BInterest(schedule);
    return (h(Fragment, null,
        h("div", { className: "glass-panel p-4", style: { marginBottom: '1rem' } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' } },
                h("h3", { className: "section-title", style: { margin: 0 } },
                    "Advance Tax Schedule",
                    h(HelpButton, { title: "Advance Tax Schedule", doc: "income-tax#advance-schedule", size: 16 })),
                h("div", { style: { display: 'flex', gap: '1rem', alignItems: 'center' } },
                    h("label", { style: { fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' } },
                        h("input", { type: "checkbox", checked: advanceInputs.mode === 'presumptive', onChange: e => set({ mode: e.target.checked ? 'presumptive' : 'regular' }) }),
                        "Presumptive (pay 100% by 15 March)"))),
            h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' } },
                "Based on your recommended ",
                h("strong", { style: { textTransform: 'uppercase' } }, recommended),
                " Regime total tax of ",
                h("strong", null, formatCurrency(totalTax)),
                "."),
            h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' } },
                h(NumberInput, { label: "TDS already deducted", hint: "From salary, contract payments, interest \u2014 as per Form 26AS", value: advanceInputs.tdsCredit, onChange: v => set({ tdsCredit: v }) }),
                h("div", null,
                    h(Row, { label: "Total tax liability", value: totalTax }),
                    h(Row, { label: "Less: TDS credit", value: -(Number(advanceInputs.tdsCredit) || 0), muted: !advanceInputs.tdsCredit }),
                    h(Row, { label: "Net advance-tax liability", value: schedule.netLiability, bold: true }))),
            !schedule.applies && (h("div", { style: { padding: '0.75rem', background: 'var(--success-bg, #ecfdf5)', borderRadius: 6, fontSize: '0.85rem' } },
                h(Check, { size: 14, style: { display: 'inline', marginRight: 4 } }),
                schedule.note))),
        schedule.applies && (h(Fragment, null,
            h("div", { className: "glass-panel p-0", style: { marginBottom: '1rem', overflow: 'hidden' } },
                h("table", { className: "data-table", style: { marginBottom: 0 } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Installment"),
                            h("th", null, "Due Date"),
                            h("th", { style: { textAlign: 'right' } }, "% cumulative"),
                            h("th", { style: { textAlign: 'right' } }, "This installment"),
                            h("th", { style: { textAlign: 'right' } }, "Paid by due date"),
                            h("th", { style: { textAlign: 'right' } }, "Shortfall"))),
                    h("tbody", null, schedule.schedule.map(row => (h("tr", { key: row.installment },
                        h("td", null,
                            "#",
                            row.installment),
                        h("td", null, row.label),
                        h("td", { style: { textAlign: 'right' } },
                            (row.cumulativePct * 100).toFixed(0),
                            "%"),
                        h("td", { style: { textAlign: 'right' } }, formatCurrency(row.installmentDue)),
                        h("td", { style: { textAlign: 'right' } }, formatCurrency(row.totalPaidByDue)),
                        h("td", { style: { textAlign: 'right', color: row.shortfall > 0 ? '#dc2626' : '#059669', fontWeight: 600 } }, formatCurrency(row.shortfall)))))))),
            h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' } },
                h("div", { className: "glass-panel p-4" },
                    h("h4", { style: { marginTop: 0, marginBottom: '0.5rem' } },
                        "Payments made",
                        h(HelpButton, { title: "Payments made", doc: "income-tax#advance-payments", size: 16 })),
                    (advanceInputs.payments || []).length === 0 && h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)' } }, "No advance-tax payments recorded yet."),
                    (advanceInputs.payments || []).map((p, i) => (h("div", { key: i, style: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' } },
                        h("input", { type: "date", className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem' }, value: p.date, onChange: e => updatePayment(i, { date: e.target.value }) }),
                        h("input", { type: "number", className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem' }, value: p.amount || '', placeholder: "Amount", onChange: e => updatePayment(i, { amount: parseFloat(e.target.value) || 0 }) }),
                        h("button", { className: "icon-btn icon-btn-red", onClick: () => removePayment(i), title: "Remove" },
                            h(X, { size: 14 }))))),
                    h("button", { className: "btn btn-secondary", style: { fontSize: '0.78rem', marginTop: '0.5rem' }, onClick: addPayment }, "+ Add payment")),
                h("div", { className: "glass-panel p-4" },
                    h("h4", { style: { marginTop: 0, marginBottom: '0.5rem' } },
                        "Interest under \u00A7234B / \u00A7234C",
                        h(HelpButton, { title: "Interest under 234B / 234C", doc: "income-tax#interest-234", size: 16 })),
                    h(Row, { label: "\u00A7234C \u2014 installment shortfall", value: interest234C, muted: !interest234C }),
                    h(Row, { label: "\u00A7234B \u2014 post year-end delay (1% per month)", value: interest234B, muted: !interest234B }),
                    h(Row, { label: "Total interest", value: interest234B + interest234C, bold: true }),
                    h("div", { style: { marginTop: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.75rem', color: 'var(--text-muted)' } },
                        h("strong", null, "\u00A7234C"),
                        ": 1% per month for shortfalls in Q1-Q3 (3 months each) and Q4 (1 month). Waived if you paid \u2265 12% by 15 Jun / 36% by 15 Sep.",
                        h("br", null),
                        h("br", null),
                        h("strong", null, "\u00A7234B"),
                        ": 1% per month from 1 April of AY if you paid less than 90% of tax by 31 March.")))))));
}
// ============================================================================
// Regime Calculator sub-tab
// ============================================================================
function RegimeCalculatorTab({ inputs, setInputs, comparison, onReset }) {
    const set = (patch) => setInputs(prev => ({ ...prev, ...patch }));
    // 80D and 80DDB limits depend on age: show the limit the calculation uses.
    const effectiveCapLabel = (section, cap) => {
        // v1.10.74 - 80TTA (under 60) / 80TTB (60+) also depend on age.
        const c = ['80D', '80DDB', '80TTA', '80TTB'].includes(section)
            ? effectiveDeductionCap(section, { selfSenior: Number(inputs.age) >= 60, parentsSenior: !!inputs.parentsSenior })
            : cap;
        return c === Infinity ? 'No cap' : formatCurrency(c);
    };
    const setDed = (section, val) => setInputs(prev => ({
        ...prev,
        deductions: { ...prev.deductions, [section]: val },
    }));
    return (h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '1rem' } },
        h("div", { className: "glass-panel p-4" },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' } },
                h("h3", { className: "section-title", style: { margin: 0 } },
                    "Your income",
                    h(HelpButton, { title: "Your income", doc: "income-tax#your-income", size: 16 })),
                h("button", { className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.3rem 0.6rem' }, onClick: onReset },
                    h(X, { size: 14 }),
                    " Reset")),
            h("div", { style: { display: 'grid', gap: '0.4rem', marginBottom: '0.75rem', fontSize: '0.82rem' } },
                h("label", { className: "form-label", style: { marginBottom: 0 } },
                    "Your age on 31 March",
                    h("select", { className: "form-input", value: Number(inputs.age) >= 80 ? 80 : Number(inputs.age) >= 60 ? 60 : 0, onChange: e => { const age = Number(e.target.value); set({ age, selfSenior: age >= 60 }); } },
                        h("option", { value: 0 }, "Under 60"),
                        h("option", { value: 60 }, "60 to 79 (senior citizen)"),
                        h("option", { value: 80 }, "80 or older (super senior citizen)"))),
                h("label", { style: { display: 'flex', gap: '0.4rem', alignItems: 'center' } },
                    h("input", { type: "checkbox", checked: !!inputs.parentsSenior, onChange: e => set({ parentsSenior: e.target.checked }) }),
                    "My parents (whose health insurance I pay) are 60 or older"),
                h("label", { style: { display: 'flex', gap: '0.4rem', alignItems: 'center' } },
                    h("input", { type: "checkbox", checked: !!inputs.isGovtEmployee, onChange: e => set({ isGovtEmployee: e.target.checked }) }),
                    "I am a government employee")),
            h(NumberInput, { label: "Gross Salary (Form 16 box 1)", hint: "Enter zero if you don't have salary income. Standard Deduction is applied automatically.", value: inputs.salary, onChange: v => set({ salary: v }) }),
            h(NumberInput, { label: "Business / Professional Income", hint: inputs._autofillHint ? '✨ Auto-filled from your invoices minus purchases + expenses this FY. Override if needed.' : 'Net profit from your books.', value: inputs.businessIncome, onChange: v => set({ businessIncome: v, _autofillHint: false }) }),
            h(NumberInput, { label: "House Property (rent received)", hint: "Rent received less municipal tax and the 30% standard deduction. Enter home-loan interest separately under \u00A724b below.", value: inputs.housePropertyIncome, onChange: v => set({ housePropertyIncome: v }) }),
            h(NumberInput, { label: "Other Sources (bank interest, dividends, etc.)", hint: "Includes savings-account interest; 80TTA claims that separately.", value: inputs.otherSources, onChange: v => set({ otherSources: v }) }),
            h("h4", { style: { marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' } },
                "Capital gains (special rates)",
                h(HelpButton, { title: "Capital gains (special rates)", doc: "income-tax#capital-gains", size: 16 })),
            h(NumberInput, { label: "STCG on listed equity (\u00A7111A)", hint: "Taxed flat at 20%. Excludes debt / property STCG (those go into slab).", value: inputs.stcgAtSpecialRate, onChange: v => set({ stcgAtSpecialRate: v }) }),
            h(NumberInput, { label: "LTCG on listed equity (\u00A7112A)", hint: "First \u20B91.25 lakh exempt; the rest taxed flat at 12.5%.", value: inputs.ltcgAtSpecialRate, onChange: v => set({ ltcgAtSpecialRate: v }) }),
            h("h4", { style: { marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' } },
                "Deductions (Old Regime only)",
                h(HelpButton, { title: "Deductions (Old Regime only)", doc: "income-tax#deductions", size: 16 })),
            h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '0.5rem' } }, "Under New Regime (default from FY 2023-24), only Section 80CCD(2) \u2014 employer NPS contribution \u2014 is allowed. These deductions ONLY reduce your Old-Regime tax."),
            Object.entries(DEDUCTION_CAPS).map(([section, cap]) => (h(NumberInput, { key: section, label: `§${section}`, hint: `Cap: ${effectiveCapLabel(section, cap)} · ${SECTION_DESCRIPTIONS[section] || ''}`, value: inputs.deductions?.[section] || 0, onChange: v => setDed(section, v) }))),
            h(NumberInput, { label: "\u00A780CCD(2) \u2014 employer NPS", hint: "Allowed under BOTH regimes, up to 10% of salary (14% for government employees).", value: inputs.deductions?.['80CCD2'] || 0, onChange: v => setDed('80CCD2', v) })),
        h("div", null,
            h("div", { className: "glass-panel p-4", style: { marginBottom: '1rem' } },
                h("h3", { className: "section-title", style: { marginTop: 0 } },
                    "Recommended: ",
                    h("span", { style: { color: comparison.recommended === 'new' ? '#059669' : '#8b5cf6', textTransform: 'uppercase' } },
                        comparison.recommended,
                        " Regime"),
                    h(HelpButton, { title: "Recommended regime", doc: "income-tax#recommended", size: 16 })),
                h("p", { style: { fontSize: '0.85rem', margin: '0 0 0.75rem 0' } },
                    "Saves you ",
                    h("strong", null, formatCurrency(comparison.savings)),
                    " compared to the other regime.",
                    comparison.recommended === 'new' && ' (New Regime is the default — you don\'t need to elect anything.)',
                    comparison.recommended === 'old' && ' (You must file Form 10-IEA before the due date to elect Old Regime.)')),
            h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' } },
                h(RegimeCard, { title: "Old Regime", result: comparison.old, highlighted: comparison.recommended === 'old', color: "#8b5cf6" }),
                h(RegimeCard, { title: "New Regime", result: comparison.new, highlighted: comparison.recommended === 'new', color: "#059669" })),
            h("div", { className: "glass-panel p-4", style: { marginTop: '1rem', fontSize: '0.8rem' } },
                h("div", { style: { display: 'flex', gap: '0.5rem', alignItems: 'flex-start' } },
                    h(Info, { size: 16, style: { flexShrink: 0, marginTop: 2, color: 'var(--primary)' } }),
                    h("div", null,
                        h("strong", null, "How this is computed:"),
                        " slabs \u2192 \u00A787A rebate \u2192 surcharge (income > \u20B950L) \u2192 4% Health & Ed Cess. STCG (\u00A7111A) at 20%, LTCG (\u00A7112A) at 12.5% over \u20B91.25 lakh exempt. Numbers auto-save; refresh the page and they persist."))))));
}
function RegimeCard({ title, result, highlighted, color }) {
    return (h("div", { className: "glass-panel p-4", style: {
            border: highlighted ? `2px solid ${color}` : '1px solid var(--border)',
            background: highlighted ? `${color}15` : undefined,
        } },
        h("h4", { style: { margin: 0, marginBottom: '0.5rem', color } },
            title,
            h(HelpButton, { title: title, doc: "income-tax#old-vs-new", size: 16 })),
        h(Row, { label: "Gross Total Income", value: result.grossTotalIncome }),
        h(Row, { label: "Standard Deduction", value: -result.standardDeduction, muted: !result.standardDeduction }),
        h(Row, { label: "Chapter VI-A", value: -result.allowedDeductions, muted: !result.allowedDeductions }),
        h(Row, { label: "Taxable Income", value: result.taxableIncome, bold: true }),
        h("hr", { style: { opacity: 0.2, margin: '0.5rem 0' } }),
        h(Row, { label: "Slab Tax", value: result.slabTax }),
        (result.stcgTax > 0 || result.ltcgTax > 0) && (h(Fragment, null,
            h(Row, { label: "STCG (20%)", value: result.stcgTax, muted: !result.stcgTax }),
            h(Row, { label: "LTCG (12.5%)", value: result.ltcgTax, muted: !result.ltcgTax }))),
        result.rebate87A > 0 && h(Row, { label: "\u00A787A Rebate", value: -result.rebate87A }),
        result.surcharge > 0 && h(Row, { label: "Surcharge", value: result.surcharge }),
        h(Row, { label: "Health & Ed Cess (4%)", value: result.cess }),
        h("hr", { style: { opacity: 0.2, margin: '0.5rem 0' } }),
        h(Row, { label: "Total Tax", value: result.totalTax, bold: true, big: true })));
}
function Row({ label, value, bold, big, muted }) {
    return (h("div", { style: {
            display: 'flex', justifyContent: 'space-between',
            fontSize: big ? '1rem' : '0.8rem',
            fontWeight: bold ? 700 : 400,
            marginBottom: 2,
            opacity: muted ? 0.5 : 1,
        } },
        h("span", null, label),
        h("span", { style: { fontFamily: 'monospace' } }, formatCurrency(value))));
}
function NumberInput({ label, hint, value, onChange }) {
    return (h("div", { style: { marginBottom: '0.6rem' } },
        h("label", { style: { display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 2 } }, label),
        h("input", { type: "number", className: "form-input", style: { padding: '0.4rem 0.6rem', fontSize: '0.85rem' }, value: value || '', min: "0", step: "any", onChange: e => onChange(parseFloat(e.target.value) || 0), placeholder: "0" }),
        hint && h("p", { style: { margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-muted)' } }, hint)));
}
// ============================================================================
// Bank Statement Import sub-tab
// ============================================================================
function BankImportTab({ bankImport, setBankImport, onCommit }) {
    const [dragActive, setDragActive] = useState(false);
    const handleFile = async (file) => {
        if (!file)
            return;
        try {
            const text = await file.text();
            const parsed = parseBankStatement(text);
            if (!parsed.transactions.length) {
                toast('No transactions found. Try uploading a raw CSV from your bank\'s statement download.', 'warning');
                return;
            }
            setBankImport(parsed);
            toast(`Parsed ${parsed.transactions.length} transactions from ${parsed.bankName}`, 'success');
        }
        catch {
            toast('Could not parse this CSV. Supported banks: SBI, HDFC, ICICI, Axis, Kotak, PNB, Yes Bank.', 'error');
        }
    };
    const changeCategory = (idx, category) => {
        setBankImport(prev => ({
            ...prev,
            transactions: prev.transactions.map((t, i) => i === idx ? { ...t, category } : t),
        }));
    };
    const totals = useMemo(() => {
        const t = {};
        (bankImport.transactions || []).forEach(row => {
            const amt = (row.credit || 0) > 0 ? row.credit : (row.debit || 0);
            t[row.category] = (t[row.category] || 0) + amt;
        });
        return t;
    }, [bankImport]);
    if (!bankImport.transactions.length) {
        return (h("div", { className: "glass-panel p-6" },
            h("div", { onDragEnter: e => { e.preventDefault(); setDragActive(true); }, onDragLeave: () => setDragActive(false), onDragOver: e => e.preventDefault(), onDrop: e => {
                    e.preventDefault();
                    setDragActive(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file)
                        handleFile(file);
                }, style: {
                    border: `2px dashed ${dragActive ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: 12,
                    padding: '3rem 1rem',
                    textAlign: 'center',
                    background: dragActive ? 'rgba(30, 64, 175, 0.05)' : undefined,
                    cursor: 'pointer',
                }, onClick: () => document.getElementById('bank-csv-input')?.click() },
                h(Upload, { size: 40, style: { opacity: 0.5, marginBottom: '0.5rem' } }),
                h("p", { style: { margin: 0, fontSize: '1rem', fontWeight: 600 } }, "Drop a bank-statement CSV here or click to select"),
                h("p", { style: { margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' } }, "Auto-detects: SBI \u00B7 HDFC \u00B7 ICICI \u00B7 Axis \u00B7 Kotak \u00B7 PNB \u00B7 Yes Bank"),
                h("input", { id: "bank-csv-input", type: "file", accept: ".csv,text/csv", style: { display: 'none' }, onChange: e => handleFile(e.target.files?.[0]) })),
            h("div", { style: { marginTop: '1.5rem' } },
                h("h4", { style: { fontSize: '0.9rem', marginBottom: '0.5rem' } },
                    "How to get the CSV",
                    h(HelpButton, { title: "How to get the CSV", doc: "income-tax#bank-csv", size: 16 })),
                h("ul", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.7, margin: 0, paddingLeft: '1.2rem' } },
                    h("li", null,
                        h("strong", null, "Net-banking"),
                        " \u2192 Accounts \u2192 Statements \u2192 Download as CSV / Excel (save as CSV)"),
                    h("li", null,
                        h("strong", null, "Mobile app"),
                        " \u2192 Account statement \u2192 Share \u2192 Export CSV"),
                    h("li", null,
                        "Choose a date range covering the current FY (1 Apr ",
                        parseInt(CURRENT_FY.split('-')[0], 10),
                        " onwards)"),
                    h("li", null, "Your data is parsed in-browser \u2014 nothing is uploaded to a server")))));
    }
    return (h(Fragment, null,
        h("div", { className: "glass-panel p-4", style: { marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h("div", null,
                h("h3", { className: "section-title", style: { margin: 0 } },
                    bankImport.bankName,
                    " \u2014 ",
                    bankImport.transactions.length,
                    " transactions",
                    h(HelpButton, { title: "Reviewing the transactions", doc: "income-tax#bank-review", size: 16 })),
                h("p", { style: { margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' } }, "Review each row's category. Auto-categorised \u2014 override any you disagree with.")),
            h("div", { style: { display: 'flex', gap: '0.5rem' } },
                h("button", { className: "btn btn-secondary", onClick: () => setBankImport({ bankName: '', transactions: [] }) },
                    h(X, { size: 16 }),
                    " Clear"),
                h("button", { className: "btn btn-primary", onClick: () => onCommit(totals) },
                    h(ChevronRight, { size: 16 }),
                    " Push to Calculator"))),
        h("div", { className: "glass-panel p-3", style: { marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.82rem' } }, Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (h("span", { key: cat, style: { background: CATEGORY_COLORS[cat] || '#e2e8f0', padding: '0.25rem 0.6rem', borderRadius: 4 } },
            h("strong", null,
                CATEGORY_LABELS[cat] || cat,
                ":"),
            " ",
            formatCurrency(amt))))),
        h("div", { className: "glass-panel", style: { overflow: 'auto', maxHeight: '60vh' } },
            h("table", { className: "data-table", style: { minWidth: '900px' } },
                h("thead", null,
                    h("tr", null,
                        h("th", null, "Date"),
                        h("th", null, "Description"),
                        h("th", { style: { textAlign: 'right' } }, "Debit"),
                        h("th", { style: { textAlign: 'right' } }, "Credit"),
                        h("th", null, "Category"))),
                h("tbody", null, bankImport.transactions.map((row, idx) => (h("tr", { key: idx },
                    h("td", { className: "text-muted", style: { fontSize: '0.78rem' } }, row.date),
                    h("td", { style: { maxWidth: '350px', fontSize: '0.78rem' }, title: row.description }, row.description),
                    h("td", { style: { textAlign: 'right', color: '#dc2626', fontFamily: 'monospace', fontSize: '0.78rem' } }, row.debit ? formatCurrency(row.debit) : '-'),
                    h("td", { style: { textAlign: 'right', color: '#059669', fontFamily: 'monospace', fontSize: '0.78rem' } }, row.credit ? formatCurrency(row.credit) : '-'),
                    h("td", null,
                        h("select", { value: row.category, onChange: e => changeCategory(idx, e.target.value), className: "form-input", style: { padding: '0.2rem 0.4rem', fontSize: '0.75rem', width: 'auto' } }, Object.entries(CATEGORY_LABELS).map(([k, v]) => (h("option", { key: k, value: k }, v)))))))))))));
}
// ============================================================================
// ITR Summary sub-tab — consolidated snapshot
// ============================================================================
function SummaryTab({ bills, expenses, purchases, profile, comparison, inputs, presumptive, advanceSchedule, fy, ay }) {
    const generateITR4PDF = async () => {
        try {
            const { jsPDF } = await import('jspdf');
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const tax = comparison[comparison.recommended];
            // Build the ITR-4 field map from all inputs
            const rows = buildITR4FieldMap(inputs, tax, presumptive?.presumptiveIncome ? presumptive : null, inputs.deductions, profile?.pan);
            let y = 15;
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text('ITR-4 (Sugam) Filing Summary', 105, y, { align: 'center' });
            y += 6;
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text(`FY ${fy} · AY ${ay} · Regime: ${comparison.recommended.toUpperCase()} · Generated ${new Date().toLocaleDateString('en-IN')}`, 105, y, { align: 'center' });
            y += 6;
            // Assessee block
            if (profile?.businessName) {
                doc.setFontSize(10);
                doc.setFont('helvetica', 'bold');
                doc.rect(15, y, 180, 22, 'S');
                doc.text('Assessee', 20, y + 5);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.text(`Name: ${profile.businessName}`, 20, y + 11);
                if (profile.gstin)
                    doc.text(`GSTIN: ${profile.gstin}`, 20, y + 16);
                if (profile.pan)
                    doc.text(`PAN: ${profile.pan}`, 120, y + 11);
                y += 26;
            }
            // Fields grouped by section
            let currentSection = '';
            for (const r of rows) {
                if (y > 265) {
                    doc.addPage();
                    y = 20;
                }
                if (r.section !== currentSection) {
                    currentSection = r.section;
                    y += 4;
                    doc.setFillColor(...getAccentRGB());
                    doc.setTextColor(255);
                    doc.rect(15, y, 180, 6, 'F');
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'bold');
                    doc.text(r.section, 17, y + 4);
                    doc.setTextColor(0);
                    y += 8;
                }
                doc.setFontSize(r.big ? 10 : 8.5);
                doc.setFont('helvetica', r.bold ? 'bold' : 'normal');
                doc.text(r.field, 17, y);
                const val = typeof r.value === 'number' ? formatCurrency(r.value) : String(r.value || '');
                doc.text(val, 190, y, { align: 'right' });
                if (r.note) {
                    y += 4;
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'italic');
                    doc.setTextColor(120);
                    doc.text(r.note, 20, y);
                    doc.setTextColor(0);
                }
                y += 5;
            }
            // Advance tax summary
            if (advanceSchedule?.applies) {
                if (y > 245) {
                    doc.addPage();
                    y = 20;
                }
                y += 4;
                doc.setFillColor(...getAccentRGB());
                doc.setTextColor(255);
                doc.rect(15, y, 180, 6, 'F');
                doc.setFontSize(9);
                doc.setFont('helvetica', 'bold');
                doc.text('E — Advance Tax', 17, y + 4);
                doc.setTextColor(0);
                y += 8;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8.5);
                advanceSchedule.schedule.forEach(row => {
                    doc.text(`Installment #${row.installment} (${row.label})`, 17, y);
                    doc.text(formatCurrency(row.installmentDue), 130, y, { align: 'right' });
                    doc.text(`Paid: ${formatCurrency(row.totalPaidByDue)}`, 190, y, { align: 'right' });
                    y += 5;
                });
            }
            // Footer
            doc.setFontSize(7);
            doc.setFont('helvetica', 'italic');
            doc.text('Generated by GST Billing Software. Verify against your books + Form 26AS before filing on incometax.gov.in.', 105, 285, { align: 'center' });
            doc.save(`ITR-4-Summary-${profile?.businessName?.replace(/[^\w]+/g, '-') || 'assessee'}-${ay}.pdf`);
            toast('ITR-4 Summary PDF downloaded', 'success');
        }
        catch (e) {
            toast('Could not generate PDF', 'error');
            console.error('ITR-4 PDF', e);
        }
    };
    const inFY = (dateStr) => {
        if (!dateStr)
            return false;
        return getFinancialYearLabel(parseLocalDate(dateStr)) === fy; // local date, not UTC
    };
    const fyBills = bills.filter(b => inFY(b.invoiceDate));
    const fyExpenses = expenses.filter(e => inFY(e.date));
    const fyPurchases = purchases.filter(p => inFY(p.date));
    const sales = fyBills.reduce((s, b) => s + billTurnover(b), 0);
    const businessExpenses = fyExpenses.filter(e => e.category !== 'Personal / Drawings' && e.category !== 'Asset Purchase').reduce((s, e) => s + expenseCost(e), 0);
    const trading = fyPurchases.reduce((s, p) => s + purchaseCost(p), 0);
    const assets = fyExpenses.filter(e => e.category === 'Asset Purchase').reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const netBusiness = Math.max(0, sales - trading - businessExpenses);
    // Presumptive threshold check (Section 44AD — up to ₹2Cr turnover)
    const under44ADEligible = sales < 20_000_000 && (profile?.businessType || '').toLowerCase() !== 'professional';
    return (h(Fragment, null,
        h("div", { className: "stats-grid", style: { gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '1rem' } },
            h("div", { className: "stat-card" },
                h("div", { className: "stat-icon stat-icon-blue" },
                    h(TrendingUp, { size: 22 })),
                h("div", null,
                    h("p", { className: "stat-label" },
                        "Sales excl. GST (FY ",
                        fy,
                        ")"),
                    h("h2", { className: "stat-value" }, formatCurrency(sales)))),
            h("div", { className: "stat-card" },
                h("div", { className: "stat-icon stat-icon-purple" },
                    h(Landmark, { size: 22 })),
                h("div", null,
                    h("p", { className: "stat-label" }, "Trading Purchases"),
                    h("h2", { className: "stat-value" }, formatCurrency(trading)))),
            h("div", { className: "stat-card" },
                h("div", { className: "stat-icon stat-icon-green" },
                    h(FileText, { size: 22 })),
                h("div", null,
                    h("p", { className: "stat-label" }, "Business Expenses"),
                    h("h2", { className: "stat-value" }, formatCurrency(businessExpenses)))),
            h("div", { className: "stat-card" },
                h("div", { className: "stat-icon stat-icon-red" },
                    h(Calculator, { size: 22 })),
                h("div", null,
                    h("p", { className: "stat-label" }, "Net Business Income"),
                    h("h2", { className: "stat-value" }, formatCurrency(netBusiness))))),
        h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
            h("div", { className: "glass-panel p-4" },
                h("h3", { className: "section-title" },
                    "Income breakdown",
                    h(HelpButton, { title: "Income breakdown", doc: "income-tax#income-breakdown", size: 16 })),
                h(Row, { label: "Sales / Turnover", value: sales }),
                h(Row, { label: "Less: Trading purchases", value: -trading }),
                h(Row, { label: "Less: Business expenses", value: -businessExpenses }),
                h(Row, { label: "= Net business income", value: netBusiness, bold: true }),
                h(Row, { label: "+ Salary declared", value: Number(inputs.salary) || 0, muted: !inputs.salary }),
                h(Row, { label: "+ Rent received", value: Number(inputs.housePropertyIncome) || 0, muted: !inputs.housePropertyIncome }),
                h(Row, { label: "+ Other sources", value: Number(inputs.otherSources) || 0, muted: !inputs.otherSources }),
                h(Row, { label: "+ Capital gains (STCG + LTCG)", value: (Number(inputs.stcgAtSpecialRate) || 0) + (Number(inputs.ltcgAtSpecialRate) || 0), muted: !inputs.stcgAtSpecialRate && !inputs.ltcgAtSpecialRate }),
                assets > 0 && (h("div", { style: { marginTop: '0.75rem', padding: '0.5rem', background: 'var(--warn-bg, #fffbeb)', borderRadius: 6, fontSize: '0.78rem' } },
                    h("strong", null, "Note:"),
                    " ",
                    formatCurrency(assets),
                    " in Asset Purchases isn't deducted here. Assets are capitalised then depreciated under \u00A732 \u2014 enter depreciation as a business expense in the year it's claimed (not the year of purchase)."))),
            h("div", { className: "glass-panel p-4" },
                h("h3", { className: "section-title" },
                    "Tax snapshot",
                    h(HelpButton, { title: "Tax snapshot", doc: "income-tax#tax-snapshot", size: 16 })),
                h("p", { style: { fontSize: '0.85rem', margin: '0 0 0.5rem 0' } },
                    "Recommended regime: ",
                    h("strong", { style: { color: comparison.recommended === 'new' ? '#059669' : '#8b5cf6', textTransform: 'uppercase' } }, comparison.recommended)),
                h(Row, { label: `Tax under ${comparison.recommended.toUpperCase()} Regime`, value: comparison[comparison.recommended].totalTax, bold: true, big: true }),
                h(Row, { label: "Tax under other regime", value: comparison[comparison.recommended === 'new' ? 'old' : 'new'].totalTax, muted: true }),
                h(Row, { label: "You save vs other regime", value: comparison.savings }),
                h("div", { style: { marginTop: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.75rem', color: 'var(--text-muted)' } },
                    under44ADEligible && (h(Fragment, null,
                        h("strong", null, "\uD83D\uDCA1 You may qualify for Section 44AD presumptive taxation."),
                        " If your turnover is under \u20B92Cr, you can declare 6% (digital receipts) or 8% (cash) of turnover as income and skip maintaining full books. File ITR-4 (Sugam) if you opt in.",
                        h("br", null),
                        h("br", null))),
                    "Filing due date: ",
                    h("strong", null,
                        "31 July ",
                        parseInt(fy.split('-')[1], 10) + 2000),
                    " (non-audit) \u00B7",
                    h("strong", null,
                        " 31 October ",
                        parseInt(fy.split('-')[1], 10) + 2000),
                    " (audit / \u00A744AB). Advance tax installments: 15 Jun \u00B7 15 Sep \u00B7 15 Dec \u00B7 15 Mar."))),
        h("div", { className: "glass-panel p-4", style: { marginTop: '1rem', background: 'linear-gradient(135deg, rgba(30,64,175,0.05) 0%, rgba(5,150,105,0.05) 100%)', border: '1px solid var(--primary)' } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' } },
                h("div", null,
                    h("h3", { className: "section-title", style: { margin: 0, color: 'var(--primary)' } },
                        "ITR-4 (Sugam) Filing Summary PDF",
                        h(HelpButton, { title: "ITR-4 (Sugam) Filing Summary PDF", doc: "income-tax#itr4-pdf", size: 16 })),
                    h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' } }, "One PDF with every ITR-4 field pre-computed. Copy each value into the corresponding box on incometax.gov.in \u2014 or hand the PDF to your CA.")),
                h("button", { className: "btn btn-primary", onClick: generateITR4PDF },
                    h(Download, { size: 16 }),
                    " Download ITR-4 Summary"))),
        h("div", { className: "glass-panel p-4", style: { marginTop: '1rem' } },
            h("h3", { className: "section-title" },
                "Not included yet",
                h(HelpButton, { title: "Not included yet", doc: "income-tax#not-included", size: 16 })),
            h("ul", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, paddingLeft: '1.2rem', lineHeight: 1.7 } },
                h("li", null,
                    h("strong", null, "Form 16 upload + parse"),
                    " \u2014 auto-extract salary + TDS + exemptions"),
                h("li", null,
                    h("strong", null, "Capital Gains module"),
                    " \u2014 Zerodha / Groww / ICICI Direct CSV import"),
                h("li", null,
                    h("strong", null, "House Property module"),
                    " \u2014 multi-property, home-loan interest \u00A724(b)"),
                h("li", null,
                    h("strong", null, "ITR-1 / ITR-2 / ITR-3 support"),
                    " \u2014 for salaried + rental + capital-gains assessees"),
                h("li", null,
                    h("strong", null, "ITR JSON export"),
                    " \u2014 upload directly to the IT portal"),
                h("li", null,
                    h("strong", null, "Form 26AS reconciliation"),
                    " \u2014 upload TDS certificate")))));
}
// ============================================================================
// Constants + helpers
// ============================================================================
function defaultInputs() {
    return {
        salary: 0,
        businessIncome: 0,
        housePropertyIncome: 0,
        otherSources: 0,
        stcgAtSpecialRate: 0,
        ltcgAtSpecialRate: 0,
        deductions: {
            '80C': 0, '80CCD1B': 0, '80D': 0, '80TTA': 0, '80TTB': 0,
            '80E': 0, '80G': 0, '80GG': 0, '80DDB': 0, '80U': 0,
            '24b': 0, '80CCD2': 0,
        },
        regime: 'new',
    };
}
const SECTION_DESCRIPTIONS = {
    '80C': 'PPF · ELSS · LIC · EPF · tuition · home-loan principal · NSC',
    '80CCD1B': 'Additional NPS (self)',
    '80D': 'Health insurance (self + family + parents)',
    '80TTA': 'Savings-account interest (< 60 yrs)',
    '80TTB': 'Bank / PO deposit interest (senior citizens)',
    '80E': 'Education-loan interest — no cap, 8 years',
    '80G': 'Donations to approved funds',
    '80GG': 'Rent paid when HRA is not received',
    '80DDB': 'Specified serious illness',
    '80U': 'Self-disability',
    '24b': 'Home-loan interest (self-occupied)',
};
const CATEGORY_LABELS = {
    salary: 'Salary income',
    business_in: 'Business receipts',
    business_out: 'Business expense',
    interest: 'Interest earned',
    rent_received: 'Rent received',
    investment: 'Investment / MF / PPF',
    deduction_80C: '80C claim',
    deduction_80D: '80D claim',
    gst_paid: 'GST paid',
    transfer: 'Transfer / unclassified',
    personal: 'Personal spending',
};
const CATEGORY_COLORS = {
    salary: '#dbeafe',
    business_in: '#dcfce7',
    business_out: '#fee2e2',
    interest: '#e0f2fe',
    rent_received: '#f3e8ff',
    investment: '#fef3c7',
    deduction_80C: '#ccfbf1',
    deduction_80D: '#ccfbf1',
    gst_paid: '#fed7aa',
    transfer: '#e2e8f0',
    personal: '#fce7f3',
};
