import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { Wallet, Plus, Edit3, Trash2, Search, X, Save, Calendar } from '../vanilla/icons.js';
import { getAllExpenses, saveExpense, deleteExpense, getProfile } from '../store.js';
import { formatCurrency, getFYOptions, belongsToProfile, isUnassignedToBusiness } from '../utils.js';
import UnassignedBanner from './UnassignedBanner.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import HelpButton from './HelpButton.js';
import TableExport from './TableExport.js';
import { useCostCentres } from './useCostCentres.js';
import { CostCentreSelect, CostCentreFilter } from './CostCentrePicker.js';
import { matchesCentre, centreFields, centreLabel, UNTAGGED } from '../utils/costCentres.js';
// Each category is tagged with its ITR (Income Tax Return) head so the
// v1.7.0+ ITR Filing Summary can auto-aggregate expenses under the correct
// P&L line. Users don't have to think about heads — they pick the category
// they already understand.
//   - 'business'      → deductible business expense under section 37
//   - 'depreciation'  → section 32 (asset purchases, capitalised then
//                       depreciated per Rule 5)
//   - 'salary'        → separately tracked; declared under section 40A(2)(b)
//                       for related parties
//   - 'notDeductible' → personal / drawings / capital / non-business
const EXPENSE_CATEGORIES = [
    { name: 'Office Rent', itrHead: 'business' },
    { name: 'Utilities', itrHead: 'business' },
    { name: 'Internet & Phone', itrHead: 'business' },
    { name: 'Software & Tools', itrHead: 'business' },
    { name: 'Travel', itrHead: 'business' },
    { name: 'Meals & Entertainment', itrHead: 'business' },
    { name: 'Office Supplies', itrHead: 'business' },
    { name: 'Salary & Wages', itrHead: 'salary' },
    { name: 'Professional Fees', itrHead: 'business' },
    { name: 'Insurance', itrHead: 'business' },
    { name: 'Marketing & Ads', itrHead: 'business' },
    { name: 'Raw Materials', itrHead: 'business' },
    { name: 'Shipping & Courier', itrHead: 'business' },
    { name: 'Repairs & Maintenance', itrHead: 'business' },
    { name: 'Bank Charges', itrHead: 'business' },
    { name: 'GST Paid', itrHead: 'business' },
    { name: 'Asset Purchase', itrHead: 'depreciation' },
    { name: 'Personal / Drawings', itrHead: 'notDeductible' },
    { name: 'Other', itrHead: 'business' },
];
const CATEGORY_NAMES = EXPENSE_CATEGORIES.map(c => c.name);
const PAYMENT_MODES = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card', 'Other'];
// v1.10.74 - today's LOCAL date (toISOString is UTC, so before 05:30 IST it
// gave yesterday). Called when the form opens, not once at load.
const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const emptyForm = {
    date: '', // v1.10.74 - set to localToday() when the form opens
    description: '',
    category: 'Other',
    amount: '',
    gstAmount: '',
    gstPercent: '',
    // P1 #15: interstate flag. When on, ITC on GST paid routes to IGST in
    // GSTR-3B Table 4(A) instead of splitting 50/50 into CGST + SGST. Real
    // scenario: AWS / Google / Adobe / SaaS bills from out-of-state offices.
    // Off = intrastate = supplier and buyer in the same state.
    interstate: false,
    vendorName: '',
    vendorGstin: '',
    invoiceNo: '',
    paymentMode: 'Bank Transfer',
    note: '',
    // v1.10.83 (#112) - optional; see utils/costCentres.js
    costCentre: '',
    costCentreName: '',
};
// v1.10.6 — audit L4: local copy removed, imported from utils above.
export default function ExpenseTracker() {
    const [expenses, setExpenses] = useState([]);
    // v1.10.65 (#58 item 3) — the business these records belong to.
    const [ownerProfile, setOwnerProfile] = useState(null);
    const [search, setSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [fyFilter, setFyFilter] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ ...emptyForm });
    const [centreFilter, setCentreFilter] = useState('');
    const { on: ccOn, centres } = useCostCentres(ownerProfile);
    const fyOptions = getFYOptions();
    const defaultFy = fyOptions[0]?.value || '';
    // v1.10.65 (#58 item 3) — assign records saved before businesses were kept
    // separate. Never automatic: only the user knows which business an old
    // record belonged to, so guessing would file it into the wrong books.
    const unassignedExpenses = expenses.filter(isUnassignedToBusiness);
    const assignUnassignedExpenses = async () => {
        await Promise.all(unassignedExpenses.map(r => saveExpense({
            ...r,
            ownerGstin: ownerProfile?.gstin || '',
            ownerName: ownerProfile?.businessName || '',
        })));
        loadExpenses();
    };
    const loadExpenses = async () => {
        try {
            const [rows, prof] = await Promise.all([getAllExpenses(), getProfile().catch(() => null)]);
            setOwnerProfile(prof);
            // v1.10.65 (#58 item 3) — show only this business's records. Anything
            // saved before businesses were separated has no owner recorded and is
            // always shown, so nothing disappears from an existing ledger.
            setExpenses((rows || []).filter(r => belongsToProfile(r, prof)));
        }
        catch {
            toast('Failed to load expenses', 'error');
        }
    };
    useEffect(() => {
        if (fyOptions[0])
            setFyFilter(fyOptions[0].value);
        loadExpenses();
    }, []);
    const filtered = expenses.filter(exp => {
        if (search.trim()) {
            const q = search.toLowerCase();
            if (!(exp.description || '').toLowerCase().includes(q) &&
                !(exp.vendorName || '').toLowerCase().includes(q) &&
                !(exp.invoiceNo || '').toLowerCase().includes(q))
                return false;
        }
        if (categoryFilter !== 'all' && exp.category !== categoryFilter)
            return false;
        if (!matchesCentre(exp, centreFilter))
            return false;
        if (fyFilter) {
            const fy = fyOptions.find(f => f.value === fyFilter);
            if (fy && exp.date) {
                if (exp.date < fy.from || exp.date > fy.to)
                    return false;
            }
        }
        return true;
    });
    const totalAmount = filtered.reduce((s, e) => s + (e.amount || 0), 0);
    const totalGST = filtered.reduce((s, e) => s + (e.gstAmount || 0), 0);
    const openAdd = () => {
        setForm({ ...emptyForm, date: localToday() });
        setEditingId(null);
        setShowForm(true);
    };
    const openEdit = (exp) => {
        setForm({
            date: exp.date || '',
            description: exp.description || '',
            category: exp.category || 'Other',
            amount: exp.amount || '',
            gstAmount: exp.gstAmount || '',
            gstPercent: exp.gstPercent || '',
            vendorName: exp.vendorName || '',
            vendorGstin: exp.vendorGstin || '',
            invoiceNo: exp.invoiceNo || '',
            paymentMode: exp.paymentMode || 'Bank Transfer',
            interstate: !!exp.interstate,
            note: exp.note || '',
            costCentre: exp.costCentre || '',
            costCentreName: exp.costCentreName || '',
        });
        setEditingId(exp.id);
        setShowForm(true);
    };
    const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm({ ...emptyForm });
    };
    const handleSave = async () => {
        if (!form.description.trim()) {
            toast('Description is required', 'warning');
            return;
        }
        if (!form.amount || parseFloat(form.amount) <= 0) {
            toast('Enter a valid amount', 'warning');
            return;
        }
        // v1.10.74 - GST % must be 0 to 100 (40% is a real rate, so no 28 cap).
        const gstPct = form.gstPercent === '' ? 0 : parseFloat(form.gstPercent);
        if (!(gstPct >= 0 && gstPct <= 100)) {
            toast('GST % must be between 0 and 100', 'warning');
            return;
        }
        try {
            const expense = {
                ...(editingId ? { id: editingId } : {}),
                date: form.date,
                description: form.description.trim(),
                category: form.category,
                amount: parseFloat(form.amount),
                gstAmount: form.gstAmount ? parseFloat(form.gstAmount) : 0,
                gstPercent: form.gstPercent ? parseFloat(form.gstPercent) : 0,
                vendorName: form.vendorName.trim(),
                vendorGstin: form.vendorGstin.trim(),
                invoiceNo: form.invoiceNo.trim(),
                paymentMode: form.paymentMode,
                interstate: !!form.interstate,
                note: form.note.trim(),
                // Stamp the business this expense belongs to. `vendorGstin` above is
                // the SUPPLIER — filing an expense under your own supplier would be
                // exactly backwards, so the owner is kept in its own field.
                ownerGstin: ownerProfile?.gstin || '',
                ownerName: ownerProfile?.businessName || '',
                ...centreFields(form.costCentre, form.costCentreName),
            };
            await saveExpense(expense);
            toast(editingId ? 'Expense updated' : 'Expense added', 'success');
            closeForm();
            loadExpenses();
        }
        catch {
            toast('Failed to save expense', 'error');
        }
    };
    const handleDelete = async (id) => {
        if (await confirmAction({
            title: 'Delete this expense?',
            message: 'The row is removed from your expense ledger. Any GST ITC claimed against this bill in past returns stays as filed.',
            confirmLabel: 'Delete',
            tone: 'danger',
        })) {
            try {
                await deleteExpense(id);
                toast('Expense deleted', 'success');
                loadExpenses();
            }
            catch {
                toast('Failed to delete', 'error');
            }
        }
    };
    const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
    // v1.10.74 - recompute GST from the NEW amount and GST % on every change
    // of either (it used the old amount), and zero it when either is empty/0.
    const updateAmountOrGST = (field, value) => setForm(prev => {
        const next = { ...prev, [field]: value };
        const base = parseFloat(next.amount) || 0;
        const pct = parseFloat(next.gstPercent) || 0;
        const gst = base > 0 && pct > 0 ? (base * pct) / (100 + pct) : 0;
        return { ...next, gstAmount: Math.round(gst * 100) / 100 };
    });
    // v1.10.77 (#85) - the expense statement: the list as filtered, oldest
    // first, with a total row; as CSV, Excel or Print / PDF. Same columns as the
    // old CSV, so a CA's sheet keeps working.
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const statementRows = filtered.length ? [
        ...[...filtered].sort((x, y) => String(x.date || '').localeCompare(String(y.date || ''))).map(x => [
            x.date || '', x.description || '', x.category || '', r2(x.amount), r2(x.gstAmount), Number(x.gstPercent) || 0,
            x.vendorName || '', x.vendorGstin || '', x.invoiceNo || '', x.paymentMode || '', x.interstate ? 'Y' : 'N', x.note || ''
        ]),
        ['Total', '', '', r2(totalAmount), r2(totalGST), '', '', '', '', '', '', ''],
    ] : [];
    const statementPeriod = [
        fyOptions.find(f => f.value === fyFilter)?.label || 'all years',
        categoryFilter !== 'all' ? categoryFilter : '',
        centreFilter ? (centreFilter === UNTAGGED ? 'no cost centre' : centreLabel(centres.find(c => c.id === centreFilter))) : '',
        search.trim() ? `matching "${search.trim()}"` : '',
    ].filter(Boolean).join(', ');
    return (h("div", { className: "dashboard-container" },
        h("div", { className: "page-header" },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h("div", null,
                    h("h1", { className: "page-title" },
                        "Expenses ",
                        h(HelpButton, { title: "Expenses \u2014 how to use", doc: "expenses", size: 16 })),
                    h("p", { className: "page-subtitle" }, "Track business expenses for P&L and ITC claims"))),
            h("div", { className: "flex gap-2" },
                h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Add Expense"))),
        h(UnassignedBanner, { count: unassignedExpenses.length, businessName: ownerProfile?.businessName, noun: "expense", onAssign: assignUnassignedExpenses }),
        h("div", { className: "stats-grid", style: { gridTemplateColumns: 'repeat(3, 1fr)' } },
            h("div", { className: "stat-card" },
                h("div", { className: "stat-icon stat-icon-purple" },
                    h(Wallet, { size: 22 })),
                h("div", null,
                    h("p", { className: "stat-label" }, "Total Expenses"),
                    h("h2", { className: "stat-value stat-value-purple" }, formatCurrency(totalAmount)))),
            h("div", { className: "stat-card" },
                h("div", { className: "stat-icon stat-icon-green" },
                    h(Calendar, { size: 22 })),
                h("div", null,
                    h("p", { className: "stat-label" }, "GST Paid (ITC)"),
                    h("h2", { className: "stat-value stat-value-green" }, formatCurrency(totalGST)))),
            h("div", { className: "stat-card" },
                h("div", { className: "stat-icon stat-icon-blue" },
                    h(Wallet, { size: 22 })),
                h("div", null,
                    h("p", { className: "stat-label" }, "Entries"),
                    h("h2", { className: "stat-value" }, filtered.length)))),
        h("div", { className: "glass-panel p-4 mb-6" },
            h("div", { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' } },
                h("div", { className: "search-box", style: { maxWidth: '300px' } },
                    h(Search, { size: 16, className: "search-icon" }),
                    h("input", { type: "text", placeholder: "Search expenses...", value: search, onChange: e => setSearch(e.target.value), className: "search-input" })),
                h("select", { className: "filter-select", value: categoryFilter, onChange: e => setCategoryFilter(e.target.value) },
                    h("option", { value: "all" }, "All Categories"),
                    CATEGORY_NAMES.map(c => h("option", { key: c, value: c }, c))),
                h("select", { className: "filter-select", value: fyFilter, onChange: e => setFyFilter(e.target.value) },
                    h("option", { value: "" }, "All years"),
                    fyOptions.map(fy => h("option", { key: fy.value, value: fy.value }, fy.label))),
                ccOn && h(CostCentreFilter, { centres: centres, value: centreFilter, onChange: setCentreFilter }),
                (search || categoryFilter !== 'all' || fyFilter !== defaultFy || centreFilter) && (h("button", { className: "icon-btn icon-btn-red", onClick: () => { setSearch(''); setCategoryFilter('all'); setFyFilter(defaultFy); setCentreFilter(''); }, title: "Clear filters", "aria-label": "Clear filters" },
                    h(X, { size: 15 }))))),
        showForm && (h("div", { className: "modal-overlay", onClick: closeForm },
            h("div", { className: "modal-content", onClick: e => e.stopPropagation(), style: { maxWidth: '620px' } },
                h("h3", { className: "section-title" },
                    editingId ? 'Edit Expense' : 'Add Expense',
                    " ",
                    h(HelpButton, { title: "Adding an expense", doc: "expenses#add-expense", size: 16 })),
                h("div", { className: "grid grid-cols-2 gap-4" },
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Date *"),
                        h("input", { type: "date", className: "form-input", value: form.date, onChange: e => updateField('date', e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Category"),
                        h("select", { className: "form-input", value: form.category, onChange: e => updateField('category', e.target.value) }, CATEGORY_NAMES.map(c => h("option", { key: c, value: c }, c)))),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label" }, "Description *"),
                        h("input", { type: "text", className: "form-input", value: form.description, onChange: e => updateField('description', e.target.value), placeholder: "e.g. AWS Hosting - March" })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Amount (incl. GST) *"),
                        h("input", { type: "number", className: "form-input", value: form.amount, onChange: e => updateAmountOrGST('amount', e.target.value), placeholder: "0.00", min: "0" })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "GST % (for ITC)"),
                        h("input", { type: "number", className: "form-input", value: form.gstPercent, onChange: e => updateAmountOrGST('gstPercent', e.target.value), placeholder: "18", min: "0", max: "100" }),
                        form.gstAmount > 0 && h("p", { className: "field-hint" },
                            "GST: ",
                            formatCurrency(form.gstAmount))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Vendor Name"),
                        h("input", { type: "text", className: "form-input", value: form.vendorName, onChange: e => updateField('vendorName', e.target.value), placeholder: "Optional" })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Vendor GSTIN"),
                        h("input", { type: "text", className: "form-input", value: form.vendorGstin, onChange: e => updateField('vendorGstin', e.target.value), placeholder: "For ITC claim", maxLength: 15 })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Invoice / Bill No"),
                        h("input", { type: "text", className: "form-input", value: form.invoiceNo, onChange: e => updateField('invoiceNo', e.target.value), placeholder: "Optional" })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Payment Mode"),
                        h("select", { className: "form-input", value: form.paymentMode, onChange: e => updateField('paymentMode', e.target.value) }, PAYMENT_MODES.map(m => h("option", { key: m, value: m }, m)))),
                    ccOn && (h("div", { className: "form-group" },
                        h("label", { className: "form-label", htmlFor: "cost-centre" }, "Cost centre"),
                        h(CostCentreSelect, { centres: centres, value: form.costCentre, name: form.costCentreName, onChange: (id, name) => setForm(prev => ({ ...prev, costCentre: id, costCentreName: name })) }))),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', cursor: 'pointer' } },
                            h("input", { type: "checkbox", checked: !!form.interstate, onChange: e => updateField('interstate', e.target.checked), style: { width: 16, height: 16, accentColor: 'var(--primary)' } }),
                            h("span", null,
                                h("strong", null, "Inter-state expense"),
                                " \u2014 vendor charged IGST (different state)",
                                h("span", { style: { color: '#94a3b8', fontSize: '0.72rem', display: 'block' } }, "Routes ITC to IGST in GSTR-3B. Common: AWS / Google / Adobe / SaaS billed from an out-of-state office. Tip: check the vendor's GSTIN \u2014 first 2 digits are their state code.")))),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label" }, "Note (optional)"),
                        h("input", { type: "text", className: "form-input", value: form.note, onChange: e => updateField('note', e.target.value), placeholder: "Any additional note..." }))),
                h("div", { className: "flex gap-2 justify-end mt-4" },
                    h("button", { className: "btn btn-secondary", onClick: closeForm }, "Cancel"),
                    h("button", { className: "btn btn-primary", onClick: handleSave },
                        h(Save, { size: 16 }),
                        " ",
                        editingId ? 'Update' : 'Save'))))),
        h("div", { className: "glass-panel" },
            h("div", { className: "table-header", style: { flexWrap: 'wrap', gap: '0.5rem' } },
                h("h3", null,
                    "Expense Records ",
                    h(HelpButton, { title: "Expense Records", doc: "expenses#expense-list", size: 16 })),
                h(TableExport, { title: "Expense statement", filename: `Expenses-${statementPeriod}`, landscape: true, subtitle: [ownerProfile?.businessName, statementPeriod].filter(Boolean).join(', '), headers: ['Date', 'Description', 'Category', 'Amount', 'GST Amount', 'GST %', 'Vendor', 'Vendor GSTIN', 'Invoice No', 'Payment Mode', 'Inter-state', 'Note'], rows: statementRows })),
            filtered.length === 0 ? (h("div", { className: "empty-state" },
                h(Wallet, { size: 48 }),
                h("p", null, expenses.length === 0 ? 'No expenses recorded yet.' : 'No expenses match your filters.'),
                expenses.length === 0 && h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Add Expense"))) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table", style: { minWidth: '800px' } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Date"),
                            h("th", null, "Description"),
                            h("th", null, "Category"),
                            h("th", null, "Vendor"),
                            h("th", { style: { textAlign: 'right' } }, "Amount"),
                            h("th", { style: { textAlign: 'right' } }, "GST"),
                            h("th", null, "Mode"),
                            h("th", { className: "col-center" }, "Actions"))),
                    h("tbody", null, filtered.map(exp => (h("tr", { key: exp.id },
                        h("td", { className: "text-muted" }, exp.date ? new Date(exp.date).toLocaleDateString('en-IN') : ''),
                        h("td", { className: "font-medium" }, exp.description),
                        h("td", null,
                            h("span", { className: "type-badge" }, exp.category)),
                        h("td", { className: "text-muted" }, exp.vendorName || '-'),
                        h("td", { style: { textAlign: 'right' }, className: "font-bold" }, formatCurrency(exp.amount)),
                        h("td", { style: { textAlign: 'right' }, className: "text-muted" }, exp.gstAmount ? formatCurrency(exp.gstAmount) : '-'),
                        h("td", { className: "text-muted" }, exp.paymentMode),
                        h("td", null,
                            h("div", { className: "table-actions" },
                                h("button", { className: "icon-btn icon-btn-blue", onClick: () => openEdit(exp), title: "Edit" },
                                    h(Edit3, { size: 15 })),
                                h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDelete(exp.id), title: "Delete" },
                                    h(Trash2, { size: 15 })))))))),
                    h("tfoot", null,
                        h("tr", { style: { fontWeight: 'bold', borderTop: '2px solid var(--border)' } },
                            h("td", { colSpan: 4 }, "Total"),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(totalAmount)),
                            h("td", { style: { textAlign: 'right' } }, formatCurrency(totalGST)),
                            h("td", { colSpan: 2 })))))))));
}
