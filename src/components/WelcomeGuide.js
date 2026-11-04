import { useState, h, Fragment } from '../vanilla/dom.js';
import { Building2, FileText, BarChart3, Shield, ChevronRight, ChevronLeft, Check, ArrowRight, Image, PenTool } from '../vanilla/icons.js';
import { saveProfile, setRegionMode } from '../store.js';
import { getStatesForCountry, getCountryConfig, detectCountryFromBrowser, createEmptyAccount } from '../utils.js';
import { toast } from './Toast.js';
import HelpButton from './HelpButton.js';
import SafePrivateNote from './SafePrivateNote.js';
const STEPS = [
    { id: 'welcome', title: 'Welcome', icon: FileText },
    { id: 'business', title: 'Business Details', icon: Building2 },
    { id: 'bank', title: 'Bank & UPI', icon: Shield },
    { id: 'ready', title: 'You\'re All Set!', icon: BarChart3 },
];
export default function WelcomeGuide({ onComplete }) {
    const [step, setStep] = useState(0);
    // v1.10.74 - region starts as India (below), so the country must too; the
    // browser country is only used when "Outside India" is picked.
    const [profile, setProfile] = useState({
        businessName: '', address: '', city: '', pin: '', state: '', country: 'India', gstin: '', pan: '',
        email: '', phone: '', bankName: '', accountNumber: '', ifsc: '', swift: '',
        logo: '', signature: '', upiId: '',
        // v1.10.83 - asked here, with the logo; on unless they untick it.
        showInMenu: true,
    });
    // v1.10.67 (#66 item 2, @sangwanmail-eng) — this is an India-first GST app,
    // so India is the default. It used to be chosen from the browser locale, and
    // a Windows set to en-US started people on "Outside India" with a United
    // States company profile. The other two options are one click away.
    const [region, setRegion] = useState('india');
    const [saving, setSaving] = useState(false);
    const cc = getCountryConfig(profile.country);
    const stateOptions = getStatesForCountry(profile.country);
    const handleChange = (e) => {
        setProfile({ ...profile, [e.target.name]: e.target.value });
    };
    const handleFileUpload = (field) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file)
                return;
            if (file.size > 500 * 1024) {
                toast('Image must be under 500KB', 'warning');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => setProfile(p => ({ ...p, [field]: reader.result }));
            reader.readAsDataURL(file);
        };
        input.click();
    };
    const handleFinish = async () => {
        setSaving(true);
        try {
            setRegionMode(region);
            // Mirror the wizard's flat bank/UPI inputs into a single payment account
            // so the multi-account manager has a starting entry. If the user
            // skipped all bank fields, we don't create an empty account — they can
            // add one later in Settings.
            const hasBank = profile.bankName || profile.accountNumber || profile.ifsc || profile.swift || profile.upiId;
            const profileToSave = hasBank ? {
                ...profile,
                paymentAccounts: [{
                        ...createEmptyAccount(profile.bankName || 'Default account'),
                        bankName: profile.bankName || '',
                        accountNumber: profile.accountNumber || '',
                        ifsc: profile.ifsc || '',
                        swift: profile.swift || '',
                        upiId: profile.upiId || '',
                        isDefault: true,
                        isActive: true,
                    }],
            } : profile;
            await saveProfile(profileToSave);
            localStorage.setItem('freegstbill_onboarded', 'true');
            toast('Setup complete! Start creating invoices.', 'success');
            onComplete(profileToSave);
        }
        catch {
            toast('Failed to save. Try again.', 'error');
        }
        setSaving(false);
    };
    const handleSkip = () => {
        localStorage.setItem('freegstbill_onboarded', 'true');
        onComplete(null);
    };
    const canProceed = () => {
        if (step === 1)
            return profile.businessName.trim().length > 0;
        return true;
    };
    return (h("div", { style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: 'var(--bg-primary)' } },
        h("div", { style: { maxWidth: '640px', width: '100%' } },
            h("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '2rem', justifyContent: 'center' } }, STEPS.map((s, i) => (h("div", { key: s.id, style: {
                    width: i === step ? '3rem' : '2rem', height: '4px', borderRadius: '2px',
                    background: i <= step ? 'var(--primary)' : 'var(--border-color)',
                    transition: 'all 0.3s ease',
                } })))),
            h("div", { className: "glass-panel", style: { padding: '2.5rem' } },
                step === 0 && (h("div", { style: { textAlign: 'center' } },
                    h("div", { style: { width: '64px', height: '64px', borderRadius: '16px', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' } },
                        h(FileText, { size: 32, color: "white" })),
                    h("h1", { style: { fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-primary)' } },
                        "Welcome to Free GST Billing Software ",
                        h(HelpButton, { title: "Welcome", doc: "first-run#welcome", size: 16 })),
                    h("p", { style: { color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 } }, "Free, open-source GST billing software. Your business records stay in this browser on this device. No Google sign-in is required."),
                    h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', textAlign: 'left' } }, [
                        { title: 'Create Invoices', desc: 'Tax Invoice, Proforma, Credit Note, Bill of Supply, Delivery Challan' },
                        { title: 'Auto GST Calculation', desc: 'CGST/SGST for same state, IGST for different state — automatic' },
                        { title: 'GST Filing Ready', desc: 'GSTR-1, GSTR-3B, HSN reports auto-generated. Download CSVs for portal.' },
                        { title: 'Private local storage', desc: 'Business records are saved in this browser profile using IndexedDB. No Google account or shared app database.' },
                    ].map((item, i) => (h("div", { key: i, style: { padding: '1rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' } },
                        h("div", { style: { fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem', color: 'var(--text-primary)' } }, item.title),
                        h("div", { style: { fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 } }, item.desc))))),
                    h(SafePrivateNote, { style: { marginBottom: '1.5rem' } }),
                    h("p", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' } }, "Let's set up your business profile so your invoices look professional. Takes about 2 minutes."),
                    h("div", { style: { marginTop: '1rem', padding: '1rem', borderRadius: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', textAlign: 'left' } },
                        h("p", { style: { fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.6rem', color: 'var(--text-primary)' } }, "Where will you be invoicing from?"),
                        h("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' } }, [
                            { id: 'india', label: '🇮🇳 India', desc: 'GST, GSTR-1/3B, UPI' },
                            { id: 'international', label: '🌍 Outside India', desc: 'VAT/SST/MwSt' },
                            { id: 'both', label: '🌐 Both', desc: 'India + foreign clients' },
                        ].map(opt => (h("button", { key: opt.id, type: "button", onClick: () => {
                                setRegion(opt.id);
                                if (opt.id === 'india')
                                    setProfile(p => ({ ...p, country: 'India' }));
                                else if (opt.id === 'international' && profile.country === 'India')
                                    setProfile(p => ({ ...p, country: detectCountryFromBrowser() === 'India' ? 'United States' : detectCountryFromBrowser() }));
                            }, className: `type-chip ${region === opt.id ? 'type-chip-active' : ''}`, style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0.55rem 0.7rem', gap: '0.15rem' } },
                            h("span", { style: { fontWeight: 600 } }, opt.label),
                            h("span", { style: { fontSize: '0.68rem', color: region === opt.id ? 'inherit' : 'var(--text-muted)', fontWeight: 400 } }, opt.desc))))),
                        h("p", { style: { fontSize: '0.7rem', color: 'var(--text-muted)', margin: '0.6rem 0 0' } }, "You can change this any time in Settings \u2192 Region Preference.")))),
                step === 1 && (h("div", null,
                    h("h2", { style: { fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' } },
                        "Business Details ",
                        h(HelpButton, { title: "Business Details", doc: "first-run#business-details", size: 16 })),
                    h("p", { style: { fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' } }, "This info appears on every invoice you generate. You can change it anytime in Settings."),
                    h("div", { style: { display: 'grid', gap: '1rem' } },
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Business Name *"),
                            h("input", { type: "text", name: "businessName", className: "form-input", value: profile.businessName, onChange: handleChange, placeholder: "e.g. Sharma Consultants Pvt. Ltd." })),
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Address"),
                            h("textarea", { name: "address", className: "form-input", rows: 2, value: profile.address, onChange: handleChange, placeholder: "e.g. 42, MG Road, Sector 15, Gurugram 122001" })),
                        h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, cc.stateLabel),
                                stateOptions.length > 0 ? (h("select", { name: "state", className: "form-input", value: profile.state, onChange: handleChange },
                                    h("option", { value: "" },
                                        "Select ",
                                        cc.stateLabel.toLowerCase()),
                                    stateOptions.map(s => h("option", { key: s, value: s }, s)))) : (h("input", { type: "text", name: "state", className: "form-input", value: profile.state, onChange: handleChange, placeholder: cc.stateLabel })),
                                profile.country === 'India' && h("span", { className: "field-hint" }, "Needed for auto CGST/SGST vs IGST")),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, cc.taxIdLabel),
                                h("input", { type: "text", name: "gstin", className: "form-input", value: profile.gstin, onChange: handleChange, placeholder: cc.taxIdPlaceholder, maxLength: 20, style: { textTransform: 'uppercase' } }),
                                h("span", { className: "field-hint" }, "Leave blank if not registered for tax"))),
                        h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "PAN"),
                                h("input", { type: "text", name: "pan", className: "form-input", value: profile.pan, onChange: handleChange, placeholder: "AAAAA1234A", maxLength: 10, style: { textTransform: 'uppercase' } })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Phone"),
                                h("input", { type: "text", name: "phone", className: "form-input", value: profile.phone, onChange: handleChange, placeholder: "+91 98765 43210" }))),
                        h("div", { className: "form-group" },
                            h("label", { className: "form-label" }, "Email"),
                            h("input", { type: "email", name: "email", className: "form-input", value: profile.email, onChange: handleChange, placeholder: "billing@yourbusiness.com" }))))),
                step === 2 && (h("div", null,
                    h("h2", { style: { fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' } },
                        "Bank & UPI Details ",
                        h(HelpButton, { title: "Bank & UPI Details", doc: "first-run#bank-upi", size: 16 })),
                    h("p", { style: { fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' } }, "Shown on your invoices so clients know where to pay. Optional \u2014 you can add this later."),
                    h("div", { style: { display: 'grid', gap: '1rem' } },
                        h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Bank Name"),
                                h("input", { type: "text", name: "bankName", className: "form-input", value: profile.bankName, onChange: handleChange, placeholder: "e.g. HDFC Bank" })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Account Number"),
                                h("input", { type: "text", name: "accountNumber", className: "form-input", value: profile.accountNumber, onChange: handleChange, placeholder: "e.g. 12345678901234" }))),
                        h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, cc.bankLabel || 'IFSC Code'),
                                h("input", { type: "text", name: "ifsc", className: "form-input", value: profile.ifsc, onChange: handleChange, placeholder: "e.g. HDFC0001234", style: { textTransform: 'uppercase' } })),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "UPI ID"),
                                h("input", { type: "text", name: "upiId", className: "form-input", value: profile.upiId, onChange: handleChange, placeholder: "e.g. business@upi" }),
                                h("span", { className: "field-hint" }, "Auto-generates QR code on invoices"))),
                        h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Business Logo"),
                                h("button", { type: "button", className: "btn btn-secondary", onClick: () => handleFileUpload('logo'), style: { width: '100%', justifyContent: 'center' } },
                                    h(Image, { size: 16 }),
                                    " ",
                                    profile.logo ? 'Change Logo' : 'Upload Logo'),
                                profile.logo && h("img", { src: profile.logo, alt: "Logo", style: { height: '40px', marginTop: '0.5rem', objectFit: 'contain' } }),
                                h("span", { className: "field-hint" }, "PNG/JPG, max 500KB"),
                                h("label", { style: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', marginTop: '0.6rem' } },
                                    h("input", { type: "checkbox", checked: !!profile.showInMenu, onChange: (e) => setProfile(prev => ({ ...prev, showInMenu: e.target.checked })), style: { width: 16, height: 16, marginTop: 2, accentColor: 'var(--primary)' } }),
                                    h("span", null, "Show my business name and logo in the app's menu (top left)"))),
                            h("div", { className: "form-group" },
                                h("label", { className: "form-label" }, "Digital Signature"),
                                h("button", { type: "button", className: "btn btn-secondary", onClick: () => handleFileUpload('signature'), style: { width: '100%', justifyContent: 'center' } },
                                    h(PenTool, { size: 16 }),
                                    " ",
                                    profile.signature ? 'Change Signature' : 'Upload Signature'),
                                profile.signature && h("img", { src: profile.signature, alt: "Signature", style: { height: '40px', marginTop: '0.5rem', objectFit: 'contain' } }),
                                h("span", { className: "field-hint" }, "PNG/JPG, max 500KB")))))),
                step === 3 && (h("div", { style: { textAlign: 'center' } },
                    h("div", { style: { width: '64px', height: '64px', borderRadius: '50%', background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' } },
                        h(Check, { size: 32, color: "white" })),
                    h("h2", { style: { fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-primary)' } },
                        "You're All Set! ",
                        h(HelpButton, { title: "You're All Set", doc: "first-run#all-set", size: 16 })),
                    h("p", { style: { color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 } }, "Your business profile is ready. Here's what to do next:"),
                    h("div", { style: { textAlign: 'left', marginBottom: '2rem' } }, [
                        { num: '1', title: 'Create your first invoice', desc: 'Click "New Invoice" in the sidebar. Pick invoice type, add client details and line items.' },
                        { num: '2', title: 'Download or share', desc: 'Generate PDF, share via WhatsApp or email. UPI QR auto-appears if you added your UPI ID.' },
                        { num: '3', title: 'Check GST reports', desc: 'After a few invoices, open "GST Returns" in the sidebar. Your GSTR-1, GSTR-3B and HSN summary are built from them.' },
                        { num: '4', title: 'File GST returns', desc: 'Download the GSTR-1 JSON from GST Returns and upload it on the GST portal. The Filing Guide tab there walks you through it.' },
                    ].map((item) => (h("div", { key: item.num, style: { display: 'flex', gap: '1rem', padding: '0.75rem 0', borderBottom: '1px solid var(--border-color)' } },
                        h("div", { style: { width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0 } }, item.num),
                        h("div", null,
                            h("div", { style: { fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' } }, item.title),
                            h("div", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' } }, item.desc)))))),
                    h("div", { style: { padding: '1rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', marginBottom: '1.5rem' } },
                        h("div", { style: { fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 } },
                            "Your business data is stored in the ",
                            h("strong", null, "Free GST Billing Software"),
                            " in this browser profile. To access your records on another device, download a JSON backup from Settings and import it there.")))),
                h("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' } },
                    h("div", null,
                        step === 0 && (h("button", { className: "btn btn-secondary", onClick: handleSkip, style: { fontSize: '0.85rem' } }, "Skip Setup")),
                        step > 0 && step < 3 && (h("button", { className: "btn btn-secondary", onClick: () => setStep(step - 1) },
                            h(ChevronLeft, { size: 16 }),
                            " Back"))),
                    h("div", { style: { display: 'flex', gap: '0.75rem' } },
                        step < 3 && (h("button", { className: "btn btn-primary", onClick: () => setStep(step + 1), disabled: !canProceed() },
                            step === 0 ? 'Get Started' : 'Next',
                            " ",
                            h(ChevronRight, { size: 16 }))),
                        step === 2 && (h("button", { className: "btn btn-secondary", onClick: () => setStep(3), style: { fontSize: '0.85rem' } }, "Skip, I'll add later")),
                        step === 3 && (h("button", { className: "btn btn-primary", onClick: handleFinish, disabled: saving },
                            saving ? 'Saving...' : 'Start Billing',
                            " ",
                            h(ArrowRight, { size: 16 })))))),
            h("div", { style: { display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '1rem' } }, STEPS.map((s, i) => (h("div", { key: s.id, style: { fontSize: '0.7rem', color: i === step ? 'var(--primary)' : 'var(--text-muted)', fontWeight: i === step ? 600 : 400, transition: 'all 0.3s' } }, s.title)))))));
}
