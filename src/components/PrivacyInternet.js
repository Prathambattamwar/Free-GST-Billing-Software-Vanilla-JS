import { h, Fragment } from '../vanilla/dom.js';
// v1.10.83 - Settings → Privacy & internet. Asked for: "people want to be
// sure this is safe... how can we show them we are not tracking any data, or
// that they can turn the internet off". Every row here must match the code and
// docs-site/pages/security.mjs (#what-it-connects-to); change them together.
import { WifiOff, ShieldCheck } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
import { useOfflineMode } from '../utils/offlineMode.js';
import { docsLink } from '../utils.js';
const USES = [
    ['Checking for a new version', 'By itself: a few seconds after the app opens, then every 6 hours', 'Asks GitHub for the newest version number. Nothing about you is sent.', 'Stopped'],
    ['Local browser storage', 'Whenever you create or change a record', 'Reads and saves invoices, customers, products, GST records, settings and saved PDFs in this browser profile using IndexedDB.', 'Always available locally'],
    ['Updating the app', 'When you click Update or Check for Updates', 'Downloads the new version from GitHub.', 'Only when you click'],
    ['Help pages, Report a problem, WhatsApp, the GST portal', 'When you click them', 'Opens them in your browser, like any link.', 'Only when you click'],
];
const cell = { padding: '0.45rem 0.6rem', borderTop: '1px solid var(--border)', verticalAlign: 'top' };
export default function PrivacyInternet() {
    const [offline, toggle] = useOfflineMode();
    return (h(Fragment, null,
        h("h3", { className: "section-title" },
            "Privacy & internet ",
            h(HelpButton, { title: "Privacy and internet", doc: "security#offline-mode", size: 16, style: { marginLeft: 6 } })),
        h("p", { className: "page-subtitle", style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' } },
            h(ShieldCheck, { size: 18, style: { color: 'var(--success, #16a34a)', flexShrink: 0, marginTop: 2 }, "aria-hidden": "true" }),
            h("span", null, "Your invoices, clients and settings are stored on this device in this browser profile. No Google sign-in, OAuth, app server or shared database is used. The internet is only used for optional services below.")),
        h("label", { className: "notice notice-info", style: { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '1rem' } },
            h("input", { type: "checkbox", checked: offline, onChange: (e) => toggle(e.target.checked), style: { marginTop: 4, width: 18, height: 18, flexShrink: 0 } }),
            h("span", null,
                h("strong", { style: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem' } },
                    h(WifiOff, { size: 16, "aria-hidden": "true" }),
                    " Offline mode: never go online by itself"),
                h("br", null),
                h("span", { style: { fontSize: '0.85rem' } }, offline
                    ? 'On. Automatic internet requests such as update checks are paused. Local business data continues to work.'
                    : 'Off. Optional online resources can load automatically. Your business data remains local either way.'))),
        h("div", { className: "table-wrap", style: { overflowX: 'auto' } },
            h("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' } },
                h("thead", null,
                    h("tr", { style: { textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.78rem' } },
                        h("th", { style: { padding: '0.45rem 0.6rem' } }, "What uses the internet"),
                        h("th", { style: { padding: '0.45rem 0.6rem' } }, "When"),
                        h("th", { style: { padding: '0.45rem 0.6rem' } }, "What it does"),
                        h("th", { style: { padding: '0.45rem 0.6rem' } }, "Offline mode"))),
                h("tbody", null, USES.map(([what, when, does, stopped]) => (h("tr", { key: what },
                    h("td", { style: { ...cell, fontWeight: 600 } }, what),
                    h("td", { style: cell }, when),
                    h("td", { style: cell }, does),
                    h("td", { style: cell }, stopped))))))),
        h("p", { style: { fontSize: '0.85rem', margin: '0.75rem 0 0' } }, "Local storage does not require an internet connection. Export a JSON backup from Settings regularly; import it on another device to move your data."),
        h("div", { style: { marginTop: '1rem', padding: '0.75rem 0.9rem', borderRadius: 8, background: 'var(--bg-secondary)', fontSize: '0.85rem' } },
            h("strong", null, "Check it yourself in 2 minutes."),
            " Turn off Wi-Fi. You can still create invoices and save records locally. Only optional online resources such as update checks will be unavailable.",
            ' ',
            h("a", { href: docsLink('security#check-yourself'), target: "_blank", rel: "noopener noreferrer", style: { fontWeight: 600, color: 'var(--primary)' } }, "More ways to check \u2192"))));
}
