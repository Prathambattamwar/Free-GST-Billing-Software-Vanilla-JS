import { h, Fragment } from '../vanilla/dom.js';
// v1.10.83 (#112) - the cost centre picker and list filter shared by the
// invoice, purchase and expense screens and the Dashboard (loader: useCostCentres.js).
import { centreLabel, UNTAGGED } from '../utils/costCentres.js';
// Picks one centre for a document. Archived centres cannot be picked, but a
// document already tagged with one keeps it (shown as archived).
// onChange(id, name); id '' = none.
export function CostCentreSelect({ centres, value = '', name = '', onChange, id = 'cost-centre' }) {
    const current = value ? centres.find((c) => c.id === value) : null;
    const keepOld = value && (!current || current.archived);
    return (h("select", { id: id, className: "form-input", value: value, onChange: (e) => {
            const next = e.target.value;
            const c = centres.find((x) => x.id === next);
            onChange(next, c ? c.name : (next === value ? name : ''));
        } },
        h("option", { value: "" }, "None"),
        centres.filter((c) => !c.archived).map((c) => h("option", { key: c.id, value: c.id }, centreLabel(c))),
        keepOld && h("option", { value: value },
            current ? centreLabel(current) : (name || 'Unknown'),
            " (archived)")));
}
// The list filter: all, untagged, or one centre (archived ones too).
export function CostCentreFilter({ centres, value, onChange }) {
    return (h("select", { className: "filter-select", value: value, onChange: (e) => onChange(e.target.value), "aria-label": "Cost centre", title: "Cost centre" },
        h("option", { value: "" }, "All cost centres"),
        h("option", { value: UNTAGGED }, "No cost centre"),
        centres.map((c) => h("option", { key: c.id, value: c.id },
            centreLabel(c),
            c.archived ? ' (archived)' : ''))));
}
