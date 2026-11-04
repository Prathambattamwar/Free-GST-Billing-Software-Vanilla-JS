import { h, Fragment } from '../vanilla/dom.js';
// v1.10.73 - two ruled-box invoice designs, built from real invoices users
// asked for:
//   "boxed" - every section in ruled boxes, the item table filled with empty
//             rows to a fixed height (like a printed quotation pad).
//   "tally" - the Tally layout Indian businesses and their clients know:
//             reference and dispatch boxes, taxes inside the item table,
//             HSN/SAC tax summary, tax amount in words, declaration, and a
//             "Customer's Seal and Signature" box.
//
// All numbers come from the caller (InvoicePreview), which computes them the
// same way for every design, so a total can never differ between designs.
//
// PDF page breaks: buildPDF only ends a page on an element edge it knows about.
// Every block and every table row here carries data-pdf-page-boundary, so a
// page can end between rows or blocks but never cuts through one.
import { filledOrderDetails, getStateCode, printedSubtotal, roundQty } from '../utils.js';
import SignatureImages from './SignatureImages.js';
import { purposeCodeText } from '../utils/purposeCodes.js';
const LINE = '#1f2937';
const B = `1px solid ${LINE}`;
const cell = { border: B, padding: '4px 6px', verticalAlign: 'top' };
const th = { ...cell, fontWeight: 700, textAlign: 'center', background: '#f3f4f6' };
const right = { textAlign: 'right', whiteSpace: 'nowrap' };
const center = { textAlign: 'center' };
const small = { fontSize: '0.92em', color: '#374151' };
const label = { fontWeight: 700 };
const blockProps = { 'data-pdf-page-boundary': '' };
// Tally item-table cell: column lines on both sides, none between rows.
const vc = { padding: '3px 6px', borderLeft: B, borderRight: B, verticalAlign: 'top' };
const blank = (n, height) => Array.from({ length: Math.max(0, n) }, (_, i) => h("td", { key: `b${i}`, style: { ...vc, ...(height ? { height } : {}) } }));
const num = (n) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const stateWithCode = (state) => {
    if (!state)
        return '';
    const code = getStateCode(state);
    return code ? `${state}, Code : ${code}` : state;
};
function Signature({ ctx, align = 'right' }) {
    const { sig } = ctx;
    return (h("div", { ...blockProps, "data-pdf-signature": "", style: { textAlign: align, minHeight: 90, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' } },
        h("div", { style: { fontWeight: 700 } },
            "for ",
            ctx.profile?.businessName || 'Your Business'),
        sig.show && (h("div", { style: { margin: '4px 0' } },
            h(SignatureImages, { sigImg: sig.sigImg, stampImg: sig.stampImg, sigHeight: sig.sigHeight, stampHeight: sig.stampHeight, layout: sig.layout, align: align, gap: 6, sigMaxWidth: 160, stampMaxWidth: 110, spaceBelow: 0 }))),
        ctx.showSignatoryText && h("div", null, "Authorised Signatory")));
}
function RichBlock({ title, html, className = '' }) {
    if (!html)
        return null;
    return (h("div", { ...blockProps, style: { marginBottom: 4 } },
        h("div", { style: label }, title),
        h("div", { className: `inv-rich ${className}`, style: small, dangerouslySetInnerHTML: { __html: html } })));
}
// Tax rows shown under the items (Tally) or beside the bank block (Boxed).
function taxRows(ctx) {
    const { totals, isIndia, isInterstate, showGST, taxLabel, singleRate, options } = ctx;
    const rows = [];
    const pct = singleRate != null ? ` (${singleRate}%)` : '';
    const halfPct = singleRate != null ? ` (${singleRate / 2}%)` : '';
    if (showGST) {
        if (isIndia && isInterstate)
            rows.push(['IGST' + pct, totals.igst]);
        else if (isIndia) {
            rows.push(['CGST' + halfPct, totals.cgst]);
            rows.push([(totals.isIntraUT ? 'UTGST' : 'SGST') + halfPct, (totals.sgst || 0) + (totals.utgst || 0)]);
        }
        else
            rows.push([taxLabel, (totals.cgst || 0) + (totals.sgst || 0) + (totals.igst || 0)]);
    }
    if (totals.cess > 0)
        rows.push(['Cess', totals.cess]);
    if (totals.tcsAmount > 0)
        rows.push([`TCS${options.tcsSection ? ` (${options.tcsSection} @ ${options.tcsRate}%)` : ''}`, totals.tcsAmount]);
    if (totals.invoiceDiscountAmount > 0)
        rows.push(['Less : Discount on total', -totals.invoiceDiscountAmount]);
    if (totals.roundOff)
        rows.push([totals.roundOff < 0 ? 'Less : Round Off' : 'Round Off', totals.roundOff]);
    return rows;
}
export function HsnSummaryTable({ ctx }) {
    const { hsnRows, isIndia, isInterstate, taxLabel, totals } = ctx;
    if (!hsnRows.length)
        return null;
    const sum = (k) => hsnRows.reduce((s, r) => s + r[k], 0);
    const intra = isIndia && !isInterstate;
    const sgstName = totals.isIntraUT ? 'UTGST' : 'SGST/UTGST';
    return (h("table", { className: "inv-hsn-summary", style: { width: '100%', borderCollapse: 'collapse', marginTop: -1 } },
        h("thead", null,
            h("tr", { ...blockProps },
                h("th", { style: th, rowSpan: 2 }, "HSN/SAC"),
                h("th", { style: th, rowSpan: 2 }, "Taxable Value"),
                intra ? (h(Fragment, null,
                    h("th", { style: th, colSpan: 2 }, "CGST"),
                    h("th", { style: th, colSpan: 2 }, sgstName)))
                    : h("th", { style: th, colSpan: 2 }, isIndia ? 'IGST' : taxLabel),
                h("th", { style: th, rowSpan: 2 }, "Total Tax Amount")),
            h("tr", { ...blockProps },
                h("th", { style: th }, "Rate"),
                h("th", { style: th }, "Amount"),
                intra && (h(Fragment, null,
                    h("th", { style: th }, "Rate"),
                    h("th", { style: th }, "Amount"))))),
        h("tbody", null,
            hsnRows.map((r) => (h("tr", { key: `${r.hsn}|${r.rate}`, ...blockProps },
                h("td", { style: cell }, r.hsn || '-'),
                h("td", { style: { ...cell, ...right } }, num(r.taxable)),
                intra ? (h(Fragment, null,
                    h("td", { style: { ...cell, ...center } },
                        r.rate / 2,
                        "%"),
                    h("td", { style: { ...cell, ...right } }, num(r.tax / 2)),
                    h("td", { style: { ...cell, ...center } },
                        r.rate / 2,
                        "%"),
                    h("td", { style: { ...cell, ...right } }, num(r.tax / 2)))) : (h(Fragment, null,
                    h("td", { style: { ...cell, ...center } },
                        r.rate,
                        "%"),
                    h("td", { style: { ...cell, ...right } }, num(r.tax)))),
                h("td", { style: { ...cell, ...right } }, num(r.tax))))),
            h("tr", { ...blockProps, style: { fontWeight: 700 } },
                h("td", { style: { ...cell, ...right } }, "Total"),
                h("td", { style: { ...cell, ...right } }, num(sum('taxable'))),
                intra ? (h(Fragment, null,
                    h("td", { style: cell }),
                    h("td", { style: { ...cell, ...right } }, num(sum('tax') / 2)),
                    h("td", { style: cell }),
                    h("td", { style: { ...cell, ...right } }, num(sum('tax') / 2)))) : (h(Fragment, null,
                    h("td", { style: cell }),
                    h("td", { style: { ...cell, ...right } }, num(sum('tax'))))),
                h("td", { style: { ...cell, ...right } }, num(sum('tax')))))));
}
function BankLines({ ctx, tally }) {
    const { account, profile, sellerCC } = ctx;
    if (!ctx.showBankDetails || !(account?.bankName || profile?.bankName))
        return null;
    const rows = [
        ['Bank Name', account?.bankName || profile.bankName],
        ['Account Name', account?.accountHolderName || profile?.businessName],
        ['A/c No.', account?.accountNumber || profile.accountNumber],
        [tally ? `Branch & ${sellerCC.bankLabel || 'IFS Code'}` : (sellerCC.bankLabel || 'IFSC'), [account?.branch, account?.ifsc || profile.ifsc].filter(Boolean).join(' & ')],
        ['SWIFT', account?.swift || profile.swift],
        ['IBAN', account?.iban],
        ['Purpose code', ctx.purposeCode && purposeCodeText(ctx.purposeCode)],
    ].filter(([, v]) => v);
    return (h("div", { ...blockProps },
        h("div", { style: label }, tally ? "Company's Bank Details" : 'Bank Details'),
        h("table", { style: { borderCollapse: 'collapse' } },
            h("tbody", null, rows.map(([k, v]) => (h("tr", { key: k },
                h("td", { style: { paddingRight: 8, whiteSpace: 'nowrap' } }, k),
                h("td", null,
                    ": ",
                    h("strong", null, v)))))))));
}
function UpiQr({ ctx }) {
    // v1.10.83 - an invoice in a foreign currency has no UPI QR; its online
    // payment link (PayPal, Wise...) takes the place.
    if (ctx.paymentLink)
        return h("div", { ...blockProps, style: { marginTop: 6 } },
            h("div", { style: label }, "Pay online"),
            h("div", { style: { wordBreak: 'break-all' } }, ctx.paymentLink));
    if (!ctx.qrDataUrl)
        return null;
    return (h("div", { ...blockProps, style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
        h("img", { src: ctx.qrDataUrl, alt: "UPI QR", style: { width: 72, height: 72 } }),
        h("div", { style: small },
            "Scan to pay (UPI)",
            h("br", null),
            h("strong", null, ctx.upiId))));
}
function SellerBlock({ ctx, tally }) {
    const { profile, t, sellerCC } = ctx;
    return (h("div", null,
        t.logo && profile?.logo && !tally && (h("img", { src: profile.logo, alt: "Logo", style: { maxHeight: `${profile.logoHeight || 48}px`, maxWidth: 160, objectFit: 'contain', marginBottom: 4 } })),
        t.businessName && h("div", { style: { fontWeight: 800, fontSize: '1.05em' } }, profile?.businessName || 'Your Business'),
        t.businessAddress && profile?.address && h("div", { style: { whiteSpace: 'pre-line' } }, profile.address),
        t.businessAddress && (profile?.city || profile?.pin) && h("div", null, [profile.city, profile.pin].filter(Boolean).join(' - ')),
        t.gstin && profile?.gstin && h("div", null,
            sellerCC.taxIdLabel || 'GSTIN',
            tally ? '/UIN' : '',
            ": ",
            h("strong", null, profile.gstin)),
        t.state && profile?.state && h("div", null,
            "State Name : ",
            stateWithCode(profile.state)),
        (t.businessPhone && profile?.phone) || (profile?.pan && ctx.isIndia) ? (h("div", null, [t.businessPhone && profile?.phone ? `Mobile: ${profile.phone}` : '', profile?.pan && ctx.isIndia ? `PAN: ${profile.pan}` : ''].filter(Boolean).join(' | '))) : null,
        t.businessEmail && profile?.email && h("div", null,
            "E-Mail : ",
            profile.email)));
}
function PartyBlock({ ctx, heading, party, withContact }) {
    const { t, sellerCC } = ctx;
    return (h("div", null,
        h("div", { style: label }, heading),
        h("div", { style: { fontWeight: 800 } }, party.name || 'Client Name'),
        t.clientAddress && party.address && h("div", { style: { whiteSpace: 'pre-line' } }, party.address),
        t.clientAddress && (party.city || party.pin) && h("div", null, [party.city, party.pin].filter(Boolean).join(' - ')),
        withContact && t.clientAddress && ctx.clientAbroad && h("div", null, ctx.clientCountry),
        t.gstin && party.gstin && h("div", null,
            withContact && ctx.clientAbroad ? ctx.clientTaxIdLabel : `${sellerCC.taxIdLabel || 'GSTIN'}/UIN`,
            " : ",
            h("strong", null, party.gstin)),
        t.state && party.state && h("div", null,
            "State Name : ",
            stateWithCode(party.state)),
        withContact && t.clientPhone && party.phone && h("div", null,
            "Ph: ",
            party.phone),
        withContact && t.clientEmail && party.email && h("div", null,
            "E-Mail : ",
            party.email)));
}
// ---------------------------------------------------------------------------
// TALLY STYLE
// ---------------------------------------------------------------------------
function TallyLayout({ ctx }) {
    const { details, client, items, totals, fmt, lineCalc, t, invoiceTitle } = ctx;
    const orderMap = Object.fromEntries(filledOrderDetails(details).map((f) => [f.key, f.value]));
    const shipTo = ctx.shipTo;
    const refBoxes = [
        ['Invoice No.', h("strong", { key: "n" }, details?.invoiceNumber), 'Dated', h("strong", { key: "d" }, ctx.shortDate(details?.invoiceDate))],
        ['Delivery Note', orderMap.deliveryNote, 'Mode/Terms of Payment', orderMap.paymentTerms],
        ['Reference No. & Date.', orderMap.referenceNo, 'Other References', orderMap.otherReferences],
        ["Buyer's Order No.", orderMap.buyerOrderNo, 'Dated', orderMap.buyerOrderDate],
        ['Dispatch Doc No.', orderMap.dispatchDocNo, 'Delivery Note Date', orderMap.deliveryNoteDate],
        ['Dispatched through', orderMap.dispatchedThrough, 'Destination', orderMap.destination],
    ];
    const extraRef = [
        orderMap.vehicleNo && ['Vehicle No.', orderMap.vehicleNo],
        orderMap.revisionNo && ['Revision No.', orderMap.revisionNo],
        (orderMap.periodFrom || orderMap.periodTo) && ['Service Period', [orderMap.periodFrom, orderMap.periodTo].filter(Boolean).join(' to ')],
        t.dueDate && details?.dueDate && ['Due Date', ctx.shortDate(details.dueDate)],
        ctx.showReverseChargeLine && ['Reverse Charge', ctx.reverseChargeText],
        t.placeOfSupply && ctx.placeOfSupply && ['Place of Supply', stateWithCode(ctx.placeOfSupply)],
    ].filter(Boolean);
    const refCell = (k, v) => (h("td", { style: { ...cell, width: '25%', height: 34 } },
        h("div", { style: small }, k),
        h("div", null, v || '')));
    const rows = taxRows(ctx);
    const units = [...new Set(items.map((i) => i.unit || ''))];
    const totalQty = roundQty(items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)); // #96: 0.1 + 0.2 printed as 0.30000000000000004
    const showQtyTotal = units.length === 1 && t.itemQty;
    // Sl No + Description + Amount, plus the optional columns.
    // v1.10.83 - the "per" (unit) column goes with the unit option.
    const perCol = t.rate && t.itemUnit;
    const colCount = 3 + (t.hsn ? 1 : 0) + (t.itemQty ? 1 : 0) + (t.rate ? 1 : 0) + (perCol ? 1 : 0) + (ctx.hasAnyDiscount ? 1 : 0);
    const spacer = Math.max(0, 260 - items.length * 26 - rows.length * 20);
    return (h("div", { className: "grid-inv grid-inv-tally", style: { padding: '7mm 8mm', color: '#111827', fontSize: '0.78rem', lineHeight: 1.35 } },
        h("div", { ...blockProps, style: { textAlign: 'center', fontWeight: 800, fontSize: '1.15rem', marginBottom: 4 } }, invoiceTitle),
        h("table", { style: { width: '100%', borderCollapse: 'collapse' } },
            h("tbody", null,
                h("tr", { ...blockProps },
                    h("td", { style: { ...cell, width: '50%' }, rowSpan: 4 },
                        h(SellerBlock, { ctx: ctx, tally: true })),
                    refCell(...refBoxes[0].slice(0, 2)),
                    refCell(...refBoxes[0].slice(2))),
                refBoxes.slice(1, 4).map((r) => (h("tr", { key: r[0], ...blockProps },
                    refCell(r[0], r[1]),
                    refCell(r[2], r[3])))),
                h("tr", { ...blockProps },
                    h("td", { style: cell, rowSpan: 3 + (extraRef.length ? 1 : 0) },
                        shipTo && h(Fragment, null,
                            h(PartyBlock, { ctx: ctx, heading: "Consignee (Ship to)", party: shipTo }),
                            h("div", { style: { height: 6 } })),
                        h(PartyBlock, { ctx: ctx, heading: "Buyer (Bill to)", party: client, withContact: true })),
                    refCell(refBoxes[4][0], refBoxes[4][1]),
                    refCell(refBoxes[4][2], refBoxes[4][3])),
                h("tr", { ...blockProps },
                    refCell(refBoxes[5][0], refBoxes[5][1]),
                    refCell(refBoxes[5][2], refBoxes[5][3])),
                extraRef.length > 0 && (h("tr", { ...blockProps },
                    h("td", { style: cell, colSpan: 2 }, extraRef.map(([k, v]) => h("div", { key: k },
                        h("span", { style: small },
                            k,
                            ": "),
                        h("strong", null, v)))))),
                h("tr", { ...blockProps },
                    h("td", { style: { ...cell, height: 48 }, colSpan: 2 },
                        h("div", { style: small }, "Terms of Delivery"),
                        h("div", null, orderMap.deliveryTerms || ''))))),
        orderMap.workDetails && (h("div", { ...blockProps, style: { ...cell, borderTop: 'none' } },
            h("span", { style: label }, "Work Details: "),
            orderMap.workDetails)),
        h("table", { className: "inv-table grid-items", style: { width: '100%', borderCollapse: 'collapse', margin: '-1px 0 0' } },
            h("thead", null,
                h("tr", null,
                    h("th", { style: { ...th, width: 28 } }, "Sl No."),
                    h("th", { style: th },
                        "Description of ",
                        ctx.isServices ? 'Services' : 'Goods'),
                    t.hsn && h("th", { style: th }, ctx.isServices ? 'SAC' : 'HSN/SAC'),
                    t.itemQty && h("th", { style: th }, "Quantity"),
                    t.rate && h("th", { style: th }, "Rate"),
                    perCol && h("th", { style: th }, "per"),
                    ctx.hasAnyDiscount && h("th", { style: th }, "Disc."),
                    h("th", { style: th }, "Amount"))),
            h("tbody", null,
                items.map((item, i) => {
                    const l = lineCalc(item);
                    return (h("tr", { key: item.id || i },
                        h("td", { style: { ...vc, ...center } }, i + 1),
                        h("td", { style: vc },
                            h("strong", null, item.name || '-'),
                            item.description && h("div", { style: { ...small, whiteSpace: 'pre-wrap' } }, item.description)),
                        t.hsn && h("td", { style: { ...vc, ...center } }, item.hsn || ''),
                        t.itemQty && h("td", { style: { ...vc, ...right } },
                            h("strong", null,
                                item.quantity,
                                t.itemUnit && item.unit ? ` ${item.unit}` : '')),
                        t.rate && h("td", { style: { ...vc, ...right } }, num(item.rate)),
                        perCol && h("td", { style: { ...vc, ...center } }, item.unit || ''),
                        ctx.hasAnyDiscount && h("td", { style: { ...vc, ...right } }, l.discount > 0 ? num(l.discount) : ''),
                        h("td", { style: { ...vc, ...right } },
                            h("strong", null, num(l.taxable)))));
                }),
                h("tr", null,
                    h("td", { style: vc }),
                    h("td", { style: vc }),
                    blank(colCount - 3),
                    h("td", { style: { ...vc, ...right, borderTop: B } }, num(printedSubtotal(totals) - (totals.totalDiscount || 0)))),
                rows.map(([k, v]) => (h("tr", { key: k },
                    h("td", { style: vc }),
                    h("td", { style: { ...vc, ...right, fontStyle: 'italic', fontWeight: 700 } }, k),
                    blank(colCount - 3),
                    h("td", { style: { ...vc, ...right, fontWeight: 700 } }, v < 0 ? `(-)${num(-v)}` : num(v))))),
                spacer > 0 && (h("tr", { "data-pdf-spacer": "stretch" }, blank(colCount, spacer))),
                h("tr", { style: { fontWeight: 800 } },
                    h("td", { style: cell }),
                    h("td", { style: { ...cell, ...right } }, "Total"),
                    t.hsn && h("td", { style: cell }),
                    t.itemQty && h("td", { style: { ...cell, ...right } }, showQtyTotal ? `${totalQty}${t.itemUnit && units[0] ? ` ${units[0]}` : ''}` : ''),
                    t.rate && h("td", { style: cell }),
                    perCol && h("td", { style: cell }),
                    ctx.hasAnyDiscount && h("td", { style: cell }),
                    h("td", { style: { ...cell, ...right, fontSize: '1.08em' } }, fmt(totals.total))))),
        h("div", { ...blockProps, style: { ...cell, borderTop: 'none', display: 'flex', justifyContent: 'space-between', gap: 8 } },
            h("div", null, ctx.showAmountWords && (h(Fragment, null,
                h("div", { style: small }, "Amount Chargeable (in words)"),
                h("div", { style: { fontWeight: 800 } }, ctx.words(totals.total))))),
            h("div", { style: { fontStyle: 'italic', whiteSpace: 'nowrap' } }, "E. & O.E")),
        totals.tdsAmount > 0 && (h("div", { ...blockProps, style: { ...cell, borderTop: 'none', ...small } },
            "Less: TDS",
            ctx.options.tdsSection ? ` (${ctx.options.tdsSection} @ ${ctx.options.tdsRate}%)` : '',
            " ",
            fmt(totals.tdsAmount),
            " \u00B7 Net Receivable ",
            h("strong", null, fmt(totals.netReceivable)))),
        ctx.showHsnSummary && h(HsnSummaryTable, { ctx: ctx }),
        ctx.showTaxInWords && ctx.totalTax > 0 && (h("div", { ...blockProps, style: { ...cell, borderTop: 'none' } },
            "Tax Amount (in words) : ",
            h("strong", null, ctx.words(ctx.totalTax)))),
        h("div", { style: { border: B, borderTop: 'none', display: 'grid', gridTemplateColumns: '1fr 1fr' } },
            h("div", { style: { padding: '4px 6px', borderRight: B } },
                ctx.notices,
                ctx.isIndia && ctx.profile?.pan && h("div", { ...blockProps, style: { margin: '4px 0' } },
                    "Company's PAN : ",
                    h("strong", null, ctx.profile.pan)),
                h(RichBlock, { title: "Terms & Conditions", html: ctx.termsHtml, className: ctx.termsClassMod }),
                h(RichBlock, { title: "Notes", html: ctx.notesHtml, className: ctx.termsClassMod }),
                ctx.showDeclaration && (h("div", { ...blockProps },
                    h("div", { style: { ...label, textDecoration: 'underline' } }, "Declaration"),
                    h("div", { style: small }, ctx.declarationText)))),
            h("div", { style: { padding: '4px 6px' } },
                h(BankLines, { ctx: ctx, tally: true }),
                h(UpiQr, { ctx: ctx })),
            ctx.showCustomerSeal ? (h("div", { ...blockProps, style: { padding: '4px 6px', borderTop: B, borderRight: B, minHeight: 80 } }, "Customer's Seal and Signature")) : h("div", { style: { borderTop: B, borderRight: B } }),
            h("div", { style: { padding: '4px 6px', borderTop: B } },
                h(Signature, { ctx: ctx }))),
        h("div", { ...blockProps, style: { textAlign: 'center', marginTop: 4, ...small } }, ctx.showSystemGeneratedNote ? 'This is a computer generated invoice. No signature or stamp is required.' : 'This is a Computer Generated Invoice')));
}
// ---------------------------------------------------------------------------
// BOXED GRID
// ---------------------------------------------------------------------------
const BOXED_MIN_ROWS = 8;
function BoxedLayout({ ctx }) {
    const { details, client, items, totals, fmt, lineCalc, t, invoiceTitle, accent, profile } = ctx;
    const order = filledOrderDetails(details);
    const workDetails = order.find((f) => f.key === 'workDetails');
    const metaRows = [
        t.invoiceDate && ['Date', ctx.shortDate(details?.invoiceDate)],
        t.invoiceNumber && [`${ctx.docLabel} No`, details?.invoiceNumber],
        t.dueDate && details?.dueDate && ['Due Date', ctx.shortDate(details.dueDate)],
        ctx.showReverseChargeLine && ['Reverse Charge', ctx.reverseChargeText],
        details?.originalInvoiceRef && ['Against Invoice', details.originalInvoiceRef],
        ...order.filter((f) => f.key !== 'workDetails').map((f) => [f.label, f.value]),
    ].filter(Boolean);
    const rows = taxRows(ctx);
    const filler = Math.max(0, BOXED_MIN_ROWS - items.length);
    // v1.10.83 - the UNIT column goes with the unit option.
    const unitCol = t.itemQty && t.itemUnit;
    const colCount = 3 + (t.hsn ? 1 : 0) + (t.itemQty ? 1 : 0) + (unitCol ? 1 : 0) + (t.rate ? 1 : 0) + (ctx.hasAnyDiscount ? 1 : 0);
    const shipTo = ctx.shipTo;
    return (h("div", { className: "grid-inv grid-inv-boxed", style: { padding: '7mm 8mm', color: '#111827', fontSize: '0.8rem', lineHeight: 1.35 } },
        h("div", { style: { border: B } },
            h("div", { ...blockProps, style: { textAlign: 'center', padding: '8px 6px', borderBottom: B } },
                t.logo && profile?.logo && (h("img", { src: profile.logo, alt: "Logo", style: { maxHeight: `${profile.logoHeight || 48}px`, maxWidth: 160, objectFit: 'contain', display: 'block', margin: '0 auto 4px' } })),
                t.businessName && h("div", { style: { fontSize: '1.7rem', fontWeight: 800, color: accent, letterSpacing: '0.02em' } }, profile?.businessName || 'Your Business'),
                h("div", { style: { fontWeight: 700, color: '#4b5563', letterSpacing: '0.06em' } }, invoiceTitle)),
            h("table", { style: { width: '100%', borderCollapse: 'collapse' } },
                h("tbody", null,
                    h("tr", { ...blockProps },
                        h("td", { style: { ...cell, borderLeft: 'none', borderTop: 'none', width: '55%' } },
                            h(SellerBlock, { ctx: { ...ctx, t: { ...t, logo: false } } })),
                        h("td", { style: { ...cell, borderRight: 'none', borderTop: 'none', padding: 0 } }, metaRows.map(([k, v], i) => (h("div", { key: k, style: { padding: '4px 6px', borderTop: i ? B : 'none' } },
                            h("span", { style: label },
                                k,
                                ":"),
                            " ",
                            v))))),
                    h("tr", { ...blockProps },
                        h("td", { style: { ...cell, borderLeft: 'none' } },
                            h(PartyBlock, { ctx: ctx, heading: "Billing To:", party: client, withContact: true })),
                        h("td", { style: { ...cell, borderRight: 'none' } },
                            h("div", { style: label }, "Shipping To:"),
                            shipTo ? (h(Fragment, null,
                                shipTo.address && h("div", { style: { whiteSpace: 'pre-line' } }, shipTo.address),
                                (shipTo.city || shipTo.pin) && h("div", null, [shipTo.city, shipTo.pin].filter(Boolean).join(' - ')),
                                shipTo.state && h("div", null,
                                    "State: ",
                                    shipTo.state))) : h("div", { style: small }, "Same as billing address"),
                            t.placeOfSupply && ctx.placeOfSupply && h("div", { style: { marginTop: 6 } },
                                h("span", { style: label }, "Place of Supply:"),
                                " ",
                                ctx.placeOfSupply))))),
            workDetails && (h("div", { ...blockProps, style: { padding: '5px 6px', borderBottom: B } },
                h("span", { style: label }, "Work Details:"),
                " ",
                workDetails.value)),
            h("table", { className: "inv-table grid-items", style: { width: '100%', borderCollapse: 'collapse', margin: 0 } },
                h("thead", null,
                    h("tr", null,
                        h("th", { style: { ...th, borderLeft: 'none', width: 30 } }, "SI"),
                        h("th", { style: th }, "Description"),
                        t.hsn && h("th", { style: th }, ctx.isServices ? 'SAC' : 'HSN/SAC'),
                        unitCol && h("th", { style: th }, "UNIT"),
                        t.itemQty && h("th", { style: th }, "QTY"),
                        t.rate && h("th", { style: th }, "Rate"),
                        ctx.hasAnyDiscount && h("th", { style: th }, "Disc."),
                        h("th", { style: { ...th, borderRight: 'none' } }, "Amount"))),
                h("tbody", null,
                    items.map((item, i) => {
                        const l = lineCalc(item);
                        return (h("tr", { key: item.id || i },
                            h("td", { style: { ...cell, ...center, borderLeft: 'none' } }, i + 1),
                            h("td", { style: cell },
                                item.name || '-',
                                item.description && h("div", { style: { ...small, whiteSpace: 'pre-wrap' } }, item.description)),
                            t.hsn && h("td", { style: { ...cell, ...center } }, item.hsn || ''),
                            unitCol && h("td", { style: { ...cell, ...center } }, item.unit || ''),
                            t.itemQty && h("td", { style: { ...cell, ...center } }, item.quantity),
                            t.rate && h("td", { style: { ...cell, ...right } }, num(item.rate)),
                            ctx.hasAnyDiscount && h("td", { style: { ...cell, ...right } }, l.discount > 0 ? num(l.discount) : ''),
                            h("td", { style: { ...cell, ...right, borderRight: 'none' } }, num(l.taxable))));
                    }),
                    Array.from({ length: filler }, (_, i) => (h("tr", { key: `fill-${i}`, "data-pdf-spacer": "row" }, Array.from({ length: colCount }, (__, c) => (h("td", { key: c, style: { ...cell, height: 26, ...(c === 0 ? { borderLeft: 'none' } : {}), ...(c === colCount - 1 ? { borderRight: 'none' } : {}) } })))))))),
            h("div", { ...blockProps, style: { display: 'grid', gridTemplateColumns: '1fr auto', borderBottom: B } },
                h("div", { style: { padding: '4px 6px', borderRight: B } },
                    h(BankLines, { ctx: ctx }),
                    h(UpiQr, { ctx: ctx })),
                h("table", { style: { borderCollapse: 'collapse', minWidth: 230, alignSelf: 'start' } },
                    h("tbody", null,
                        h("tr", null,
                            h("td", { style: { ...cell, borderTop: 'none', ...right } }, "Total"),
                            h("td", { style: { ...cell, borderTop: 'none', borderRight: 'none', ...right } }, num(printedSubtotal(totals) - (totals.totalDiscount || 0)))),
                        rows.map(([k, v]) => (h("tr", { key: k },
                            h("td", { style: { ...cell, ...right } }, k),
                            h("td", { style: { ...cell, borderRight: 'none', ...right } }, v < 0 ? `-${num(-v)}` : num(v))))),
                        h("tr", { style: { fontWeight: 800 } },
                            h("td", { style: { ...cell, borderBottom: 'none', ...right } }, ctx.invoiceType === 'credit-note' ? 'Credit Amount' : 'Grand Total'),
                            h("td", { style: { ...cell, borderBottom: 'none', borderRight: 'none', ...right } }, fmt(totals.total))),
                        totals.tdsAmount > 0 && (h("tr", { style: small },
                            h("td", { style: { ...cell, ...right } }, "Less: TDS / Net Receivable"),
                            h("td", { style: { ...cell, borderRight: 'none', ...right } }, fmt(totals.netReceivable))))))),
            ctx.showAmountWords && (h("div", { ...blockProps, style: { padding: '4px 6px', borderBottom: B } },
                h("span", { style: label }, "Amount in words:"),
                " ",
                ctx.words(totals.total))),
            ctx.showHsnSummary && h("div", { style: { margin: '0 -1px' } },
                h(HsnSummaryTable, { ctx: ctx })),
            ctx.showTaxInWords && ctx.totalTax > 0 && (h("div", { ...blockProps, style: { padding: '4px 6px', borderBottom: B } },
                h("span", { style: label }, "Tax amount in words:"),
                " ",
                ctx.words(ctx.totalTax))),
            h("div", { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '4px 6px' } },
                h("div", null,
                    ctx.notices,
                    h(RichBlock, { title: "Terms & Conditions:", html: ctx.termsHtml, className: ctx.termsClassMod }),
                    h(RichBlock, { title: "Notes:", html: ctx.notesHtml, className: ctx.termsClassMod }),
                    ctx.showDeclaration && (h("div", { ...blockProps },
                        h("div", { style: label }, "Declaration:"),
                        h("div", { style: small }, ctx.declarationText))),
                    ctx.showCustomerSeal && (h("div", { ...blockProps, style: { marginTop: 10, border: B, padding: '4px 6px', minHeight: 60, width: 200 } }, "Customer's Seal and Signature"))),
                h("div", { style: { minWidth: 190 } },
                    h(Signature, { ctx: ctx }))),
            h("div", { ...blockProps, style: { textAlign: 'center', borderTop: B, padding: '3px 6px', ...small, fontStyle: 'italic' } }, ctx.showSystemGeneratedNote ? 'This is a computer generated document. No signature or stamp is required.' : 'This is a computer generated document.'))));
}
export default function InvoiceGridLayout({ ctx }) {
    return ctx.style === 'tally' ? h(TallyLayout, { ctx: ctx }) : h(BoxedLayout, { ctx: ctx });
}
