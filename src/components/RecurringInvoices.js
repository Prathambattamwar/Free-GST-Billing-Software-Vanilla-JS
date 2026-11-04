import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { RefreshCw, Plus, Edit3, Trash2, Play, Pause, X, Save } from '../vanilla/icons.js';
import { getAllRecurring, saveRecurring, deleteRecurring, getAllClients, getProfile, generateRecurringNow } from '../store.js';
import { formatCurrency, INVOICE_TYPES, belongsToProfile, isUnassignedToBusiness, templateTotals, localToday, toLocalIsoDate, parseLocalDate } from '../utils.js';
import UnassignedBanner from './UnassignedBanner.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import HelpButton from './HelpButton.js';
const FREQUENCIES = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' },
];
const emptyForm = {
    clientName: '', clientState: '', clientGstin: '', clientAddress: '',
    frequency: 'monthly', invoiceType: 'tax-invoice',
    items: [{ name: '', hsn: '', quantity: 1, rate: '', taxPercent: 18, discount: 0 }],
    notes: '', nextDate: '', active: true,
    interval: 1, endMode: 'never', endDate: '', maxOccurrences: '',
};
const UNIT_PLURAL = { weekly: 'weeks', monthly: 'months', quarterly: 'quarters', yearly: 'years' };
const frequencyLabel = (tpl) => {
    const n = Math.max(1, parseInt(tpl.interval, 10) || 1);
    if (n === 1)
        return FREQUENCIES.find(f => f.value === tpl.frequency)?.label || 'Monthly';
    return `Every ${n} ${UNIT_PLURAL[tpl.frequency] || 'months'}`;
};
export default function RecurringInvoices() {
    const [templates, setTemplates] = useState([]);
    // v1.10.65 (#58 item 3) — the business these templates belong to.
    const [ownerProfile, setOwnerProfile] = useState(null);
    const [clients, setClients] = useState([]);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    // The whole template being edited. Saving replaces the record on the
    // server, so anything this form does not show (invoice options, terms,
    // tax-inclusive, business, client country, SEZ, occurrence count...) must
    // be carried over from here, or an edit silently wipes it.
    const [editingTpl, setEditingTpl] = useState(null);
    const [form, setForm] = useState({ ...emptyForm });
    // v1.10.65 (#58 item 3) — assign records saved before businesses were kept
    // separate. Never automatic: only the user knows which business an old
    // record belonged to, so guessing would file it into the wrong books.
    const unassignedTemplates = templates.filter(isUnassignedToBusiness);
    const assignUnassignedTemplates = async () => {
        await Promise.all(unassignedTemplates.map(r => saveRecurring({
            ...r,
            ownerGstin: ownerProfile?.gstin || '',
            ownerName: ownerProfile?.businessName || '',
        })));
        load();
    };
    const load = async () => {
        try {
            const [recs, cls, prof] = await Promise.all([
                getAllRecurring(), getAllClients(), getProfile().catch(() => null),
            ]);
            setOwnerProfile(prof);
            // v1.10.65 (#58 item 3) — show only this business's records. Anything
            // saved before businesses were separated has no owner recorded and is
            // always shown, so nothing disappears from an existing ledger.
            setTemplates((recs || []).filter(r => belongsToProfile(r, prof)));
            setClients(cls);
        }
        catch {
            toast('Failed to load data', 'error');
        }
    };
    useEffect(() => { load(); }, []);
    const openAdd = () => {
        // The 1st of next month, as a local date. (setMonth on the 31st skipped a
        // month, and toISOString() gave the last day of THIS month in India.)
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        setForm({ ...emptyForm, nextDate: toLocalIsoDate(nextMonth) });
        setEditingId(null);
        setShowForm(true);
    };
    const openEdit = (tpl) => {
        setForm({
            clientName: tpl.clientName || '',
            clientState: tpl.clientState || '',
            clientGstin: tpl.clientGstin || '',
            clientAddress: tpl.clientAddress || '',
            frequency: tpl.frequency || 'monthly',
            invoiceType: tpl.invoiceType || 'tax-invoice',
            // Migrate v1.6.7-and-earlier templates that used `description` — the
            // server-side auto-fire reads `name`, so a template with description
            // fired blank rows. Normalize on load.
            items: (tpl.items && tpl.items.length > 0)
                ? tpl.items.map(i => ({ ...i, name: i.name || i.description || '' }))
                : [{ name: '', hsn: '', quantity: 1, rate: '', taxPercent: 18, discount: 0 }],
            notes: tpl.notes || '',
            nextDate: tpl.nextDate || '',
            active: tpl.active !== false,
            interval: tpl.interval || 1,
            endMode: tpl.endMode || 'never',
            endDate: tpl.endDate || '',
            maxOccurrences: tpl.maxOccurrences || '',
        });
        setEditingTpl(tpl);
        setEditingId(tpl.id);
        setShowForm(true);
    };
    const closeForm = () => { setShowForm(false); setEditingId(null); setEditingTpl(null); setClientExtras(null); };
    const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
    const updateItem = (idx, field, value) => {
        setForm(prev => {
            const items = [...prev.items];
            items[idx] = { ...items[idx], [field]: value };
            return { ...prev, items };
        });
    };
    const addItem = () => {
        setForm(prev => ({
            ...prev,
            items: [...prev.items, { name: '', hsn: '', quantity: 1, rate: '', taxPercent: 18, discount: 0 }],
        }));
    };
    const removeItem = (idx) => {
        if (form.items.length <= 1)
            return;
        setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
    };
    // The client's other details are kept too: country and SEZ decide IGST vs
    // CGST + SGST on the generated invoices, and the rest prints on them. Only
    // name, state, GSTIN and address were taken, so a client abroad or in an
    // SEZ was billed as an ordinary local sale.
    const [clientExtras, setClientExtras] = useState(null);
    const selectClient = (cli) => {
        setForm(prev => ({
            ...prev,
            clientName: cli.name || '',
            clientState: cli.state || '',
            clientGstin: cli.gstin || '',
            clientAddress: cli.address || '',
        }));
        setClientExtras({
            clientCountry: cli.country || '', clientCity: cli.city || '', clientPin: cli.pin || '',
            clientEmail: cli.email || '', clientPhone: cli.phone || '', isSEZ: !!cli.isSEZ,
        });
    };
    const handleSave = async () => {
        if (!form.clientName.trim()) {
            toast('Client name required', 'warning');
            return;
        }
        if (!form.items.some(i => i.name && i.rate)) {
            toast('Add at least one item with description and rate', 'warning');
            return;
        }
        try {
            await saveRecurring({
                ...(editingId && editingTpl ? editingTpl : {}),
                ...(editingId ? { id: editingId } : {}),
                ...form,
                ...(clientExtras || {}),
                // A new next date restarts the schedule's day of month (see the
                // server's advanceDate).
                ...(editingTpl && editingTpl.nextDate !== form.nextDate ? { anchorDay: null } : {}),
                interval: Math.min(12, Math.max(1, parseInt(form.interval, 10) || 1)),
                endDate: form.endMode === 'onDate' ? form.endDate : '',
                maxOccurrences: form.endMode === 'afterN' ? (parseInt(form.maxOccurrences, 10) || null) : null,
                items: form.items.filter(i => i.name),
                // v1.10.65 (#58 item 3) — which business this template bills for.
                ownerGstin: ownerProfile?.gstin || '',
                ownerName: ownerProfile?.businessName || '',
            });
            toast(editingId ? 'Template updated' : 'Recurring invoice created', 'success');
            closeForm();
            load();
        }
        catch {
            toast('Failed to save', 'error');
        }
    };
    const handleDelete = async (id) => {
        if (await confirmAction({
            title: 'Delete this recurring invoice?',
            message: 'The template will stop generating new invoices. Existing generated invoices stay in your dashboard untouched.',
            confirmLabel: 'Delete template',
            tone: 'danger',
        })) {
            try {
                await deleteRecurring(id);
                toast('Deleted', 'success');
                load();
            }
            catch {
                toast('Failed to delete', 'error');
            }
        }
    };
    const toggleActive = async (tpl) => {
        const on = tpl.active !== false; // no flag = active, as the list shows it
        await saveRecurring({ ...tpl, active: !on });
        toast(on ? 'Paused' : 'Activated', 'info');
        load();
    };
    const generateNow = async (tpl) => {
        try {
            const { invoiceNumber } = await generateRecurringNow(tpl.id);
            toast(`Invoice ${invoiceNumber} generated for ${tpl.clientName}`, 'success');
            load();
        }
        catch (err) {
            toast('Failed to generate: ' + (err?.message || 'please try again'), 'error');
        }
    };
    const getDueTemplates = () => {
        const today = localToday();
        return templates.filter(t => t.active !== false && t.nextDate && t.nextDate <= today);
    };
    const dueTemplates = getDueTemplates();
    return (h("div", { className: "dashboard-container" },
        h("div", { className: "page-header" },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h("div", null,
                    h("h1", { className: "page-title" },
                        "Recurring Invoices ",
                        h(HelpButton, { title: "Recurring invoices \u2014 how to use", doc: "recurring", size: 16 })),
                    h("p", { className: "page-subtitle" }, "Auto-generate invoices for retainer clients"))),
            h("button", { className: "btn btn-primary", onClick: openAdd },
                h(Plus, { size: 18 }),
                " New Template")),
        h(UnassignedBanner, { count: unassignedTemplates.length, businessName: ownerProfile?.businessName, noun: "recurring template", onAssign: assignUnassignedTemplates }),
        dueTemplates.length > 0 && (h("div", { className: "glass-panel p-4 mb-6", style: { borderLeft: '4px solid #f59e0b', background: 'var(--warn-bg)', color: 'var(--warn-text)' } },
            h("h4", { style: { marginBottom: '0.5rem', color: 'var(--warn-text)' } },
                dueTemplates.length,
                " invoice",
                dueTemplates.length > 1 ? 's' : '',
                " due for generation",
                h(HelpButton, { title: "Invoices due for generation", doc: "recurring#due-banner", size: 16 })),
            h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } }, dueTemplates.map(tpl => (h("button", { key: tpl.id, className: "btn btn-primary", style: { fontSize: '0.8rem', padding: '0.4rem 0.75rem' }, onClick: () => generateNow(tpl) },
                h(Play, { size: 14 }),
                " ",
                tpl.clientName,
                " \u2014 ",
                FREQUENCIES.find(f => f.value === tpl.frequency)?.label)))))),
        showForm && (h("div", { className: "modal-overlay", onClick: closeForm },
            h("div", { className: "modal-content", onClick: e => e.stopPropagation(), style: { maxWidth: '680px', maxHeight: '90vh' } },
                h("h3", { className: "section-title" },
                    editingId ? 'Edit Template' : 'New Recurring Invoice',
                    h(HelpButton, { title: editingId ? 'Edit Template' : 'New Recurring Invoice', doc: editingId ? 'recurring#edit-template' : 'recurring#template-form', size: 16 })),
                !editingId && clients.length > 0 && !form.clientName && (h("div", { style: { marginBottom: '1rem' } },
                    h("label", { className: "form-label" },
                        "Quick Select Client",
                        h(HelpButton, { title: "Quick Select Client", doc: "recurring#quick-select-client", size: 14 })),
                    h("div", { className: "client-picker" }, clients.map(cli => (h("button", { key: cli.id, className: "client-picker-item", onClick: () => selectClient(cli) },
                        h("strong", null, cli.name),
                        h("span", null,
                            cli.state,
                            cli.gstin ? ` | ${cli.gstin}` : ''))))))),
                h("div", { className: "grid grid-cols-2 gap-4" },
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Client Name *"),
                        h("input", { type: "text", className: "form-input", value: form.clientName, onChange: e => updateField('clientName', e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Client GSTIN"),
                        h("input", { type: "text", className: "form-input", value: form.clientGstin, onChange: e => updateField('clientGstin', e.target.value), maxLength: 15 })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Frequency"),
                        h("select", { className: "form-input", value: form.frequency, onChange: e => updateField('frequency', e.target.value) }, FREQUENCIES.map(f => h("option", { key: f.value, value: f.value }, f.label)))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Every"),
                        h("input", { type: "number", min: "1", max: "12", className: "form-input", value: form.interval, onChange: e => updateField('interval', e.target.value), title: "1 = every period. Monthly with 3 = every three months." })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Next Due Date"),
                        h("input", { type: "date", className: "form-input", value: form.nextDate, onChange: e => updateField('nextDate', e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Stop"),
                        h("select", { className: "form-input", value: form.endMode, onChange: e => updateField('endMode', e.target.value) },
                            h("option", { value: "never" }, "Never (until I stop it)"),
                            h("option", { value: "onDate" }, "On a specific date"),
                            h("option", { value: "afterN" }, "After N invoices"))),
                    form.endMode === 'onDate' && (h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Stop after this date"),
                        h("input", { type: "date", className: "form-input", value: form.endDate, onChange: e => updateField('endDate', e.target.value) }))),
                    form.endMode === 'afterN' && (h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Number of invoices"),
                        h("input", { type: "number", min: "1", className: "form-input", value: form.maxOccurrences, placeholder: "e.g. 12", onChange: e => updateField('maxOccurrences', e.target.value) }))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Invoice Type"),
                        h("select", { className: "form-input", value: form.invoiceType, onChange: e => updateField('invoiceType', e.target.value) }, Object.entries(INVOICE_TYPES).map(([k, v]) => h("option", { key: k, value: k }, v.label))))),
                h("h4", { style: { marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 } },
                    "Line Items",
                    h(HelpButton, { title: "Line Items", doc: "recurring#line-items", size: 14 })),
                form.items.map((item, idx) => (h("div", { key: idx, className: "line-item-row", style: { alignItems: 'flex-end' } },
                    h("div", { className: "line-item-field", style: { flex: 2 } },
                        h("label", { className: "form-label" }, "Description"),
                        h("input", { type: "text", className: "form-input", value: item.name, onChange: e => updateItem(idx, 'name', e.target.value) })),
                    h("div", { className: "line-item-field", style: { width: 80 } },
                        h("label", { className: "form-label" }, "Qty"),
                        h("input", { type: "number", className: "form-input", value: item.quantity, onChange: e => updateItem(idx, 'quantity', e.target.value), min: "1" })),
                    h("div", { className: "line-item-field", style: { width: 100 } },
                        h("label", { className: "form-label" }, "Rate"),
                        h("input", { type: "number", className: "form-input", value: item.rate, onChange: e => updateItem(idx, 'rate', e.target.value), min: "0" })),
                    h("div", { className: "line-item-field", style: { width: 70 } },
                        h("label", { className: "form-label" }, "GST%"),
                        h("input", { type: "number", className: "form-input", value: item.taxPercent, onChange: e => updateItem(idx, 'taxPercent', e.target.value), min: "0" })),
                    h("div", { className: "line-item-delete" }, form.items.length > 1 && (h("button", { className: "icon-btn icon-btn-red", onClick: () => removeItem(idx), title: "Remove item", "aria-label": "Remove item" },
                        h(X, { size: 14 }))))))),
                h("button", { className: "btn btn-secondary", onClick: addItem, style: { fontSize: '0.8rem', marginBottom: '1rem' } },
                    h(Plus, { size: 14 }),
                    " Add Item"),
                h("div", { className: "flex gap-2 justify-end mt-4" },
                    h("button", { className: "btn btn-secondary", onClick: closeForm }, "Cancel"),
                    h("button", { className: "btn btn-primary", onClick: handleSave },
                        h(Save, { size: 16 }),
                        " ",
                        editingId ? 'Update' : 'Save'))))),
        h("div", { className: "glass-panel" },
            h("div", { className: "table-header" },
                h("h3", null,
                    "Recurring Templates",
                    h(HelpButton, { title: "Recurring Templates", doc: "recurring#list", size: 16 }))),
            templates.length === 0 ? (h("div", { className: "empty-state" },
                h(RefreshCw, { size: 48 }),
                h("p", null, "No recurring invoices set up yet."),
                h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Create Template"))) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table", style: { minWidth: '700px' } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Client"),
                            h("th", null, "Frequency"),
                            h("th", null, "Type"),
                            h("th", { style: { textAlign: 'right' } }, "Amount"),
                            h("th", null, "Next Due"),
                            h("th", null, "Status"),
                            h("th", { className: "col-center" }, "Actions"))),
                    h("tbody", null, templates.map(tpl => {
                        // The same calculation the browser-local data adapter uses when generating invoices.
                        const total = templateTotals(tpl, ownerProfile).total;
                        const isDue = tpl.active !== false && tpl.nextDate && tpl.nextDate <= localToday();
                        return (h("tr", { key: tpl.id, className: isDue ? 'row-warning' : '' },
                            h("td", { className: "font-medium" }, tpl.clientName),
                            h("td", null,
                                h("span", { className: "type-badge" }, frequencyLabel(tpl))),
                            h("td", { className: "text-muted" }, INVOICE_TYPES[tpl.invoiceType || 'tax-invoice']?.label),
                            h("td", { style: { textAlign: 'right' }, className: "font-bold" }, formatCurrency(total, tpl.invoiceOptions?.currency || 'INR')),
                            h("td", { className: isDue ? 'font-bold' : 'text-muted', style: isDue ? { color: '#d97706' } : {} }, tpl.nextDate ? parseLocalDate(tpl.nextDate).toLocaleDateString('en-IN') : '-'),
                            h("td", null,
                                h("span", { className: "status-badge", style: {
                                        background: tpl.active !== false ? '#ecfdf5' : '#f3f4f6',
                                        color: tpl.active !== false ? '#059669' : '#6b7280',
                                    } }, tpl.active !== false ? 'Active' : 'Paused')),
                            h("td", null,
                                h("div", { className: "table-actions" },
                                    h("button", { className: "icon-btn icon-btn-green", onClick: () => generateNow(tpl), title: "Generate Now" },
                                        h(Play, { size: 15 })),
                                    h("button", { className: "icon-btn icon-btn-blue", onClick: () => toggleActive(tpl), title: tpl.active !== false ? 'Pause' : 'Activate' }, tpl.active !== false ? h(Pause, { size: 15 }) : h(Play, { size: 15 })),
                                    h("button", { className: "icon-btn icon-btn-blue", onClick: () => openEdit(tpl), title: "Edit" },
                                        h(Edit3, { size: 15 })),
                                    h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDelete(tpl.id), title: "Delete" },
                                        h(Trash2, { size: 15 }))))));
                    }))))))));
}
