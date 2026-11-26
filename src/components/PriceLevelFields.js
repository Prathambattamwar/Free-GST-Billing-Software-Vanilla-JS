import { h, Fragment } from '../vanilla/dom.js';
// v1.10.85 - the price-level boxes on three screens (see utils/priceLevels.js).
// Each is shown only while Settings -> Features -> Price levels is on.
const muted = { fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 };
// Settings -> Features, under the switch: the names of the (up to 3) levels.
export function PriceLevelNames({ names, problem, onChange }) {
    const set = (i, v) => onChange(names.map((n, j) => (j === i ? v : n)));
    return (h("div", { style: { margin: '0.35rem 0 0 1.4rem' } },
        h("div", { style: muted }, "Level names (leave one blank to use fewer):"),
        h("div", { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.3rem' } }, names.map((n, i) => (h("input", { key: i, type: "text", className: "form-input", value: n, maxLength: 30, "aria-label": `Price level ${i + 1} name`, placeholder: `Level ${i + 1}`, onChange: (e) => set(i, e.target.value), style: { width: 110, fontSize: '0.78rem', padding: '0.3rem 0.45rem' } })))),
        problem && h("div", { role: "alert", style: { ...muted, color: '#dc2626', marginTop: '0.3rem' } }, problem)));
}
// Product form: a price for each level, besides the selling price.
export function PriceLevelPrices({ levels, prices, onChange }) {
    if (!levels.length)
        return null;
    return (h("div", { className: "form-group", style: { gridColumn: 'span 2' } },
        h("span", { className: "form-label" }, "Price for each level (optional)"),
        h("div", { style: { display: 'grid', gridTemplateColumns: `repeat(${levels.length}, minmax(0, 1fr))`, gap: '0.5rem' } }, levels.map((l) => (h("label", { key: l.id, style: { fontSize: '0.75rem' } },
            l.name,
            h("input", { type: "number", className: "form-input", min: "0", step: "any", placeholder: "Selling price", "aria-label": `${l.name} price`, value: prices?.[l.id] ?? '', onChange: (e) => onChange({ ...(prices || {}), [l.id]: e.target.value }) }))))),
        h("span", { style: muted }, "Blank = the selling price is used for clients on that level.")));
}
// Client form: the level the client buys at.
export function PriceLevelSelect({ levels, value, onChange }) {
    if (!levels.length)
        return null;
    return (h("div", null,
        h("label", { htmlFor: "client-price-level", style: { display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 } }, "Price level"),
        h("select", { id: "client-price-level", className: "form-input", style: { fontSize: '0.8rem', padding: '0.35rem' }, value: value || '', onChange: (e) => onChange(e.target.value) },
            h("option", { value: "" }, "Selling price (no level)"),
            levels.map((l) => h("option", { key: l.id, value: l.id }, l.name)))));
}
