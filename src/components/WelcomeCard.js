// v1.10.81 - a welcome for new users at the top of the Dashboard (asked for by
// the maintainer): thanks them, and whoever told them about the app, says it
// is free for good, and that support of any amount is welcome but never
// needed. On the page, not a popup; shown until closed and only while the
// business has fewer than 10 invoices (from 10 the daily support card takes
// over, so the two never show together).
import { useState, h, Fragment } from '../vanilla/dom.js';
import { Heart, Share2, X } from '../vanilla/icons.js';
import { SUPPORT_NUDGE_MIN_INVOICES } from '../utils/supporters.js';
import HelpButton from './HelpButton.js';
const KEY = 'freegstbill_welcomeCard';
const SHARE_TEXT = 'I use Free GST Billing for my GST invoices. It is free and stores business data locally in my browser: https://github.com/IamRamgarhia/Free-GST-Billing-Software';
const isClosed = () => { try {
    return localStorage.getItem(KEY) === 'closed';
}
catch {
    return false;
} };
export default function WelcomeCard({ invoiceCount, onOpenSupport }) {
    const [closed, setClosed] = useState(isClosed);
    if (closed || invoiceCount >= SUPPORT_NUDGE_MIN_INVOICES)
        return null;
    const close = () => {
        try {
            localStorage.setItem(KEY, 'closed');
        }
        catch { /* private mode */ }
        setClosed(true);
    };
    return (h("section", { className: "welcome-card", "aria-labelledby": "welcome-card-title" },
        h("button", { type: "button", className: "welcome-card-close", onClick: close, "aria-label": "Close the welcome note" },
            h(X, { size: 18 })),
        h("h2", { id: "welcome-card-title" },
            "Thank you for choosing Free GST Billing ",
            h(HelpButton, { title: "The welcome note", doc: "dashboard#welcome-card", size: 16 })),
        h("p", { className: "welcome-card-lead" }, "And thank you to whoever told you about it. This app grows because shop owners, accountants and CAs recommend it to each other."),
        h("ul", { className: "welcome-card-points" },
            h("li", null,
                h("strong", null, "Free, for good."),
                " No subscription, no ads, no locked features."),
            h("li", null,
                h("strong", null, "Your data stays yours."),
                " Your invoices and business records are saved locally in this browser profile."),
            h("li", null,
                h("strong", null, "A new update every Saturday."),
                " Fixes and new features each week; tell us what you need on GitHub (Support & About)."),
            h("li", null,
                h("strong", null, "Support is welcome, never needed."),
                " If the app saves you time, any amount by UPI keeps it going.")),
        h("div", { className: "welcome-card-actions" },
            h("button", { type: "button", className: "welcome-card-btn welcome-card-btn-primary", onClick: onOpenSupport },
                h(Heart, { size: 16 }),
                " Support with any amount"),
            h("a", { className: "welcome-card-btn", href: `https://wa.me/?text=${encodeURIComponent(SHARE_TEXT)}`, target: "_blank", rel: "noopener noreferrer" },
                h(Share2, { size: 16 }),
                " Share on WhatsApp"),
            h("button", { type: "button", className: "welcome-card-btn welcome-card-btn-quiet", onClick: close }, "Start billing"))));
}
