import { h, Fragment } from '../vanilla/dom.js';
// v1.10.86 - "Customise Dashboard": show or hide each block, move it up or
// down, and choose the screen the app opens on. Per browser (listPrefs.js).
import { useState } from '../vanilla/dom.js';
import { ArrowUp, ArrowDown, X } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
import { DASHBOARD_BLOCKS, DEFAULT_LAYOUT, moveBlock, toggleBlock, START_VIEW_KEY, START_VIEWS } from '../utils/listPrefs.js';
const LABELS = Object.fromEntries(DASHBOARD_BLOCKS);
const readStart = () => { try {
    return localStorage.getItem(START_VIEW_KEY) || 'dashboard';
}
catch {
    return 'dashboard';
} };
export default function DashboardCustomise({ layout, onChange, onClose }) {
    const [start, setStart] = useState(readStart);
    const changeStart = (v) => {
        setStart(v);
        try {
            if (v === 'dashboard')
                localStorage.removeItem(START_VIEW_KEY);
            else
                localStorage.setItem(START_VIEW_KEY, v);
        }
        catch { /* private mode */ }
    };
    const reset = () => { onChange(DEFAULT_LAYOUT); changeStart('dashboard'); };
    return (h("div", { className: "modal-overlay", onClick: onClose },
        h("div", { className: "modal-content dash-customise", role: "dialog", "aria-modal": "true", "aria-labelledby": "dash-customise-title", onClick: (e) => e.stopPropagation(), style: { maxWidth: 480 } },
            h("div", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' } },
                h("h3", { id: "dash-customise-title", className: "section-title", style: { margin: 0, flex: 1 } },
                    "Customise Dashboard ",
                    h(HelpButton, { title: "Customise Dashboard", doc: "dashboard#customise", size: 16 })),
                h("button", { type: "button", className: "icon-btn", onClick: onClose, "aria-label": "Close" },
                    h(X, { size: 16 }))),
            h("p", { className: "text-muted", style: { fontSize: '0.82rem', margin: '0 0 0.75rem' } }, "Tick what to show and move it up or down. Kept in this browser."),
            h("ul", { className: "dash-customise-list" }, layout.order.map((id, i) => {
                const shown = !layout.hidden.includes(id);
                return (h("li", { key: id, className: shown ? '' : 'is-hidden' },
                    h("label", null,
                        h("input", { type: "checkbox", checked: shown, onChange: () => onChange(toggleBlock(layout, id)) }),
                        LABELS[id]),
                    h("button", { type: "button", className: "icon-btn", disabled: i === 0, onClick: () => onChange(moveBlock(layout, id, -1)), "aria-label": `Move ${LABELS[id]} up`, title: "Move up" },
                        h(ArrowUp, { size: 15 })),
                    h("button", { type: "button", className: "icon-btn", disabled: i === layout.order.length - 1, onClick: () => onChange(moveBlock(layout, id, 1)), "aria-label": `Move ${LABELS[id]} down`, title: "Move down" },
                        h(ArrowDown, { size: 15 }))));
            })),
            h("div", { className: "form-group", style: { marginTop: '1rem' } },
                h("label", { htmlFor: "start-view", className: "form-label" }, "Open the app on"),
                h("select", { id: "start-view", className: "form-input", value: start, onChange: (e) => changeStart(e.target.value) }, START_VIEWS.map(([v, label]) => h("option", { key: v, value: v }, label))),
                h("div", { className: "text-muted", style: { fontSize: '0.75rem', marginTop: '0.3rem' } }, "When you open the app. Going back to a screen while you work is not changed.")),
            h("div", { className: "flex gap-2 justify-end mt-4" },
                h("button", { type: "button", className: "btn btn-secondary", onClick: reset }, "Reset"),
                h("button", { type: "button", className: "btn btn-primary", onClick: onClose }, "Done")))));
}
