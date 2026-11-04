// v1.10.83 - the Wi-Fi button at the top right (asked for: "on top a button
// to make our software offline, and it shows what will happen when offline").
// Same switch as Settings → Privacy & internet; what it stops must match
// src/utils/offlineMode.js and docs-site/pages/security.mjs#offline-mode.
import { useState, h, Fragment } from '../vanilla/dom.js';
import { Wifi, WifiOff, Check } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
import { useOfflineMode } from '../utils/offlineMode.js';
const STOPS = [
    'No automatic check for updates. Use Check for Updates in Settings when you want one.',
    'The supporters list is not loaded (the last numbers seen still show).',
    'Business data remains available locally. Automatic internet requests such as update checks and public lists are paused.',
];
const KEEPS = [
    'You can create and save records locally, even when you are offline.',
    'Links you click (help pages, WhatsApp, the GST portal) still open in your browser.',
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
                    ? 'On. Automatic internet requests such as update checks and public lists are paused. Local business data continues to work.'
                    : 'Off. Optional online resources can load automatically. Your business records remain stored locally either way.'),
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
