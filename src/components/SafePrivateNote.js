import { h } from '../vanilla/dom.js';
import { ShieldCheck } from '../vanilla/icons.js';

const POINTS = [
  'Invoices and business records stay in this browser profile using IndexedDB.',
  'No Google account, OAuth sign-in or application server is required.',
  'The app does not automatically upload or sync business records.',
  'An internet connection may be needed to load the app and helper libraries the first time.',
];

export default function SafePrivateNote({ style }) {
  return h('div', { role: 'note', 'aria-label': 'Local data and privacy', style: {
    display: 'flex', gap: '0.7rem', alignItems: 'flex-start', padding: '0.75rem 0.9rem',
    borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
    textAlign: 'left', ...style,
  } },
  h(ShieldCheck, { size: 22, style: { color: 'var(--success, #16a34a)', flexShrink: 0, marginTop: 1 }, 'aria-hidden': 'true' }),
  h('div', { style: { minWidth: 0 } },
    h('div', { style: { fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '0.3rem' } }, 'Local data and privacy'),
    h('ul', { style: { margin: 0, paddingLeft: '1.1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55 } },
      POINTS.map((point) => h('li', { key: point }, point)))));
}
