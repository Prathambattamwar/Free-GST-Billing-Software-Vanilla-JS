import { useState, h, Fragment } from '../vanilla/dom.js';
import { X, ChevronRight, Check } from '../vanilla/icons.js';
import { getPrintSettings, savePrintSettings, applyBusinessPreset } from '../utils/printSettings.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
import { patchInvoiceDefaults, getEnabledModules, setEnabledModules, setBusinessType } from '../store.js';
import { BUSINESS_TYPES, businessTypeById, applyBusinessType, invoiceDefaultsForType } from '../utils/businessTypes.js';
const PAPER_LABELS = { a4: 'A4', a5: 'A5', thermal80: '80mm thermal', thermal58: '58mm thermal' };
// ============================================================================
// v1.9.3 — First-run Setup Wizard
// Shown when onboardingComplete = false. 3 steps:
//   1. Business type (auto-configures 15+ settings via BUSINESS_PRESETS)
//   2. Paper size + language
//   3. Confirm + save
// User can Skip at any time; setting is marked complete either way.
// ============================================================================
export default function SetupWizard({ onClose }) {
    const [step, setStep] = useState(1);
    const [selectedBiz, setSelectedBiz] = useState('');
    const [paperSize, setPaperSize] = useState('a4');
    const [language, setLanguage] = useState('en');
    // v1.10.6 — audit L9. Prior code let `finish()` with no business
    // preset selected behave identically to `skip()` — user got two
    // indistinguishable "did nothing" exits. Now: finish() is disabled
    // (see button below) until at least one choice is made, so hitting
    // Finish always writes something meaningful. skip() stays available
    // for users who genuinely want to dismiss and configure later.
    const finish = () => {
        const current = getPrintSettings();
        // v1.10.33 — Clear onboardingSkipped when the user actually
        // completes setup, so the "Finish setup" pill hides for good.
        let next = { ...current, onboardingComplete: true, onboardingSkipped: false };
        // Preset first, THEN the language picked on step 2: four presets set
        // English, which used to overwrite a Hindi / Tamil / ... choice.
        if (selectedBiz)
            next = applyBusinessPreset(next, selectedBiz);
        // v1.10.83 - the business type also decides which features show. A new
        // install has nothing to lose, so it applies without asking (Settings →
        // Business type asks first).
        if (selectedBiz) {
            setEnabledModules(applyBusinessType(selectedBiz, getEnabledModules()));
            setBusinessType(selectedBiz);
        }
        next.labelLanguage = language;
        if (paperSize)
            next.paperSize = paperSize;
        savePrintSettings(next);
        // The invoice screen takes its paper size from the invoice defaults, not
        // from print settings. v1.10.83 - with the business type's invoice
        // defaults (a freelancer's invoices start in Services mode).
        const invoiceDefaults = { ...(selectedBiz ? invoiceDefaultsForType(selectedBiz) : {}), ...(paperSize ? { paperSize } : {}) };
        patchInvoiceDefaults(invoiceDefaults);
        toast('Setup complete! Your defaults are configured.', 'success');
        onClose();
    };
    const skip = () => {
        // v1.10.33 — Distinguishes "Skip" from "None of these":
        //   Skip           → onboardingComplete=true, onboardingSkipped=true
        //                    (App shows a bottom-right "Finish setup" pill)
        //   None of these  → onboardingComplete=true, onboardingSkipped=false
        //                    (user chose to configure manually — no nag)
        // Reported: "if user skip it should show in right side bottom so
        // they can do it again".
        const current = getPrintSettings();
        savePrintSettings({ ...current, onboardingComplete: true, onboardingSkipped: true });
        toast('Setup skipped — use the "Finish setup" pill to come back to it.', 'info');
        onClose();
    };
    const canFinish = !!selectedBiz || !!paperSize || language !== 'en';
    return (h("div", { className: "modal-overlay", style: { zIndex: 9999 } },
        h("div", { className: "modal-content", style: { maxWidth: '640px', maxHeight: '90vh', overflow: 'auto' } },
            h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' } },
                h("div", null,
                    h("h2", { style: { margin: 0, fontSize: '1.35rem' } },
                        "\uD83D\uDC4B Welcome to GST Billing ",
                        h(HelpButton, { title: "Setting up your invoices", doc: "first-run#setup-wizard", size: 16 })),
                    h("p", { style: { margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' } },
                        "Step ",
                        step,
                        " of 3 \u00B7 Takes 90 seconds")),
                h("button", { type: "button", className: "icon-btn", onClick: skip, title: "Skip setup \u2014 I'll configure later" },
                    h(X, { size: 18 }))),
            h("div", { style: { display: 'flex', gap: '0.35rem', marginBottom: '1.5rem' } }, [1, 2, 3].map(n => (h("div", { key: n, style: {
                    flex: 1, height: 4, borderRadius: 2,
                    background: n <= step ? 'var(--primary)' : 'var(--border)',
                } })))),
            step === 1 && (h(Fragment, null,
                h("h3", { style: { marginTop: 0 } },
                    "What kind of business do you run? ",
                    h(HelpButton, { title: "What kind of business do you run?", doc: "first-run#wizard-business-type", size: 16 })),
                h("p", { style: { fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' } }, "Pick one and the app shows the features that business needs, and sets an invoice style to match. You can change it later in Settings \u2192 Business type."),
                h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' } }, BUSINESS_TYPES.map(({ id: key, ...preset }) => (h("button", { key: key, type: "button", onClick: () => setSelectedBiz(key), style: {
                        padding: '0.85rem',
                        background: selectedBiz === key ? 'var(--primary)' : 'var(--card)',
                        color: selectedBiz === key ? '#fff' : 'var(--text)',
                        border: `2px solid ${selectedBiz === key ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 8,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: '0.85rem',
                    } },
                    h("div", { style: { fontWeight: 700, marginBottom: 3 } }, preset.label),
                    h("div", { style: { fontSize: '0.72rem', opacity: 0.85 } }, preset.hint))))),
                h("div", { style: { marginTop: '1rem', textAlign: 'center' } },
                    h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.82rem' }, onClick: () => {
                            const current = getPrintSettings();
                            savePrintSettings({ ...current, onboardingComplete: true, onboardingSkipped: false });
                            toast('Setup dismissed — configure any time from Settings → Print & PDF.', 'info');
                            onClose();
                        } }, "None of these \u2014 I'll configure manually")))),
            step === 2 && (h(Fragment, null,
                h("h3", { style: { marginTop: 0 } },
                    "Paper size + language ",
                    h(HelpButton, { title: "Paper size + language", doc: "first-run#wizard-paper-language", size: 16 })),
                h("p", { style: { fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' } }, "What are you mostly printing on?"),
                h("label", { style: { display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 } }, "Paper size"),
                h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem', marginBottom: '1.25rem' } }, [
                    ['a4', 'A4 · Standard'],
                    ['a5', 'A5 · Compact'],
                    ['thermal80', '80mm Thermal'],
                    ['thermal58', '58mm Thermal'],
                ].map(([key, label]) => (h("button", { key: key, type: "button", onClick: () => setPaperSize(key), style: {
                        padding: '0.7rem',
                        background: paperSize === key ? 'var(--primary)' : 'var(--card)',
                        color: paperSize === key ? '#fff' : 'var(--text)',
                        border: `2px solid ${paperSize === key ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                    } }, label)))),
                h("label", { style: { display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 } }, "Section label language"),
                h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' } }, [
                    ['en', 'English'], ['hi', 'हिन्दी (Hindi)'], ['ta', 'தமிழ் (Tamil)'],
                    ['mr', 'मराठी (Marathi)'], ['bn', 'বাংলা (Bengali)'],
                ].map(([key, label]) => (h("button", { key: key, type: "button", onClick: () => setLanguage(key), style: {
                        padding: '0.55rem',
                        background: language === key ? 'var(--primary)' : 'var(--card)',
                        color: language === key ? '#fff' : 'var(--text)',
                        border: `1px solid ${language === key ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 5,
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                    } }, label)))))),
            step === 3 && (h(Fragment, null,
                h("h3", { style: { marginTop: 0 } },
                    "Ready to go \uD83D\uDE80 ",
                    h(HelpButton, { title: "Ready to go", doc: "first-run#wizard-ready", size: 16 })),
                h("p", { style: { fontSize: '0.85rem', marginBottom: '1rem' } },
                    "We'll apply these defaults to every new invoice. You can change any of them later in ",
                    h("strong", null, "Settings \u2192 Print & PDF"),
                    "."),
                h("div", { style: { padding: '1rem', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.9rem' } },
                    h(Row, { label: "Business type", value: selectedBiz ? businessTypeById(selectedBiz)?.label : '(none — manual config)' }),
                    h(Row, { label: "Default paper size", value: PAPER_LABELS[paperSize] || paperSize }),
                    h(Row, { label: "Section label language", value: { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', mr: 'मराठी', bn: 'বাংলা' }[language] })),
                h("div", { style: { marginTop: '1rem', padding: '0.75rem', background: 'rgba(30, 64, 175, 0.06)', borderRadius: 6, fontSize: '0.82rem' } },
                    "\uD83D\uDCA1 ",
                    h("strong", null, "What happens next:"),
                    " When you create your first invoice, these settings apply automatically. Use the ",
                    h("strong", null, "PDF Style Editor"),
                    " to tune colours or the ",
                    h("strong", null, "Live preview"),
                    " to see any change instantly."))),
            h("div", { style: { display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem', gap: '0.5rem', flexWrap: 'wrap' } },
                h("button", { type: "button", className: "btn btn-secondary", onClick: skip, style: { fontSize: '0.82rem' } }, "Skip setup"),
                h("div", { style: { display: 'flex', gap: '0.5rem' } },
                    step > 1 && (h("button", { type: "button", className: "btn btn-secondary", onClick: () => setStep(step - 1) }, "Back")),
                    step < 3 ? (h("button", { type: "button", className: "btn btn-primary", onClick: () => setStep(step + 1) },
                        "Continue ",
                        h(ChevronRight, { size: 16 }))) : (h("button", { type: "button", className: "btn btn-primary", onClick: finish, disabled: !canFinish, title: canFinish ? '' : 'Pick a business type, paper size, or language first — or use Skip.' },
                        h(Check, { size: 16 }),
                        " Finish setup")))))));
}
function Row({ label, value }) {
    return (h("div", { style: { display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border)' } },
        h("span", { style: { color: 'var(--text-muted)' } }, label),
        h("span", { style: { fontWeight: 600 } }, value || '—')));
}
