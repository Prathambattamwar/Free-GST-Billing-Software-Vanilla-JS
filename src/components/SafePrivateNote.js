import { h, Fragment } from '../vanilla/dom.js';
// v1.10.83 - "Is this open-source app safe?" answered where people first ask
// it: the welcome screen and Support & About. Every line here must stay true;
// the full, checked answer is the docs page docs-site/pages/security.mjs.
import { ShieldCheck, HardDrive, UserX, WifiOff, EyeOff, Code, Download, Archive, KeyRound, Bug, RefreshCw, ListChecks } from '../vanilla/icons.js';
import { docsLink } from '../utils.js';
const POINTS = [
    'Your business data is stored locally in this browser',
    'No shared app database or shared storage account',
    'Export a backup to move your data to another device',
    'Free and open source: anyone can check the code',
];
export default function SafePrivateNote({ style }) {
    return (h("div", { role: "note", "aria-label": "Safe and private", style: { display: 'flex', gap: '0.7rem', alignItems: 'flex-start', padding: '0.75rem 0.9rem', borderRadius: 10,
            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', textAlign: 'left', ...style } },
        h(ShieldCheck, { size: 22, style: { color: 'var(--success, #16a34a)', flexShrink: 0, marginTop: 1 }, "aria-hidden": "true" }),
        h("div", { style: { minWidth: 0 } },
            h("div", { style: { fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '0.3rem' } }, "Safe and private"),
            h("ul", { style: { margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55 } }, POINTS.map((p) => h("li", { key: p }, p))),
            h("a", { href: docsLink('security'), target: "_blank", rel: "noopener noreferrer", style: { display: 'inline-block', marginTop: '0.35rem', fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary)' } }, "How we keep it safe \u2192"))));
}
// v1.10.83 - the full list, as its own section on Support & About ("make
// this safe and private a different section and bigger, with every point").
// Each line is a summary of a section of docs-site/pages/security.mjs.
const SAFETY = [
    { icon: HardDrive, title: 'Your data stays in this browser', text: 'Invoices, clients, products, settings and backups are stored in this browser profile using IndexedDB. No Google sign-in or shared app database is used.', doc: 'security#your-data-stays' },
    { icon: UserX, title: 'No app account or password', text: 'No account, password or OAuth permission is collected by the app.', doc: 'security#your-data-stays' },
    { icon: WifiOff, title: 'Local storage works offline', text: 'Business records can be read and saved without an internet connection. External help pages and optional online resources still need internet.', doc: 'security#offline-mode' },
    { icon: EyeOff, title: 'No tracking, no ads', text: 'No analytics and nothing sent to us. We never see your invoices, amounts, GSTIN or bank details. Free because we earn from paid work for businesses, not from data.', doc: 'security#why-free' },
    { icon: HardDrive, title: 'Move data to another device', text: 'Download a JSON backup from Settings and import it in the other browser.', doc: 'backup#export-import' },
    { icon: Code, title: 'Open source', text: 'Anyone can read the code on GitHub, and a developer can build the app from it themselves.', doc: 'security#open-source' },
    { icon: Download, title: 'Browser-based app', text: 'The deployed app is static HTML, CSS and JavaScript. No Node.js application server is used to process business records.', doc: 'security#open-source' },
    { icon: Archive, title: 'Daily local backups', text: 'Daily snapshots are saved in this browser profile and kept for 30 days. Download backups regularly to protect against browser-data loss.', doc: 'security#backups-and-lock' },
    { icon: KeyRound, title: 'Optional PIN lock', text: 'On a shared computer, lock the app with a PIN. It is stored only as a scrambled check value, never as the digits.', doc: 'security#backups-and-lock' },
    { icon: Bug, title: 'Problem reports only when you click', text: 'Diagnostic records stay in this browser profile. A report is sent only when you click Report.', doc: 'security#problem-reports' },
    { icon: RefreshCw, title: 'Security fixes in updates', text: 'A new version most Saturdays, urgent fixes sooner. GitHub security alerts watch the code libraries the app uses.', doc: 'security#updates-and-security-fixes' },
    { icon: ListChecks, title: 'Check it yourself', text: 'Review the browser storage panel to see the app database stored on this device.', doc: 'security#check-yourself' },
];
export function SafePrivateSection({ style }) {
    return (h("section", { className: "glass-panel", "aria-labelledby": "safe-private-title", style: { padding: '1.5rem', ...style } },
        h("div", { style: { display: 'flex', gap: '0.85rem', alignItems: 'center', marginBottom: '1.1rem' } },
            h(ShieldCheck, { size: 34, style: { color: 'var(--success, #16a34a)', flexShrink: 0 }, "aria-hidden": "true" }),
            h("div", null,
                h("h2", { id: "safe-private-title", style: { margin: 0, fontSize: '1.3rem' } }, "Safe and private"),
                h("p", { style: { margin: '0.15rem 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)' } },
                    "What happens to your business data, and what the app does and does not do.",
                    ' ',
                    h("a", { href: docsLink('security'), target: "_blank", rel: "noopener noreferrer", style: { fontWeight: 600, color: 'var(--primary)' } }, "The full answer \u2192")))),
        h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem 1.5rem' } }, SAFETY.map((p) => (h("div", { key: p.title, style: { display: 'flex', gap: '0.7rem', alignItems: 'flex-start' } },
            h(p.icon, { size: 20, style: { color: 'var(--primary)', flexShrink: 0, marginTop: 2 }, "aria-hidden": "true" }),
            h("div", { style: { minWidth: 0 } },
                h("a", { href: docsLink(p.doc), target: "_blank", rel: "noopener noreferrer", style: { fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', textDecoration: 'none' } }, p.title),
                h("p", { style: { margin: '0.2rem 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 } }, p.text))))))));
}
