// v1.10.83 (#121) - the Import CSV window of Products and Clients: download a
// sample file, choose your file, see what will be added, import. Parsing is
// in src/utils/listCsv.js. Old invoices are imported elsewhere (Dashboard ->
// CSV import / export), so this window says where.
import { useState, h, Fragment } from '../vanilla/dom.js';
import { Upload, Download, X } from '../vanilla/icons.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
const download = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// what: 'products' | 'clients'. parse(text) -> { list, skipped, errors }.
// save(item) saves one. intro: what the columns are.
export default function CsvListImport({ what, sample, sampleName, doc, intro, parse, save, onClose, onDone }) {
    const [plan, setPlan] = useState(null); // { fileName, list, skipped, errors }
    const [busy, setBusy] = useState(false);
    const pickFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file)
            return;
        try {
            setPlan({ fileName: file.name, ...parse(await file.text()) });
        }
        catch (err) {
            toast(`Could not read ${file.name}: ${err.message}`, 'error');
        }
    };
    const runImport = async () => {
        setBusy(true);
        let saved = 0;
        try {
            for (const item of plan.list) {
                await save(item);
                saved += 1;
            }
            toast(`Imported ${saved} ${what}${plan.skipped ? `, skipped ${plan.skipped} already in your list` : ''}`, 'success');
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
    const n = plan?.list.length || 0;
    return (h("div", { className: "modal-overlay", onClick: close },
        h("div", { className: "modal-content", style: { maxWidth: 600 }, onClick: (e) => e.stopPropagation() },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                h("h3", { className: "section-title", style: { margin: 0, textTransform: 'none' } },
                    "Import ",
                    what,
                    " from CSV ",
                    h(HelpButton, { title: `Importing ${what}`, doc: doc, size: 16 })),
                h("button", { type: "button", className: "icon-btn", onClick: close, title: "Close", "aria-label": "Close" },
                    h(X, { size: 16 }))),
            h("p", { className: "text-muted", style: { fontSize: '0.85rem' } },
                intro,
                " Names already in your list are skipped, so importing the same file twice is safe."),
            h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' } },
                h("button", { type: "button", className: "btn btn-secondary", onClick: () => download(sample, sampleName), title: "A CSV with the right column headings and two example rows. Open it in Excel or Google Sheets, replace the examples and save as CSV." },
                    h(Download, { size: 15 }),
                    " Download sample file"),
                h("label", { className: "btn btn-primary", style: { cursor: 'pointer' } },
                    h(Upload, { size: 15 }),
                    " Choose CSV file",
                    h("input", { type: "file", accept: ".csv,text/csv", onChange: pickFile, style: { display: 'none' } }))),
            plan && (h("div", { style: { padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' } },
                h("strong", null, plan.fileName),
                ": ",
                n,
                " ready to import",
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
                h("b", null, "CSV import / export"),
                ", which has its own template.",
                h(HelpButton, { title: "Importing old invoices", doc: "dashboard#csv", size: 14 })),
            h("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' } },
                h("button", { type: "button", className: "btn btn-secondary", onClick: close, disabled: busy }, "Close"),
                h("button", { type: "button", className: "btn btn-primary", onClick: runImport, disabled: busy || !n }, busy ? 'Importing…' : `Import ${n || ''}`.trim())))));
}
