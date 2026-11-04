import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { ChevronUp, ChevronDown } from '../vanilla/icons.js';
import { FEATURE_GROUPS, isModuleEnabled } from '../utils.js';
import { BUSINESS_TYPES, businessTypeById, applyBusinessType, featureChanges, moduleLabel, orderedMenu, moveMenuItem, invoiceDefaultsForType } from '../utils/businessTypes.js';
import { getEnabledModules, setEnabledModules, getBusinessType, setBusinessType, getMenuOrder, setMenuOrder, getAllRecurring, patchInvoiceDefaults } from '../store.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
// v1.10.83 - Settings → Business type and Settings → Features.
// Both only change what is shown; nothing is ever deleted.
//
// Asked for: "just checkbox and save button to apply". Ticking, the arrows
// and picking a business type only change a draft; the page's one
// "Save all changes" bar applies it (and lists it as unsaved until then,
// like the Company form). The sidebar follows the saved copy only.
const muted = { fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 };
const readSaved = () => ({ modules: getEnabledModules(), type: getBusinessType(), order: getMenuOrder() });
const orderKey = (order) => orderedMenu(order).map(m => m.id).join();
// Draft + saved copy for both tabs. SettingsView adds `unsaved` to its bar
// and calls save() / discard() from "Save all changes" / "Discard".
export function useFeatureDraft() {
    const [saved, setSaved] = useState(readSaved);
    const [draft, setDraft] = useState(saved);
    const changes = featureChanges(saved.modules, draft.modules);
    const typeChanged = draft.type !== saved.type;
    const featuresChanged = changes.turnOn.length > 0 || changes.turnOff.length > 0 || orderKey(draft.order) !== orderKey(saved.order);
    const unsaved = [typeChanged && 'Business type', featuresChanged && 'Features'].filter(Boolean);
    const save = () => {
        if (featuresChanged) {
            setEnabledModules(draft.modules);
            setMenuOrder(draft.order);
        }
        if (typeChanged && draft.type) {
            setBusinessType(draft.type);
            patchInvoiceDefaults(invoiceDefaultsForType(draft.type));
        }
        setSaved(draft);
        toast('Features saved. The menu now shows your choices.', 'success');
    };
    const discard = () => setDraft(saved);
    return { draft, setDraft, saved, changes, unsaved, save, discard };
}
// In the browser edition, due recurring invoices are generated when the
// user next opens the app; no background server runs while the app is closed.
function useActiveRecurringCount() {
    const [count, setCount] = useState(0);
    useEffect(() => {
        getAllRecurring().then(list => setCount((list || []).filter(t => t && t.active !== false).length)).catch(() => { });
    }, []);
    return count;
}
const recurringNote = (n) => `You have ${n} recurring invoice${n === 1 ? '' : 's'}. Any invoices that become due are generated the next time you open the app. Manage or pause ${n === 1 ? 'it' : 'them'} on the Recurring screen.`;
// "Not saved yet: Turn on … Turn off …" - shown on both tabs while the draft differs.
function PendingChanges({ features }) {
    if (!features.unsaved.length)
        return null;
    const { turnOn, turnOff } = features.changes;
    return (h("div", { className: "notice notice-warn", style: { fontSize: '0.8rem', margin: '0.85rem 0' } },
        h("div", null,
            h("div", null,
                h("strong", null, "Not saved yet."),
                " Click ",
                h("strong", null, "Save all changes"),
                " at the bottom to apply."),
            turnOn.length > 0 && h("div", null,
                "Turn on: ",
                turnOn.map(moduleLabel).join(', ')),
            turnOff.length > 0 && h("div", null,
                "Turn off: ",
                turnOff.map(moduleLabel).join(', ')),
            h("div", { style: { opacity: 0.85 } }, "Nothing is deleted; this only changes what you see."))));
}
export function BusinessTypePanel({ features }) {
    const { draft, setDraft, saved } = features;
    const choose = (type) => setDraft({ ...draft, type: type.id, modules: applyBusinessType(type.id, draft.modules) });
    const chosen = businessTypeById(saved.type);
    return (h("div", { id: "section-biztype", className: "glass-panel p-6 mb-6", style: { order: 0 } },
        h("h3", { className: "section-title", style: { marginTop: 0, marginBottom: '0.25rem' } },
            "Business type ",
            h(HelpButton, { title: "Business type", doc: "settings#business-type", size: 16, style: { marginLeft: 6 } })),
        h("p", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 } }, "Pick what kind of business you run. The tick boxes in Features are filled in for that business; nothing changes until you save."),
        h("p", { style: { fontSize: '0.85rem', margin: '0.85rem 0' } },
            "Your business type: ",
            h("strong", null, chosen ? chosen.label : 'Not chosen yet')),
        !chosen && draft.type === saved.type && (h("div", { className: "notice notice-info", style: { fontSize: '0.8rem', marginBottom: '0.85rem' } }, "Pick one below so the menu shows only what you use. Your current switches stay exactly as they are until you pick and save.")),
        h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.6rem' } }, BUSINESS_TYPES.map(type => (h("button", { key: type.id, type: "button", onClick: () => choose(type), className: `type-chip ${draft.type === type.id ? 'type-chip-active' : ''}`, "aria-pressed": draft.type === type.id, style: { textAlign: 'left', padding: '0.7rem 0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem' } },
            h("span", { style: { fontWeight: 600 } }, type.label),
            h("span", { style: { fontSize: '0.72rem', fontWeight: 400, opacity: 0.85 } }, type.hint))))),
        h(PendingChanges, { features: features })));
}
function Check({ id, label, help, modules, onToggle, note }) {
    const on = isModuleEnabled(id, modules);
    return (h("label", { style: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', flex: 1, minWidth: 0 } },
        h("input", { type: "checkbox", checked: on, onChange: () => onToggle(id), style: { width: 15, height: 15, accentColor: 'var(--primary)', marginTop: '2px', flexShrink: 0 } }),
        h("span", null,
            h("span", { style: { fontWeight: 600 } }, label),
            help && h("span", { style: { ...muted, display: 'block' } }, help),
            !on && note && h("span", { style: { ...muted, display: 'block', color: 'var(--warn-text)' } }, note))));
}
export function FeaturesPanel({ features, regionMode }) {
    const { draft, setDraft } = features;
    const recurring = useActiveRecurringCount();
    const notes = { recurring: recurring > 0 ? recurringNote(recurring) : '' };
    const type = businessTypeById(draft.type);
    const setModules = (modules) => setDraft({ ...draft, modules });
    const toggle = (id) => setModules({ ...draft.modules, [id]: !isModuleEnabled(id, draft.modules) });
    const move = (id, dir) => setDraft({ ...draft, order: moveMenuItem(draft.order, id, dir) });
    const reset = () => setModules(type ? applyBusinessType(type.id, draft.modules) : {});
    // Data-driven: every module in FEATURE_GROUPS and every item in MENU_ITEMS
    // shows up here, so a module added later needs no change to this screen.
    const menu = orderedMenu(draft.order);
    const menuModules = FEATURE_GROUPS.find(g => g.id === 'menu')?.modules || [];
    const renderSection = (section, title) => {
        const items = menu.filter(m => m.section === section);
        return (h("div", { className: "surface-card" },
            h("div", { style: { fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.5rem' } }, title),
            h("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.45rem' } }, items.map((item, i) => {
                const mod = menuModules.find(m => m.id === item.module);
                return (h("div", { key: item.id, "data-menu-item": item.id, style: { display: 'flex', alignItems: 'flex-start', gap: '0.4rem' } },
                    h("span", { style: { display: 'flex', gap: 2, flexShrink: 0 } },
                        h("button", { type: "button", className: "icon-btn", disabled: i === 0, onClick: () => move(item.id, -1), "aria-label": `Move ${item.label} up`, title: "Move up", style: { padding: 2 } },
                            h(ChevronUp, { size: 16 })),
                        h("button", { type: "button", className: "icon-btn", disabled: i === items.length - 1, onClick: () => move(item.id, 1), "aria-label": `Move ${item.label} down`, title: "Move down", style: { padding: 2 } },
                            h(ChevronDown, { size: 16 }))),
                    mod && !mod.core ? (h(Check, { id: mod.id, label: item.label, help: item.help, modules: draft.modules, onToggle: toggle, note: notes[mod.id] })) : (h("span", { style: { fontSize: '0.8rem', flex: 1, minWidth: 0 } },
                        h("span", { style: { fontWeight: 600 } }, item.label),
                        h("span", { style: { ...muted, marginLeft: '0.4rem' } }, "(always shown)"),
                        h("span", { style: { ...muted, display: 'block' } }, item.help)))));
            }))));
    };
    return (h("div", { id: "section-modules", className: "glass-panel p-6 mb-6", style: { order: 5 } },
        h("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' } },
            h("div", null,
                h("h3", { className: "section-title", style: { marginTop: 0, marginBottom: '0.25rem' } },
                    "Features ",
                    h(HelpButton, { title: "Features", doc: "settings#features", size: 16, style: { marginLeft: 6 } })),
                h("p", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 } },
                    "Tick what you want to see, untick what you don't, then click ",
                    h("strong", null, "Save all changes"),
                    ". Unticked things disappear from the menu and screens; your data stays untouched.")),
            h("button", { type: "button", className: "btn btn-secondary", onClick: reset, style: { fontSize: '0.78rem', padding: '0.35rem 0.7rem' } }, type ? 'Reset to my business type' : 'Reset to default')),
        h(PendingChanges, { features: features }),
        h("div", { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', margin: '1.1rem 0 0.5rem' } },
            h("h4", { style: { margin: 0, fontSize: '0.92rem' } },
                "Menu ",
                h(HelpButton, { title: "Menu: show, hide and order", doc: "settings#features-menu", size: 16, style: { marginLeft: 6 } })),
            h("span", { style: muted },
                "Use the arrows to change the order of the menu.",
                ' ',
                draft.order.length > 0 && h("button", { type: "button", onClick: () => setDraft({ ...draft, order: [] }), style: { fontSize: '0.72rem', background: 'none', border: 0, color: 'var(--primary)', cursor: 'pointer', padding: 0 } }, "Default order"))),
        h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' } },
            renderSection('main', 'Top of the menu'),
            renderSection('bottom', 'Bottom of the menu'),
            renderSection('top', 'Buttons at the top right')),
        h("h4", { style: { margin: '1.25rem 0 0.5rem', fontSize: '0.92rem' } },
            "Features inside screens ",
            h(HelpButton, { title: "Features inside screens", doc: "settings#features-inside-screens", size: 16, style: { marginLeft: 6 } })),
        h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' } }, FEATURE_GROUPS.filter(g => g.id !== 'menu').map(group => {
            // India-only switches do nothing outside India, so they are not listed.
            const mods = group.modules.filter(m => !m.core && !(m.indiaOnly && regionMode === 'international'));
            if (!mods.length)
                return null;
            return (h("div", { key: group.id, className: "surface-card" },
                h("div", { style: { fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.5rem' } }, group.label),
                h("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.45rem' } }, mods.map(mod => h(Check, { key: mod.id, id: mod.id, label: mod.label, help: mod.help, modules: draft.modules, onToggle: toggle, note: notes[mod.id] })))));
        }))));
}
