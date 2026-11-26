import { h, Fragment } from '../vanilla/dom.js';
// v1.10.84 (maintainer, 7 Nov: "we should have some trash folder in the
// dashboard ... all tabs on top") - the Trash tab of the Invoices screen.
// Deleted invoices wait here 30 days (the server's purgeOldTrash removes them
// after that, counted from the day they were deleted: ERR-084).
import { RotateCcw, Trash2 } from '../vanilla/icons.js';
import { formatCurrency } from '../utils.js';
export const TRASH_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
// The same day format as the Invoices list (4/11/2026).
const day = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN') : '-'; };
export const daysLeft = (trashedAt, now = Date.now()) => {
    const t = Date.parse(trashedAt || '');
    if (!Number.isFinite(t))
        return TRASH_DAYS;
    return Math.max(0, TRASH_DAYS - Math.floor((now - t) / DAY));
};
export default function InvoiceTrash({ items, onRestore, onPurge, busy }) {
    if (!items.length) {
        return (h("div", { className: "empty-state" },
            h(Trash2, { size: 48 }),
            h("p", null,
                "The Trash is empty. Deleted invoices wait here for ",
                TRASH_DAYS,
                " days, then go for good.")));
    }
    return (h("div", { className: "table-scroll" },
        h("p", { className: "text-muted", style: { fontSize: '0.8rem', margin: '0.6rem 0 0.5rem', padding: '0 1.25rem' } },
            "Deleted invoices stay here ",
            TRASH_DAYS,
            " days, then they are removed for good. Restore puts one back in your invoices (and takes its stock out again)."),
        h("table", { className: "data-table invoice-table" },
            h("thead", null,
                h("tr", null,
                    h("th", { style: { paddingLeft: '1.25rem' } }, "Date"),
                    h("th", null, "Invoice No."),
                    h("th", null, "Client"),
                    h("th", null, "Amount"),
                    h("th", null, "Deleted on"),
                    h("th", null, "Days left"),
                    h("th", { className: "col-center col-sticky-actions" }, "Actions"))),
            h("tbody", null, items.map((b) => (h("tr", { key: b.id },
                h("td", { className: "text-muted", style: { paddingLeft: '1.25rem' } }, day(b.invoiceDate || b.data?.details?.invoiceDate)),
                h("td", { className: "font-medium" }, b.invoiceNumber || '-'),
                h("td", null, b.clientName || '-'),
                h("td", null, formatCurrency(b.totalAmount || 0, b.currency || 'INR')),
                h("td", { className: "text-muted" }, day(b._trashedAt)),
                h("td", null, daysLeft(b._trashedAt)),
                h("td", { className: "col-sticky-actions" },
                    h("div", { className: "table-actions", style: { justifyContent: 'center' } },
                        h("button", { type: "button", className: "btn btn-secondary", disabled: busy, onClick: () => onRestore(b), style: { fontSize: '0.75rem', padding: '0.3rem 0.6rem' }, title: "Put it back in your invoices" },
                            h(RotateCcw, { size: 13 }),
                            " Restore"),
                        h("button", { type: "button", className: "btn btn-secondary", disabled: busy, onClick: () => onPurge(b), style: { fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--danger)', borderColor: 'var(--danger)' }, title: "Delete it now, for good" },
                            h(Trash2, { size: 13 }),
                            " Delete forever"))))))))));
}
