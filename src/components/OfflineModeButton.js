import { h, Fragment } from '../vanilla/dom.js';
// v1.10.83 - the Wi-Fi button at the top right (asked for: "on top a button
// to make our software offline, and it shows what will happen when offline").
// Same switch as Settings → Privacy & internet; what it stops must match
// src/utils/offlineMode.js and docs-site/pages/security.mjs#offline-mode.
import { useState } from '../vanilla/dom.js';
import { Wifi, WifiOff, Check } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
import { useOfflineMode } from '../utils/offlineMode.js';
const STOPS = [
    'The app does not automatically check for new releases or sync business records; Google Drive backup actions are also disabled.',
    'Your invoices and saved PDFs remain in this browser profile.',
];
const KEEPS = [
    'Invoices, PDFs, printing, payments, stock, reports, GST returns and local backups remain available.',
    'Your browser may still need internet to load uncached app libraries or open external links.',
];
export default function OfflineModeButton({ className, onOpenSettings }) {
    const [on, setOn] = useOfflineMode();
    const [open, setOpen] = useState(false);
    const label = on ? 'Offline mode is on' : 'Offline mode is off';
    return (h(Fragment, null,
        h("button", { type: "button", className: className, onClick: () => setOpen(true), title: `${label}: click to see or change it`, "aria-label": label, style: on ? { color: '#d97706' } : undefined }, on ? h(WifiOff, { size: 18 }) : h(Wifi, { size: 18 })),
        open && (h("div", { className: "modal-overlay", onClick: () => setOpen(false) },
            h("div", { className: "modal-content", role: "dialog", "aria-labelledby": "offline-title", style: { maxWidth: '480px' }, onClick: (e) => e.stopPropagation() },
                h("h3", { id: "offline-title", className: "section-title", style: { margin: '0 0 0.4rem', display: 'flex', alignItems: 'center', gap: '0.45rem' } },
                    on ? h(WifiOff, { size: 20, style: { color: '#d97706' } }) : h(Wifi, { size: 20 }),
                    " Offline mode",
                    h(HelpButton, { title: "Offline mode", doc: "security#offline-mode", size: 16 })),
                h("p", { style: { margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' } }, on
                    ? 'On. The app keeps business data in this browser, disables automatic release checks, and disables Google Drive backup actions.'
                    : 'Off. Business data is still stored locally by default. Optional Google Drive backups are available when you choose them; first-time or uncached libraries may still require internet.'),
                h("div", { style: { fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.3rem' } }, on ? 'While it is on' : 'When it is on'),
                h("ul", { style: { margin: '0 0 0.8rem', paddingLeft: '1.1rem', fontSize: '0.85rem', lineHeight: 1.55 } }, STOPS.map((t) => h("li", { key: t }, t))),
                h("div", { style: { fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.3rem' } }, "What stays the same"),
                h("ul", { style: { margin: '0 0 1rem', paddingLeft: '1.1rem', fontSize: '0.85rem', lineHeight: 1.55, listStyle: 'none' } }, KEEPS.map((t) => h("li", { key: t, style: { display: 'flex', gap: '0.4rem' } },
                    h(Check, { size: 15, style: { color: 'var(--success, #16a34a)', flexShrink: 0, marginTop: 3 }, "aria-hidden": "true" }),
                    t))),
                h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
                    h("button", { type: "button", className: `btn ${on ? 'btn-secondary' : 'btn-primary'}`, onClick: () => setOn(!on) }, on ? h(Fragment, null,
                        h(Wifi, { size: 16 }),
                        " Turn Offline mode off") : h(Fragment, null,
                        h(WifiOff, { size: 16 }),
                        " Turn Offline mode on")),
                    h("button", { type: "button", className: "btn btn-secondary", onClick: () => setOpen(false) }, "Close"),
                    onOpenSettings && (h("button", { type: "button", onClick: () => { setOpen(false); onOpenSettings(); }, style: { background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem', fontWeight: 600, color: 'var(--primary)', textDecoration: 'underline' } }, "Everything that uses the internet"))))))));
}
