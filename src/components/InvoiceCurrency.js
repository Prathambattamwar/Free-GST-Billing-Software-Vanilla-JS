import { h, Fragment } from '../vanilla/dom.js';
import { COUNTRIES, getCountriesForRegion, formatCurrency, parseLocalDate } from '../utils.js';
import HelpButton from './HelpButton.js';
// v1.10.83 - the invoice currency and exchange rate, where the amounts are
// typed (Invoice Details) and in Customize. Asked for: "if user has selected
// foreign and india both we should have option while creating invoice to
// change from inr to usd".
//
// The rate is kept on the invoice: GST returns and reports turn the invoice
// into rupees with it. The last rate used for a currency is only offered as a
// hint (placeholder), never filled in: rates change every day.
const symbolOf = (code) => COUNTRIES.find(c => c.currency === code)?.currencySymbol || code;
const optionLabel = (code) => { const s = symbolOf(code); return s === code ? code : `${s} ${code}`; };
export default function InvoiceCurrency({ options, baseCurrency, regionMode, invoiceDate, total, onCurrency, onRate, disabled, compact }) {
    const currency = options.currency || baseCurrency;
    const codes = [...new Set([baseCurrency, currency, ...getCountriesForRegion(regionMode).map(c => c.currency)])];
    const foreign = currency !== baseCurrency;
    const rate = Number(options.exchangeRate);
    const hasRate = isFinite(rate) && rate > 0;
    const lastRate = options.fxRates?.[currency];
    const dateText = invoiceDate ? parseLocalDate(invoiceDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'the invoice date';
    return (h("div", { className: "form-group full-width", "data-invoice-currency": true, style: { marginBottom: compact ? '0.75rem' : 0 } },
        h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
            h("div", { style: { flex: '0 1 150px', minWidth: 120 } },
                h("label", { className: "form-label", htmlFor: compact ? 'inv-currency-c' : 'inv-currency' },
                    "Currency ",
                    h(HelpButton, { title: "Invoice currency and exchange rate", doc: "invoices#currency", size: 14 })),
                h("select", { id: compact ? 'inv-currency-c' : 'inv-currency', className: "form-input", value: currency, disabled: disabled, onChange: (e) => onCurrency(e.target.value) }, codes.map(c => h("option", { key: c, value: c }, optionLabel(c))))),
            foreign && (h("div", { style: { flex: '1 1 180px', minWidth: 150 } },
                h("label", { className: "form-label", htmlFor: compact ? 'inv-rate-c' : 'inv-rate' },
                    "1 ",
                    currency,
                    " = ? ",
                    baseCurrency),
                h("input", { id: compact ? 'inv-rate-c' : 'inv-rate', type: "number", step: "any", min: "0", className: "form-input", value: options.exchangeRate || '', disabled: disabled, onChange: (e) => onRate(e.target.value), placeholder: lastRate ? `last used ${lastRate}` : 'e.g. 84.10' })))),
        foreign && (h("small", { style: { display: 'block', marginTop: '0.3rem', fontSize: '0.74rem', color: hasRate ? 'var(--text-muted)' : 'var(--warn-text, #b45309)', lineHeight: 1.5 } }, hasRate
            ? h(Fragment, null,
                "\u2248 ",
                h("strong", null, formatCurrency(Math.round((Number(total) || 0) * rate * 100) / 100, baseCurrency)),
                " in all, at the rate for ",
                dateText,
                ". GST returns and reports use this amount.")
            : h(Fragment, null,
                "\u26A0 Enter the rate for ",
                dateText,
                " (your bank's rate or the RBI reference rate). GST returns and reports need this invoice in ",
                baseCurrency,
                ".")))));
}
