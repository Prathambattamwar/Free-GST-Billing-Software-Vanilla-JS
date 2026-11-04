// v1.10.83 (#111) - e-invoicing screens: the per-invoice panel in the editor
// (download the JSON, paste the IRN back) and the list of problems / import
// results shown after a bulk export or an IRN import on the Dashboard.
import { useState, h, Fragment } from '../vanilla/dom.js';
import { FileText, X } from '../vanilla/icons.js';
import { buildEInvoice, einvoiceFromInput, downloadJson, einvoiceFileName } from '../utils/einvoice.js';
import HelpButton from './HelpButton.js';
const EINVOICE_PORTAL = 'https://einvoice1.gst.gov.in';
// rows: [{ invoiceNumber, errors: [] }]
export function EInvoiceReport({ title, intro, rows, onClose }) {
    return (h("div", { className: "modal-overlay", onClick: onClose },
        h("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-label": title },
            h("h3", { className: "section-title", style: { marginTop: 0 } },
                title,
                " ",
                h(HelpButton, { title: "E-invoice results", doc: "gst-returns#e-invoice-report", size: 16, style: { marginLeft: 6 } })),
            intro && h("p", { style: { fontSize: '0.85rem', marginTop: 0 } }, intro),
            h("ul", { style: { paddingLeft: '1.1rem', fontSize: '0.84rem', lineHeight: 1.5 } }, rows.map((r, i) => (h("li", { key: `${r.invoiceNumber}-${i}`, style: { marginBottom: '0.5rem' } },
                h("strong", null, r.invoiceNumber),
                h("ul", { style: { paddingLeft: '1rem', margin: '0.15rem 0 0' } }, r.errors.map((e) => h("li", { key: e }, e))))))),
            h("div", { style: { display: 'flex', justifyContent: 'flex-end' } },
                h("button", { type: "button", className: "btn btn-primary", onClick: onClose }, "OK")))));
}
// bill: the invoice as it is on screen; saved: it has been saved under its
// final number; onSaveIrn(einvoice | null) stores or removes the IRN.
export function EInvoiceEditorModal({ bill, profile, bills, saved, onSaveIrn, onClose }) {
    const current = bill.einvoice || {};
    const [form, setForm] = useState({ irn: current.irn || '', ackNo: current.ackNo || '', ackDate: current.ackDate || '', signedQr: current.signedQr || '' });
    const [formErrors, setFormErrors] = useState([]);
    const [busy, setBusy] = useState(false);
    const { doc, errors } = buildEInvoice(bill, { profile, bills });
    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
    const save = async (value) => {
        setBusy(true);
        try {
            if (await onSaveIrn(value))
                onClose();
        }
        finally {
            setBusy(false);
        }
    };
    const submit = () => {
        const { einvoice, errors: errs } = einvoiceFromInput(form);
        setFormErrors(errs);
        if (einvoice)
            save(einvoice);
    };
    return (h("div", { className: "modal-overlay", onClick: onClose },
        h("div", { className: "modal-content", onClick: (e) => e.stopPropagation(), role: "dialog", "aria-label": "E-invoice", style: { maxWidth: 620 } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h("h3", { className: "section-title", style: { margin: 0 } },
                    "E-invoice (IRN) ",
                    h(HelpButton, { title: "E-invoice (IRN) window", doc: "gst-returns#e-invoice-dialog", size: 16, style: { marginLeft: 6 } })),
                h("button", { type: "button", className: "icon-btn", onClick: onClose, "aria-label": "Close" },
                    h(X, { size: 16 }))),
            h("ol", { style: { paddingLeft: '1.2rem', fontSize: '0.84rem', lineHeight: 1.55 } },
                h("li", null, "Download the e-invoice JSON."),
                h("li", null,
                    "Upload it on ",
                    h("a", { href: EINVOICE_PORTAL, target: "_blank", rel: "noreferrer" }, "einvoice1.gst.gov.in"),
                    " (e-Invoice \u2192 Bulk Upload)."),
                h("li", null,
                    "Paste the IRN, Ack No, Ack Date and Signed QR Code the portal gives back, and click ",
                    h("strong", null, "Save IRN"),
                    ". They then print on the invoice with a QR code.")),
            !saved ? (h("div", { className: "notice notice-warn", style: { fontSize: '0.84rem' } }, "Save the invoice first, so its number is final.")) : current.irn ? (h("div", { className: "notice notice-info", style: { fontSize: '0.84rem' } }, "This invoice has its IRN. It prints at the top of the invoice with the QR code.")) : errors.length > 0 ? (h("div", { className: "notice notice-danger", style: { fontSize: '0.84rem', display: 'block' } },
                h("strong", null, "Fix these first:"),
                h("ul", { style: { paddingLeft: '1.1rem', margin: '0.3rem 0 0' } }, errors.map((e) => h("li", { key: e }, e))))) : null,
            h("button", { type: "button", className: "btn btn-secondary", disabled: !saved || !doc, onClick: () => downloadJson(einvoiceFileName(bill.invoiceNumber), [doc]), style: { margin: '0.75rem 0 1rem' } },
                h(FileText, { size: 16 }),
                " Download e-invoice JSON"),
            h("div", { style: { display: 'grid', gap: '0.6rem' } },
                h("label", { className: "form-group", style: { margin: 0 } },
                    h("span", { className: "form-label" }, "IRN"),
                    h("input", { className: "form-input", value: form.irn, onChange: set('irn'), placeholder: "64 letters and digits", spellCheck: false })),
                h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' } },
                    h("label", { className: "form-group", style: { margin: 0 } },
                        h("span", { className: "form-label" }, "Ack No"),
                        h("input", { className: "form-input", value: form.ackNo, onChange: set('ackNo'), inputMode: "numeric" })),
                    h("label", { className: "form-group", style: { margin: 0 } },
                        h("span", { className: "form-label" }, "Ack Date"),
                        h("input", { className: "form-input", value: form.ackDate, onChange: set('ackDate'), placeholder: "as the portal shows it" }))),
                h("label", { className: "form-group", style: { margin: 0 } },
                    h("span", { className: "form-label" }, "Signed QR Code"),
                    h("textarea", { className: "form-input", rows: 4, value: form.signedQr, onChange: set('signedQr'), spellCheck: false, placeholder: "The long text that starts with eyJ", style: { fontFamily: 'monospace', fontSize: '0.75rem' } }))),
            formErrors.length > 0 && (h("ul", { className: "notice notice-danger", style: { fontSize: '0.84rem', display: 'block', paddingLeft: '1.8rem', marginTop: '0.75rem' } }, formErrors.map((e) => h("li", { key: e }, e)))),
            h("div", { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem', flexWrap: 'wrap' } },
                current.irn && (h("button", { type: "button", className: "btn btn-secondary", disabled: busy, onClick: () => save(null), style: { color: 'var(--danger)', borderColor: 'var(--danger)', marginRight: 'auto' } }, "Remove IRN")),
                h("button", { type: "button", className: "btn btn-secondary", onClick: onClose }, "Close"),
                h("button", { type: "button", className: "btn btn-primary", disabled: !saved || busy, onClick: submit }, "Save IRN")))));
}
