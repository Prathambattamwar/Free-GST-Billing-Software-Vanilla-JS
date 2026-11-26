import { h, Fragment } from '../vanilla/dom.js';
import { useState } from '../vanilla/dom.js';
import { getAllProducts, updateProductsFromCsv } from '../store.js';
import { buildPricePlan, exportPrices } from '../utils/productUpdateCsv.js';
export default function ProductUpdateImport({ onClose, onDone }) {
    const [plan, setPlan] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [page, setPage] = useState(0), [confirmed, setConfirmed] = useState(false);
    const [allowStock, setAllowStock] = useState(false), [stockConfirmed, setStockConfirmed] = useState(false);
    const download = async () => {
        setError('');
        setBusy(true);
        try {
            const products = await getAllProducts(), url = URL.createObjectURL(new Blob([exportPrices(products)], { type: 'text/csv;charset=utf-8' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Product-updates.csv';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setBusy(false);
        }
    };
    const choose = async (e) => {
        const file = e.target.files?.[0];
        setPlan(null);
        setError('');
        setConfirmed(false);
        setStockConfirmed(false);
        setPage(0);
        if (!file)
            return;
        if (file.size > 5 * 1024 * 1024) {
            setError('Use a CSV smaller than 5 MB.');
            return;
        }
        setBusy(true);
        try {
            setPlan(buildPricePlan(await file.text(), await getAllProducts(), { allowStock }));
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setBusy(false);
            e.target.value = '';
        }
    };
    const apply = async () => {
        if (!confirmed ||
            !plan?.changes.length ||
            plan.errors.length ||
            (plan.changes.some((c) => 'stock' in c.prices) && !stockConfirmed))
            return;
        setBusy(true);
        setError('');
        try {
            const result = await updateProductsFromCsv(plan.changes.map(({ id, prices, expected }) => ({ id, prices, expected })), allowStock && stockConfirmed);
            setPlan(null);
            setConfirmed(false);
            setStockConfirmed(false);
            onDone(result);
        }
        catch (e) {
            setError(e.message);
            setConfirmed(false);
        }
        finally {
            setBusy(false);
        }
    };
    return (h("div", { className: "glass-panel p-4 mb-6", "aria-label": "Import product updates" },
        h("div", { className: "flex gap-2", style: { justifyContent: 'space-between', flexWrap: 'wrap' } },
            h("h3", null, "Import product updates"),
            h("button", { className: "btn btn-secondary", disabled: busy, onClick: onClose }, "Close")),
        h("p", null, "Download current products, edit the CSV, then upload it here. Match by Product ID (recommended), or an exact product name ignoring case and surrounding spaces. New products are not added."),
        h("p", null, "Update Purchase Price, Selling Price and HSN/SAC together. Stock is optional and disabled by default. Blank cells stay unchanged; 0 explicitly sets a price or stock to zero. GST %, names and saved invoices stay unchanged. Keep the same tax-inclusive or tax-exclusive price basis you currently use; this import does not convert GST."),
        h("p", null, "Keep HSN/SAC as text in Excel to preserve leading zeros. Stock is the final quantity in the product\u2019s base unit, not its alternate unit. It replaces the current balance; it is not a purchase receipt or an amount to add."),
        h("label", null,
            h("input", { type: "checkbox", checked: allowStock, disabled: busy, onChange: (e) => {
                    setAllowStock(e.target.checked);
                    setPlan(null);
                    setConfirmed(false);
                    setStockConfirmed(false);
                } }),
            ' ',
            "Enable stock quantity updates for this upload (choose the CSV after enabling)."),
        h("div", { className: "flex gap-2", style: { flexWrap: 'wrap', margin: '1rem 0' } },
            h("button", { className: "btn btn-secondary", disabled: busy, onClick: download }, "Download current products CSV"),
            h("label", { className: "btn btn-secondary" },
                "Choose update CSV",
                h("input", { type: "file", accept: ".csv,text/csv", disabled: busy, onChange: choose, style: { maxWidth: 220, marginLeft: 8 } }))),
        busy && h("p", { role: "status" }, "Please wait. Do not close this page."),
        error && (h("p", { role: "alert", style: { color: 'var(--danger, #b91c1c)' } }, error)),
        plan && (h(Fragment, null,
            h("p", null,
                h("b", null,
                    plan.changes.length,
                    " products to update"),
                " \u00B7 ",
                plan.unchanged,
                " unchanged \u00B7 ",
                plan.blank,
                " blank update rows \u00B7 ",
                plan.errors.length,
                " errors"),
            !!plan.ignored.length && (h("p", null,
                "Ignored columns: ",
                plan.ignored.join(', '),
                ". They will not be changed.")),
            !!plan.errors.length && (h("div", { role: "alert" },
                h("p", null, "Fix these rows and upload again. Nothing has been saved."),
                h("ul", null, plan.errors.slice(0, 100).map((e, i) => (h("li", { key: i }, e)))),
                plan.errors.length > 100 && h("p", null, "Showing the first 100 errors."))),
            !!plan.changes.length && (h(Fragment, null,
                h("div", { className: "table-scroll" },
                    h("table", { className: "data-table" },
                        h("thead", null,
                            h("tr", null,
                                h("th", null, "Product"),
                                h("th", null, "Purchase price: old \u2192 new"),
                                h("th", null, "Selling price: old \u2192 new"),
                                h("th", null, "HSN/SAC: old \u2192 new"),
                                h("th", null, "Stock: old \u2192 new"))),
                        h("tbody", null, plan.changes.slice(page * 100, (page + 1) * 100).map((c) => (h("tr", { key: c.id },
                            h("td", null, c.name),
                            ['purchasePrice', 'sellingPrice', 'hsn', 'stock'].map((f) => (h("td", { key: f }, f in c.prices
                                ? `${c.expected[f] ?? 'Not tracked'} → ${c.prices[f]}`
                                : 'Unchanged'))))))))),
                h("div", { className: "flex gap-2", style: { margin: '1rem 0' } },
                    h("button", { className: "btn btn-secondary", disabled: page === 0 || busy, onClick: () => setPage(page - 1) }, "Previous"),
                    h("span", null,
                        "Page ",
                        page + 1,
                        " of ",
                        Math.ceil(plan.changes.length / 100)),
                    h("button", { className: "btn btn-secondary", disabled: (page + 1) * 100 >= plan.changes.length || busy, onClick: () => setPage(page + 1) }, "Next")),
                h("label", null,
                    h("input", { type: "checkbox", checked: confirmed, disabled: busy || !!plan.errors.length, onChange: (e) => setConfirmed(e.target.checked) }),
                    ' ',
                    "I reviewed the changes and approve updating ",
                    plan.changes.length,
                    " products."),
                h("br", null),
                plan.changes.some((c) => 'stock' in c.prices) && (h(Fragment, null,
                    h("label", null,
                        h("input", { type: "checkbox", checked: stockConfirmed, disabled: busy || !!plan.errors.length, onChange: (e) => setStockConfirmed(e.target.checked) }),
                        ' ',
                        "I approve replacing stock balances for",
                        ' ',
                        plan.changes.filter((c) => 'stock' in c.prices).length,
                        " products with the reviewed CSV quantities."),
                    h("br", null))),
                h("button", { style: { marginTop: 12 }, className: "btn btn-primary", disabled: busy ||
                        !confirmed ||
                        !!plan.errors.length ||
                        (plan.changes.some((c) => 'stock' in c.prices) && !stockConfirmed), onClick: apply },
                    "Update ",
                    plan.changes.length,
                    " products"),
                h("p", null, "A backup of affected products is saved before applying changes. Any value changed elsewhere after preview will block the update.")))))));
}
