// v1.10.81 - on Support & About: the weekly update (a new version every
// Saturday, decided with the maintainer), where to report problems and ask
// for features (GitHub issue forms), and "What's new" from the CHANGELOG.md
// that ships with the app. The changelog is shown as text (changelog.js
// parses it), never as HTML.
import { useEffect, useState, h, Fragment } from '../vanilla/dom.js';
import { Bug, Lightbulb, CalendarClock, ListChecks, Sparkles } from '../vanilla/icons.js';
import { parseChangelog, inlineParts } from '../utils/changelog.js';
import HelpButton from './HelpButton.js';
const REPO = 'https://github.com/IamRamgarhia/Free-GST-Billing-Software';
const CHANGELOG_URL = `${REPO}/blob/main/CHANGELOG.md`;
const card = { padding: '1.25rem 1.5rem' };
function Inline({ text }) {
    return inlineParts(text).map((p, i) => {
        if (p.t === 'b')
            return h("strong", { key: i }, p.v);
        if (p.t === 'i')
            return h("em", { key: i }, p.v);
        if (p.t === 'code')
            return h("code", { key: i }, p.v);
        if (p.t === 'link')
            return h("a", { key: i, href: p.href, target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--primary)' } }, p.v);
        return h("span", { key: i }, p.v);
    });
}
function Release({ entry }) {
    return (h(Fragment, null,
        entry.summary && h("p", { style: { margin: '0.35rem 0 0.6rem', fontWeight: 600, lineHeight: 1.5 } },
            h(Inline, { text: entry.summary })),
        entry.sections.map((s) => (h("div", { key: s.title, style: { marginBottom: '0.6rem' } },
            h("div", { style: { fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', margin: '0.5rem 0 0.25rem' } }, s.title),
            h("ul", { style: { margin: 0, paddingLeft: '1.1rem', fontSize: '0.84rem', lineHeight: 1.55 } }, s.blocks.map((b, i) => (b.kind === 'para'
                ? h("li", { key: i, style: { listStyle: 'none', marginLeft: '-1.1rem' } },
                    h(Inline, { text: b.text }))
                : (h("li", { key: i, style: { marginBottom: '0.25rem' } },
                    h(Inline, { text: b.text }),
                    b.children.length > 0 && (h("ul", { style: { margin: '0.2rem 0 0', paddingLeft: '1.1rem' } }, b.children.map((c, j) => h("li", { key: j },
                        h(Inline, { text: c })))))))))))))));
}
const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
export default function WhatsNew() {
    const [entries, setEntries] = useState(null);
    useEffect(() => {
        let live = true;
        fetch('/api/changelog')
            .then((r) => (r.ok ? r.json() : { text: '' }))
            .then(({ text }) => { if (live)
            setEntries(parseChangelog(text, 6)); })
            .catch(() => { if (live)
            setEntries([]); });
        return () => { live = false; };
    }, []);
    return (h(Fragment, null,
        h("div", { className: "glass-panel", style: { ...card, marginBottom: '1.25rem' }, "aria-labelledby": "weekly-title" },
            h("div", { style: { display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' } },
                h(CalendarClock, { size: 26, style: { color: 'var(--primary)', flexShrink: 0, marginTop: 2 } }),
                h("div", { style: { flex: '1 1 300px', minWidth: 0 } },
                    h("h3", { id: "weekly-title", style: { margin: '0 0 0.35rem', fontSize: '1rem' } },
                        "A new update every Saturday ",
                        h(HelpButton, { title: "A new update every Saturday", doc: "support#weekly", size: 16 })),
                    h("p", { style: { margin: '0 0 0.5rem', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '72ch' } },
                        "Every Saturday we release one update with that week's fixes and new features. The app tells you when it is ready: click ",
                        h("b", null, "Update"),
                        " in the sidebar, and your invoices and settings are kept. Anything urgent, such as the app not opening, is fixed straight away."),
                    h("p", { style: { margin: '0 0 0.9rem', fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: '72ch' } }, "Tell us on GitHub what is wrong or what you need. We read every request each week, the ones most people ask for come first, and you get a reply there when it is done."),
                    h("div", { style: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' } },
                        h("a", { className: "btn btn-primary", href: `${REPO}/issues/new?template=bug_report.yml`, target: "_blank", rel: "noopener noreferrer" },
                            h(Bug, { size: 16 }),
                            " Report a problem"),
                        h("a", { className: "btn btn-secondary", href: `${REPO}/issues/new?template=feature_request.yml`, target: "_blank", rel: "noopener noreferrer" },
                            h(Lightbulb, { size: 16 }),
                            " Ask for a feature"),
                        h("a", { className: "btn btn-secondary", href: `${REPO}/issues`, target: "_blank", rel: "noopener noreferrer" },
                            h(ListChecks, { size: 16 }),
                            " See all requests"),
                        entries && entries.length > 0 ? (h("button", { type: "button", className: "btn btn-secondary", onClick: () => document.getElementById('whats-new')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
                            h(Sparkles, { size: 16 }),
                            " What's new")) : (h("a", { className: "btn btn-secondary", href: CHANGELOG_URL, target: "_blank", rel: "noopener noreferrer" },
                            h(Sparkles, { size: 16 }),
                            " Changelog")))))),
        entries && entries.length > 0 && (h("div", { id: "whats-new", className: "glass-panel", style: { ...card, marginBottom: '1.25rem', scrollMarginTop: '1rem' }, "aria-labelledby": "whats-new-title" },
            h("h3", { id: "whats-new-title", style: { margin: '0 0 0.25rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                h(Sparkles, { size: 18, style: { color: 'var(--primary)' } }),
                " What's new ",
                h(HelpButton, { title: "What's new", doc: "support#whats-new", size: 16 })),
            h("p", { style: { margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' } },
                "The latest updates. Every version since the first is in the ",
                h("a", { href: CHANGELOG_URL, target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--primary)' } }, "full changelog"),
                ", and the downloads are on ",
                h("a", { href: `${REPO}/releases`, target: "_blank", rel: "noopener noreferrer", style: { color: 'var(--primary)' } }, "GitHub Releases"),
                "."),
            entries.map((e, i) => (h("details", { key: e.version, open: i === 0, style: { borderTop: '1px solid var(--border-color)', padding: '0.65rem 0' } },
                h("summary", { style: { cursor: 'pointer', fontWeight: 700 } },
                    "v",
                    e.version,
                    " ",
                    h("span", { style: { fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' } },
                        "\u00B7 ",
                        longDate(e.date))),
                h(Release, { entry: e }))))))));
}
