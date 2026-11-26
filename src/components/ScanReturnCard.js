import { h, Fragment } from '../vanilla/dom.js';
import { Eye, Undo2, PackageCheck } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
import { formatCurrency, formatShortDate } from '../utils.js';
// v1.10.86 (#197) - the one invoice a scanned return label (order ID, AWB or
// invoice number, matched exactly by findScannedInvoice) belongs to, above the
// Dashboard list: Open it, or make its credit note. When a credit note against
// it is already made, that is said instead, with Open.
export default function ScanReturnCard({ found, onOpen, onReturn }) {
    const { bill, creditNotes } = found;
    const d = bill.data?.details || {};
    const codes = [d.buyerOrderNo && `Order ${d.buyerOrderNo}`, d.dispatchDocNo && `AWB ${d.dispatchDocNo}`].filter(Boolean).join(' · ');
    const cn = creditNotes[0];
    return (h("div", { className: "scan-return-card", role: "status", "aria-live": "polite" },
        h(PackageCheck, { size: 20, className: "scan-return-icon", "aria-hidden": "true" }),
        h("div", { className: "scan-return-info" },
            h("div", { className: "scan-return-title" },
                h("strong", null, bill.invoiceNumber),
                h("span", null, formatShortDate(bill.invoiceDate)),
                h("span", null, bill.clientName),
                h("strong", null, formatCurrency(Number(bill.totalAmount) || 0, bill.currency || 'INR')),
                h(HelpButton, { title: "Scan a return", doc: "dashboard#scan-a-return", size: 14 })),
            codes && h("div", { className: "scan-return-codes" }, codes),
            cn && h("div", { className: "scan-return-done" },
                "Credit note ",
                cn.invoiceNumber,
                " already made",
                creditNotes.length > 1 ? ` (and ${creditNotes.length - 1} more)` : '',
                ".")),
        h("div", { className: "scan-return-actions" },
            h("button", { type: "button", className: "btn btn-secondary", onClick: () => onOpen(bill) },
                h(Eye, { size: 14 }),
                " Open"),
            cn
                ? h("button", { type: "button", className: "btn btn-secondary", onClick: () => onOpen(cn) },
                    h(Eye, { size: 14 }),
                    " Open ",
                    cn.invoiceNumber)
                : h("button", { type: "button", className: "btn btn-primary", onClick: () => onReturn(bill) },
                    h(Undo2, { size: 14 }),
                    " Return / credit note"))));
}
