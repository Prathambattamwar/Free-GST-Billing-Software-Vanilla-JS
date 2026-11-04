import { useState, useEffect, useRef, h, Fragment } from '../vanilla/dom.js';
import { Receipt, Plus, Trash2, Search, Printer, Pencil } from '../vanilla/icons.js';
import { getAllReceipts, saveReceipt, deleteReceipt, getAllBills, getProfile, getNextInvoiceNumber, saveBill } from '../store.js';
import { formatCurrency, numberToWords, belongsToProfile, isUnassignedToBusiness, countsAsSales, businessKeyOf, localToday, amountDue, paymentStatusFor, isCancelledBill } from '../utils.js';
import UnassignedBanner from './UnassignedBanner.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import HelpButton from './HelpButton.js';
const PAYMENT_MODES = ['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card', 'Other'];
// date is filled in when the form opens (localToday): set here it was the
// day the app was loaded, in UTC.
const emptyForm = {
    date: '',
    receiptNo: '',
    clientName: '',
    clientAddress: '',
    amount: '',
    paymentMode: 'Bank Transfer',
    referenceNo: '',
    againstInvoice: '',
    note: '',
};
export default function ReceiptVoucher() {
    const [receipts, setReceipts] = useState([]);
    const [bills, setBills] = useState([]);
    const [profile, setProfile] = useState({});
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ ...emptyForm });
    const [previewReceipt, setPreviewReceipt] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const receiptRef = useRef(null);
    // v1.10.74 - the number previewed when the form opened, so save can tell
    // whether the user typed their own.
    const previewedNoRef = useRef('');
    const loadData = async () => {
        try {
            const [recs, bls, prof] = await Promise.all([getAllReceipts(), getAllBills(), getProfile()]);
            // v1.10.66 (#64 item 2) — receipts belong to one business, like its
            // invoices. Both lists are narrowed: the receipts shown, and the
            // invoices offered in Quick Select and matched by "Against Invoice".
            // Two businesses can each have an INV/2026-27/0001, so matching across
            // them could post a payment against the other company's invoice.
            // Receipts saved before this carry no business and are always shown.
            setReceipts((recs || []).filter(r => belongsToProfile(r, prof)));
            setBills((bls || []).filter(b => belongsToProfile(b, prof)));
            setProfile(prof || {});
        }
        catch {
            toast('Failed to load data', 'error');
        }
    };
    useEffect(() => {
        loadData();
    }, []);
    // Peek at the next receipt number using the SAME atomic counter that
    // invoice numbers use. Pre-v1.6.8 this counted `receipts.length + 1`
    // which raced under concurrent saves + two tabs.
    const getNextReceiptNo = async () => {
        try {
            // v1.10.79 (#95) - a business with its own numbering numbers its receipts too.
            return await getNextInvoiceNumber('RCP', { peek: true, businessKey: businessKeyOf(profile) });
        }
        catch {
            // Fallback preserves old behaviour if server is offline mid-mount
            const count = receipts.length + 1;
            const now = new Date();
            const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
            return `RCP/${fy}-${String(fy + 1).slice(-2)}/${String(count).padStart(4, '0')}`;
        }
    };
    const filtered = search.trim()
        ? receipts.filter(r => (r.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
            (r.receiptNo || '').toLowerCase().includes(search.toLowerCase()))
        : receipts;
    const openAdd = async () => {
        const receiptNo = await getNextReceiptNo();
        previewedNoRef.current = receiptNo;
        setForm({ ...emptyForm, date: localToday(), receiptNo });
        setEditingId(null);
        setShowForm(true);
    };
    // v1.10.16 — reported: "here also add edit option" — the Payment Receipts
    // list only had Print + Delete. Delete + re-create lost the original
    // receipt number and the paid-against linkage. Now Edit opens the same
    // form pre-filled with the receipt fields; save re-POSTs with the same
    // id so the server upserts in place.
    const openEdit = (rcp) => {
        setForm({
            date: rcp.date || localToday(),
            receiptNo: rcp.receiptNo || '',
            clientName: rcp.clientName || '',
            clientAddress: rcp.clientAddress || '',
            amount: String(rcp.amount ?? ''),
            paymentMode: rcp.paymentMode || 'Bank Transfer',
            referenceNo: rcp.referenceNo || '',
            againstInvoice: rcp.againstInvoice || '',
            note: rcp.note || '',
        });
        setEditingId(rcp.id);
        setShowForm(true);
    };
    const closeForm = () => { setShowForm(false); setForm({ ...emptyForm }); setEditingId(null); };
    const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
    const selectInvoice = (bill) => {
        setForm(prev => ({
            ...prev,
            clientName: bill.clientName || '',
            clientAddress: bill.data?.client?.address || '',
            // v1.10.23 — clamp negative (overpaid) to 0 so the new-receipt
            // amount input doesn't start pre-filled with a negative number.
            amount: String(Math.max(0, Math.round((amountDue(bill) - (bill.paidAmount || 0)) * 100) / 100)),
            againstInvoice: bill.invoiceNumber || '',
        }));
    };
    const handleSave = async () => {
        if (!form.clientName.trim()) {
            toast('Client name required', 'warning');
            return;
        }
        if (!form.amount || parseFloat(form.amount) <= 0) {
            toast('Enter valid amount', 'warning');
            return;
        }
        try {
            // v1.10.16 — Edit mode preserves the original receipt number and id so
            // the server upserts in place. Only new receipts reserve a fresh
            // atomic number from the RCP counter.
            let receiptNo = form.receiptNo;
            // v1.10.74 - a number the user typed is kept; only the auto number
            // (or an empty field) is swapped for a freshly reserved one.
            if (!editingId && (!receiptNo.trim() || receiptNo.trim() === previewedNoRef.current)) {
                try {
                    receiptNo = await getNextInvoiceNumber('RCP', { businessKey: businessKeyOf(profile) });
                }
                catch {
                    receiptNo = receiptNo.trim() || previewedNoRef.current; /* fall back to peeked number */
                }
            }
            // v1.10.66 (#64 item 2) — a NEW receipt is stamped with the business
            // selected now. An edited receipt keeps what it had, including no business
            // at all: an older receipt is assigned only through the explicit "Assign
            // to" banner, never as a side effect of fixing a typo while some other
            // business happens to be selected.
            const existing = editingId ? receipts.find(r => r.id === editingId) : null;
            const receipt = {
                ...form,
                receiptNo,
                amount: parseFloat(form.amount),
                ownerGstin: existing ? (existing.ownerGstin || '') : (profile?.gstin || ''),
                ownerName: existing ? (existing.ownerName || '') : (profile?.businessName || ''),
            };
            if (editingId)
                receipt.id = editingId;
            await saveReceipt(receipt);
            // P1 #19: propagate the payment to the linked invoice so the Dashboard
            // shows the invoice as paid/partial and doesn't require the user to
            // double-record via the payment modal. If no invoice link, skip
            // silently — receipts against ad-hoc payments (advances, deposits)
            // aren't tied to any bill.
            // v1.10.16 — Edit mode: find the previously-propagated payment record
            // in the linked bill (matched by receiptNo) and update it in place
            // instead of appending. Prevents double-counting when a receipt is
            // edited. If the linked invoice was changed, we remove the old
            // propagation and add a fresh one to the new invoice.
            const modeMap = { 'Bank Transfer': 'bank-transfer', 'UPI': 'upi', 'Cash': 'cash', 'Cheque': 'cheque', 'Card': 'card', 'Other': 'other' };
            const paidAmount = parseFloat(form.amount);
            // A cancelled invoice stays cancelled (un-cancel it on the Dashboard,
            // which also fixes its stock); otherwise paid once the payments cover
            // the total less TDS.
            const statusFor = (bill, paid) => (isCancelledBill(bill) ? 'cancelled' : paymentStatusFor(bill, paid));
            const stripReceiptFromBill = async (bill) => {
                if (!bill)
                    return;
                const priorPayments = bill.payments || [];
                const kept = priorPayments.filter(p => p.receiptNo !== receiptNo);
                if (kept.length === priorPayments.length)
                    return;
                const newTotal = kept.reduce((s, p) => s + (Number(p.amount) || 0), 0);
                await saveBill({ ...bill, paidAmount: newTotal, status: statusFor(bill, newTotal), payments: kept }, { overwrite: true });
            };
            // If editing and the linked invoice changed (or was removed), scrub
            // the old link first.
            if (editingId) {
                try {
                    const original = receipts.find(r => r.id === editingId);
                    const oldRef = original?.againstInvoice?.trim();
                    const newRef = form.againstInvoice?.trim();
                    if (oldRef && oldRef !== newRef) {
                        const oldBill = bills.find(b => b.invoiceNumber === oldRef || b.id === oldRef);
                        await stripReceiptFromBill(oldBill);
                    }
                }
                catch { /* non-fatal */ }
            }
            let unmatchedRef = '';
            if (form.againstInvoice && form.againstInvoice.trim()) {
                try {
                    const bill = bills.find(b => b.invoiceNumber === form.againstInvoice.trim() || b.id === form.againstInvoice.trim());
                    if (!bill)
                        unmatchedRef = form.againstInvoice.trim(); // v1.10.74 - tell the user below
                    if (bill) {
                        const priorPayments = bill.payments || [];
                        const priorIdx = priorPayments.findIndex(p => p.receiptNo === receiptNo);
                        const nextEntry = {
                            // The receipt's id, as payments recorded on the Dashboard carry
                            // theirs: editing or deleting the payment there then updates this
                            // receipt instead of making a second one.
                            id: receipt.id,
                            amount: paidAmount,
                            date: form.date,
                            mode: modeMap[form.paymentMode] || 'other',
                            note: `Receipt ${receiptNo}${form.referenceNo ? ' · ref ' + form.referenceNo : ''}`,
                            recordedAt: priorIdx >= 0 ? priorPayments[priorIdx].recordedAt : new Date().toISOString(),
                            receiptNo,
                        };
                        const nextPayments = priorIdx >= 0
                            ? priorPayments.map((p, i) => i === priorIdx ? nextEntry : p)
                            : [...priorPayments, nextEntry];
                        const newTotal = nextPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
                        await saveBill({ ...bill, paidAmount: newTotal, status: statusFor(bill, newTotal), payments: nextPayments }, { overwrite: true });
                    }
                }
                catch { /* non-fatal: receipt is saved; user can manually update the bill */ }
            }
            toast('Receipt saved', 'success');
            if (unmatchedRef)
                toast(`No invoice numbered ${unmatchedRef} was found, so this receipt is saved on its own.`, 'info');
            closeForm();
            loadData();
        }
        catch {
            toast('Failed to save', 'error');
        }
    };
    const handleDelete = async (id) => {
        if (await confirmAction({
            title: 'Delete this receipt?',
            message: 'The receipt voucher is removed from your records. The underlying invoice payment (if this was linked to one) stays intact.',
            confirmLabel: 'Delete',
            tone: 'danger',
        })) {
            try {
                await deleteReceipt(id);
                toast('Deleted', 'success');
                loadData();
            }
            catch {
                toast('Failed to delete', 'error');
            }
        }
    };
    const printReceipt = (receipt) => {
        setPreviewReceipt(receipt);
        setTimeout(() => {
            const el = receiptRef.current;
            if (!el)
                return;
            const printWindow = window.open('', '_blank');
            // v1.10.74 - a blocked pop-up returns null; this used to fail silently.
            if (!printWindow) {
                toast('Your browser blocked the print window. Allow pop-ups for this app and try again.', 'warning');
                setPreviewReceipt(null);
                return;
            }
            printWindow.document.write(`
        <html><head><title>Receipt ${receipt.receiptNo}</title>
        <style>
          body { font-family: 'Inter', Arial, sans-serif; margin: 0; padding: 2rem; color: #1a1a2e; }
          .receipt-box { max-width: 600px; margin: 0 auto; border: 2px solid #e2e8f0; border-radius: 8px; padding: 2rem; }
          .receipt-header { text-align: center; margin-bottom: 1.5rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 1rem; }
          .receipt-title { font-size: 1.5rem; font-weight: 800; color: #0f172a; margin: 0; }
          .receipt-subtitle { font-size: 0.8rem; color: #64748b; margin: 0.25rem 0 0; }
          .receipt-row { display: flex; justify-content: space-between; padding: 0.5rem 0; font-size: 0.9rem; border-bottom: 1px solid #f1f5f9; }
          .receipt-label { color: #64748b; font-weight: 500; }
          .receipt-value { color: #1e293b; font-weight: 600; }
          .receipt-amount { font-size: 1.5rem; font-weight: 800; color: #1e40af; text-align: center; margin: 1.5rem 0; padding: 1rem; background: #eff6ff; border-radius: 8px; }
          .receipt-words { font-size: 0.85rem; color: #334155; font-style: italic; text-align: center; margin-bottom: 1.5rem; }
          .receipt-footer { display: flex; justify-content: space-between; margin-top: 3rem; padding-top: 1rem; }
          .receipt-sig { text-align: center; }
          .receipt-sig-line { width: 180px; border-bottom: 1.5px solid #1e293b; margin-bottom: 0.25rem; }
          .receipt-sig-label { font-size: 0.75rem; color: #64748b; }
          .business-name { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.25rem; }
          .business-details { font-size: 0.75rem; color: #64748b; }
          @media print { body { margin: 0; } .receipt-box { border: none; } }
        </style></head><body>
        ${el.innerHTML}
        <script>window.print(); window.close();</script>
        </body></html>
      `);
            printWindow.document.close();
            setPreviewReceipt(null);
        }, 100);
    };
    // v1.10.67 (#66 item 12) — no money is owed on a cancelled invoice.
    // v1.10.74 - nor on quotes, challans or credit notes: real sales only.
    const unpaidBills = bills.filter(b => b.status !== 'paid' && countsAsSales(b));
    // v1.10.66 (#64 item 2) — receipts saved before this release carry no
    // business. As with expenses they are never assigned automatically: only the
    // user knows which business took the money.
    const unassignedReceipts = receipts.filter(isUnassignedToBusiness);
    const assignUnassignedReceipts = async () => {
        await Promise.all(unassignedReceipts.map(r => saveReceipt({
            ...r,
            ownerGstin: profile?.gstin || '',
            ownerName: profile?.businessName || '',
        })));
        loadData();
    };
    return (h("div", { className: "dashboard-container" },
        h("div", { className: "page-header" },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h("div", null,
                    h("h1", { className: "page-title" },
                        "Receipts ",
                        h(HelpButton, { title: "Receipts \u2014 how to use", doc: "receipts", size: 16 })),
                    h("p", { className: "page-subtitle" }, "Generate payment receipts for clients"))),
            h("button", { className: "btn btn-primary", onClick: openAdd },
                h(Plus, { size: 18 }),
                " New Receipt")),
        h(UnassignedBanner, { count: unassignedReceipts.length, businessName: profile?.businessName, noun: "receipt", onAssign: assignUnassignedReceipts }),
        showForm && (h("div", { className: "modal-overlay", onClick: closeForm },
            h("div", { className: "modal-content", onClick: e => e.stopPropagation(), style: { maxWidth: '600px' } },
                h("h3", { className: "section-title" },
                    editingId ? 'Edit Payment Receipt' : 'New Payment Receipt',
                    h(HelpButton, { title: editingId ? 'Edit Payment Receipt' : 'New Payment Receipt', doc: editingId ? 'receipts#edit-receipt' : 'receipts#new-receipt', size: 16 })),
                unpaidBills.length > 0 && !form.againstInvoice && (h("div", { style: { marginBottom: '1rem' } },
                    h("label", { className: "form-label" },
                        "Quick Select \u2014 Unpaid Invoices",
                        h(HelpButton, { title: "Quick Select \u2014 Unpaid Invoices", doc: "receipts#quick-select", size: 14 })),
                    h("div", { className: "client-picker", style: { maxHeight: '150px', overflowY: 'auto' } }, unpaidBills.slice(0, 50).map(bill => (h("button", { key: bill.id, className: "client-picker-item", onClick: () => selectInvoice(bill) },
                        h("div", null,
                            h("strong", null, bill.clientName),
                            h("span", { style: { marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' } }, bill.invoiceNumber)),
                        (bill.totalAmount - (bill.paidAmount || 0)) > 0.005 && (h("span", { style: { fontWeight: 600 } }, formatCurrency(bill.totalAmount - (bill.paidAmount || 0)))))))))),
                h("div", { className: "grid grid-cols-2 gap-4" },
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Receipt No"),
                        h("input", { type: "text", className: "form-input", value: form.receiptNo, onChange: e => updateField('receiptNo', e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Date"),
                        h("input", { type: "date", className: "form-input", value: form.date, onChange: e => updateField('date', e.target.value) })),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label" }, "Received From (Client Name) *"),
                        h("input", { type: "text", className: "form-input", value: form.clientName, onChange: e => updateField('clientName', e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Amount *"),
                        h("input", { type: "number", className: "form-input", value: form.amount, onChange: e => updateField('amount', e.target.value), min: "0" })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Payment Mode"),
                        h("select", { className: "form-input", value: form.paymentMode, onChange: e => updateField('paymentMode', e.target.value) }, PAYMENT_MODES.map(m => h("option", { key: m, value: m }, m)))),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Reference / Transaction No"),
                        h("input", { type: "text", className: "form-input", value: form.referenceNo, onChange: e => updateField('referenceNo', e.target.value) })),
                    h("div", { className: "form-group" },
                        h("label", { className: "form-label" }, "Against Invoice"),
                        h("input", { type: "text", className: "form-input", value: form.againstInvoice, onChange: e => updateField('againstInvoice', e.target.value), placeholder: "e.g. INV/2025-26/0001" })),
                    h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                        h("label", { className: "form-label" }, "Note (optional)"),
                        h("input", { type: "text", className: "form-input", value: form.note, onChange: e => updateField('note', e.target.value) }))),
                h("div", { className: "flex gap-2 justify-end mt-4" },
                    h("button", { className: "btn btn-secondary", onClick: closeForm }, "Cancel"),
                    h("button", { className: "btn btn-primary", onClick: handleSave }, "Save Receipt"))))),
        previewReceipt && (h("div", { style: { position: 'absolute', left: '-9999px' }, ref: receiptRef },
            h("div", { className: "receipt-box" },
                h("div", { className: "receipt-header" },
                    h("p", { className: "business-name" }, profile.businessName || 'Your Business'),
                    h("p", { className: "business-details" }, profile.address),
                    profile.gstin && h("p", { className: "business-details" },
                        "GSTIN: ",
                        profile.gstin),
                    h("h2", { className: "receipt-title" }, "PAYMENT RECEIPT")),
                h("div", { className: "receipt-row" },
                    h("span", { className: "receipt-label" }, "Receipt No:"),
                    h("span", { className: "receipt-value" }, previewReceipt.receiptNo)),
                h("div", { className: "receipt-row" },
                    h("span", { className: "receipt-label" }, "Date:"),
                    h("span", { className: "receipt-value" }, new Date(previewReceipt.date).toLocaleDateString('en-IN'))),
                h("div", { className: "receipt-row" },
                    h("span", { className: "receipt-label" }, "Received From:"),
                    h("span", { className: "receipt-value" }, previewReceipt.clientName)),
                previewReceipt.clientAddress && h("div", { className: "receipt-row" },
                    h("span", { className: "receipt-label" }, "Address:"),
                    h("span", { className: "receipt-value" }, previewReceipt.clientAddress)),
                h("div", { className: "receipt-row" },
                    h("span", { className: "receipt-label" }, "Payment Mode:"),
                    h("span", { className: "receipt-value" }, previewReceipt.paymentMode)),
                previewReceipt.referenceNo && h("div", { className: "receipt-row" },
                    h("span", { className: "receipt-label" }, "Reference No:"),
                    h("span", { className: "receipt-value" }, previewReceipt.referenceNo)),
                previewReceipt.againstInvoice && h("div", { className: "receipt-row" },
                    h("span", { className: "receipt-label" }, "Against Invoice:"),
                    h("span", { className: "receipt-value" }, previewReceipt.againstInvoice)),
                h("div", { className: "receipt-amount" }, formatCurrency(previewReceipt.amount)),
                h("p", { className: "receipt-words" }, numberToWords(previewReceipt.amount)),
                previewReceipt.note && h("p", { style: { fontSize: '0.85rem', color: '#64748b' } },
                    "Note: ",
                    previewReceipt.note),
                h("div", { className: "receipt-footer" },
                    h("div", { className: "receipt-sig" },
                        h("div", { className: "receipt-sig-line" }),
                        h("span", { className: "receipt-sig-label" }, "Received By")),
                    h("div", { className: "receipt-sig" },
                        h("div", { className: "receipt-sig-line" }),
                        h("span", { className: "receipt-sig-label" }, "Authorized Signatory")))))),
        h("div", { className: "glass-panel p-4 mb-6" },
            h("div", { className: "search-box", style: { maxWidth: '400px' } },
                h(Search, { size: 16, className: "search-icon" }),
                h("input", { type: "text", placeholder: "Search receipts...", value: search, onChange: e => setSearch(e.target.value), className: "search-input" }))),
        h("div", { className: "glass-panel" },
            h("div", { className: "table-header" },
                h("h3", null,
                    "Payment Receipts",
                    h(HelpButton, { title: "Payment Receipts", doc: "receipts#receipt-list", size: 16 }))),
            filtered.length === 0 ? (h("div", { className: "empty-state" },
                h(Receipt, { size: 48 }),
                h("p", null, receipts.length === 0 ? 'No receipts generated yet.' : 'No receipts match your search.'),
                receipts.length === 0 && h("button", { className: "btn btn-primary", onClick: openAdd },
                    h(Plus, { size: 18 }),
                    " Create Receipt"))) : (h("div", { className: "table-scroll" },
                h("table", { className: "data-table", style: { minWidth: '700px' } },
                    h("thead", null,
                        h("tr", null,
                            h("th", null, "Date"),
                            h("th", null, "Receipt No"),
                            h("th", null, "Client"),
                            h("th", null, "Against Invoice"),
                            h("th", { style: { textAlign: 'right' } }, "Amount"),
                            h("th", null, "Mode"),
                            h("th", { className: "col-center" }, "Actions"))),
                    h("tbody", null, filtered.map(rcp => (h("tr", { key: rcp.id },
                        h("td", { className: "text-muted" }, rcp.date ? new Date(rcp.date).toLocaleDateString('en-IN') : ''),
                        h("td", null,
                            h("span", { className: "invoice-badge" }, rcp.receiptNo)),
                        h("td", { className: "font-medium" }, rcp.clientName),
                        h("td", { className: "text-muted" }, rcp.againstInvoice || '-'),
                        h("td", { style: { textAlign: 'right' }, className: "font-bold" }, formatCurrency(rcp.amount)),
                        h("td", { className: "text-muted" }, rcp.paymentMode),
                        h("td", null,
                            h("div", { className: "table-actions" },
                                h("button", { className: "icon-btn icon-btn-blue", onClick: () => printReceipt(rcp), title: "Print" },
                                    h(Printer, { size: 15 })),
                                h("button", { className: "icon-btn", onClick: () => openEdit(rcp), title: "Edit" },
                                    h(Pencil, { size: 15 })),
                                h("button", { className: "icon-btn icon-btn-red", onClick: () => handleDelete(rcp.id), title: "Delete" },
                                    h(Trash2, { size: 15 }))))))))))))));
}
