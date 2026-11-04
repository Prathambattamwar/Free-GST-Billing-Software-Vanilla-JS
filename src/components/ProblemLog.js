// v1.10.83 - Problem log, under Support & About. Lists the problems this
// browser logged (newest first) and the app's saved diagnostic entries,
// both already redacted. Nothing is sent to the project maintainer until Report is clicked.
import { useEffect, useState, h, Fragment } from '../vanilla/dom.js';
import { getProblems, clearProblems, onProblemsChanged, copyText, openReport } from '../utils/problemLog.js';
import { knownProblemFor, matchKnownProblem, reportText, KNOWN_PROBLEMS, TROUBLESHOOTING_URL } from '../utils/errorReport.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export default function ProblemLog() {
    const [items, setItems] = useState(() => getProblems());
    const [savedLines, setSavedLines] = useState(null);
    useEffect(() => onProblemsChanged(() => setItems(getProblems())), []);
    useEffect(() => {
        let live = true;
        fetch('/api/errors-log').then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live)
            setSavedLines(Array.isArray(d?.lines) ? d.lines : []); })
            .catch(() => { if (live)
            setSavedLines([]); });
        return () => { live = false; };
    }, []);
    const copy = async (text) => toast(await copyText(text) ? 'Copied. Paste it into an email or a GitHub issue.' : 'Could not copy. Select the text and press Ctrl+C.', 'info');
    const copyAll = () => copy(items.slice().reverse().map(reportText).join('\n\n')
        + (savedLines?.length ? `\n\nSaved app log (last ${savedLines.length} lines):\n\`\`\`\n${savedLines.join('\n')}\n\`\`\`` : ''));
    // Match known problem patterns in saved diagnostic entries.
    const savedKnown = [...new Set((savedLines || []).map((l) => matchKnownProblem(l)?.id).filter(Boolean))]
        .map((id) => KNOWN_PROBLEMS.find((k) => k.id === id));
    const list = items.slice().reverse();
    return (h("div", { className: "glass-panel", style: { padding: '1.25rem 1.5rem', marginBottom: '1.25rem' }, id: "problem-log" },
        h("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' } },
            h("div", null,
                h("h3", { style: { margin: '0 0 0.25rem', fontSize: '1rem' } },
                    "Problem log ",
                    h(HelpButton, { title: "Problem log", doc: "troubleshooting#problem-log", size: 16, style: { marginLeft: 6 } })),
                h("p", { style: { margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' } }, "Recent app diagnostics, with private details (GSTIN, PAN, phone, email, UPI ID, account numbers) removed. They stay in this browser profile; a report is sent only when you click Report.")),
            h("div", { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' } },
                h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.82rem' }, onClick: copyAll, disabled: !list.length && !savedLines?.length }, "Copy all"),
                h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.82rem' }, onClick: () => { clearProblems(); toast('Problem log cleared.', 'success'); }, disabled: !list.length }, "Clear log"))),
        list.length === 0
            ? h("p", { style: { margin: '0.9rem 0 0', fontSize: '0.88rem' } }, "No problems logged. Good.")
            : (h("ul", { className: "problem-log-list", style: { marginTop: '0.75rem' } }, list.map((e, i) => {
                const known = knownProblemFor(e);
                return (h("li", { key: `${e.time}-${i}` },
                    h("span", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' } },
                        when(e.time),
                        " \u00B7 ",
                        e.view || '?'),
                    h("span", { className: "problem-log-msg" },
                        e.api ? `${e.api.method} ${e.api.path} (${e.api.status || 'no answer'}): ` : '',
                        e.message,
                        known && h(Fragment, null,
                            " \u00B7 ",
                            h("a", { href: known.url, target: "_blank", rel: "noopener noreferrer" }, "How to fix"))),
                    h("span", { style: { display: 'flex', gap: '0.35rem' } },
                        h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.2rem 0.55rem' }, onClick: () => copy(reportText(e)) }, "Copy"),
                        h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.2rem 0.55rem' }, onClick: () => openReport(e) }, "Report"))));
            }))),
        h("details", { style: { marginTop: '1rem' } },
            h("summary", { style: { cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 } },
                "Saved app log ",
                savedLines ? `(${savedLines.length} recent line${savedLines.length === 1 ? '' : 's'})` : ''),
            savedKnown.length > 0 && (h("ul", { style: { margin: '0.6rem 0', paddingLeft: '1.1rem', fontSize: '0.85rem' } }, savedKnown.map((k) => h("li", { key: k.id },
                k.fix,
                " ",
                h("a", { href: `${TROUBLESHOOTING_URL}#${k.id}`, target: "_blank", rel: "noopener noreferrer" }, "How to fix"))))),
            h("pre", { className: "problem-log-server" }, savedLines === null ? 'Loading...' : savedLines.length ? savedLines.join('\n') : 'No saved app diagnostics.'))));
}
