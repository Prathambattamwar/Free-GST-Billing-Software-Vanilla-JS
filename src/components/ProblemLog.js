import { h, Fragment } from '../vanilla/dom.js';
// v1.10.83 - Problem log, under . Lists the problems this
// browser logged (newest first) and the browser-local error log lines,
// both already redacted. Nothing leaves the computer until Report is clicked.
import { useEffect, useState } from '../vanilla/dom.js';
import { getProblems, clearProblems, onProblemsChanged, copyText, openReport } from '../utils/problemLog.js';
import { knownProblemFor, matchKnownProblem, reportText, KNOWN_PROBLEMS } from '../utils/errorReport.js';
import { toast } from './Toast.js';
const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export default function ProblemLog() {
    const [items, setItems] = useState(() => getProblems());
    const [serverLines, setServerLines] = useState(null);
    useEffect(() => onProblemsChanged(() => setItems(getProblems())), []);
    useEffect(() => {
        let live = true;
        fetch('/api/errors-log').then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live)
            setServerLines(Array.isArray(d?.lines) ? d.lines : []); })
            .catch(() => { if (live)
            setServerLines([]); });
        return () => { live = false; };
    }, []);
    const copy = async (text) => toast(await copyText(text) ? 'Copied. Paste it into an email or a GitHub issue.' : 'Could not copy. Select the text and press Ctrl+C.', 'info');
    const copyAll = () => copy(items.slice().reverse().map(reportText).join('\n\n')
        + (serverLines?.length ? `\n\nBrowser log (last ${serverLines.length} lines):\n\`\`\`\n${serverLines.join('\n')}\n\`\`\`` : ''));
    // Known problems seen in the browser log (a damaged file, a full disk...).
    const serverKnown = [...new Set((serverLines || []).map((l) => matchKnownProblem(l)?.id).filter(Boolean))]
        .map((id) => KNOWN_PROBLEMS.find((k) => k.id === id));
    const list = items.slice().reverse();
    return (h("div", { className: "glass-panel", style: { padding: '1.25rem 1.5rem', marginBottom: '1.25rem' }, id: "problem-log" },
        h("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' } },
            h("div", null,
                h("h3", { style: { margin: '0 0 0.25rem', fontSize: '1rem' } },
                    "Problem log ",
                    ),
                h("p", { style: { margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' } }, "Problems the app ran into on this computer, with private details (GSTIN, PAN, phone, email, UPI ID, account numbers) removed. Nothing is sent anywhere unless you click Report.")),
            h("div", { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' } },
                h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.82rem' }, onClick: copyAll, disabled: !list.length && !serverLines?.length }, "Copy all"),
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
                            h("span", { style: { color: 'var(--text-muted)' } }, known.fix))),
                    h("span", { style: { display: 'flex', gap: '0.35rem' } },
                        h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.2rem 0.55rem' }, onClick: () => copy(reportText(e)) }, "Copy"),
                        h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.2rem 0.55rem' }, onClick: () => openReport(e) }, "Report"))));
            }))),
        h("details", { style: { marginTop: '1rem' } },
            h("summary", { style: { cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 } },
                "Browser log ",
                serverLines ? `(${serverLines.length} recent line${serverLines.length === 1 ? '' : 's'})` : ''),
            serverKnown.length > 0 && (h("ul", { style: { margin: '0.6rem 0', paddingLeft: '1.1rem', fontSize: '0.85rem' } }, serverKnown.map((k) => h("li", { key: k.id }, k.fix)))),
            h("pre", { className: "problem-log-server" }, serverLines === null ? 'Loading...' : serverLines.length ? serverLines.join('\n') : 'The browser log is empty.'))));
}
