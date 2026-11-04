## 1.10.89 — 4 November 2026

### Interface
- Removed all contextual help buttons that opened the external `invoices.html` documentation page, including invoice form, currency and compliance help links.
- Kept unrelated contextual help links for settings, reports, GST returns and other screens.
- Updated the service-worker cache key so GitHub Pages users receive the change.

# GST Billing Software — Changelog

## 1.10.88 — 4 November 2026

### Interface
- Removed the top-right User Guide question-mark button and its menu/command-palette entry. Contextual help links inside forms remain available.
- Improved responsive layouts for desktop, tablet and mobile: safer content sizing, touch-friendly navigation, stacked forms, responsive cards, scrollable data tables and viewport-fitted dialogs.
- Updated the service-worker cache key so deployed devices fetch the revised interface.

## 1.10.87 — 4 November 2026

### Branding
- Updated the application name to **GST Billing Software** across the browser title, welcome flow, settings, generated reports and PDF exports.
- Removed the previous product-name prefix from user-facing copy and newly downloaded backup filenames.

### Application
- Kept the static HTML, CSS and browser-native JavaScript architecture.
- Kept local IndexedDB storage and existing backup compatibility.
- Preserved invoice, quotation, inventory, GST returns, tax reports and export workflows.

### Compatibility
- Existing browser storage identifiers and backup markers are intentionally unchanged so data created by earlier releases remains accessible.
