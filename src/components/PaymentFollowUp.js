import { useState, useEffect, useMemo, h } from '../vanilla/dom.js';
import { getAllBills, getAllClients, getProfile } from '../store.js';
import { amountDue, belongsToProfile, countsAsSales, formatCurrency, localToday, parseLocalDate } from '../utils.js';
import { openWhatsAppShare } from '../utils/share.js';
import { toast } from './Toast.js';
import { AlertTriangle, Clock, MessageCircle, RefreshCw, Search, Users, FileText } from '../vanilla/icons.js';

const dayNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
const safeDate = (value) => {
    if (!value) return null;
    const date = parseLocalDate(value);
    return Number.isNaN(date.getTime()) ? null : date;
};
const money = (value, currency) => formatCurrency(Math.max(0, Number(value) || 0), currency || 'INR');

function getPaidAmount(bill) {
    const payments = Array.isArray(bill?.payments) ? bill.payments : [];
    const fromPayments = payments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0);
    return fromPayments > 0.005 ? fromPayments : (Number(bill?.paidAmount) || 0);
}

function makeReminder(row, businessName) {
    const name = row.clientName || 'Sir/Madam';
    const total = money(row.bill.totalAmount, row.currency);
    const outstanding = money(row.outstanding, row.currency);
    const invoice = row.bill.invoiceNumber || row.bill.id || '—';
    if (row.kind === 'overdue' && row.daysUntilDue !== null && row.daysUntilDue < 0) {
        return `Hi ${name}, this is a gentle reminder that Invoice ${invoice} for ${outstanding} was due on ${row.dueDate.toLocaleDateString('en-IN')}. Invoice total: ${total}. Kindly arrange the pending payment. Thank you! - ${businessName || 'Our Company'}`;
    }
    if (row.paid > 0.005) {
        return `Hi ${name}, a balance of ${outstanding} is pending on Invoice ${invoice} (invoice total ${total}). Kindly clear the remaining amount at your earliest convenience. Thank you! - ${businessName || 'Our Company'}`;
    }
    return `Hi ${name}, this is a gentle reminder about the pending payment of ${outstanding} on Invoice ${invoice} (invoice total ${total}). Kindly arrange the payment at your earliest convenience. Thank you! - ${businessName || 'Our Company'}`;
}

export default function PaymentFollowUp({ activeProfile }) {
    const [allBills, setAllBills] = useState([]);
    const [clients, setClients] = useState([]);
    const [loadedProfile, setLoadedProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [refreshTick, setRefreshTick] = useState(0);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const profile = activeProfile ?? loadedProfile;

    const loadData = async () => {
        setLoading(true);
        setLoadError('');
        try {
            const [billsResult, clientsResult, profileResult] = await Promise.all([
                getAllBills(),
                getAllClients().catch(() => []),
                getProfile().catch(() => activeProfile || null),
            ]);
            setAllBills(Array.isArray(billsResult) ? billsResult : []);
            setClients(Array.isArray(clientsResult) ? clientsResult : []);
            setLoadedProfile(profileResult || activeProfile || null);
        }
        catch (error) {
            console.error('Payment Follow-up: failed to load records', error);
            setLoadError('Could not load payment records. Please try refreshing.');
            toast('Could not load payment follow-up records', 'error');
        }
        finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
        // The page refreshes on mount and when the user explicitly requests it.
        // Existing payment and invoice workflows remain untouched.
        // eslint-disable-next-line vanilla-runtime/exhaustive-deps
    }, [refreshTick]);

    const clientByName = useMemo(() => {
        const map = new Map();
        for (const client of clients) {
            const key = String(client?.name || '').trim().toLowerCase();
            if (key) map.set(key, client);
        }
        return map;
    }, [clients]);

    const rows = useMemo(() => {
        const today = safeDate(localToday()) || new Date();
        const todayNumber = dayNumber(today);
        return allBills
            .filter((bill) => belongsToProfile(bill, profile) && countsAsSales(bill))
            .map((bill) => {
                const due = Number(amountDue(bill)) || 0;
                const paid = getPaidAmount(bill);
                const outstanding = Math.max(0, Math.round((due - paid) * 100) / 100);
                if (outstanding <= 0.01) return null;
                const explicitDueDate = bill?.data?.details?.dueDate || bill?.dueDate || '';
                const dueDate = safeDate(explicitDueDate);
                const daysUntilDue = dueDate ? Math.round(dayNumber(dueDate) - todayNumber) : null;
                const statusIsOverdue = String(bill?.status || '').toLowerCase() === 'overdue';
                const overdueByDate = daysUntilDue !== null && daysUntilDue < 0;
                const kind = statusIsOverdue || overdueByDate
                    ? 'overdue'
                    : !dueDate ? 'noDueDate' : daysUntilDue <= 7 ? 'dueSoon' : 'upcoming';
                const clientName = bill.clientName || bill.data?.client?.name || 'Unknown customer';
                const savedClient = clientByName.get(String(clientName).trim().toLowerCase());
                const phone = bill.clientPhone || bill.data?.client?.phone || savedClient?.phone || '';
                const email = bill.data?.client?.email || savedClient?.email || '';
                const currency = bill.currency || bill.data?.invoiceOptions?.currency || 'INR';
                return { bill, clientName, phone, email, currency, paid, outstanding, dueDate, daysUntilDue, statusIsOverdue, overdueByDate, kind };
            })
            .filter(Boolean)
            .sort((a, b) => {
                const aRank = a.kind === 'overdue' ? 0 : a.kind === 'dueSoon' ? 1 : a.kind === 'noDueDate' ? 2 : 3;
                const bRank = b.kind === 'overdue' ? 0 : b.kind === 'dueSoon' ? 1 : b.kind === 'noDueDate' ? 2 : 3;
                if (aRank !== bRank) return aRank - bRank;
                if (a.kind === 'overdue' && b.kind === 'overdue' && a.daysUntilDue !== b.daysUntilDue) return a.daysUntilDue - b.daysUntilDue;
                return b.outstanding - a.outstanding;
            });
    }, [allBills, clientByName, profile]);

    const filteredRows = useMemo(() => {
        const query = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (filter === 'overdue' && row.kind !== 'overdue') return false;
            if (filter === 'dueSoon' && row.kind !== 'dueSoon') return false;
            if (filter === 'partial' && row.paid <= 0.005) return false;
            if (filter === 'noDueDate' && row.kind !== 'noDueDate') return false;
            if (!query) return true;
            return [row.clientName, row.bill.invoiceNumber, row.phone]
                .some((value) => String(value || '').toLowerCase().includes(query));
        });
    }, [rows, filter, search]);

    const metrics = useMemo(() => {
        const byCurrency = new Map();
        const customers = new Set();
        let overdueCount = 0;
        let dueSoonCount = 0;
        for (const row of rows) {
            const current = byCurrency.get(row.currency) || { outstanding: 0, overdue: 0 };
            current.outstanding += row.outstanding;
            if (row.kind === 'overdue') {
                current.overdue += row.outstanding;
                overdueCount += 1;
            }
            if (row.kind === 'dueSoon') dueSoonCount += 1;
            byCurrency.set(row.currency, current);
            customers.add(row.clientName.toLowerCase());
        }
        return { byCurrency: [...byCurrency.entries()], overdueCount, dueSoonCount, customerCount: customers.size };
    }, [rows]);

    const customerSummary = useMemo(() => {
        const grouped = new Map();
        for (const row of rows) {
            const key = `${row.clientName.toLowerCase()}|${row.currency}`;
            const item = grouped.get(key) || { clientName: row.clientName, currency: row.currency, outstanding: 0, invoices: 0, overdue: 0 };
            item.outstanding += row.outstanding;
            item.invoices += 1;
            if (row.kind === 'overdue') item.overdue += row.outstanding;
            grouped.set(key, item);
        }
        return [...grouped.values()].sort((a, b) => b.outstanding - a.outstanding);
    }, [rows]);

    const sendReminder = (row) => {
        if (!row.phone) toast('No phone number is saved for this customer. Choose the customer manually in WhatsApp.', 'warning', 5000);
        const message = makeReminder(row, profile?.businessName);
        openWhatsAppShare(row.phone, message);
        toast('WhatsApp reminder prepared. Review the message in WhatsApp and press Send manually.', 'info', 5000);
    };

    const filters = [
        { id: 'all', label: 'All pending', count: rows.length },
        { id: 'overdue', label: 'Overdue', count: metrics.overdueCount },
        { id: 'dueSoon', label: 'Due in 7 days', count: metrics.dueSoonCount },
        { id: 'partial', label: 'Part-paid', count: rows.filter(row => row.paid > 0.005).length },
        { id: 'noDueDate', label: 'No due date', count: rows.filter(row => row.kind === 'noDueDate').length },
    ];

    const renderDue = (row) => {
        if (!row.dueDate) {
            return row.statusIsOverdue
                ? h('span', { style: { color: 'var(--danger, #dc2626)', fontWeight: 700 } }, 'Marked overdue · due date not set')
                : h('span', { style: { color: 'var(--text-muted)' } }, 'Not set');
        }
        if (row.overdueByDate) return h('span', { style: { color: 'var(--danger, #dc2626)', fontWeight: 700 } }, `Overdue ${Math.abs(row.daysUntilDue)} day${Math.abs(row.daysUntilDue) === 1 ? '' : 's'}`);
        if (row.statusIsOverdue) return h('span', { style: { color: 'var(--danger, #dc2626)', fontWeight: 700 } }, `Marked overdue · due ${row.dueDate.toLocaleDateString('en-IN')}`);
        if (row.daysUntilDue === 0) return h('span', { style: { color: 'var(--warning, #b45309)', fontWeight: 700 } }, 'Due today');
        if (row.kind === 'dueSoon') return h('span', { style: { color: 'var(--warning, #b45309)', fontWeight: 700 } }, `Due in ${row.daysUntilDue} day${row.daysUntilDue === 1 ? '' : 's'}`);
        return h('span', { style: { color: 'var(--text-secondary, var(--text-muted))' } }, `Due ${row.dueDate.toLocaleDateString('en-IN')}`);
    };

    return h('div', { className: 'dashboard-container' },
        h('div', { className: 'page-header', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' } },
            h('div', null,
                h('h1', { className: 'page-title', style: { margin: 0 } }, 'Payment Follow-up'),
                h('p', { className: 'page-subtitle', style: { marginTop: '0.25rem' } }, 'Track pending customer payments and prepare follow-up reminders.')),
            h('button', { type: 'button', className: 'btn btn-secondary', onClick: () => setRefreshTick(value => value + 1), disabled: loading },
                h(RefreshCw, { size: 16 }), loading ? ' Refreshing…' : ' Refresh')),
        h('div', { className: 'stats-grid stats-grid-4', style: { marginBottom: '1rem' } },
            h('div', { className: 'stat-card' }, h('div', { className: 'stat-icon stat-icon-blue' }, h(FileText, { size: 20 })), h('div', { style: { minWidth: 0 } }, h('p', { className: 'stat-label' }, 'Pending invoices'), h('p', { className: 'stat-value' }, rows.length))),
            h('div', { className: 'stat-card' }, h('div', { className: 'stat-icon stat-icon-red' }, h(AlertTriangle, { size: 20 })), h('div', { style: { minWidth: 0 } }, h('p', { className: 'stat-label' }, 'Overdue invoices'), h('p', { className: 'stat-value' }, metrics.overdueCount))),
            h('div', { className: 'stat-card' }, h('div', { className: 'stat-icon stat-icon-orange' }, h(Clock, { size: 20 })), h('div', { style: { minWidth: 0 } }, h('p', { className: 'stat-label' }, 'Due in 7 days'), h('p', { className: 'stat-value' }, metrics.dueSoonCount))),
            h('div', { className: 'stat-card' }, h('div', { className: 'stat-icon stat-icon-green' }, h(Users, { size: 20 })), h('div', { style: { minWidth: 0 } }, h('p', { className: 'stat-label' }, 'Customers to follow up'), h('p', { className: 'stat-value' }, metrics.customerCount)))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '0.85rem', marginBottom: '1rem' } },
            ...metrics.byCurrency.map(([currency, totals]) => h('div', { key: currency, className: 'glass-panel p-4', style: { border: '1px solid var(--border)', borderRadius: 12 } },
                h('div', { style: { fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.3rem' } }, `Outstanding · ${currency}`),
                h('div', { style: { fontSize: '1.35rem', fontWeight: 800 } }, money(totals.outstanding, currency)),
                h('div', { style: { fontSize: '0.78rem', color: 'var(--danger, #dc2626)', marginTop: '0.25rem' } }, `Overdue: ${money(totals.overdue, currency)}`))),
            metrics.byCurrency.length === 0 && h('div', { className: 'glass-panel p-4', style: { border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text-muted)' } }, 'No outstanding balances found.'))),
        h('div', { className: 'glass-panel p-4', style: { marginBottom: '1rem' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.8rem', flexWrap: 'wrap' } },
                h(Search, { size: 17, style: { color: 'var(--text-muted)' } }),
                h('input', { className: 'form-input', value: search, onChange: event => setSearch(event.target.value), placeholder: 'Search customer, invoice number or phone…', style: { flex: '1 1 260px', minWidth: 0 } })),
            h('div', { style: { display: 'flex', gap: '0.45rem', flexWrap: 'wrap' } },
                ...filters.map(item => h('button', { key: item.id, type: 'button', className: 'btn btn-secondary', onClick: () => setFilter(item.id), style: { fontSize: '0.78rem', padding: '0.4rem 0.7rem', borderColor: filter === item.id ? 'var(--primary)' : undefined, background: filter === item.id ? 'var(--primary-light, rgba(37,99,235,0.10))' : undefined, color: filter === item.id ? 'var(--primary)' : undefined } }, `${item.label} (${item.count})`)))),
        loadError && h('div', { className: 'notice notice-danger', style: { marginBottom: '1rem' } }, loadError),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '1rem', alignItems: 'start' } },
            h('section', { className: 'glass-panel p-4', style: { border: '1px solid var(--border)', borderRadius: 12, minWidth: 0 } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' } },
                    h('h2', { className: 'section-title', style: { margin: 0 } }, 'Follow-up queue'),
                    h('span', { style: { color: 'var(--text-muted)', fontSize: '0.78rem' } }, `${filteredRows.length} shown`)),
                loading ? h('p', { className: 'text-muted' }, 'Loading payment records…')
                    : filteredRows.length === 0 ? h('div', { style: { padding: '1.6rem 0.5rem', textAlign: 'center', color: 'var(--text-muted)' } }, filter === 'all' && !search ? 'You are all caught up. No pending customer payments.' : 'No invoices match this filter.')
                        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.65rem' } },
                            ...filteredRows.map(row => h('div', { key: row.bill.id || row.bill.invoiceNumber, style: { border: '1px solid var(--border)', borderRadius: 10, padding: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap' } },
                                h('div', { style: { flex: '1 1 190px', minWidth: 0 } },
                                    h('div', { style: { fontWeight: 700, overflowWrap: 'anywhere' } }, row.clientName),
                                    h('div', { style: { color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 2 } }, `Invoice ${row.bill.invoiceNumber || row.bill.id || '—'} · ${row.bill.invoiceDate ? safeDate(row.bill.invoiceDate)?.toLocaleDateString('en-IN') || row.bill.invoiceDate : 'Date not set'}`),
                                    h('div', { style: { fontSize: '0.78rem', marginTop: 4 } }, renderDue(row)),
                                    row.phone && h('div', { style: { color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 2 } }, row.phone)),
                                h('div', { style: { flex: '0 1 150px', minWidth: 120 } },
                                    h('div', { style: { fontWeight: 800, fontSize: '1.02rem' } }, money(row.outstanding, row.currency)),
                                    h('div', { style: { color: 'var(--text-muted)', fontSize: '0.72rem' } }, `Total ${money(row.bill.totalAmount, row.currency)}`),
                                    row.paid > 0.005 && h('div', { style: { color: 'var(--text-muted)', fontSize: '0.72rem' } }, `Paid ${money(row.paid, row.currency)}`)),
                                h('button', { type: 'button', className: 'btn btn-primary', onClick: () => sendReminder(row), style: { fontSize: '0.78rem', padding: '0.45rem 0.7rem', whiteSpace: 'nowrap' } }, h(MessageCircle, { size: 15 }), ' Remind')))),
            h('aside', { className: 'glass-panel p-4', style: { border: '1px solid var(--border)', borderRadius: 12, minWidth: 0 } },
                h('h2', { className: 'section-title', style: { margin: '0 0 0.25rem' } }, 'Customer-wise outstanding'),
                h('p', { style: { color: 'var(--text-muted)', fontSize: '0.76rem', margin: '0 0 0.75rem' } }, 'Grouped by customer and currency'),
                customerSummary.length === 0 ? h('p', { className: 'text-muted' }, 'No customer dues to show.') : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.7rem' } },
                    ...customerSummary.slice(0, 12).map(item => h('div', { key: `${item.clientName}-${item.currency}`, style: { borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' } },
                        h('div', { style: { fontWeight: 650, overflowWrap: 'anywhere' } }, item.clientName),
                        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.78rem', marginTop: 3 } },
                            h('span', { style: { color: 'var(--text-muted)' } }, `${item.invoices} invoice${item.invoices === 1 ? '' : 's'}`),
                            h('strong', null, money(item.outstanding, item.currency))),
                        item.overdue > 0.005 && h('div', { style: { color: 'var(--danger, #dc2626)', fontSize: '0.72rem', marginTop: 2 } }, `Overdue ${money(item.overdue, item.currency)}`)))))),
        h('div', { style: { marginTop: '1rem', padding: '0.75rem 0.9rem', borderRadius: 9, background: 'var(--surface-secondary, var(--bg-secondary))', color: 'var(--text-muted)', fontSize: '0.78rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' } },
            h(AlertTriangle, { size: 16, style: { flexShrink: 0, marginTop: 1 } }),
            h('span', null, 'WhatsApp opens with a pre-filled message. Review it and press Send yourself. This page does not send messages automatically or record delivery.')),
    );
}
