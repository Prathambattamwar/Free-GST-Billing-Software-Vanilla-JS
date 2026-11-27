import { h, Fragment } from '../vanilla/dom.js';
import { WifiOff, ShieldCheck } from '../vanilla/icons.js';
import { useOfflineMode } from '../utils/offlineMode.js';

const ROWS = [
  ['Business records', 'Saved in this browser profile using IndexedDB. They are not automatically uploaded or synced.', 'Local to this browser'],
  ['App libraries', 'Some PDF, spreadsheet and OCR libraries are loaded from pinned public CDNs when the page or feature first needs them.', 'Internet may be needed until cached'],
  ['Backups', 'Download a JSON backup, or explicitly save one to your connected Google Drive. Saved PDF files stay in this browser until downloaded.', 'Only when you choose'],
  ['External links', 'WhatsApp, GST portal and other links open only when you choose them.', 'Only when clicked'],
];
const cell = { padding: '0.55rem 0.65rem', borderTop: '1px solid var(--border)', verticalAlign: 'top' };

export default function PrivacyInternet() {
  const [offline, toggle] = useOfflineMode();
  return h(Fragment, null,
    h('h3', { className: 'section-title' }, 'Privacy & internet'),
    h('p', { className: 'page-subtitle', style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' } },
      h(ShieldCheck, { size: 18, style: { color: 'var(--success, #16a34a)', flexShrink: 0, marginTop: 2 }, 'aria-hidden': 'true' }),
      h('span', null, 'Invoices, clients, products and settings are stored in this browser profile by default. This static edition does not require an account or sync records automatically. Google Drive backups are optional and only happen when you request them.')),
    h('label', { className: 'notice notice-info', style: { display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '1rem' } },
      h('input', { type: 'checkbox', checked: offline, onChange: (e) => toggle(e.target.checked), style: { marginTop: 4, width: 18, height: 18, flexShrink: 0 } }),
      h('span', null,
        h('strong', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem' } }, h(WifiOff, { size: 16, 'aria-hidden': 'true' }), ' Limit optional online actions'),
        h('br'),
        h('span', { style: { fontSize: '0.85rem' } }, offline
          ? 'Enabled. Automatic release checks and Google Drive backups are disabled. Your data remains local.'
          : 'Disabled. Your business records remain local unless you explicitly choose a Google Drive backup. First-time or uncached app libraries may still need internet.'))),
    h('div', { className: 'table-wrap', style: { overflowX: 'auto' } },
      h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' } },
        h('thead', null, h('tr', { style: { textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.78rem' } },
          h('th', { style: { padding: '0.45rem 0.6rem' } }, 'Area'),
          h('th', { style: { padding: '0.45rem 0.6rem' } }, 'What happens'),
          h('th', { style: { padding: '0.45rem 0.6rem' } }, 'Network use'))),
        h('tbody', null, ROWS.map(([area, detail, network]) => h('tr', { key: area },
          h('td', { style: { ...cell, fontWeight: 600 } }, area),
          h('td', { style: cell }, detail),
          h('td', { style: cell }, network)))))),
    h('p', { style: { fontSize: '0.85rem', margin: '0.75rem 0 0' } }, 'For use on another device, download a backup from Data & Backups or restore one from your connected Google Drive. Browser data can be removed by clearing this site’s storage, so keep an external backup.'));
}
