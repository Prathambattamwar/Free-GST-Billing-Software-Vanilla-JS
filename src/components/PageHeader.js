import { h, Fragment } from '../vanilla/dom.js';
// v1.10.37 - Reusable page header (was a gradient card with an icon badge,
// a title, a subtitle line and the action buttons on the right).
//
// v1.10.86 - the header is the top bar now (maintainer, 15 Nov: "what if we
// have all things in one in top bar", chosen: one line, some icons). It is
// drawn into App.jsx's top bar through two portals (components/pageBarSlots.js):
//   [title (?) meta extras]   [search]   [secondary icons][primary]   [? bell ...]
//
// Props:
//   title      the page name (plain words; the (?) is added from `help`)
//   help       { title, doc } for the (?) button next to the title
//   subtitle   the line that was under the title: now the (?) button's tooltip
//   meta       a short count or note after the title ("26 invoices")
//   extras     controls that belong to the title (Dashboard's "Totals for",
//              a Year box, Cash / Bank tabs); they keep their words
//   secondary  the screen's other buttons, as <BarButton>s (icons with a
//              tooltip); in the "⋯" menu on a phone or a narrow window
//   primary    the screen's main button, with its words ("New Invoice")
import { useContext, useEffect, useRef, useState } from '../vanilla/dom.js';
import { createPortal } from '../vanilla/dom.js';
import { MoreHorizontal } from '../vanilla/icons.js';
import HelpButton from './HelpButton.js';
import { PageBarSlots } from './pageBarSlots.js';
// An icon button for the top bar. `label` is its name (what it said before it
// became an icon, so screen readers and the tests find it the same way); it is
// shown again as words inside the ⋯ menu. With `href` it is a link.
export function BarButton({ icon, label, title, ...rest }) {
    const Icon = icon;
    const Tag = rest.href ? 'a' : 'button';
    return (h(Tag, { type: rest.href ? undefined : 'button', className: "topbar-btn page-bar-btn", title: title || label, "aria-label": label, ...rest },
        h(Icon, { size: 18, "aria-hidden": "true" }),
        h("span", { className: "pb-label" }, label)));
}
export default function PageHeader({ title, help, subtitle, meta, extras, secondary, primary }) {
    const slots = useContext(PageBarSlots);
    const [open, setOpen] = useState(false);
    const moreRef = useRef(null);
    useEffect(() => {
        if (!open)
            return undefined;
        const close = (e) => {
            if (e.type === 'keydown' ? e.key === 'Escape' : !moreRef.current?.contains(e.target))
                setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [open]);
    // The bar mounts in the same render as the first screen; the portals follow
    // straight after (before anything is painted).
    if (!slots?.title || !slots?.actions)
        return null;
    return (h(Fragment, null,
        createPortal(h("div", { className: "page-bar-head" },
            h("h1", { className: "page-title" },
                title,
                help && h(HelpButton, { title: help.title, doc: help.doc, hint: subtitle, size: 16 })),
            meta ? h("span", { className: "page-bar-meta" }, meta) : null,
            extras), slots.title),
        createPortal(h(Fragment, null,
            secondary && (h("div", { className: "page-bar-more", ref: moreRef },
                h("button", { type: "button", className: "topbar-btn page-bar-more-btn", onClick: () => setOpen((o) => !o), title: "More buttons for this page", "aria-label": "More buttons", "aria-haspopup": "true", "aria-expanded": open },
                    h(MoreHorizontal, { size: 18 })),
                h("div", { className: `page-bar-secondary${open ? ' is-open' : ''}`, onClick: () => setOpen(false) }, secondary))),
            primary), slots.actions)));
}
