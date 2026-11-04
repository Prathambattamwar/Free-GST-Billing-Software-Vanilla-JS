import { useState, useRef, useEffect, h, Fragment } from '../vanilla/dom.js';
import { X, Upload, Loader, Wand2, Package, Sparkles, Trash2, Plus } from '../vanilla/icons.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
// OCR utility is loaded on demand from the pinned browser ESM CDN import map.
// v1.10.35 — Match extracted product names against the saved catalog
// so users don't retype HSN + GST for products they already have.
import { getAllProducts } from '../store.js';
/*
 * v1.10.22 — Purchase-bill OCR.
 *
 * Reported: "purchase bill ocr for faster and accurate entry".
 *
 * User uploads a photo/scan of a supplier's tax invoice; we OCR the image
 * via tesseract.js (loaded on demand, kept out of the main bundle) and
 * heuristically pull out:
 *
 *   - Supplier GSTIN — 15-char format is strict enough to catch reliably.
 *   - Invoice number — after "Invoice", "Bill", "No." labels.
 *   - Invoice date   — dd/mm/yyyy or dd-mm-yyyy variants.
 *   - Grand total    — the number labelled "Total", "Grand Total", or
 *                      "Amount Payable", with rupee-format tolerance.
 *
 * Line items are NOT auto-parsed — table extraction from OCR text is
 * unreliable across bill layouts and misrouted ITC is worse than a slow
 * manual entry. User confirms the extracted header fields and fills line
 * items themselves.
 *
 * Tesseract.js runs entirely client-side (WebAssembly). No network
 * calls to a paid OCR provider. The worker and English language data are
 * fetched from public CDNs on first use; later use may benefit from browser cache.
 */
// GSTIN: 2-digit state code + 5 letters + 4 digits + 1 letter + entity
// code (digit/letter) + 'Z' + check digit/letter. Real length: 15.
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;
// Date variants seen on Indian tax invoices:
//   14/07/2026, 14-07-2026, 14 Jul 2026, 14th July 2026 (rare).
const DATE_RES = [
    /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/,
    /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})\b/i,
];
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const parseDateFrom = (text) => {
    for (const re of DATE_RES) {
        const m = text.match(re);
        if (!m)
            continue;
        let y, mo, d;
        if (/^\d/.test(m[2])) {
            // Numeric month → assume DD-MM-YYYY (India default).
            d = Number(m[1]);
            mo = Number(m[2]);
            y = Number(m[3]);
        }
        else {
            d = Number(m[1]);
            mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
            y = Number(m[3]);
        }
        if (y < 100)
            y = 2000 + y;
        if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100)
            continue;
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return '';
};
// Invoice number: first non-blank token after "Invoice", "Bill", or "No".
// Length ceiling (25 chars) drops paragraph-continuation false positives.
const parseInvoiceNumber = (text) => {
    const m = text.match(/(?:invoice|bill|inv|voucher)\s*(?:no\.?|#|number)?\s*:?\s*([A-Za-z0-9/-]{2,25})/i);
    return m ? m[1].trim() : '';
};
// Supplier name — heuristic: the first uppercase-heavy line above the
// GSTIN. Often a company name is set in all-caps on Indian bills.
const parseSupplierName = (text) => {
    const gstinIdx = text.search(GSTIN_RE);
    const above = gstinIdx > 0 ? text.slice(0, gstinIdx) : text;
    const lines = above.split(/\n+/).map(l => l.trim()).filter(Boolean);
    // Look backwards from the GSTIN for a line with >=50% uppercase letters
    // and >=3 words. That's usually the supplier's registered name.
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.length < 4 || line.length > 80)
            continue;
        const letters = line.replace(/[^A-Za-z]/g, '');
        if (letters.length < 4)
            continue;
        const upper = letters.replace(/[^A-Z]/g, '').length / letters.length;
        if (upper >= 0.5)
            return line;
    }
    return '';
};
// Grand total — walks label patterns from most-specific to most-general,
// returns the first match as a JS number. Indian rupee formatting has
// commas we strip; a bare "Total" without a currency prefix is fine.
const parseGrandTotal = (text) => {
    const patterns = [
        /grand\s*total[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        /(?:amount|amt)\s+payable[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        /(?:invoice\s+)?total[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        /net\s+(?:amount|payable)[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (!m)
            continue;
        const n = Number(m[1].replace(/,/g, ''));
        if (isFinite(n) && n > 0)
            return n;
    }
    return 0;
};
// v1.10.35 — Tax-breakdown extraction. Grabs CGST / SGST / IGST / cess
// amounts + taxable value + round-off. Indian tax invoices lay these
// under the item table with labels like "CGST 9% 45.00" or "IGST @18%
// = 90.00". Regex tolerates the wide space + punctuation variance
// tesseract introduces when characters split awkwardly across an OCR
// scan.
const parseTaxBreakdown = (text) => {
    const out = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, roundOff: 0 };
    const num = (m) => {
        if (!m)
            return 0;
        const n = Number(m[m.length - 1].replace(/,/g, ''));
        return isFinite(n) && n >= 0 ? n : 0;
    };
    const patterns = {
        taxableValue: [
            /(?:taxable\s+(?:value|amount))[^0-9-]{0,15}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
            /(?:sub\s?total|subtotal)[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        ],
        cgst: [
            /\bcgst[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        ],
        sgst: [
            /\b(?:sgst|utgst)[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        ],
        igst: [
            /\bigst[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        ],
        cess: [
            /\bcess[^0-9-]{0,15}(?:@?\s*\d+(?:\.\d+)?%?)?[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*([\d,]+\.?\d*)/i,
        ],
        roundOff: [
            /(?:round\s*(?:off|ing))[^0-9-]{0,10}(?:rs\.?|inr|₹)?\s*(-?[\d,]+\.?\d*)/i,
        ],
    };
    for (const [key, list] of Object.entries(patterns)) {
        for (const re of list) {
            const m = text.match(re);
            if (m) {
                out[key] = num(m);
                break;
            }
        }
    }
    return out;
};
// v1.10.35 — Line-item heuristic. Bill layouts vary but a taxable line
// almost always ends with a numeric column pair (rate, amount). We walk
// the raw OCR text row-by-row, keep only rows that look like table
// entries (short-ish, end with 2+ numeric tokens), and pull out:
//   - name        : leading text up to the first HSN/qty/rate token
//   - hsn         : nearby 4/6/8-digit code
//   - quantity    : first bare integer (with optional decimal)
//   - rate        : the LAST number that's not the row total
//   - amount      : the LAST number on the row
//   - taxPercent  : "18%"/"5%" etc if present on the row
// This won't be perfect on every bill — user reviews + edits before
// applying. But even 60% accuracy on 5 items beats manual typing.
const LINE_ITEM_HSN_RE = /\b(\d{4,8})\b/;
const LINE_ITEM_NUM_RE = /\b(\d+(?:\.\d+)?)\b/g;
const LINE_ITEM_PCT_RE = /(\d+(?:\.\d+)?)\s*%/;
// Words that anchor "this line is a total, NOT a line item":
const NON_ITEM_ANCHORS = /^(?:sub\s?total|subtotal|grand\s+total|total|net\s+(?:amount|payable)|amount\s+payable|cgst|sgst|utgst|igst|cess|round|balance|discount|freight|shipping|packing|handling|tds|tcs|advance|received|paid|dues?|hsn|desc|description|item\s*name|qty|rate|amount|s\.?\s*no|sno)\b/i;
const parseLineItems = (rawText) => {
    const lines = rawText.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
        // Skip obvious non-item rows (headers, totals, labels).
        if (line.length < 8 || line.length > 200)
            continue;
        if (NON_ITEM_ANCHORS.test(line))
            continue;
        // Row must end in numbers (at least a rate + amount pair usually).
        const nums = [...line.matchAll(LINE_ITEM_NUM_RE)].map(m => ({
            value: Number(m[1]),
            index: m.index,
        }));
        if (nums.length < 2)
            continue;
        // Last number = amount; second-to-last = rate (loose heuristic).
        const amount = nums[nums.length - 1].value;
        const rate = nums[nums.length - 2].value;
        if (!isFinite(amount) || amount <= 0)
            continue;
        if (!isFinite(rate) || rate <= 0)
            continue;
        // If amount < rate, likely misparsed (rate should be per-unit).
        // Not fatal — we surface both and let the user swap.
        // Find HSN — first 4/6/8-digit code on the row. Skip codes below
        // 1000 (probably a qty/rate collision).
        const hsnMatch = line.match(LINE_ITEM_HSN_RE);
        let hsn = '';
        if (hsnMatch && Number(hsnMatch[1]) >= 1000)
            hsn = hsnMatch[1];
        // Find tax percent if present on the row.
        const pctMatch = line.match(LINE_ITEM_PCT_RE);
        const taxPercent = pctMatch ? Number(pctMatch[1]) : 0;
        // Quantity: first integer < 10000 before the rate. Falls back to 1
        // if we can't distinguish (many bills omit qty for single-piece).
        let quantity = 1;
        for (const n of nums) {
            if (n.value === rate || n.value === amount)
                continue;
            if (n.value > 0 && n.value < 10000 && Number.isInteger(n.value)) {
                quantity = n.value;
                break;
            }
        }
        // Sanity check: qty * rate should be near amount (within 25% or GST margin).
        const expectedAmount = quantity * rate;
        const ratio = expectedAmount > 0 ? Math.abs(expectedAmount - amount) / amount : 1;
        if (ratio > 0.3 && ratio < 0.35) {
            // Might be tax-inclusive — leave as-is, user will see and can fix.
        }
        // Name = the text before the first numeric token, cleaned up.
        const firstNumIdx = nums[0].index;
        let name = line.slice(0, firstNumIdx).trim();
        // Strip leading serial numbers ("1.", "01)", "Item 1 -").
        name = name.replace(/^(?:item\s*)?\d+\s*[.)\-:]?\s*/i, '').trim();
        // Strip trailing HSN if it leaked into the name.
        if (hsn)
            name = name.replace(new RegExp(`\\b${hsn}\\b`), '').trim();
        // Skip if name became empty or is just punctuation.
        if (!name || !/[A-Za-z]{3,}/.test(name))
            continue;
        if (name.length > 100)
            name = name.slice(0, 100);
        items.push({ name, hsn, quantity, rate, amount, taxPercent });
    }
    return items;
};
// v1.10.35 — Fuzzy product-catalog matching. When OCR gives us "Copier
// Paper A4 70gsm" and the user's catalog has "A4 Copier Paper 70 GSM",
// we want to auto-fill HSN + tax rate from the saved product without
// exact-string matching. Token-set overlap (Jaccard) is fast, works
// with word reordering, tolerates spacing/case differences, and is
// portable to any language. Threshold 0.5 = at least half the tokens
// overlap → strong match.
const tokenize = (s) => {
    if (!s)
        return new Set();
    return new Set(String(s)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3));
};
const jaccard = (a, b) => {
    if (!a.size || !b.size)
        return 0;
    const intersection = [...a].filter(x => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    return intersection / union;
};
const matchProduct = (extractedName, catalog) => {
    if (!catalog?.length)
        return null;
    const tokens = tokenize(extractedName);
    if (!tokens.size)
        return null;
    let best = null, bestScore = 0.5; // threshold
    for (const p of catalog) {
        const score = jaccard(tokens, tokenize(p.name));
        if (score > bestScore) {
            best = p;
            bestScore = score;
        }
    }
    return best ? { product: best, score: bestScore } : null;
};
// Everything above assembled — returns partial patch of PurchaseBills.emptyForm.
// v1.10.35 — Enriched: line items, tax breakdown, catalog matches.
const heuristicParseBill = (rawText, catalog = []) => {
    const text = rawText.replace(/[ \t]+/g, ' ');
    const gstinMatch = text.match(GSTIN_RE);
    const items = parseLineItems(rawText);
    // Enrich each item with catalog match (HSN + tax rate fallback).
    const enrichedItems = items.map(it => {
        const match = matchProduct(it.name, catalog);
        if (match) {
            return {
                ...it,
                // Prefer OCR-extracted HSN, fall back to catalog HSN.
                hsn: it.hsn || match.product.hsn || '',
                // Prefer catalog's stored GST rate over the OCR-extracted one —
                // catalog is user-verified, OCR is noisy.
                taxPercent: match.product.taxPercent ?? it.taxPercent,
                // Attach the matched product's id so the caller can link back.
                _matchedProductId: match.product.id,
                _matchScore: match.score,
                _matchedName: match.product.name,
            };
        }
        return it;
    });
    return {
        supplierGstin: gstinMatch ? gstinMatch[0] : '',
        supplierName: parseSupplierName(text),
        invoiceNumber: parseInvoiceNumber(text),
        date: parseDateFrom(text),
        grandTotal: parseGrandTotal(text),
        taxBreakdown: parseTaxBreakdown(text),
        items: enrichedItems,
        _rawText: rawText,
    };
};
export default function BillOCR({ onClose, onExtracted }) {
    const [file, setFile] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [status, setStatus] = useState('idle'); // 'idle' | 'ocr' | 'done' | 'error'
    const [progress, setProgress] = useState(0);
    const [rawText, setRawText] = useState('');
    const [parsed, setParsed] = useState(null);
    // v1.10.35 — Products catalog loaded once on mount. Used to enrich
    // extracted line items with the user's known HSN + GST rate so they
    // don't have to retype for products they've already saved.
    const [catalog, setCatalog] = useState([]);
    const fileInputRef = useRef(null);
    useEffect(() => {
        getAllProducts().then(setCatalog).catch(() => setCatalog([]));
    }, []);
    const pickFile = (f) => {
        if (!f)
            return;
        if (!f.type.startsWith('image/')) {
            toast('Please upload an image (PNG, JPG, WebP).', 'warning');
            return;
        }
        if (f.size > 8 * 1024 * 1024) {
            toast('Image is over 8MB — please compress first (or take a smaller photo).', 'warning');
            return;
        }
        setFile(f);
        setPreviewUrl(URL.createObjectURL(f));
        setStatus('idle');
        setRawText('');
        setParsed(null);
        setProgress(0);
    };
    const runOCR = async () => {
        if (!file)
            return;
        setStatus('ocr');
        setProgress(0);
        // Tesseract runs in the browser. The worker, WASM core and language data
        // are loaded from pinned public CDNs in this static no-build edition.
        // OCR requires an internet connection the first time it is used.
        let worker = null;
        try {
            const Tesseract = await import('tesseract.js');
            // Pin the worker and core to the same Tesseract 7 release so their
            // worker protocol and WASM ABI remain compatible.
            worker = await Tesseract.createWorker('eng', 1, {
                workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
                corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
                langPath: 'https://tessdata.projectnaptha.com/4.0.0',
                // Language data is distributed as gzip by the public tessdata CDN.
                gzip: true,
                logger: (m) => {
                    if (typeof m?.progress === 'number') {
                        setProgress(Math.round(m.progress * 100));
                    }
                },
            });
            const { data } = await worker.recognize(file);
            await worker.terminate();
            worker = null;
            setRawText(data.text);
            // v1.10.35 — Pass the loaded product catalog so line-item HSN +
            // tax rates auto-fill from saved products via fuzzy name match.
            const p = heuristicParseBill(data.text, catalog);
            setParsed(p);
            setStatus('done');
        }
        catch (err) {
            console.error('OCR failed:', err);
            // v1.10.30 — reported: "ocr issue hai abhi bhi" with screenshot
            // showing "OCR failed: undefined." Root cause: v1.10.29 used
            // `err.message || String(err)`, but tesseract sometimes rejects with
            // a non-Error value (a string, a plain object, or literally
            // undefined) → `String(undefined)` → the toast said "undefined".
            // Now we normalize aggressively across every shape tesseract can
            // throw / reject.
            let msg = '';
            if (typeof err === 'string')
                msg = err;
            else if (err && typeof err.message === 'string' && err.message)
                msg = err.message;
            else if (err && typeof err.data === 'string')
                msg = err.data;
            else if (err && err.data && typeof err.data.message === 'string')
                msg = err.data.message;
            else if (err) {
                try {
                    msg = JSON.stringify(err);
                }
                catch {
                    msg = 'Unknown error';
                }
            }
            else
                msg = 'Unknown error';
            if (msg === 'undefined' || msg === '{}' || !msg.trim())
                msg = 'Unknown error (see browser console — F12 — for details)';
            let hint = 'Try a sharper photo, or open the browser console (F12) for the full error.';
            if (/fetch|network|Failed to fetch|CDN|502|503|504/i.test(msg))
                hint = 'Network fetch failed — OCR needs to download ~2MB of language data on first use. Check your connection and try again in a moment.';
            else if (/worker|SharedArrayBuffer|not defined/i.test(msg))
                hint = 'Tesseract worker failed to load. Hard-refresh (Ctrl+F5) to fetch a clean bundle. If it keeps failing, the app may need HTTPS + COOP/COEP headers for tesseract v7.';
            else if (/blob|image|decode|corrupt|invalid/i.test(msg))
                hint = 'Could not decode the image. Try a JPG or PNG under 8MB, taken with good lighting.';
            else if (/timeout|timed out/i.test(msg))
                hint = 'OCR timed out. Image may be too large — try cropping to just the invoice header.';
            toast(`OCR failed: ${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''} · ${hint}`, 'error', 12000);
            setStatus('error');
            if (worker) {
                try {
                    await worker.terminate();
                }
                catch { /* ignore */ }
            }
        }
    };
    const applyToForm = () => {
        if (!parsed)
            return;
        // v1.10.35 — Also ship line items + tax breakdown to the parent so
        // the purchase form is pre-filled top to bottom (was: header only,
        // items always blank).
        onExtracted({
            supplierName: parsed.supplierName,
            supplierGstin: parsed.supplierGstin,
            invoiceNumber: parsed.invoiceNumber,
            date: parsed.date,
            grandTotal: parsed.grandTotal,
            items: parsed.items || [],
            taxBreakdown: parsed.taxBreakdown || {},
        });
        onClose();
    };
    // v1.10.35 — Line-item editors: user can tweak / add / remove
    // before applying to the form. Each row is displayed with name,
    // HSN, qty, rate, tax%, amount + a match-badge if the row was
    // auto-linked to a saved product.
    const updateItem = (idx, patch) => {
        setParsed(p => ({
            ...p,
            items: p.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
        }));
    };
    const removeItem = (idx) => {
        setParsed(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
    };
    const addItem = () => {
        setParsed(p => ({
            ...p,
            items: [...(p.items || []), { name: '', hsn: '', quantity: 1, rate: 0, amount: 0, taxPercent: 18 }],
        }));
    };
    return (h("div", { className: "modal-overlay", onClick: onClose },
        h("div", { className: "modal-content", onClick: e => e.stopPropagation(), style: { maxWidth: 'min(1080px, 96vw)', maxHeight: '92vh', overflow: 'auto' } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' } },
                h("h3", { className: "section-title", style: { margin: 0, display: 'flex', alignItems: 'center', gap: 8 } },
                    h(Wand2, { size: 18 }),
                    " Import from bill image (OCR) ",
                    h(HelpButton, { title: "Reading a bill from a photo", doc: "purchases#ocr", size: 16 })),
                h("button", { className: "icon-btn", onClick: onClose, title: "Close" },
                    h(X, { size: 18 }))),
            h("p", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem' } },
                "Upload a photo or scan of the supplier's invoice. We'll extract the",
                h("strong", null, " GSTIN, invoice number, date, grand total, line items (name / HSN / quantity / rate / GST%), and the tax breakdown (CGST / SGST / IGST / cess)"),
                ". Rows are cross-matched against your saved products \u2014 matched items get your stored HSN + tax rate auto-filled. Everything runs in your browser; nothing is uploaded to a server."),
            h("div", { style: { display: 'grid', gridTemplateColumns: previewUrl ? '1fr 1fr' : '1fr', gap: '1rem' } },
                h("div", null,
                    h("div", { onDragOver: e => e.preventDefault(), onDrop: e => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }, onClick: () => fileInputRef.current?.click(), style: {
                            border: '2px dashed var(--border-color)', borderRadius: 8,
                            padding: '1.25rem', textAlign: 'center', cursor: 'pointer',
                            background: 'var(--bg-secondary)', minHeight: 120,
                        } },
                        h(Upload, { size: 26, style: { opacity: 0.6, marginBottom: 6 } }),
                        h("p", { style: { margin: 0, fontSize: '0.85rem' } }, file ? file.name : 'Click or drag a bill image here'),
                        h("input", { ref: fileInputRef, type: "file", accept: "image/*", style: { display: 'none' }, onChange: e => pickFile(e.target.files?.[0]) })),
                    previewUrl && (h("img", { src: previewUrl, alt: "Bill preview", style: { marginTop: 10, maxWidth: '100%', maxHeight: 300, border: '1px solid var(--border-color)', borderRadius: 4 } })),
                    file && status !== 'ocr' && (h("button", { className: "btn btn-primary", onClick: runOCR, style: { marginTop: 10, width: '100%' } },
                        h(Wand2, { size: 16 }),
                        " Extract fields")),
                    status === 'ocr' && (h("div", { style: { marginTop: 10, textAlign: 'center', fontSize: '0.85rem' } },
                        h(Loader, { size: 16, className: "spin", style: { verticalAlign: '-3px', marginRight: 6 } }),
                        "Reading image\u2026 ",
                        progress,
                        "%"))),
                parsed && (h("div", { style: { background: 'var(--bg-secondary)', padding: '0.85rem', borderRadius: 6, maxHeight: 'calc(88vh - 100px)', overflowY: 'auto' } },
                    h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.9rem' } },
                        "Extracted fields ",
                        h(HelpButton, { title: "Checking what was read", doc: "purchases#ocr-review", size: 16 })),
                    h(FieldPreview, { label: "Supplier", value: parsed.supplierName, onChange: v => setParsed(p => ({ ...p, supplierName: v })) }),
                    h(FieldPreview, { label: "GSTIN", value: parsed.supplierGstin, onChange: v => setParsed(p => ({ ...p, supplierGstin: v })) }),
                    h(FieldPreview, { label: "Invoice No.", value: parsed.invoiceNumber, onChange: v => setParsed(p => ({ ...p, invoiceNumber: v })) }),
                    h(FieldPreview, { label: "Date", value: parsed.date, onChange: v => setParsed(p => ({ ...p, date: v })), type: "date" }),
                    h(FieldPreview, { label: "Grand total", value: parsed.grandTotal || '', onChange: v => setParsed(p => ({ ...p, grandTotal: Number(v) || 0 })), type: "number" }),
                    parsed.taxBreakdown && (parsed.taxBreakdown.taxableValue || parsed.taxBreakdown.cgst || parsed.taxBreakdown.igst) > 0 && (h("div", { style: { marginTop: 10, padding: '0.55rem 0.7rem', background: 'var(--bg-primary)', borderRadius: 5, border: '1px solid var(--border)' } },
                        h("div", { style: { fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 } }, "Tax breakdown"),
                        h("div", { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: '0.75rem' } },
                            parsed.taxBreakdown.taxableValue > 0 && h(Fragment, null,
                                h("span", { style: { color: 'var(--text-muted)' } }, "Taxable"),
                                h("span", { style: { textAlign: 'right', fontWeight: 600 } },
                                    "\u20B9",
                                    parsed.taxBreakdown.taxableValue.toFixed(2))),
                            parsed.taxBreakdown.cgst > 0 && h(Fragment, null,
                                h("span", { style: { color: 'var(--text-muted)' } }, "CGST"),
                                h("span", { style: { textAlign: 'right' } },
                                    "\u20B9",
                                    parsed.taxBreakdown.cgst.toFixed(2))),
                            parsed.taxBreakdown.sgst > 0 && h(Fragment, null,
                                h("span", { style: { color: 'var(--text-muted)' } }, "SGST / UTGST"),
                                h("span", { style: { textAlign: 'right' } },
                                    "\u20B9",
                                    parsed.taxBreakdown.sgst.toFixed(2))),
                            parsed.taxBreakdown.igst > 0 && h(Fragment, null,
                                h("span", { style: { color: 'var(--text-muted)' } }, "IGST"),
                                h("span", { style: { textAlign: 'right' } },
                                    "\u20B9",
                                    parsed.taxBreakdown.igst.toFixed(2))),
                            parsed.taxBreakdown.cess > 0 && h(Fragment, null,
                                h("span", { style: { color: 'var(--text-muted)' } }, "Cess"),
                                h("span", { style: { textAlign: 'right' } },
                                    "\u20B9",
                                    parsed.taxBreakdown.cess.toFixed(2))),
                            Math.abs(parsed.taxBreakdown.roundOff) > 0.005 && h(Fragment, null,
                                h("span", { style: { color: 'var(--text-muted)' } }, "Round-off"),
                                h("span", { style: { textAlign: 'right' } },
                                    parsed.taxBreakdown.roundOff >= 0 ? '+' : '',
                                    "\u20B9",
                                    parsed.taxBreakdown.roundOff.toFixed(2)))))),
                    h("div", { style: { marginTop: 12 } },
                        h("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 } },
                            h("span", { style: { fontSize: '0.8rem', fontWeight: 600 } },
                                h(Package, { size: 13, style: { verticalAlign: '-2px', marginRight: 4 } }),
                                "Line items (",
                                parsed.items?.length || 0,
                                ")"),
                            h("button", { type: "button", className: "btn btn-secondary", onClick: addItem, style: { fontSize: '0.7rem', padding: '0.2rem 0.5rem' } },
                                h(Plus, { size: 11 }),
                                " Add row")),
                        (!parsed.items || parsed.items.length === 0) ? (h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0, padding: '0.5rem', background: 'var(--bg-primary)', borderRadius: 4, textAlign: 'center' } }, "No line items detected. Add rows manually or use the OCR-total single-line fallback.")) : (h("div", { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' } }, parsed.items.map((it, idx) => (h("div", { key: idx, style: { background: 'var(--bg-primary)', padding: '0.5rem 0.6rem', borderRadius: 4, border: '1px solid var(--border)' } },
                            h("div", { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 } },
                                h("input", { type: "text", className: "form-input", value: it.name || '', onChange: e => updateItem(idx, { name: e.target.value }), placeholder: "Product / description", style: { flex: 1, fontSize: '0.78rem', padding: '0.25rem 0.4rem' } }),
                                h("button", { type: "button", className: "icon-btn icon-btn-red", onClick: () => removeItem(idx), title: "Remove row", "aria-label": "Remove row", style: { width: 24, height: 24 } },
                                    h(Trash2, { size: 12 }))),
                            it._matchedProductId && (h("div", { style: { fontSize: '0.68rem', color: 'var(--primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 3 } },
                                h(Sparkles, { size: 10 }),
                                " Matched saved product: ",
                                h("em", null, it._matchedName),
                                " (",
                                Math.round((it._matchScore || 0) * 100),
                                "%)")),
                            h("div", { style: { display: 'grid', gridTemplateColumns: '1.5fr 0.7fr 1fr 0.8fr 1fr', gap: 5, fontSize: '0.72rem' } },
                                h("div", null,
                                    h("label", { style: { fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' } }, "HSN/SAC"),
                                    h("input", { type: "text", className: "form-input", value: it.hsn || '', onChange: e => updateItem(idx, { hsn: e.target.value }), placeholder: "e.g. 4802", style: { fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' } })),
                                h("div", null,
                                    h("label", { style: { fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' } }, "Qty"),
                                    h("input", { type: "number", step: "any", className: "form-input", value: it.quantity ?? '', onChange: e => updateItem(idx, { quantity: Number(e.target.value) || 0 }), style: { fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' } })),
                                h("div", null,
                                    h("label", { style: { fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' } }, "Rate \u20B9"),
                                    h("input", { type: "number", step: "any", className: "form-input", value: it.rate ?? '', onChange: e => updateItem(idx, { rate: Number(e.target.value) || 0 }), style: { fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' } })),
                                h("div", null,
                                    h("label", { style: { fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' } }, "GST%"),
                                    h("input", { type: "number", step: "any", className: "form-input", value: it.taxPercent ?? '', onChange: e => updateItem(idx, { taxPercent: Number(e.target.value) || 0 }), style: { fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' } })),
                                h("div", null,
                                    h("label", { style: { fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block' } }, "Amount \u20B9"),
                                    h("input", { type: "number", step: "any", className: "form-input", value: it.amount ?? '', onChange: e => updateItem(idx, { amount: Number(e.target.value) || 0 }), style: { fontSize: '0.72rem', padding: '0.2rem 0.35rem', width: '100%' } }))))))))),
                    h("details", { style: { marginTop: 10, fontSize: '0.75rem', color: 'var(--text-muted)' } },
                        h("summary", { style: { cursor: 'pointer' } }, "Raw OCR text"),
                        h("pre", { style: { whiteSpace: 'pre-wrap', fontSize: '0.7rem', maxHeight: 140, overflow: 'auto', marginTop: 4 } }, rawText)),
                    h("button", { className: "btn btn-primary", onClick: applyToForm, style: { marginTop: 10, width: '100%' } },
                        "Use these values (",
                        parsed.items?.length || 0,
                        " line item",
                        parsed.items?.length === 1 ? '' : 's',
                        ")")))))));
}
function FieldPreview({ label, value, onChange, type = 'text' }) {
    return (h("div", { style: { marginBottom: 6 } },
        h("label", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', marginBottom: 2 } }, label),
        h("input", { type: type, className: "form-input", value: value ?? '', onChange: e => onChange(e.target.value), style: { fontSize: '0.82rem', padding: '0.3rem 0.5rem' } })));
}
