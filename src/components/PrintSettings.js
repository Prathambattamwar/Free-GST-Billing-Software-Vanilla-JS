import { useState, useEffect, useRef, h, Fragment } from '../vanilla/dom.js';
import { Printer, TestTube, RotateCcw, Info, Save as SaveIcon, Trash2 } from '../vanilla/icons.js';
import { toast } from './Toast.js';
import { confirmAction } from './ConfirmModal.js';
import InvoicePreview from './InvoicePreview.js';
import { getProfile, getInvoiceDisplayOptions, saveInvoiceDisplayOptions } from '../store.js';
import { DEFAULT_PRINT_SETTINGS, getPrintSettings, savePrintSettings, buildSampleInvoice, BUSINESS_PRESETS, applyBusinessPreset, LABEL_PRESETS } from '../utils/printSettings.js';
import HelpButton from './HelpButton.js';
// v1.9.9 — Visual design presets. Each is a starting point that flips
// the pdfTemplate + color palette + thermal typography + a couple of
// layout tweaks in one click. Users can still edit every individual
// setting below afterwards (the preset just seeds sensible defaults for
// the vibe they picked).
//
// v1.9.10 — presets now shape BOTH the PDF and the thermal render.
// Colors are PDF-only (thermal printers are B&W by physics), but font
// family / weight / spacing / all-caps / header alignment / content
// toggles all apply to both, so switching preset visibly changes the
// thermal preview too.
// v1.10.36 — Design presets rewrite. Reported: "current ones are not
// good at all". Prior set had 9 designs with ~3 near-duplicate pairs
// (Modern/Enterprise/IT Services all used pdfTemplate:'modern' with
// tiny palette tweaks — hard to tell apart from the swatch bar), a
// yellow-on-navy Corporate that looked dated, and no real editorial
// or brand-forward direction. Refreshed to 8 SHARPLY DIFFERENT designs
// with intentional palettes drawn from modern invoice design references
// (Stripe, Vercel, Linear, Ramp, boutique retail, editorial press).
//
// Each preset keeps the same `id` where the ID slot mapped to a
// pdfTemplate the codebase already renders — no template code changes,
// only palette + typographic pairing shifts. That way users with
// activePresetId already in localStorage continue to see something
// active, and any per-invoice pdfStyle overrides keep working.
//
// The `mockup` array on each preset drives the new mini-preview render
// (see the DESIGN_PRESETS.map(...) block below) — a proper little
// invoice thumbnail instead of the old 3-color strip.
const DESIGN_PRESETS = [
    {
        id: 'modern',
        name: 'Aurora',
        icon: '✦',
        description: 'Cool slate + electric blue. Modern SaaS invoice.',
        tag: 'Freelancers · Tech',
        settings: {
            pdfTemplate: 'modern',
            userColorsEnabled: true,
            pdfPrimaryText: '#0f172a', pdfMutedText: '#64748b',
            pdfAccent: '#2563eb', pdfAccentText: '#ffffff',
            pdfHeaderBg: '#f8fafc', pdfDividerColor: '#e2e8f0',
            fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
            lineSpacing: 'normal', allCaps: false,
            headerAlign: 'left', headerCaps: true, contrast: 'high',
        },
    },
    {
        id: 'classic',
        name: 'Editorial',
        icon: '❋',
        description: 'Deep charcoal on warm ivory. Newspaper-authority feel.',
        tag: 'Law · Consulting',
        settings: {
            pdfTemplate: 'classic',
            userColorsEnabled: true,
            pdfPrimaryText: '#1c1917', pdfMutedText: '#78716c',
            pdfAccent: '#1c1917', pdfAccentText: '#f5f5f4',
            pdfHeaderBg: '#f5f5f4', pdfDividerColor: '#d6d3d1',
            fontFamily: 'mono', fontWeight: 'ultra', fontSize: 'medium',
            lineSpacing: 'compact', allCaps: true,
            headerAlign: 'center', headerCaps: true, contrast: 'ultra',
        },
    },
    {
        id: 'corporate',
        name: 'Executive',
        icon: '◆',
        description: 'Deep navy + soft champagne. Boardroom serious.',
        tag: 'Enterprise · B2B',
        settings: {
            pdfTemplate: 'corporate',
            userColorsEnabled: true,
            pdfPrimaryText: '#0c1e3d', pdfMutedText: '#475569',
            pdfAccent: '#0c1e3d', pdfAccentText: '#e8dcc4',
            pdfHeaderBg: '#f4f2ed', pdfDividerColor: '#c4b896',
            fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
            lineSpacing: 'comfortable', allCaps: false,
            headerAlign: 'center', headerCaps: true, contrast: 'high',
        },
    },
    {
        id: 'minimalist',
        name: 'Whisper',
        icon: '○',
        description: 'Off-white, single hairline, zero clutter.',
        tag: 'Designers · Studios',
        settings: {
            pdfTemplate: 'minimalist',
            userColorsEnabled: true,
            pdfPrimaryText: '#171717', pdfMutedText: '#a3a3a3',
            pdfAccent: '#171717', pdfAccentText: '#ffffff',
            pdfHeaderBg: '#fafafa', pdfDividerColor: '#e5e5e5',
            fontFamily: 'sans', fontWeight: 'normal', fontSize: 'medium',
            lineSpacing: 'comfortable', allCaps: false,
            headerAlign: 'left', headerCaps: false, contrast: 'normal',
        },
    },
    {
        id: 'colorful',
        name: 'Sunset',
        icon: '❉',
        description: 'Warm terracotta on cream. Boutique, cafe, salon.',
        tag: 'Retail · Cafe',
        settings: {
            pdfTemplate: 'modern',
            userColorsEnabled: true,
            pdfPrimaryText: '#7c2d12', pdfMutedText: '#9a3412',
            pdfAccent: '#ea580c', pdfAccentText: '#ffffff',
            pdfHeaderBg: '#fef3ec', pdfDividerColor: '#fdba74',
            fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
            lineSpacing: 'normal', allCaps: false,
            headerAlign: 'center', headerCaps: true, contrast: 'high',
            showTagline: true,
        },
    },
    {
        id: 'minimal',
        name: 'Monoline',
        icon: '⌘',
        description: 'Editorial mono, dense rows, developer aesthetic.',
        tag: 'Dev · Agency',
        settings: {
            pdfTemplate: 'minimal',
            userColorsEnabled: true,
            pdfPrimaryText: '#0a0a0a', pdfMutedText: '#525252',
            pdfAccent: '#16a34a', pdfAccentText: '#ffffff',
            pdfHeaderBg: '#ffffff', pdfDividerColor: '#0a0a0a',
            pdfFontScale: 0.9,
            fontFamily: 'mono', fontWeight: 'ultra', fontSize: 'small',
            lineSpacing: 'compact', allCaps: true,
            headerAlign: 'left', headerCaps: true, contrast: 'ultra',
            showRateLine: false,
        },
    },
    {
        id: 'enterprise',
        name: 'Nordic',
        icon: '❄',
        description: 'Cool teal on frosted white. Calm, professional.',
        tag: 'SaaS · Studios',
        settings: {
            pdfTemplate: 'modern',
            userColorsEnabled: true,
            pdfPrimaryText: '#134e4a', pdfMutedText: '#0f766e',
            pdfAccent: '#0d9488', pdfAccentText: '#ffffff',
            pdfHeaderBg: '#f0fdfa', pdfDividerColor: '#99f6e4',
            pdfDarkenOnPrint: true,
            fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
            lineSpacing: 'normal', allCaps: false,
            headerAlign: 'left', headerCaps: true, contrast: 'high',
            showHSN: true,
        },
    },
    {
        id: 'retail',
        name: 'Bold Retail',
        icon: '▲',
        description: 'Aggressive black + red pop. Fashion, sports, street.',
        tag: 'Fashion · Sports',
        settings: {
            pdfTemplate: 'minimalist',
            userColorsEnabled: true,
            pdfPrimaryText: '#0a0a0a', pdfMutedText: '#404040',
            pdfAccent: '#dc2626', pdfAccentText: '#ffffff',
            pdfHeaderBg: '#ffffff', pdfDividerColor: '#0a0a0a',
            pdfDarkenOnPrint: true,
            fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
            lineSpacing: 'normal', allCaps: true,
            headerAlign: 'left', headerCaps: true, contrast: 'high',
            showHSN: true,
        },
    },
];
// ============================================================================
// Print Settings — app-wide defaults for the thermal printer render.
// Persisted to localStorage key `gst_printSettings`. InvoicePreview merges
// these with per-invoice overrides from invoiceOptions.
//
// Per user feedback (v1.8.3): existing thermal output had inconsistent
// darkness (some gray, some black), Large font size didn't scale properly,
// and users need dedicated controls to match their specific printer.
// Reference receipts from SMART BAZAAR / Reliance show the ideal style:
//   ALL CAPS · BOLD everywhere · consistent dark ink · monospace font
// ============================================================================
export default function PrintSettings() {
    const [settings, setSettings] = useState(getPrintSettings);
    const [showTestPreview, setShowTestPreview] = useState(false);
    const [profile, setProfile] = useState(null);
    const previewRef = useRef(null);
    // v1.9.8 — preview mode toggle so users see the right layout for the
    // change they're making. Sticky preview on the right stays in view as
    // they scroll settings on the left.
    const [previewMode, setPreviewMode] = useState('pdf'); // 'pdf' | 'thermal' | 'both'
    useEffect(() => { getProfile().then(setProfile).catch(() => { }); }, []);
    const set = (patch) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        savePrintSettings(next);
    };
    // v1.10.36 — Business-type awareness for "Recommended for" tags AND
    // for actually HIDING options that are irrelevant to the active
    // business type. Reported: "if I have selected freelance why it is
    // still showing me retails or other option — thermal etc should also
    // hide according to business type."
    //
    // Two helpers:
    //   isRecommendedForActive([...]) → shows a ★ badge on the option.
    //   isVisibleFor([...])           → returns true if the option should
    //                                   render AT ALL. Any option not
    //                                   listed here is always visible.
    //
    // Empty activeBiz (user hasn't picked a preset yet) shows everything
    // — no premature hiding.
    const activeBiz = settings.activeBusinessPresetId || '';
    const isRecommendedForActive = (recommendedList) => {
        if (!activeBiz)
            return false;
        return recommendedList.includes(activeBiz);
    };
    const isVisibleFor = (relevantList) => {
        if (!activeBiz)
            return true; // no preset → show everything
        return relevantList.includes(activeBiz); // preset picked → only show if listed
    };
    // Reusable "hidden by business type" note so users understand WHY an
    // option isn't there when their picked preset doesn't need it.
    const HIDDEN_HINT = activeBiz ? (h("span", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' } },
        "Some options are hidden because they don't apply to your \"",
        BUSINESS_PRESETS[activeBiz]?.label,
        "\" workflow. Change or clear the business type above to see everything.")) : null;
    const reset = () => {
        setSettings({ ...DEFAULT_PRINT_SETTINGS });
        savePrintSettings({ ...DEFAULT_PRINT_SETTINGS });
        toast('Print settings reset to defaults', 'info');
    };
    const runTestPrint = async () => {
        // Render a sample invoice with current settings, then trigger browser print.
        setShowTestPreview(true);
        // Wait for the browser to update the preview + fonts to load, then generate PDF.
        setTimeout(async () => {
            try {
                const { jsPDF } = await import('jspdf');
                const html2canvas = (await import('html2canvas')).default;
                if (!previewRef.current) {
                    toast('Preview not ready', 'error');
                    return;
                }
                // v1.10.3 — await fonts + capped scale + blob leak fix.
                if (document.fonts && document.fonts.ready) {
                    try {
                        await document.fonts.ready;
                    }
                    catch { /* non-fatal */ }
                }
                // v1.10.11 — buffer-safe mode lowers the scale + JPEG quality
                // and grayscales the capture so old thermal printers with
                // small buffers can accept it.
                const bufSafe = !!settings.thermalBufferSafe;
                const capScale = bufSafe
                    ? 2
                    : Math.min(6, Math.max(2, Math.round((window.devicePixelRatio || 1) * 1.5)));
                const canvas = await html2canvas(previewRef.current, {
                    scale: capScale,
                    backgroundColor: '#ffffff', useCORS: false, logging: false,
                });
                // Grayscale the canvas in-place when buffer-safe is on. This
                // simplifies the raster the printer driver needs to process.
                if (bufSafe) {
                    try {
                        const ctx = canvas.getContext('2d');
                        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const d = img.data;
                        for (let i = 0; i < d.length; i += 4) {
                            // Luminosity method; also boost contrast so grays snap to B/W.
                            const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                            const v = gray < 180 ? 0 : 255; // hard threshold for dot-matrix feel
                            d[i] = d[i + 1] = d[i + 2] = v;
                        }
                        ctx.putImageData(img, 0, 0);
                    }
                    catch { /* CORS-tainted canvas can't be read; fall back to raw */ }
                }
                const width = 80;
                const height = (canvas.height * width) / canvas.width;
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, Math.max(150, height)] });
                const jpegQ = bufSafe ? 0.72 : 0.95;
                pdf.addImage(canvas.toDataURL('image/jpeg', jpegQ), 'JPEG', 0, 0, width, height, undefined, 'FAST');
                // v1.10.3 — blob URL revoked in `finally`-equivalent (timer +
                // load handler both trigger cleanup once). Prior code only
                // revoked in onload; if the iframe never loaded (blocked, bad
                // PDF), the blob URL leaked forever.
                const blob = pdf.output('blob');
                const url = URL.createObjectURL(blob);
                let cleaned = false;
                const cleanup = () => { if (!cleaned) {
                    cleaned = true;
                    URL.revokeObjectURL(url);
                } };
                const timer = setTimeout(cleanup, 90_000);
                let frame = document.getElementById('fgsb-print-frame');
                if (!frame) {
                    frame = document.createElement('iframe');
                    frame.id = 'fgsb-print-frame';
                    frame.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:0;height:0;border:0;';
                    document.body.appendChild(frame);
                }
                frame.src = url;
                frame.onload = () => {
                    try {
                        frame.contentWindow.focus();
                        frame.contentWindow.print();
                    }
                    catch {
                        window.open(url, '_blank');
                    }
                    setTimeout(() => { clearTimeout(timer); cleanup(); }, 60_000);
                };
                frame.onerror = () => { clearTimeout(timer); cleanup(); };
                toast('Test print sent to your default printer', 'success');
            }
            catch (e) {
                console.error('Test print failed', e);
                toast('Test print failed — try Download PDF instead', 'error');
            }
        }, 300);
    };
    // Build the invoiceOptions that flows into the InvoicePreview for the test
    // preview. All the user's chosen print settings map into the thermal-specific
    // invoiceOptions fields that InvoicePreview already reads.
    const previewInvoiceOptions = {
        paperSize: 'thermal80',
        showGST: true,
        showBankDetails: settings.showBankDetails,
        showUPI: settings.showUPI,
        showAmountWords: settings.showAmountWords,
        showTerms: false, showNotes: false,
        thermalFontSize: settings.fontSize,
        thermalCompact: !settings.showRateLine && !settings.showHSN,
        thermalCutMark: settings.cutMark,
        // Custom fields wired in the InvoicePreview thermal render
        thermalFontFamily: settings.fontFamily,
        thermalFontWeight: settings.fontWeight,
        thermalAllCaps: settings.allCaps,
        thermalLineSpacing: settings.lineSpacing,
        thermalContrast: settings.contrast,
        thermalHeaderAlign: settings.headerAlign,
        thermalHeaderCaps: settings.headerCaps,
        thermalShowLogo: settings.showLogo,
        thermalShowHSN: settings.showHSN,
        thermalShowRate: settings.showRateLine,
        thermalQrSize: settings.qrSize,
        thermalFooterMessage: settings.footerMessage,
        thermalFeedLines: settings.feedLines,
        thermalTagline: settings.showTagline ? settings.tagline : '',
    };
    const sample = buildSampleInvoice(profile);
    return (h("div", { className: "glass-panel p-6 mb-6" },
        h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' } },
            h("div", null,
                h("h3", { className: "section-title", style: { marginTop: 0, marginBottom: '0.25rem' } },
                    h(Printer, { size: 18, style: { display: 'inline', verticalAlign: -3, marginRight: 6 } }),
                    "Print & PDF Settings",
                    h("span", { style: { marginLeft: 6, verticalAlign: -2, display: 'inline-block' } },
                        h(HelpButton, { title: "Print & PDF Settings", doc: "print-settings#how-it-saves", size: 16 }))),
                h("p", { style: { fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 } }, "App-wide defaults for every printed / PDF invoice. 70+ settings \u2014 every one dynamic. Each invoice can override via its Customize panel.")),
            h("div", { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
                h("button", { className: "btn btn-secondary", style: { fontSize: '0.82rem' }, onClick: () => {
                        const next = { ...settings, onboardingComplete: false };
                        setSettings(next);
                        savePrintSettings(next);
                        toast('Setup wizard will re-open on next page reload', 'info');
                    }, title: "Show the first-run wizard again" }, "\uD83D\uDE80 Run setup wizard"),
                h("button", { className: "btn btn-secondary", style: { fontSize: '0.82rem' }, onClick: reset },
                    h(RotateCcw, { size: 14 }),
                    " Reset defaults"),
                h("button", { className: "btn btn-primary", style: { fontSize: '0.82rem' }, onClick: runTestPrint },
                    h(TestTube, { size: 14 }),
                    " Test Print"))),
        h("div", { className: "print-settings-layout", style: {
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 460px)',
                gap: '1.25rem',
                marginTop: '1.25rem',
                alignItems: 'flex-start',
            } },
            h("div", { className: "print-settings-body", style: { minWidth: 0 } },
                h("div", { style: {
                        padding: '0.85rem 1rem',
                        background: 'linear-gradient(135deg, var(--primary-light, rgba(30,64,175,0.06)), var(--card))',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        marginBottom: '1rem',
                    } },
                    h("div", { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' } },
                        h("strong", { style: { fontSize: '0.9rem' } },
                            "\u26A1 Business type ",
                            h(HelpButton, { title: "Business type preset", doc: "print-settings#business-type", size: 16, style: { marginLeft: 6 } }),
                            " ",
                            h("span", { style: { fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 } }, "sets up to a dozen settings to match your workflow")),
                        h("span", { style: { fontSize: '0.72rem', color: 'var(--text-muted)' } }, "Pick this first. Every setting below is still editable.")),
                    h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem' } }, Object.entries(BUSINESS_PRESETS).map(([key, preset]) => {
                        const active = settings.activeBusinessPresetId === key;
                        return (h("button", { key: key, type: "button", onClick: async () => {
                                if (!await confirmAction({
                                    title: `Apply "${preset.label}" preset?`,
                                    message: `This will overwrite ${Object.keys(preset.patch).length} print settings on top of your current setup. You can undo by picking "Reset defaults".`,
                                    confirmLabel: 'Apply preset',
                                    tone: 'warning',
                                }))
                                    return;
                                const next = { ...applyBusinessPreset(settings, key), activeBusinessPresetId: key };
                                setSettings(next);
                                savePrintSettings(next);
                                toast(`Applied "${preset.label}" preset`, 'success');
                            }, style: {
                                padding: '0.65rem 0.7rem',
                                border: active ? '2px solid var(--primary)' : '1px solid var(--border)',
                                borderRadius: 8,
                                background: active ? 'var(--primary-light, rgba(30,64,175,0.08))' : 'var(--card)',
                                cursor: 'pointer', textAlign: 'left',
                                display: 'flex', flexDirection: 'column', gap: '3px',
                                transition: 'all 0.15s',
                            } },
                            h("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } },
                                h("strong", { style: { fontSize: '0.82rem' } }, preset.label),
                                active && h("span", { style: { fontSize: '0.62rem', color: 'var(--primary)', fontWeight: 700 } }, "ACTIVE")),
                            h("span", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3 } }, preset.hint)));
                    }))),
                HIDDEN_HINT && (h("div", { style: { padding: '0.55rem 0.85rem', background: 'var(--primary-light, rgba(30,64,175,0.06))', border: '1px solid var(--border)', borderRadius: 8, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' } },
                    h("span", { style: { fontSize: '0.85rem' } }, "\u2139"),
                    HIDDEN_HINT,
                    h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.72rem', padding: '0.2rem 0.55rem', marginLeft: 'auto' }, onClick: () => set({ activeBusinessPresetId: '' }), title: "Clear business type to see every option regardless of relevance" }, "Show all options"))),
                h("div", { style: {
                        padding: '0.85rem 1rem',
                        background: 'linear-gradient(135deg, var(--bg-secondary), var(--card))',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        marginBottom: '1rem',
                    } },
                    h("div", { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' } },
                        h("strong", { style: { fontSize: '0.9rem' } },
                            "\uD83C\uDFA8 Visual style ",
                            h(HelpButton, { title: "Visual style", doc: "print-settings#visual-style", size: 16, style: { marginLeft: 6 } }),
                            " ",
                            h("span", { style: { fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 6 } }, "colours + typography for PDF & thermal")),
                        h("span", { style: { fontSize: '0.72rem', color: 'var(--text-muted)' } }, "Click a design to start. Edit anything below.")),
                    h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' } }, DESIGN_PRESETS.map(preset => {
                        // v1.9.13 — Multiple presets share the same pdfTemplate value
                        // (e.g. Modern, Colorful, and Enterprise all use pdfTemplate:
                        // 'modern'). Comparing on pdfTemplate lit up all of them at
                        // once. Track a distinct activePresetId instead.
                        const active = settings.activePresetId === preset.id;
                        // v1.10.36 — Mini-invoice mockup instead of the old 3-color
                        // bar. Uses the actual palette + font family the preset would
                        // apply, so users can eyeball the vibe (header band, business
                        // name in accent/primary, body rows in muted, total pill) in
                        // the preset's own colour language before clicking. Font
                        // family switches between mono + sans matching the preset so
                        // Editorial and Monoline read like receipts, Aurora + Nordic
                        // read like SaaS invoices.
                        const s = preset.settings;
                        const isMono = s.fontFamily === 'mono';
                        const mockupFont = isMono
                            ? '"Courier New", ui-monospace, monospace'
                            : 'system-ui, -apple-system, "Segoe UI", sans-serif';
                        return (h("button", { key: preset.id, type: "button", onClick: () => {
                                const next = { ...settings, ...preset.settings, activePresetId: preset.id };
                                setSettings(next);
                                savePrintSettings(next);
                                toast(`Applied "${preset.name}" design — every setting still editable below`, 'success');
                            }, style: {
                                padding: 0,
                                border: active ? '2px solid var(--primary)' : '1px solid var(--border)',
                                borderRadius: 10,
                                background: active ? 'var(--primary-light, rgba(30,64,175,0.06))' : 'var(--card)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                overflow: 'hidden',
                                transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
                                boxShadow: active ? '0 4px 14px rgba(30,64,175,0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
                            }, onMouseEnter: (e) => { if (!active)
                                e.currentTarget.style.transform = 'translateY(-2px)'; }, onMouseLeave: (e) => { e.currentTarget.style.transform = 'translateY(0)'; }, title: preset.description },
                            h("div", { style: {
                                    height: 110,
                                    background: s.pdfHeaderBg || '#ffffff',
                                    padding: '10px 12px',
                                    display: 'flex', flexDirection: 'column', gap: 6,
                                    fontFamily: mockupFont,
                                    borderBottom: `1px solid ${s.pdfDividerColor || '#e5e5e5'}`,
                                } },
                                h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } },
                                    h("span", { style: {
                                            fontSize: 10, fontWeight: 700,
                                            color: s.pdfPrimaryText || '#0f172a',
                                            letterSpacing: s.allCaps || s.headerCaps ? '0.05em' : '0',
                                            textTransform: (s.allCaps || s.headerCaps) ? 'uppercase' : 'none',
                                        } }, "BUSINESS"),
                                    h("span", { style: {
                                            fontSize: 8, fontWeight: 700,
                                            color: s.pdfAccent || '#1e40af',
                                            letterSpacing: '0.08em',
                                        } }, "INVOICE")),
                                h("div", { style: { height: 2, background: s.pdfAccent || '#1e40af', width: '35%' } }),
                                h("div", { style: { display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 } },
                                    h("div", { style: { display: 'flex', justifyContent: 'space-between' } },
                                        h("div", { style: { height: 4, background: s.pdfMutedText || '#94a3b8', width: '55%', borderRadius: 1, opacity: 0.6 } }),
                                        h("div", { style: { height: 4, background: s.pdfMutedText || '#94a3b8', width: '18%', borderRadius: 1, opacity: 0.6 } })),
                                    h("div", { style: { display: 'flex', justifyContent: 'space-between' } },
                                        h("div", { style: { height: 4, background: s.pdfMutedText || '#94a3b8', width: '45%', borderRadius: 1, opacity: 0.4 } }),
                                        h("div", { style: { height: 4, background: s.pdfMutedText || '#94a3b8', width: '15%', borderRadius: 1, opacity: 0.4 } }))),
                                h("div", { style: {
                                        marginTop: 'auto', alignSelf: 'flex-end',
                                        background: s.pdfAccent || '#1e40af',
                                        color: s.pdfAccentText || '#ffffff',
                                        fontSize: 8, fontWeight: 700,
                                        padding: '2px 8px', borderRadius: 3,
                                        letterSpacing: '0.04em',
                                    } }, "TOTAL \u20B91,250")),
                            h("div", { style: { padding: '0.55rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 3 } },
                                h("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } },
                                    h("span", { style: { fontSize: '0.85rem', fontWeight: 700 } },
                                        h("span", { style: { marginRight: 5, opacity: 0.7 } }, preset.icon),
                                        preset.name),
                                    active && h("span", { style: { fontSize: '0.6rem', color: 'var(--primary)', fontWeight: 700, letterSpacing: '0.04em' } }, "ACTIVE")),
                                preset.tag && (h("span", { style: {
                                        fontSize: '0.6rem', color: 'var(--text-muted)',
                                        textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
                                    } }, preset.tag)),
                                h("span", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.3 } }, preset.description))));
                    }))),
                isVisibleFor(['retail_shop', 'restaurant']) ? (h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' } },
                    h(SettingGroup, { title: "Typography (Thermal receipts)", doc: "print-settings#thermal-typography" },
                        h(SelectRow, { label: "Font family", value: settings.fontFamily, onChange: v => set({ fontFamily: v }), options: [
                                ['mono', 'Monospace (Courier) — thermal-optimized'],
                                ['sans', 'Sans-serif (Arial-like)'],
                            ], hint: "Applies to THERMAL receipts only. For A4/A5 PDFs use the 'PDF FONT FAMILY' section below." }),
                        h(SelectRow, { label: "Font size", value: settings.fontSize, onChange: v => set({ fontSize: v }), options: [
                                ['small', 'Small (fits more per receipt)'],
                                ['medium', 'Medium (recommended)'],
                                ['large', 'Large'],
                                ['xlarge', 'Extra Large (easier for older customers)'],
                            ] }),
                        h(SelectRow, { label: "Font weight", value: settings.fontWeight, onChange: v => set({ fontWeight: v }), options: [
                                ['normal', 'Normal'],
                                ['bold', 'Bold (recommended)'],
                                ['ultra', 'Ultra bold (darkest print)'],
                            ], hint: "Thermal print heads render bold weights much darker than normal \u2014 pick bold or ultra for consistent legibility." }),
                        h(ToggleRow, { label: "ALL CAPS mode", value: settings.allCaps, onChange: v => set({ allCaps: v }), hint: "Renders every text element in UPPERCASE \u2014 matches the SMART BAZAAR / Reliance receipt style. Best for high legibility." })),
                    h(SettingGroup, { title: "Layout", doc: "print-settings#thermal-layout" },
                        h(SelectRow, { label: "Line spacing", value: settings.lineSpacing, onChange: v => set({ lineSpacing: v }), options: [
                                ['compact', 'Compact (save paper)'],
                                ['normal', 'Normal'],
                                ['comfortable', 'Comfortable (easier to read)'],
                            ] }),
                        h(SelectRow, { label: "Header alignment", value: settings.headerAlign, onChange: v => set({ headerAlign: v }), options: [
                                ['center', 'Center (default)'],
                                ['left', 'Left-aligned'],
                            ] }),
                        h(SelectRow, { label: "Thermal ink darkness", value: settings.contrast, onChange: v => set({ contrast: v }), options: [
                                ['normal', 'Standard'],
                                ['high', 'Dark (recommended for older printers)'],
                                ['ultra', 'Extra-dark (max)'],
                            ], hint: "Applies grayscale + contrast filter to logo / QR so faded prints come out darker." }),
                        h(ToggleRow, { label: "Force ALL CAPS in header", value: settings.headerCaps, onChange: v => set({ headerCaps: v }), hint: "Business name always uppercase (independent of ALL CAPS mode)." })),
                    h(SettingGroup, { title: "Content", doc: "print-settings#thermal-content" },
                        h(ToggleRow, { label: "Show business logo", value: settings.showLogo, onChange: v => set({ showLogo: v }) }),
                        h(ToggleRow, { label: "Show HSN code per item", value: settings.showHSN, onChange: v => set({ showHSN: v }), hint: "Required for GST compliance if you're printing tax invoices. Turn off for informal counter receipts." }),
                        h(ToggleRow, { label: 'Show "Qty \u00D7 Rate" line per item', value: settings.showRateLine, onChange: v => set({ showRateLine: v }) }),
                        h(ToggleRow, { label: "Show amount in words", value: settings.showAmountWords, onChange: v => set({ showAmountWords: v }) }),
                        h(ToggleRow, { label: "Show bank details", value: settings.showBankDetails, onChange: v => set({ showBankDetails: v }) }),
                        h(ToggleRow, { label: "Show UPI QR code", value: settings.showUPI, onChange: v => set({ showUPI: v }) }),
                        settings.showUPI && (h(SelectRow, { label: "UPI QR size", value: settings.qrSize, onChange: v => set({ qrSize: v }), options: [
                                ['small', 'Small (60 × 60 px)'],
                                ['medium', 'Medium (90 × 90 px)'],
                                ['large', 'Large (120 × 120 px)'],
                            ] }))),
                    h(SettingGroup, { title: "Footer", doc: "print-settings#thermal-footer" },
                        h(TextRow, { label: "Custom footer message", value: settings.footerMessage, onChange: v => set({ footerMessage: v }), placeholder: "Thank you for your business!", hint: 'Appears above the cut mark. Leave blank to hide.' }),
                        h(ToggleRow, { label: 'Show cut mark ("\u2702 cut here")', value: settings.cutMark, onChange: v => set({ cutMark: v }), hint: "For thermal printers without auto-cutters. Turn off if your printer feeds paper automatically." }),
                        h(SelectRow, { label: "Feed lines after cut", value: String(settings.feedLines), onChange: v => set({ feedLines: parseInt(v, 10) }), options: [['0', 'No extra feed'], ['1', '1 line'], ['2', '2 lines (default)'], ['3', '3 lines'], ['4', '4 lines'], ['6', '6 lines']], hint: "Extra blank lines after the cut mark so the tear is clean." }),
                        h(ToggleRow, { label: "Show tagline", value: settings.showTagline, onChange: v => set({ showTagline: v }), hint: "Optional tagline printed below business name." }),
                        settings.showTagline && (h(TextRow, { label: "Tagline text", value: settings.tagline, onChange: v => set({ tagline: v }), placeholder: "e.g. Fresh & Local Since 2010" }))))) : (
                /* v1.10.36 — Thermal block hidden for non-thermal presets.
                   Show a subtle note so the user knows it's not missing. */
                h("div", { style: { padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--text-muted)' } },
                    "\uD83D\uDDA8 Thermal receipt settings (font, cut mark, feed lines, contrast) are hidden \u2014 the ",
                    h("strong", null, BUSINESS_PRESETS[activeBiz]?.label),
                    " preset uses A4/A5 PDFs. Switch business type above if you also print thermal receipts.")),
                h("div", { style: { marginTop: '1.75rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                    h("h4", { style: { margin: '0 0 0.75rem', fontSize: '0.95rem', color: 'var(--primary)' } },
                        "\uD83D\uDCC4 PDF & universal print features ",
                        h(HelpButton, { title: "PDF & universal print features", doc: "print-settings#pdf-features", size: 16, style: { marginLeft: 6 } })),
                    h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 1rem' } }, "Applies to A4 / A5 / Letter / Legal / thermal \u2014 every option here is dynamic (turn on / off any time)."),
                    h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' } },
                        h(SettingGroup, { title: "Auto-print", doc: "print-settings#auto-print" },
                            h(ToggleRow, { label: "Auto-print on save", value: settings.autoPrintOnSave, onChange: v => set({ autoPrintOnSave: v }), hint: "Send to your default printer immediately after Save & Download PDF. Perfect for POS counters \u2014 no manual click needed." })),
                        h(SettingGroup, { title: "Watermark", doc: "print-settings#watermark" },
                            h(ToggleRow, { label: "Show watermark", value: settings.watermarkEnabled, onChange: v => set({ watermarkEnabled: v }), hint: "Big diagonal stamp across the PDF (e.g. PAID / DUPLICATE / DRAFT)." }),
                            settings.watermarkEnabled && (h(Fragment, null,
                                h(ToggleRow, { label: "Use custom text instead of preset", value: settings.watermarkUseCustomText, onChange: v => set({ watermarkUseCustomText: v }), hint: "Type your own text below (e.g. 'FOR INTERNAL USE'). Turn off to use the PAID/DUPLICATE/etc. preset picker." }),
                                settings.watermarkUseCustomText ? (h(TextRow, { label: "Custom watermark text", value: settings.watermarkCustomText, onChange: v => set({ watermarkCustomText: v }), placeholder: "e.g. FOR INTERNAL USE" })) : (h(SelectRow, { label: "Watermark text", value: settings.watermarkText, onChange: v => set({ watermarkText: v }), options: [
                                        ['PAID', 'PAID'], ['DUPLICATE', 'DUPLICATE'], ['DRAFT', 'DRAFT'],
                                        ['OVERDUE', 'OVERDUE'], ['COPY', 'COPY'], ['ORIGINAL', 'ORIGINAL'],
                                        ['CANCELLED', 'CANCELLED'], ['REPRINT', 'REPRINT'],
                                    ] })),
                                h(SelectRow, { label: "Opacity", value: String(settings.watermarkOpacity), onChange: v => set({ watermarkOpacity: parseInt(v, 10) }), options: [['5', 'Very faint (5%)'], ['10', 'Faint (10%)'], ['15', 'Medium (15%)'], ['25', 'Strong (25%)'], ['40', 'Very strong (40%)']] })))),
                        isVisibleFor(['wholesale', 'manufacturer']) && (h(SettingGroup, { title: "Multi-copy (GST rule 48)", doc: "print-settings#copies" },
                            h(ToggleRow, { label: "Print multiple copies with labels", value: settings.multiCopyEnabled, onChange: v => set({ multiCopyEnabled: v }), tag: isRecommendedForActive(['wholesale', 'manufacturer']) ? 'Recommended for your business' : null, hint: "Prints your invoice N times with corner labels (ORIGINAL FOR RECIPIENT / DUPLICATE FOR TRANSPORTER / etc.). GST rule 48 requires 3 copies for goods, 2 for services." }),
                            settings.multiCopyEnabled && (h(SelectRow, { label: "Number of copies", value: String(settings.multiCopyCount), onChange: v => set({ multiCopyCount: parseInt(v, 10) }), options: [['2', '2 (Original + Duplicate — services)'], ['3', '3 (Original + Duplicate + Triplicate — goods)']] })))),
                        h(SettingGroup, { title: "Multi-page invoices", doc: "print-settings#multi-page" },
                            h(ToggleRow, { label: "Page numbers on pages 2+", value: settings.pageNumbersEnabled, onChange: v => set({ pageNumbersEnabled: v }), hint: 'Shows "Page 2 of 5" bottom-right on pages 2+. The first page is not numbered.' }),
                            h(ToggleRow, { label: "Business name header on pages 2+", value: settings.pageHeaderEnabled, onChange: v => set({ pageHeaderEnabled: v }), hint: "Repeats your business name at the top so multi-page invoices look professional." })),
                        h(SettingGroup, { title: "Print margins (mm)", doc: "print-settings#margins" },
                            h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' } },
                                h(NumInput, { label: "Top", value: settings.marginTop, onChange: v => set({ marginTop: v }) }),
                                h(NumInput, { label: "Bottom", value: settings.marginBottom, onChange: v => set({ marginBottom: v }) }),
                                h(NumInput, { label: "Left", value: settings.marginLeft, onChange: v => set({ marginLeft: v }) }),
                                h(NumInput, { label: "Right", value: settings.marginRight, onChange: v => set({ marginRight: v }) })),
                            h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', margin: '3px 0 0' } }, "For users printing on pre-printed letterhead \u2014 shift content down to avoid your logo, or in from the edge to fit binding.")),
                        h(SettingGroup, { title: "Verification codes", doc: "print-settings#verification-codes" },
                            h(ToggleRow, { label: "Invoice number as QR", value: settings.invoiceQrEnabled, onChange: v => set({ invoiceQrEnabled: v }), tag: isRecommendedForActive(['manufacturer', 'wholesale']) ? 'Recommended for your business' : null, hint: "Prints a QR of the invoice number (or verification URL if set below) in the bottom-right corner." }),
                            settings.invoiceQrEnabled && (h(TextRow, { label: "Verification URL (optional)", value: settings.invoiceQrUrl, onChange: v => set({ invoiceQrUrl: v }), placeholder: "https://mycompany.com/verify/{invoice_number}", hint: "{invoice_number} gets replaced with the actual invoice #. Leave blank to encode just the number." })),
                            h(ToggleRow, { label: "Invoice number as barcode text", value: settings.invoiceBarcodeEnabled, onChange: v => set({ invoiceBarcodeEnabled: v }), hint: "Prints the invoice number in large monospace at the bottom-left for warehouse scanning / filing." })),
                        isVisibleFor(['retail_shop', 'restaurant']) && (h(SettingGroup, { title: "Customer feedback QR", doc: "print-settings#feedback-qr" },
                            h(ToggleRow, { label: "Feedback / review QR", value: settings.feedbackQrEnabled, onChange: v => set({ feedbackQrEnabled: v }), tag: isRecommendedForActive(['retail_shop', 'restaurant']) ? 'Recommended for your business' : null, hint: "Adds a QR at the bottom-left of the PDF that opens a URL \u2014 Google Reviews, feedback form, WhatsApp chat, anything you want." }),
                            settings.feedbackQrEnabled && (h(Fragment, null,
                                h(TextRow, { label: "URL to encode", value: settings.feedbackQrUrl, onChange: v => set({ feedbackQrUrl: v }), placeholder: "e.g. https://g.page/r/YOUR_ID/review" }),
                                h(TextRow, { label: "Label above QR", value: settings.feedbackQrLabel, onChange: v => set({ feedbackQrLabel: v }), placeholder: "Rate us \u00B7 Give feedback" }))))),
                        h(SettingGroup, { title: "Digital signature", doc: "print-settings#signature" },
                            h(ToggleRow, { label: "Show signature on invoice", value: settings.signatureShow, onChange: v => set({ signatureShow: v }) }),
                            settings.signatureShow && (h(Fragment, null,
                                settings.signatureImage ? (h(Fragment, null,
                                    h("div", { style: { padding: '0.5rem', background: '#fff', borderRadius: 4, textAlign: 'center', marginBottom: '0.4rem' } },
                                        h("img", { src: settings.signatureImage, alt: "signature", style: { maxHeight: 60, maxWidth: '100%' } })),
                                    h("button", { className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.25rem 0.6rem' }, onClick: () => set({ signatureImage: '' }) }, "Remove signature"))) : (h(Fragment, null,
                                    h("label", { style: { fontSize: '0.78rem', display: 'block', marginBottom: 3 } }, "Upload signature (PNG / JPG)"),
                                    h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/svg+xml", onChange: e => {
                                            const file = e.target.files?.[0];
                                            if (!file)
                                                return;
                                            if (file.size > 2 * 1024 * 1024) {
                                                toast('Image too large (max 2MB)', 'warning');
                                                return;
                                            }
                                            const reader = new FileReader();
                                            reader.onload = (ev) => set({ signatureImage: ev.target.result });
                                            reader.readAsDataURL(file);
                                        }, style: { fontSize: '0.78rem' } }))),
                                h(TextRow, { label: "Signatory name", value: settings.signatureName, onChange: v => set({ signatureName: v }), placeholder: "e.g. Rakesh Kumar \u00B7 Director", hint: "Falls back to business name if left blank." })))),
                        h(SettingGroup, { title: "Terms & Conditions", doc: "print-settings#terms-page" },
                            h(ToggleRow, { label: "Print T&C on a separate page", value: settings.termsSeparatePage, onChange: v => set({ termsSeparatePage: v }), hint: "For long terms \u2014 puts them on page 2 instead of squishing on page 1. Only affects invoices with T&C enabled." })),
                        h(SettingGroup, { title: "PDF font family", doc: "print-settings#pdf-font" },
                            h(SelectRow, { label: "Font used in generated PDFs", value: settings.pdfFontFamily, onChange: v => set({ pdfFontFamily: v }), options: [
                                    ['helvetica', 'Helvetica (default, cleanest)'],
                                    ['times', 'Times New Roman (traditional / formal)'],
                                    ['courier', 'Courier (monospace / retro / receipt style)'],
                                ], hint: "Applies to the letterhead, table, and totals. Affects sheet formats (A4/A5/Letter/Legal); thermal has its own font setting above." })),
                        h(SettingGroup, { title: "Layout & printer compatibility", doc: "print-settings#thermal-compatibility" },
                            h(ToggleRow, { label: "Compact upper header (fit more items on page 1)", value: settings.headerCompact, onChange: v => set({ headerCompact: v }), hint: "Shrinks the header, billing block, and Place-of-Supply spacing so the items table starts higher up. Best when your invoices routinely spill to page 2 because of large headers." }),
                            h(ToggleRow, { label: "Thermal buffer-safe mode (for old / low-memory receipt printers)", value: settings.thermalBufferSafe, onChange: v => set({ thermalBufferSafe: v }), tag: isRecommendedForActive(['retail_shop', 'restaurant']) ? 'Recommended for your business' : null, hint: "Uses grayscale, drops render scale for thermal captures, and lowers JPEG quality. Helps \u20B9800\u2013\u20B92000 thermal printers with small internal buffers avoid stuck B/W print jobs." }),
                            h(SelectRow, { label: "Thermal print method", value: settings.thermalPrintMode || 'direct', onChange: v => set({ thermalPrintMode: v }), options: [
                                    ['direct', 'Direct HTML — sharper, faster (recommended)'],
                                    ['pdf', 'Via PDF — safer fallback for finicky printers'],
                                ], hint: "Direct sends invoice text as vector to the printer \u2014 203-dpi thermal renders it sharply. If your printer or browser mis-handles the direct path, switch to Via PDF for the pre-v1.10.42 raster behaviour." })),
                        h(SettingGroup, { title: "Custom prefix per invoice type", doc: "print-settings#prefixes" },
                            h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' } }, "Leave blank to use the built-in default. Each type has its own atomic counter \u2014 changing a prefix starts a fresh count for the new one."),
                            [
                                { key: 'tax-invoice', label: 'Tax Invoice', def: 'INV' },
                                { key: 'quotation', label: 'Quotation', def: 'QUO' },
                                { key: 'proforma', label: 'Proforma / Estimate', def: 'EST' },
                                { key: 'bill-of-supply', label: 'Bill of Supply', def: 'BOS' },
                                { key: 'composition', label: 'Composition', def: 'COMP' },
                                { key: 'credit-note', label: 'Credit Note', def: 'CN' },
                                { key: 'delivery-challan', label: 'Delivery Challan', def: 'DC' },
                            ].map(({ key, label, def }) => (h("div", { key: key, style: { display: 'grid', gridTemplateColumns: '1fr 130px', gap: '0.5rem', alignItems: 'center', marginBottom: 6 } },
                                h("span", { style: { fontSize: '0.82rem' } }, label),
                                h("input", { type: "text", className: "form-input", value: settings.customPrefixes?.[key] || '', onChange: e => set({ customPrefixes: { ...(settings.customPrefixes || {}), [key]: e.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) } }), placeholder: def, maxLength: 8, style: { fontSize: '0.8rem', padding: '0.3rem 0.5rem' } }))))),
                        isVisibleFor(['retail_shop', 'restaurant']) && (h(SettingGroup, { title: "Reprint tracking", doc: "print-settings#reprint" },
                            h(ToggleRow, { label: "Show REPRINT badge on reprints", value: settings.reprintLabelEnabled, onChange: v => set({ reprintLabelEnabled: v }), tag: isRecommendedForActive(['retail_shop', 'restaurant']) ? 'Recommended for your business' : null, hint: "Automatic red badge in the top-left of the PDF when an invoice has been printed before. Tracks how many times each bill was printed." }))),
                        h(SettingGroup, { title: "PDF quality vs file size", doc: "print-settings#pdf-quality" },
                            h(SelectRow, { label: "Print quality", value: settings.pdfQuality, onChange: v => set({ pdfQuality: v }), options: [
                                    ['draft', 'Draft — smallest file (email-friendly)'],
                                    ['standard', 'Standard — balanced'],
                                    ['hd', 'HD — sharpest, largest file (default)'],
                                ], hint: "Draft = ~50% smaller PDFs, fine for emailing. HD = crisper text at 100% zoom, larger file, better for physical archive." })),
                        isVisibleFor(['freelancer', 'service']) && (h(SettingGroup, { title: "Dual currency display", doc: "print-settings#dual-currency" },
                            h(ToggleRow, { label: "Show foreign-currency equivalent", value: settings.dualCurrencyEnabled, onChange: v => set({ dualCurrencyEnabled: v }), tag: isRecommendedForActive(['freelancer', 'service']) ? 'Recommended for your business' : null, hint: "For INR invoices to foreign clients, shows the total in a second currency next to the \u20B9 amount, at the rate set here. For invoices billed in USD, EUR... it adds the \u20B9 total to the exchange rate line, at that invoice's own rate. No live conversion." }),
                            settings.dualCurrencyEnabled && (h(Fragment, null,
                                h(SelectRow, { label: "Secondary currency", value: settings.dualCurrencyCode, onChange: v => set({ dualCurrencyCode: v }), options: [
                                        ['USD', 'USD ($)'], ['EUR', 'EUR (€)'], ['GBP', 'GBP (£)'],
                                        ['AED', 'AED (د.إ)'], ['SGD', 'SGD (S$)'], ['AUD', 'AUD (A$)'], ['JPY', 'JPY (¥)'],
                                    ] }),
                                h(NumInput, { label: `Rate (1 ${settings.dualCurrencyCode} = ? INR)`, value: settings.dualCurrencyRate, onChange: v => set({ dualCurrencyRate: v }), min: 0.01, max: 10000 }),
                                h(SelectRow, { label: "Display position", value: settings.dualCurrencyPosition, onChange: v => set({ dualCurrencyPosition: v }), options: [
                                        ['below', 'On a line below the ₹ amount'],
                                        ['inline', 'Inline in parentheses'],
                                    ] }))))),
                        h(SettingGroup, { title: "Company letterhead", doc: "print-settings#letterhead" },
                            h(ToggleRow, { label: "Use pre-printed letterhead image", value: settings.letterheadEnabled, onChange: v => set({ letterheadEnabled: v }), hint: "Upload your own designed letterhead as a full-page background. Invoice content prints on top. Best for businesses with formal branded stationery." }),
                            settings.letterheadEnabled && (h(Fragment, null,
                                settings.letterheadImage ? (h(Fragment, null,
                                    h("div", { style: { padding: '0.5rem', background: '#fff', borderRadius: 4, textAlign: 'center', marginBottom: '0.4rem' } },
                                        h("img", { src: settings.letterheadImage, alt: "letterhead", style: { maxHeight: 100, maxWidth: '100%' } })),
                                    h("button", { className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.25rem 0.6rem' }, onClick: () => set({ letterheadImage: '' }) }, "Remove letterhead"))) : (h(Fragment, null,
                                    h("div", { style: { padding: '0.5rem 0.75rem', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', color: 'var(--warn-text)', borderRadius: 6, fontSize: '0.78rem', marginBottom: '0.6rem' } }, "\u26A0 Letterhead is enabled but no image is uploaded yet. Upload a PNG or JPG below (A4 recommended, max 3 MB) \u2014 the toggle does nothing until an image is set."),
                                    h("label", { style: { fontSize: '0.78rem', display: 'block', marginBottom: 3 } }, "Upload letterhead (PNG / JPG, A4 recommended)"),
                                    h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", onChange: e => {
                                            const file = e.target.files?.[0];
                                            if (!file)
                                                return;
                                            if (file.size > 3 * 1024 * 1024) {
                                                toast('Image too large (max 3MB)', 'warning');
                                                return;
                                            }
                                            const reader = new FileReader();
                                            reader.onload = (ev) => set({ letterheadImage: ev.target.result });
                                            reader.readAsDataURL(file);
                                        }, style: { fontSize: '0.78rem' } }))),
                                h(ToggleRow, { label: "Hide invoice header block", value: settings.letterheadHideHeader, onChange: v => set({ letterheadHideHeader: v }), hint: "When letterhead already has your business info, hide the generated header block to avoid duplication." })))),
                        h(SettingGroup, { title: "PDF template style (visual design)", doc: "print-settings#template" },
                            h(SelectRow, { label: "Template", value: settings.pdfTemplate, onChange: v => set({ pdfTemplate: v }), options: [
                                    ['modern', 'Modern (colorful header · default)'],
                                    ['classic', 'Classic (professional / conservative)'],
                                    ['minimal', 'Minimal (clean / whitespace)'],
                                    ['corporate', 'Corporate (formal blue/navy)'],
                                    ['minimalist', 'Minimalist (grayscale + Inter)'],
                                    ['boxed', 'Boxed grid (ruled boxes, like a quotation pad)'],
                                    ['tally', 'Tally style (order boxes, HSN tax summary, declaration)'],
                                ], hint: "Changes the header block and table styling of the A4/A5 PDF. Thermal receipts use their own compact template." })),
                        h(SettingGroup, { title: "Print darkness", doc: "print-settings#print-darkness" },
                            h(ToggleRow, { label: "Force darker text on printed PDF", value: settings.pdfDarkenOnPrint, onChange: v => set({ pdfDarkenOnPrint: v }), hint: "Fixes light-gray labels + addresses fading on paper printers. Applies automatically when generating the PDF (screen view is unchanged). Turn off if your printer already prints greys crisply." })),
                        h(SettingGroup, { title: "PDF font scale", doc: "print-settings#pdf-font-scale" },
                            h("label", { style: { display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 } },
                                "Overall size: ",
                                h("strong", null,
                                    Math.round((settings.pdfFontScale || 1) * 100),
                                    "%")),
                            h("input", { type: "range", min: "80", max: "140", step: "5", value: Math.round((settings.pdfFontScale || 1) * 100), onChange: e => set({ pdfFontScale: parseInt(e.target.value, 10) / 100 }), style: { width: '100%', accentColor: 'var(--primary)' } }),
                            h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', margin: '3px 0 0' } }, "80% = compact (fits more per page) \u00B7 100% = default \u00B7 140% = large. Scales the entire PDF proportionally."),
                            h("p", { style: { fontSize: '0.68rem', color: 'var(--text-muted)', margin: '3px 0 0', fontStyle: 'italic' } }, "v1.10.10 note: applied at PDF export time. The on-screen preview always renders at 100% \u2014 download a PDF to see the actual scale.")))),
                h("div", { style: { marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                    h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' } },
                        h("div", null,
                            h("h4", { style: { margin: 0, fontSize: '0.95rem', color: 'var(--primary)' } },
                                "\uD83C\uDFA8 PDF Style Editor \u2014 full control over every colour ",
                                h(HelpButton, { title: "PDF Style Editor", doc: "print-settings#colours", size: 16, style: { marginLeft: 6 } })),
                            h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' } }, "Match your brand. Every colour you change updates the live preview instantly and gets baked into your PDFs.")),
                        h(ToggleRow, { label: "Use custom colours", value: settings.userColorsEnabled, onChange: v => set({ userColorsEnabled: v }) })),
                    settings.userColorsEnabled && (h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' } },
                        h(ColorRow, { label: "Primary text", value: settings.pdfPrimaryText || '#0f172a', onChange: v => set({ pdfPrimaryText: v }), hint: "Main body text \u2014 client name, item names, totals." }),
                        h(ColorRow, { label: "Muted text", value: settings.pdfMutedText || '#334155', onChange: v => set({ pdfMutedText: v }), hint: "Labels, addresses, meta info (Date, Invoice #)." }),
                        h(ColorRow, { label: "Accent colour", value: settings.pdfAccent || '#1e40af', onChange: v => set({ pdfAccent: v }), hint: "Section titles + table header background." }),
                        h(ColorRow, { label: "Accent text", value: settings.pdfAccentText || '#ffffff', onChange: v => set({ pdfAccentText: v }), hint: "Text on the accent colour (usually white on a coloured header)." }),
                        h(ColorRow, { label: "Header background", value: settings.pdfHeaderBg || '#f8fafc', onChange: v => set({ pdfHeaderBg: v }), hint: "Header block behind the business name / invoice title." }),
                        h(ColorRow, { label: "Divider lines", value: settings.pdfDividerColor || '#334155', onChange: v => set({ pdfDividerColor: v }), hint: "Hairlines between sections + table row borders." }),
                        h("div", { style: { gridColumn: '1 / -1' } },
                            h("button", { className: "btn btn-secondary", style: { fontSize: '0.75rem', padding: '0.35rem 0.75rem' }, onClick: () => set({
                                    pdfPrimaryText: '#0f172a', pdfMutedText: '#334155',
                                    pdfAccent: '#1e40af', pdfAccentText: '#ffffff',
                                    pdfHeaderBg: '#f8fafc', pdfDividerColor: '#334155',
                                }) }, "Reset colours to defaults"))))),
                h("div", { style: { marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                    h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' } },
                        "\uD83C\uDF10 Section labels \u2014 multi-language + custom text ",
                        h(HelpButton, { title: "Section labels and language", doc: "print-settings#labels-language", size: 16, style: { marginLeft: 6 } })),
                    h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' } }, "Pick a language preset OR override any individual label. Custom text overrides the language preset for that field."),
                    h(SelectRow, { label: "Language preset", value: settings.labelLanguage, onChange: v => set({ labelLanguage: v }), options: [
                            ['en', 'English'],
                            ['hi', 'हिन्दी (Hindi)'],
                            ['ta', 'தமிழ் (Tamil)'],
                            ['mr', 'मराठी (Marathi)'],
                            ['bn', 'বাংলা (Bengali)'],
                        ] }),
                    h("div", { style: { marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' } },
                        h(TextRow, { label: '"BILL TO" label', value: settings.labelBillTo, onChange: v => set({ labelBillTo: v }), placeholder: LABEL_PRESETS[settings.labelLanguage]?.billTo || LABEL_PRESETS.en.billTo }),
                        h(TextRow, { label: '"PLACE OF SUPPLY" label', value: settings.labelPlaceOfSupply, onChange: v => set({ labelPlaceOfSupply: v }), placeholder: LABEL_PRESETS[settings.labelLanguage]?.placeOfSupply || LABEL_PRESETS.en.placeOfSupply }),
                        h(TextRow, { label: '"BANK DETAILS" label', value: settings.labelBankDetails, onChange: v => set({ labelBankDetails: v }), placeholder: LABEL_PRESETS[settings.labelLanguage]?.bankDetails || LABEL_PRESETS.en.bankDetails }),
                        h(TextRow, { label: '"AMOUNT IN WORDS" label', value: settings.labelAmountInWords, onChange: v => set({ labelAmountInWords: v }), placeholder: LABEL_PRESETS[settings.labelLanguage]?.amountInWords || LABEL_PRESETS.en.amountInWords }),
                        h(TextRow, { label: '"TERMS & CONDITIONS" label', value: settings.labelTerms, onChange: v => set({ labelTerms: v }), placeholder: LABEL_PRESETS[settings.labelLanguage]?.terms || LABEL_PRESETS.en.terms }),
                        h(TextRow, { label: '"NOTES" label', value: settings.labelNotes, onChange: v => set({ labelNotes: v }), placeholder: LABEL_PRESETS[settings.labelLanguage]?.notes || LABEL_PRESETS.en.notes }))),
                h("div", { style: { marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                    h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' } },
                        "\uD83D\uDCC5 Formatting \u2014 date, number, currency ",
                        h(HelpButton, { title: "Formatting: date, number, currency", doc: "print-settings#formats", size: 16, style: { marginLeft: 6 } })),
                    h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' } },
                        h(SelectRow, { label: "Date format", value: settings.dateFormat, onChange: v => set({ dateFormat: v }), options: [
                                ['dd-mon-yyyy', '02 Apr 2026 (Indian)'],
                                ['dd-mmm-yyyy', '02-Apr-2026'],
                                ['dd-mm-yyyy', '02/04/2026'],
                                ['mm-dd-yyyy', '04/02/2026 (US)'],
                                ['yyyy-mm-dd', '2026-04-02'],
                                ['iso', 'ISO 8601'],
                            ] }),
                        h(SelectRow, { label: "Number grouping", value: settings.numberFormat, onChange: v => set({ numberFormat: v }), options: [
                                ['indian', '1,00,000.00 (Indian)'],
                                ['western', '100,000.00 (Western)'],
                                ['european', '100.000,00 (European)'],
                            ] }),
                        h(SelectRow, { label: "Decimal places", value: String(settings.decimalPlaces), onChange: v => set({ decimalPlaces: parseInt(v, 10) }), options: [['0', '0 (no decimals)'], ['2', '2 (default)'], ['3', '3'], ['4', '4']] }),
                        h(SelectRow, { label: "Currency symbol position", value: settings.currencyPosition, onChange: v => set({ currencyPosition: v }), options: [['before', '₹100 (before number)'], ['after', '100₹ (after number)']] }))),
                h(RoundOffSetting, null),
                h("div", { style: { marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                    h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' } },
                        "\uD83D\uDCCF Row density ",
                        h(HelpButton, { title: "Row density", doc: "print-settings#row-density", size: 16, style: { marginLeft: 6 } })),
                    h(SelectRow, { label: "Vertical spacing in tables + sections", value: settings.rowDensity, onChange: v => set({ rowDensity: v }), options: [
                            ['compact', 'Compact — fit more per page'],
                            ['normal', 'Normal (default)'],
                            ['comfortable', 'Comfortable — easier to read'],
                        ], hint: "Affects both A4/A5 PDFs and the on-screen preview." })),
                h("div", { style: { marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                    h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' } },
                        "\uD83D\uDCAF Custom tax rate presets ",
                        h(HelpButton, { title: "Custom tax rate presets", doc: "print-settings#tax-rates", size: 16, style: { marginLeft: 6 } })),
                    h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' } }, "Built-in rates: 0% \u00B7 0.1% \u00B7 0.25% \u00B7 3% \u00B7 5% \u00B7 12% \u00B7 18% \u00B7 28% \u00B7 40%. Since 22 Sep 2025 most goods are 5%, 18% or 40%; 12% and 28% stay for older bills. Add your own (e.g. 1.5%, 7.5%)."),
                    h(CustomListEditor, { values: settings.customTaxRates || [], onChange: v => set({ customTaxRates: v }), placeholder: "e.g. 3, 0.25, 7.5", hint: "Comma-separated numbers. Between 0 and 100." })),
                h("div", { style: { marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
                    h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' } },
                        "\uD83D\uDCBE My saved templates ",
                        h(HelpButton, { title: "My saved templates", doc: "print-settings#templates", size: 16, style: { marginLeft: 6 } })),
                    h("p", { style: { fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 0.6rem' } }, "Save your current setup as a named template. Recall any time."),
                    h(SavedTemplatesEditor, { templates: settings.savedTemplates || [], onChange: v => set({ savedTemplates: v }), currentSettings: settings, onLoad: async (tpl) => {
                            if (!await confirmAction({
                                title: `Load template "${tpl.name}"?`,
                                message: 'This overwrites your current print settings. Save the current setup as a template first if you want to be able to go back.',
                                confirmLabel: 'Load template',
                                tone: 'warning',
                            }))
                                return;
                            setSettings(tpl.settings);
                            savePrintSettings(tpl.settings);
                            toast(`Loaded "${tpl.name}"`, 'success');
                        } }))),
            h("div", { className: "print-settings-preview-pane", style: {
                    position: 'sticky', top: '1rem',
                    maxHeight: 'calc(100vh - 2rem)',
                    padding: '1rem',
                    background: 'var(--bg-secondary)',
                    borderRadius: 8,
                    display: 'flex', flexDirection: 'column', gap: '0.75rem',
                } },
                h("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                    h("strong", { style: { fontSize: '0.9rem' } },
                        h(Info, { size: 14, style: { display: 'inline', verticalAlign: -2, marginRight: 5 } }),
                        "Live preview ",
                        h(HelpButton, { title: "Live preview", doc: "print-settings#preview", size: 16, style: { marginLeft: 6 } })),
                    h("span", { style: { fontSize: '0.72rem', color: 'var(--text-muted)' } }, "Updates as you type")),
                h("div", { style: { display: 'flex', gap: '0.25rem', background: 'var(--card)', padding: '0.25rem', borderRadius: 6 } }, [
                    ['pdf', '📄 PDF (A4)'],
                    ['thermal', '🖨 Thermal (80mm)'],
                    ['both', '⊞ Split view'],
                ].map(([key, label]) => (h("button", { key: key, type: "button", onClick: () => setPreviewMode(key), style: {
                        flex: 1, padding: '0.35rem', border: 'none', borderRadius: 4,
                        background: previewMode === key ? 'var(--primary)' : 'transparent',
                        color: previewMode === key ? '#fff' : 'var(--text)',
                        fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                    } }, label)))),
                h("div", { style: { overflow: 'auto', flex: 1, background: '#fff', padding: '0.75rem', borderRadius: 6, minHeight: 200 } }, previewMode === 'both' ? (h("div", { style: { display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' } },
                    h("div", { style: { zoom: 0.42, minWidth: 0 } },
                        h(InvoicePreview, { profile: sample.profile, client: sample.client, details: sample.details, items: sample.items, totals: sample.totals, invoiceType: sample.invoiceType, options: { ...previewInvoiceOptions, paperSize: 'a4' }, customTerms: "", customNotes: "", extraSections: [] })),
                    h("div", { style: { zoom: 0.85, minWidth: 0 } },
                        h(InvoicePreview, { profile: sample.profile, client: sample.client, details: sample.details, items: sample.items, totals: sample.totals, invoiceType: sample.invoiceType, options: { ...previewInvoiceOptions, paperSize: 'thermal80' }, customTerms: "", customNotes: "", extraSections: [] })))) : previewMode === 'pdf' ? (h("div", { style: { zoom: 0.5, minWidth: 0 } },
                    h(InvoicePreview, { ref: previewRef, profile: sample.profile, client: sample.client, details: sample.details, items: sample.items, totals: sample.totals, invoiceType: sample.invoiceType, options: { ...previewInvoiceOptions, paperSize: 'a4' }, customTerms: "", customNotes: "", extraSections: [] }))) : (h("div", { style: { margin: '0 auto', width: 'fit-content' } },
                    h(InvoicePreview, { ref: previewRef, profile: sample.profile, client: sample.client, details: sample.details, items: sample.items, totals: sample.totals, invoiceType: sample.invoiceType, options: { ...previewInvoiceOptions, paperSize: 'thermal80' }, customTerms: "", customNotes: "", extraSections: [] })))))),
        showTestPreview && null));
}
// ---- small building blocks -------------------------------------------------
// `doc` is the docs section about this group (its ? button).
function SettingGroup({ title, doc, children }) {
    return (h("div", null,
        h("div", { style: { fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: 4 } },
            title,
            doc && h(HelpButton, { title: title, doc: doc, size: 16, style: { width: 24, height: 24 } })),
        h("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.7rem' } }, children)));
}
// v1.10.75 — requested: "auto round-off option". Rounding was only reachable
// from Customize -> Totals inside an open invoice. This is the same switch
// (the invoice default `showRoundOff`), kept where people look for app-wide
// settings. It writes both stores the invoice screen reads, so the next new
// invoice follows it. Saved invoices keep their own choice.
function RoundOffSetting() {
    const read = () => {
        try {
            return JSON.parse(localStorage.getItem('freegstbill_invoiceOptions') || '{}').showRoundOff !== false;
        }
        catch {
            return true;
        }
    };
    const [on, setOn] = useState(read);
    const touched = useRef(false); // a click before the load answers must win
    useEffect(() => {
        getInvoiceDisplayOptions().then((o) => { if (!touched.current && o && typeof o.showRoundOff === 'boolean')
            setOn(o.showRoundOff); }).catch(() => { });
    }, []);
    const change = async (value) => {
        touched.current = true;
        setOn(value);
        try {
            const local = JSON.parse(localStorage.getItem('freegstbill_invoiceOptions') || '{}');
            localStorage.setItem('freegstbill_invoiceOptions', JSON.stringify({ ...local, showRoundOff: value }));
        }
        catch { /* storage blocked: the server copy below still applies */ }
        try {
            const server = await getInvoiceDisplayOptions().catch(() => null);
            await saveInvoiceDisplayOptions({ ...(server || {}), showRoundOff: value });
            toast(value ? 'New invoices will be rounded off' : 'New invoices will not be rounded off', 'success');
        }
        catch {
            toast('Could not save the round-off setting', 'error');
        }
    };
    return (h("div", { style: { marginTop: '1.5rem', padding: '1rem 1.25rem', background: 'var(--bg-secondary)', borderRadius: 8 } },
        h("h4", { style: { margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--primary)' } },
            "\uD83E\uDDEE Totals ",
            h(HelpButton, { title: "Round off invoice totals", doc: "print-settings#round-off", size: 16, style: { marginLeft: 6 } })),
        h(ToggleRow, { label: "Round off invoice totals", value: on, onChange: change, hint: "Rounds the grand total to the nearest rupee and prints the difference as a Round-off line. Applies to new invoices; you can still change it per invoice under Customize \u2192 Totals." })));
}
// v1.10.36 — ToggleRow gained an optional `tag` prop for the
// "Recommended for retail" / "Recommended for wholesale" etc. badges.
// Kept optional so unrelated toggles render exactly as before.
function ToggleRow({ label, value, onChange, hint, tag }) {
    return (h("label", { style: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', cursor: 'pointer', fontSize: '0.82rem' } },
        h("input", { type: "checkbox", checked: !!value, onChange: e => onChange(e.target.checked), style: { marginTop: 2, accentColor: 'var(--primary)' } }),
        h("span", { style: { flex: 1 } },
            h("span", { style: { fontWeight: 600 } }, label),
            tag && h("span", { style: {
                    display: 'inline-block', marginLeft: 6,
                    fontSize: '0.6rem', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.04em',
                    padding: '1px 6px', borderRadius: 999,
                    background: 'var(--primary-light, rgba(30,64,175,0.1))',
                    color: 'var(--primary)',
                } },
                "\u2605 ",
                tag),
            hint && h("span", { style: { display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 } }, hint))));
}
function SelectRow({ label, value, onChange, options, hint }) {
    return (h("div", null,
        h("label", { style: { display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 3 } }, label),
        h("select", { className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem 0.55rem' }, value: value, onChange: e => onChange(e.target.value) }, options.map(([v, l]) => h("option", { key: v, value: v }, l))),
        hint && h("p", { style: { margin: '3px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' } }, hint)));
}
function CustomListEditor({ values, onChange, placeholder }) {
    const [input, setInput] = useState('');
    return (h("div", null,
        h("div", { style: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.5rem' } }, (values || []).map((v, i) => (h("span", { key: i, style: { background: 'var(--primary)', color: '#fff', padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 4 } },
            v,
            "%",
            h("button", { type: "button", onClick: () => onChange(values.filter((_, j) => j !== i)), style: { background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: '0.85rem', lineHeight: 1 } }, "\u00D7"))))),
        h("div", { style: { display: 'flex', gap: '0.35rem' } },
            h("input", { type: "text", value: input, onChange: e => setInput(e.target.value), placeholder: placeholder, className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem 0.55rem', flex: 1 } }),
            h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.78rem' }, onClick: () => {
                    const parsed = input.split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n) && n >= 0 && n <= 100);
                    if (parsed.length === 0)
                        return;
                    const merged = Array.from(new Set([...(values || []), ...parsed])).sort((a, b) => a - b);
                    onChange(merged);
                    setInput('');
                } }, "Add"))));
}
function ExtraFieldsEditor({ fields, onChange }) {
    const [label, setLabel] = useState('');
    return (h("div", null,
        (fields || []).map((f, i) => (h("div", { key: i, style: { display: 'flex', gap: '0.35rem', marginBottom: '0.35rem' } },
            h("input", { type: "text", value: f.label, className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem', flex: 1 }, onChange: e => {
                    const next = [...fields];
                    next[i] = { ...next[i], label: e.target.value };
                    onChange(next);
                } }),
            h("button", { type: "button", className: "icon-btn icon-btn-red", onClick: () => onChange(fields.filter((_, j) => j !== i)), title: "Remove" },
                h(Trash2, { size: 14 }))))),
        (fields || []).length < 5 && (h("div", { style: { display: 'flex', gap: '0.35rem', marginTop: '0.35rem' } },
            h("input", { type: "text", value: label, onChange: e => setLabel(e.target.value), placeholder: "e.g. PO Reference", className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem', flex: 1 } }),
            h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.78rem' }, onClick: () => {
                    if (!label.trim())
                        return;
                    onChange([...(fields || []), { label: label.trim(), value: '' }]);
                    setLabel('');
                } }, "Add field")))));
}
function SavedTemplatesEditor({ templates, onChange, currentSettings, onLoad }) {
    const [name, setName] = useState('');
    return (h("div", null,
        (templates || []).map((tpl, i) => (h("div", { key: i, style: { display: 'flex', gap: '0.35rem', marginBottom: '0.35rem', alignItems: 'center', padding: '0.4rem', background: 'var(--card)', borderRadius: 5 } },
            h("span", { style: { flex: 1, fontSize: '0.82rem', fontWeight: 600 } }, tpl.name),
            h("button", { type: "button", className: "btn btn-secondary", style: { fontSize: '0.72rem', padding: '0.2rem 0.5rem' }, onClick: () => onLoad(tpl) }, "Load"),
            h("button", { type: "button", className: "icon-btn icon-btn-red", onClick: () => onChange(templates.filter((_, j) => j !== i)) },
                h(Trash2, { size: 13 }))))),
        h("div", { style: { display: 'flex', gap: '0.35rem', marginTop: '0.5rem' } },
            h("input", { type: "text", value: name, onChange: e => setName(e.target.value), placeholder: "Template name (e.g. Retail v1)", className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem', flex: 1 } }),
            h("button", { type: "button", className: "btn btn-primary", style: { fontSize: '0.78rem' }, onClick: () => {
                    if (!name.trim())
                        return;
                    onChange([...(templates || []), { name: name.trim(), settings: { ...currentSettings } }]);
                    setName('');
                    toast(`Saved template "${name.trim()}"`, 'success');
                } },
                h(SaveIcon, { size: 13 }),
                " Save current as template"))));
}
function ColorRow({ label, value, onChange, hint }) {
    return (h("div", null,
        h("label", { style: { display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 } }, label),
        h("div", { style: { display: 'flex', gap: '0.4rem', alignItems: 'center' } },
            h("input", { type: "color", value: value, onChange: e => onChange(e.target.value), style: { width: 42, height: 32, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' } }),
            h("input", { type: "text", value: value, onChange: e => onChange(e.target.value), className: "form-input", style: { fontSize: '0.8rem', padding: '0.3rem 0.4rem', fontFamily: 'monospace' }, placeholder: "#000000" })),
        hint && h("p", { style: { margin: '3px 0 0', fontSize: '0.68rem', color: 'var(--text-muted)' } }, hint)));
}
function NumInput({ label, value, onChange, min = 0, max = 100 }) {
    return (h("div", null,
        h("label", { style: { display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 2 } }, label),
        h("input", { type: "number", min: min, max: max, step: "0.5", value: value ?? 0, onChange: e => onChange(parseFloat(e.target.value) || 0), className: "form-input", style: { fontSize: '0.8rem', padding: '0.3rem 0.4rem', width: '100%' } })));
}
function TextRow({ label, value, onChange, hint, placeholder }) {
    return (h("div", null,
        h("label", { style: { display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 3 } }, label),
        h("input", { type: "text", className: "form-input", style: { fontSize: '0.82rem', padding: '0.35rem 0.55rem' }, value: value || '', onChange: e => onChange(e.target.value), placeholder: placeholder }),
        hint && h("p", { style: { margin: '3px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' } }, hint)));
}
