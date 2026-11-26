import { h, Fragment } from '../vanilla/dom.js';
// v1.10.86 - a small window for changing one row of a list (a cash entry, a
// cost centre), so the form at the top of the screen stays for adding.
// Requested: "open this edit button in a modal ... I guess we can have a modal
// in more places where things need to edit or change".
// Same look as Customise menu (.mc-dialog): a title bar, the fields, and
// Delete on the left, Cancel and Save on the right. Enter saves (it is a
// form), Esc or a click outside cancels, and the keyboard goes back to the
// pencil that opened it. A sheet from the bottom on a phone.
import { useEffect, useRef } from '../vanilla/dom.js';
import { X, Save, Trash2 } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
export default function EditDialog({ title, help, onClose, onSave, onDelete, deleteLabel = 'Delete', saving, children }) {
    const boxRef = useRef(null);
    const closeRef = useRef(onClose);
    const downOnOverlay = useRef(false);
    useEffect(() => { closeRef.current = onClose; });
    useEffect(() => {
        const before = document.activeElement;
        // The first box, ready to type over.
        const first = boxRef.current?.querySelector('[data-autofocus]') || boxRef.current?.querySelector('input:not([type="hidden"]), select, textarea');
        first?.focus();
        first?.select?.();
        const onKey = (e) => {
            // Not when a suggestion list took the Esc, or the Delete question is open.
            if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.confirm-modal-overlay'))
                return;
            e.preventDefault();
            closeRef.current();
        };
        window.addEventListener('keydown', onKey);
        return () => { window.removeEventListener('keydown', onKey); before?.focus?.(); };
    }, []);
    return (
    // Closes on a click that starts and ends outside the window (not on a text
    // selection dragged out of a box).
    h("div", { className: "modal-overlay mc-overlay", onMouseDown: (e) => { downOnOverlay.current = e.target === e.currentTarget; }, onClick: (e) => { if (downOnOverlay.current && e.target === e.currentTarget)
            onClose(); } },
        h("form", { ref: boxRef, className: "modal-content mc-dialog ed-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "ed-title", noValidate: true, onSubmit: (e) => { e.preventDefault(); if (!saving)
                onSave(); } },
            h("div", { className: "mc-head" },
                h("h3", { id: "ed-title", className: "mc-title" },
                    title,
                    help && h(HelpButton, { title: title, doc: help, size: 16 })),
                h("button", { type: "button", className: "mc-close", onClick: onClose, "aria-label": "Close", title: "Close (Esc)" },
                    h(X, { size: 18 }))),
            h("div", { className: "mc-body" }, children),
            h("div", { className: "mc-foot" },
                onDelete ? (h("button", { type: "button", className: "btn btn-secondary ed-delete", onClick: onDelete, disabled: saving },
                    h(Trash2, { size: 15 }),
                    " ",
                    deleteLabel)) : h("span", null),
                h("div", { className: "ed-actions" },
                    h("button", { type: "button", className: "btn btn-secondary", onClick: onClose }, "Cancel"),
                    h("button", { type: "submit", className: "btn btn-primary", disabled: saving },
                        h(Save, { size: 15 }),
                        " Save"))))));
}
