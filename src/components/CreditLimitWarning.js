import { h, Fragment } from '../vanilla/dom.js';
import { useMemo, useState, useEffect } from '../vanilla/dom.js';
import { AlertTriangle } from '../vanilla/icons.js';
import { formatCurrency, SALES_INVOICE_TYPES } from '../utils.js';
import { clientAccount, creditLimitCheck, thisInvoiceDue, missingRateNote, openingOf, openingDue } from '../utils/clientLedger.js';
import { getAllReceipts } from '../store.js';
import { baseCurrencyOf } from '../utils/fx.js';
import HelpButton from './HelpButton.js';
// v1.10.85 - New Invoice: a warning (never a block) when what the client
// already owes this business plus what is still due on this invoice goes over
// their credit limit (Client form -> Credit limit). Nothing shows for a client
// without a limit, or for a quotation, challan or credit note.
// `paid`: already paid on the invoice being edited; `creditApplied`: the
// client credit being used on it. Amounts in another currency are converted at
// each invoice's saved exchange rate; one without a rate is left out and named.
export default function CreditLimitWarning({ savedClient, bills, profile, excludeId, invoiceType, totals, currency, exchangeRate, paid = 0, creditApplied = 0 }) {
    const limit = Number(savedClient?.creditLimit) || 0;
    const isSale = SALES_INVOICE_TYPES.includes(invoiceType || 'tax-invoice');
    const name = savedClient?.name || '';
    // v1.10.86 (#214) - their opening balance counts too, less what they paid
    // against it (receipts on no invoice), so the receipts are read when needed.
    const hasOpening = limit > 0 && isSale && openingOf(savedClient, profile) > 0;
    const [receipts, setReceipts] = useState([]);
    useEffect(() => {
        if (hasOpening)
            getAllReceipts().then((r) => setReceipts(r || [])).catch(() => { });
    }, [hasOpening]);
    const account = useMemo(() => (limit > 0 && isSale ? clientAccount(name, bills, profile, excludeId, openingDue(savedClient, bills, receipts, profile).due) : null), [limit, isSale, name, bills, profile, excludeId, savedClient, receipts]);
    if (!account)
        return null;
    const thisOne = thisInvoiceDue({ totals, currency, exchangeRate, paid, creditApplied }, profile);
    const check = creditLimitCheck(limit, account.owed, thisOne.amount);
    if (!check.over)
        return null;
    const fmt = (n) => formatCurrency(n, baseCurrencyOf(profile));
    const leftOut = missingRateNote([...account.missing, ...(thisOne.missing ? [thisOne.missing] : [])]);
    return (h("div", { className: "notice notice-warn", role: "alert", "data-testid": "credit-limit-warning", style: { marginTop: '0.75rem', fontSize: '0.82rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' } },
        h(AlertTriangle, { size: 16, style: { flexShrink: 0, marginTop: 2 } }),
        h("div", null,
            h("strong", null,
                "Over the credit limit by ",
                fmt(check.by),
                "."),
            ' ',
            name,
            " owes ",
            fmt(account.owed),
            "; with this invoice it is ",
            fmt(check.after),
            ", and their limit is ",
            fmt(limit),
            ".",
            ' ',
            "You can still save it. ",
            h(HelpButton, { title: "Credit limit", doc: "clients#credit-limit", size: 14 }),
            leftOut && h("div", { style: { fontSize: '0.75rem', marginTop: 2 } },
                "(",
                leftOut,
                ".)"))));
}
