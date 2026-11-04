import { useState, useEffect, h, Fragment } from '../vanilla/dom.js';
import { X } from '../vanilla/icons.js';
import { getCountryConfig, getStatesForCountry, validateTaxId, detectCountryFromBrowser, getCountriesForRegion, PAPER_SIZES, decodeGstin, COUNTRIES } from '../utils.js';
import { getRegionMode } from '../store.js';
import HelpButton from './HelpButton.js';
export default function ClientModal({ show, onClose, onSave, client, isEditing, defaultCountry }) {
    // Country defaults: explicit prop (active business profile) → browser locale → 'India'.
    const fallbackCountry = defaultCountry || detectCountryFromBrowser();
    const emptyForm = {
        name: '', address: '', city: '', pin: '', state: '', gstin: '', email: '', phone: '',
        country: fallbackCountry, isSEZ: false,
        // v1.9.1 — per-client print preferences. When set, they auto-populate
        // invoiceOptions when the user creates a new invoice for this client.
        // Left blank = use app-wide defaults.
        preferredPaperSize: '', // '' | 'a4' | 'a5' | 'thermal80' | ...
        preferredCurrency: '', // '' | 'INR' | 'USD' | ...
        autoPrint: false, // per-client auto-print override
    };
    const [form, setForm] = useState({ ...emptyForm });
    const [taxIdWarning, setTaxIdWarning] = useState('');
    useEffect(() => {
        if (show && client) {
            setForm({
                name: client.name || '', address: client.address || '', city: client.city || '',
                pin: client.pin || '', state: client.state || '', gstin: client.gstin || '',
                email: client.email || '', phone: client.phone || '', country: client.country || fallbackCountry,
                isSEZ: !!client.isSEZ,
                preferredPaperSize: client.preferredPaperSize || '',
                preferredCurrency: client.preferredCurrency || '',
                autoPrint: !!client.autoPrint,
            });
        }
        else if (show) {
            setForm({ ...emptyForm });
        }
        setTaxIdWarning('');
        // eslint-disable-next-line vanilla-runtime/exhaustive-deps
    }, [show, client]);
    if (!show)
        return null;
    const cc = getCountryConfig(form.country);
    const stateOptions = getStatesForCountry(form.country);
    // v1.10.83 - a client in another country than the business.
    const abroad = !!form.country && form.country !== (defaultCountry || 'India');
    const currencyCodes = [...new Set(COUNTRIES.map(c => c.currency))];
    // v1.10.68 (#68, idea from @deppen12) — a GSTIN already says which state the
    // client is registered in and carries a checksum, so fill the state in and
    // catch a typo here, offline. The state drives place of supply, so a wrong
    // one silently swaps CGST + SGST for IGST on every invoice to this client.
    const handleTaxIdBlur = () => {
        const result = validateTaxId(form.country, form.gstin);
        setTaxIdWarning(result.ok ? '' : result.message);
        if (form.country !== 'India')
            return;
        const decoded = decodeGstin(form.gstin);
        if (!decoded)
            return;
        if (!decoded.checksumOk) {
            setTaxIdWarning('This GSTIN fails its own checksum — check for a typo.');
            return;
        }
        if (!decoded.state)
            return;
        if (!form.state?.trim()) {
            setForm(prev => ({ ...prev, state: decoded.state }));
        }
        else if (form.state.trim().toLowerCase() !== decoded.state.toLowerCase()) {
            setTaxIdWarning(`This GSTIN is registered in ${decoded.state}, but the state says ${form.state}.`);
        }
    };
    const handleSave = () => {
        if (!form.name.trim())
            return;
        onSave(form);
    };
    return (h("div", { className: "modal-overlay" },
        h("div", { className: "modal-content", style: { maxWidth: '520px' } },
            h("div", { className: "flex justify-between items-center mb-4" },
                h("h3", { className: "section-title", style: { margin: 0 } },
                    isEditing ? 'Edit Client' : 'Add New Client',
                    " ",
                    h(HelpButton, { title: "Adding and editing a client", doc: "clients#client-form", size: 16 })),
                h("button", { type: "button", className: "icon-btn", onClick: onClose, title: "Close" },
                    h(X, { size: 18 }))),
            h("div", { className: "grid grid-cols-2 gap-4" },
                h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                    h("label", { className: "form-label" }, "Client / Business Name *"),
                    h("input", { type: "text", className: "form-input", value: form.name, onChange: e => setForm(prev => ({ ...prev, name: e.target.value })), placeholder: "e.g. Acme Corp" })),
                h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                    h("label", { className: "form-label" }, "Address"),
                    h("input", { type: "text", className: "form-input", value: form.address, onChange: e => setForm(prev => ({ ...prev, address: e.target.value })), placeholder: "Street address, locality" })),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label" }, "Country"),
                    h("select", { className: "form-input", value: form.country, onChange: e => setForm(prev => ({ ...prev, country: e.target.value, state: '' })) }, (() => {
                        const visible = getCountriesForRegion(getRegionMode());
                        const out = [];
                        if (form.country && !visible.some(c => c.name === form.country)) {
                            out.push(h("option", { key: form.country, value: form.country }, form.country));
                        }
                        return out.concat(visible.map(c => h("option", { key: c.code, value: c.name }, c.name)));
                    })())),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label" }, "City"),
                    h("input", { type: "text", className: "form-input", value: form.city, onChange: e => setForm(prev => ({ ...prev, city: e.target.value })), placeholder: abroad ? 'City' : 'e.g. Mumbai' })),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label" }, cc.postalLabel),
                    h("input", { type: "text", className: "form-input", value: form.pin, onChange: e => setForm(prev => ({ ...prev, pin: e.target.value })), placeholder: cc.postalLabel })),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label" },
                        cc.stateLabel,
                        abroad ? ' (optional)' : ''),
                    stateOptions.length > 0 ? (h("select", { className: "form-input", value: form.state, onChange: e => setForm(prev => ({ ...prev, state: e.target.value })) },
                        h("option", { value: "" },
                            "Select ",
                            cc.stateLabel),
                        stateOptions.map(s => h("option", { key: s, value: s }, s)))) : (h("input", { type: "text", className: "form-input", value: form.state, onChange: e => setForm(prev => ({ ...prev, state: e.target.value })), placeholder: cc.stateLabel }))),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label" }, abroad ? `${cc.taxIdLabel} (optional)` : cc.taxIdLabel),
                    h("input", { type: "text", className: "form-input", style: taxIdWarning ? { borderColor: '#f59e0b' } : undefined, value: form.gstin, onChange: e => { setForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase() })); if (taxIdWarning)
                            setTaxIdWarning(''); }, onBlur: handleTaxIdBlur, placeholder: cc.taxIdPlaceholder, maxLength: 20 }),
                    taxIdWarning && h("small", { style: { color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' } },
                        "\u26A0 ",
                        taxIdWarning)),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label" }, "Email"),
                    h("input", { type: "email", className: "form-input", value: form.email, onChange: e => setForm(prev => ({ ...prev, email: e.target.value })), placeholder: "client@example.com" })),
                h("div", { className: "form-group" },
                    h("label", { className: "form-label" }, "Phone"),
                    h("input", { type: "tel", className: "form-input", value: form.phone, onChange: e => setForm(prev => ({ ...prev, phone: e.target.value })), placeholder: abroad ? 'With country code, e.g. +1 415 555 0100' : '+91 98765 43210' })),
                abroad && (defaultCountry || 'India') === 'India' && (h("div", { className: "form-group notice notice-info", style: { gridColumn: 'span 2', display: 'block', fontSize: '0.78rem', lineHeight: 1.5, padding: '0.5rem 0.75rem', borderRadius: 6 } },
                    "Client outside India: no GSTIN or state is needed. Their tax ID (if they have one) and country print on the invoice, and the place of supply prints as \"Outside India\". Invoices to them are exports: with a LUT, no IGST is charged.",
                    h(HelpButton, { title: "Billing clients abroad (exports)", doc: "gst-basics#exports", size: 14 }))),
                form.country === 'India' && (h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
                    h("label", { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' } },
                        h("input", { type: "checkbox", checked: !!form.isSEZ, onChange: e => setForm(prev => ({ ...prev, isSEZ: e.target.checked })), style: { width: 16, height: 16, accentColor: 'var(--primary)' } }),
                        h("span", null,
                            h("strong", null, "SEZ unit / Developer"),
                            " \u2014 supplies will be charged IGST regardless of state (Section 16, IGST Act).")))),
                h("div", { className: "form-group", style: { gridColumn: 'span 2', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', marginTop: '0.5rem' } },
                    h("div", { style: { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' } },
                        "Print preferences (optional) ",
                        h(HelpButton, { title: "Client print preferences", doc: "clients#client-print-prefs", size: 16 })),
                    h("p", { style: { fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' } }, "Auto-applied when you create a new invoice for this client. Leave blank to use app-wide defaults."),
                    h("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' } },
                        h("div", null,
                            h("label", { style: { display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 } }, "Preferred paper size"),
                            h("select", { className: "form-input", style: { fontSize: '0.8rem', padding: '0.35rem' }, value: form.preferredPaperSize, onChange: e => setForm(prev => ({ ...prev, preferredPaperSize: e.target.value })) },
                                h("option", { value: "" }, "Use app default"),
                                Object.entries(PAPER_SIZES).map(([key, ps]) => (h("option", { key: key, value: key }, ps.label))))),
                        h("div", null,
                            h("label", { style: { display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 } }, "Preferred currency"),
                            h("select", { className: "form-input", style: { fontSize: '0.8rem', padding: '0.35rem' }, value: form.preferredCurrency, onChange: e => setForm(prev => ({ ...prev, preferredCurrency: e.target.value })) },
                                h("option", { value: "" }, abroad ? "Their country's currency" : 'Use invoice default'),
                                currencyCodes.map(c => h("option", { key: c, value: c }, c)))),
                        h("label", { style: { gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', marginTop: '0.2rem' } },
                            h("input", { type: "checkbox", checked: !!form.autoPrint, onChange: e => setForm(prev => ({ ...prev, autoPrint: e.target.checked })), style: { width: 15, height: 15, accentColor: 'var(--primary)' } }),
                            h("span", null,
                                h("strong", null, "Auto-print on save for this client"),
                                " \u2014 overrides global setting"))))),
            h("div", { className: "flex gap-2 justify-end mt-4" },
                h("button", { type: "button", className: "btn btn-secondary", onClick: onClose }, "Cancel"),
                h("button", { type: "button", className: "btn btn-primary", onClick: handleSave }, isEditing ? 'Update Client' : 'Save Client')))));
}
