import { h, Fragment } from '../vanilla/dom.js';
// v1.10.83 (#121) - the Import CSV window of Products and Clients: download a
// sample file, choose your file, see what will be added, import. Parsing is
// in src/utils/listCsv.js. Old invoices are imported elsewhere (Dashboard ->
// Import / export CSV), so this window says where.
// v1.10.84 - also an Excel .xlsx (Vyapar, #130; a workbook with several sheets
// gets a sheet picker) and Tally's masters .xml (#131), read by
// src/utils/importFile.js into the same rows a CSV gives.
import { useState } from '../vanilla/dom.js';
import { Upload, Download, X } from '../vanilla/icons.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
import { fileToSheets, bestSheet } from '../utils/importFile.js';
const download = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// what: 'products' | 'clients'. parse(rows) -> { list, updates?, skipped, errors }
// (updates: saved items with empty details filled in, #134).
// save(item) saves one. intro: what the columns are.
export default function CsvListImport({ what, sample, sampleName, doc, intro, parse, save, onClose, onDone }) {
    const [plan, setPlan] = useState(null); // { fileName, sheets, at, list, updates, skipped, errors }
    const [busy, setBusy] = useState(false);
    const read = (fileName, sheets, at) => ({ fileName, sheets, at, updates: [], ...parse(sheets[at].rows) });
    const pickFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file)
            return;
        try {
            const sheets = await fileToSheets(file, what);
            setPlan(read(file.name, sheets, bestSheet(sheets, (rows) => parse(rows).list.length)));
        }
        catch (err) {
            toast(`Could not read ${file.name}: ${err.message}`, 'error', 9000);
        }
    };
    const runImport = async () => {
        setBusy(true);
        let saved = 0;
        try {
            for (const item of [...plan.list, ...plan.updates]) {
                await save(item);
                saved += 1;
            }
            const added = saved - plan.updates.length;
            toast([`Imported ${added} ${what}`, plan.updates.length && `filled in details on ${plan.updates.length} already saved`,
                plan.skipped && `skipped ${plan.skipped} already in your list`].filter(Boolean).join(', '), 'success');
            onDone();
        }
        catch (err) {
            toast(`Import stopped after ${saved}: ${err.message}`, 'error', 9000);
            if (saved)
                onDone();
            else
                setBusy(false);
        }
    };
    const close = () => { if (!busy)
        onClose(); };
    const n = (plan?.list.length || 0) + (plan?.updates.length || 0);
    return (h("div", { className: "modal-overlay", onClick: close },
        h("div", { className: "modal-content", style: { maxWidth: 600 }, onClick: (e) => e.stopPropagation() },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h("h3", { className: "section-title", style: { margin: 0, textTransform: 'none' } },
                    "Import ",
                    what,
                    " ",
                    h(HelpButton, { title: `Importing ${what}`, doc: doc, size: 16 })),
                h("button", { type: "button", className: "icon-btn", onClick: close, title: "Close", "aria-label": "Close" },
                    h(X, { size: 16 }))),
            h("p", { className: "text-muted", style: { fontSize: '0.85rem' } },
                intro,
                " A name already in your list is never added twice, so importing the same file again is safe."),
            h("p", { className: "text-muted", style: { fontSize: '0.85rem' } },
                "Choose a CSV, an Excel file (.xlsx, such as Vyapar's ",
                what === 'clients' ? 'party' : 'item',
                " export) or a Tally file (in Tally: ",
                h("b", null, "Gateway of Tally > Export > Masters"),
                ", format ",
                h("b", null, "XML"),
                "; ",
                what === 'clients' ? 'ledgers under Sundry Debtors and Sundry Creditors come in' : 'stock items come in with HSN, GST rate and unit',
                ")."),
            h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' } },
                h("button", { type: "button", className: "btn btn-secondary", onClick: () => download(sample, sampleName), title: "A CSV with the right column headings and two example rows. Open it in Excel or Google Sheets, replace the examples and save as CSV." },
                    h(Download, { size: 15 }),
                    " Download sample file"),
                h("label", { className: "btn btn-primary", style: { cursor: 'pointer' } },
                    h(Upload, { size: 15 }),
                    " Choose file",
                    h("input", { type: "file", accept: ".csv,text/csv,.xlsx,.xml", onChange: pickFile, style: { display: 'none' } }))),
            plan && (h("div", { style: { padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' } },
                plan.sheets.length > 1 && (h("label", { style: { display: 'block', marginBottom: '0.5rem' } },
                    "Sheet:",
                    ' ',
                    h("select", { value: plan.at, onChange: (e) => setPlan(read(plan.fileName, plan.sheets, Number(e.target.value))) }, plan.sheets.map((s, i) => h("option", { key: `${i}-${s.name}`, value: i }, s.name || `Sheet ${i + 1}`))))),
                h("strong", null, plan.fileName),
                ": ",
                plan.list.length,
                " new to add",
                plan.updates.length > 0 && h(Fragment, null,
                    " \u00B7 ",
                    plan.updates.length,
                    " already saved: their empty details are filled in, nothing already filled is changed"),
                plan.skipped > 0 && h(Fragment, null,
                    " \u00B7 ",
                    plan.skipped,
                    " already in your list (skipped)"),
                plan.errors.length > 0 && (h(Fragment, null,
                    h("p", { style: { color: 'var(--danger)', margin: '0.5rem 0 0.25rem' } },
                        plan.errors.length,
                        " row",
                        plan.errors.length === 1 ? '' : 's',
                        " with a problem (not imported; fix the file and choose it again):"),
                    h("ul", { style: { margin: 0, paddingLeft: '1.1rem', maxHeight: 150, overflowY: 'auto' } }, plan.errors.slice(0, 50).map((e) => h("li", { key: e }, e))))))),
            h("p", { className: "text-muted", style: { fontSize: '0.8rem', margin: '0.75rem 0 0' } },
                "Old invoices? Import them on the Dashboard with ",
                h("b", null, "Import / export CSV"),
                ", which has its own template.",
                h(HelpButton, { title: "Importing old invoices", doc: "dashboard#csv", size: 14 })),
            h("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' } },
                h("button", { type: "button", className: "btn btn-secondary", onClick: close, disabled: busy }, "Close"),
                h("button", { type: "button", className: "btn btn-primary", onClick: runImport, disabled: busy || !n }, busy ? 'Importing…' : `Import ${n || ''}`.trim())))));
}
