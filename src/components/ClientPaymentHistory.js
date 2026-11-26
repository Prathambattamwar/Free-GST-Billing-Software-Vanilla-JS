import { h, Fragment } from '../vanilla/dom.js';
import { useState } from '../vanilla/dom.js';
import { ChevronDown, ChevronUp } from '../vanilla/icons.js';
import { formatCurrency, parseLocalDate } from '../utils.js';
import HelpButton from './HelpButton.js';
// v1.10.85 (#157) - a client's payments on their page: date, invoice, amount,
// mode and note, newest first (rows from clientPaymentHistory). Closed until
// clicked, so the client's page stays as it was.
export default function ClientPaymentHistory({ rows }) {
    const [open, setOpen] = useState(false);
    if (!rows.length)
        return null;
    const date = (d) => (d ? parseLocalDate(d).toLocaleDateString('en-IN') : '-');
    return (h("div", { style: { borderTop: '1px solid var(--border)' } },
        h("div", { style: { padding: '0.5rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem' } },
            h("button", { type: "button", className: "btn-link", onClick: () => setOpen(!open), "aria-expanded": open, style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' } },
                "Payment history (",
                rows.length,
                ") ",
                open ? h(ChevronUp, { size: 14 }) : h(ChevronDown, { size: 14 })),
            h(HelpButton, { title: "Payment history", doc: "clients#payment-history", size: 14 })),
        open && (h("div", { className: "table-scroll" },
            h("table", { className: "data-table", style: { marginBottom: 0 }, "aria-label": "Payment history" },
                h("thead", null,
                    h("tr", null,
                        h("th", null, "Date"),
                        h("th", null, "Invoice No."),
                        h("th", { style: { textAlign: 'right' } }, "Amount"),
                        h("th", null, "Mode"),
                        h("th", null, "Note"))),
                h("tbody", null, rows.map((r) => (h("tr", { key: r.key },
                    h("td", { className: "text-muted" }, date(r.date)),
                    h("td", null, r.invoiceNumber ? h("span", { className: "invoice-badge" }, r.invoiceNumber) : h("span", { className: "text-muted" }, r.receiptNo ? `Receipt ${r.receiptNo}` : 'Advance')),
                    h("td", { className: "font-bold", style: { textAlign: 'right', color: '#059669' } }, formatCurrency(r.amount, r.currency)),
                    h("td", null, r.mode || '-'),
                    h("td", { className: "text-muted" }, r.note || ''))))))))));
}
