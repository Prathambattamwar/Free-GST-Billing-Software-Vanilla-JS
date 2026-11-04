// Browser-only replacement for the former Express /api server.
// Business records live in this browser profile's IndexedDB. No OAuth,
// Google account, Node.js process, or remote application database is used.

import { templateTotals, clientYearToDate, businessKeyOf, numberSeriesFor, counterKeyFor, nextCounterValue, startFor, formatDocNumber, getFinancialYearLabel, parseLocalDate, INVOICE_TYPES } from '../utils.js';

const APP_VERSION = '1.10.83';
const DB_NAME = 'free-gst-billing-local';
const DB_VERSION = 1;
const RECORDS_STORE = 'records';
const FILES_STORE = 'files';
const ARRAY_KEYS = [
  'bills', 'clients', 'termsTemplates', 'products', 'productions', 'expenses',
  'purchases', 'purchaseOrders', 'cashBook', 'recurring', 'receipts', 'profiles',
  'trash', 'backups', 'savedPdfs', 'errorLog',
];

const defaultDatabase = () => ({
  schemaVersion: 1,
  profile: {
    businessName: '', address: '', state: '', gstin: '', pan: '', email: '', phone: '',
    bankName: '', accountNumber: '', ifsc: '', logo: '', signature: '', upiId: '',
  },
  profiles: [], bills: [], clients: [], termsTemplates: [], products: [], productions: [],
  expenses: [], purchases: [], purchaseOrders: [], cashBook: [], recurring: [], receipts: [],
  meta: {}, localPrefs: {}, trash: [], backups: [], savedPdfs: [], errorLog: [], lock: null,
});

let db = defaultDatabase();
let ready = false;
let queue = Promise.resolve();
let nativeFetch = null;
let dirty = false;
let idbPromise = null;

function openLocalDb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('This browser does not support IndexedDB. Please use the latest Chrome or Edge.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDS_STORE)) database.createObjectStore(RECORDS_STORE, { keyPath: 'key' });
      if (!database.objectStoreNames.contains(FILES_STORE)) database.createObjectStore(FILES_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local browser storage.'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another open app tab. Close other GST Billing tabs and retry.'));
  });
  return idbPromise;
}

async function idbGet(storeName, key) {
  const database = await openLocalDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => reject(request.error || new Error('Could not read local browser storage.'));
  });
}

async function idbPut(storeName, key, value) {
  const database = await openLocalDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put({ key, value });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('Could not save to local browser storage.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local browser storage write was aborted.'));
  });
}

async function idbDelete(storeName, key) {
  const database = await openLocalDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error('Could not delete from local browser storage.'));
  });
}

async function storeLocalFile(name, data, mimeType = 'application/octet-stream', id = null) {
  const fileId = id || makeId('file');
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  await idbPut(FILES_STORE, fileId, { name, mimeType, blob, updatedAt: new Date().toISOString() });
  return { id: fileId, name, size: blob.size, mimeType };
}
async function readLocalFile(id) { return (await idbGet(FILES_STORE, id))?.blob || null; }
async function deleteLocalFile(id) { return idbDelete(FILES_STORE, id); }
async function updateLocalFile(id, data, mimeType = 'application/octet-stream') {
  const existing = await idbGet(FILES_STORE, id);
  if (!existing) throw new Error('Saved file was not found in this browser.');
  return storeLocalFile(existing.name, data, mimeType, id);
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeId = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
const sortDateDesc = (key) => (a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || ''));
const sortName = (key) => (a, b) => String(a?.[key] || '').localeCompare(String(b?.[key] || ''));

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function errorResponse(message, status = 400, extra = {}) {
  return response({ error: message, ...extra }, status);
}
function assertReady() {
  if (!ready) throw new Error('The local billing database is still starting. Please wait a moment and retry.');
}

async function persistNow() {
  assertReady();
  db.lastSavedAt = new Date().toISOString();
  await idbPut(RECORDS_STORE, 'main', db);
  dirty = false;
}

function persist() {
  dirty = true;
  const task = queue.then(() => persistNow());
  queue = task.catch(() => {});
  return task;
}

async function waitForWrites() {
  await queue;
  if (dirty) await persist();
}

export async function initialiseLocalDatabase() {
  await openLocalDb();
  const saved = await idbGet(RECORDS_STORE, 'main');
  db = { ...defaultDatabase(), ...(saved && typeof saved === 'object' ? saved : {}) };
  for (const key of ARRAY_KEYS) if (!Array.isArray(db[key])) db[key] = [];
  if (!db.meta || typeof db.meta !== 'object') db.meta = {};
  if (!db.localPrefs || typeof db.localPrefs !== 'object') db.localPrefs = {};
  ready = true;
  window.__fgsbStorageReady = true;
  if (!saved) await persistNow();
  const today = new Date().toISOString().slice(0, 10);
  if (!db.backups.some((item) => item.date === today)) {
    try { await createBackup(today); } catch (error) { console.warn('[Local backup]', error); }
  }
  // Generate recurring invoices that became due while the app was closed.
  let recurringCount = 0;
  for (const template of [...db.recurring]) {
    if (!template || template.active === false || !template.nextDate || template.nextDate > today) continue;
    const ended = (template.endMode === 'onDate' && template.endDate && today > template.endDate)
      || (template.endMode === 'afterN' && template.maxOccurrences && (template.occurrencesCreated || 0) >= template.maxOccurrences);
    if (ended) continue;
    try {
      const result = await handleApi(new URL(`/api/recurring/${encodeURIComponent(template.id)}/generate`, window.location.href), { method: 'POST', body: '{}' });
      if (result.ok) recurringCount++;
    } catch (error) { console.warn('[Recurring invoice]', template.id, error); }
  }
  if (recurringCount) {
    db.meta.lastRecurringAutoFire = { date: today, count: recurringCount, at: new Date().toISOString() };
    await persist();
  }
  return { storage: 'indexeddb', profile: clone(db.profile), lastSavedAt: db.lastSavedAt || null };
}


function list(collection, sorter) {
  const rows = [...(db[collection] || [])];
  if (sorter) rows.sort(sorter);
  return rows;
}
function upsert(collection, entity, prefix) {
  const item = entity && typeof entity === 'object' ? entity : {};
  if (!item.id) item.id = makeId(prefix || collection.slice(0, 3));
  const rows = db[collection] || (db[collection] = []);
  const index = rows.findIndex((row) => String(row?.id) === String(item.id));
  if (index >= 0) rows[index] = clone(item); else rows.push(clone(item));
  return item.id;
}
function remove(collection, id) {
  const rows = db[collection] || [];
  db[collection] = rows.filter((row) => String(row?.id) !== String(id));
}
function creditDependents(id) {
  const hits = [];
  for (const bill of db.bills) {
    if (bill?.id === id) continue;
    const payments = bill?.payments || bill?.data?.payments || [];
    for (const payment of payments) {
      if (payment?.mode === 'credit-applied' && (payment.creditSourceBillIds || []).includes(id)) {
        hits.push({ id: bill.id, invoiceNumber: bill.invoiceNumber, amount: payment.amount });
        break;
      }
    }
  }
  return hits;
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stripSensitiveLock(meta) {
  const copy = { ...meta };
  delete copy.appLock;
  return copy;
}

function backupContent() {
  const content = clone(db);
  content.backups = [];
  content.savedPdfs = [];
  content.errorLog = [];
  return JSON.stringify({
    __freegstbill_backup: true,
    exportedAt: new Date().toISOString(),
    version: APP_VERSION,
    bills: content.bills,
    profile: content.profile,
    profiles: content.profiles,
    clients: content.clients,
    termsTemplates: content.termsTemplates,
    products: content.products,
    productions: content.productions,
    expenses: content.expenses,
    cashBook: content.cashBook,
    purchases: content.purchases,
    purchaseOrders: content.purchaseOrders,
    recurring: content.recurring,
    receipts: content.receipts,
    meta: stripSensitiveLock(content.meta || {}),
    localPrefs: content.localPrefs,
  });
}

async function createBackup(date = new Date().toISOString().slice(0, 10)) {
  if (db.backups.some((item) => item.date === date)) return { success: true, date, existing: true };
  const name = `free-gst-billing-backup-${date}.json`;
  const content = backupContent();
  const file = await storeLocalFile(name, new Blob([content], { type: 'application/json' }), 'application/json');
  db.backups.push({ date, fileId: file.id, name: file.name, size: file.size, createdAt: new Date().toISOString() });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const expired = db.backups.filter((item) => item.date && new Date(`${item.date}T23:59:59`).getTime() < cutoff);
  db.backups = db.backups.filter((item) => !expired.includes(item));
  for (const old of expired) { if (old.fileId) { try { await deleteLocalFile(old.fileId); } catch { /* keep the current database intact */ } } }
  await persist();
  return { success: true, date, fileId: file.id };
}

function parseBody(init) {
  if (init?.body == null) return Promise.resolve({});
  if (typeof init.body === 'string') {
    try { return Promise.resolve(JSON.parse(init.body)); } catch { return Promise.resolve({}); }
  }
  return Promise.resolve(init.body);
}

async function handleApi(url, init = {}) {
  assertReady();
  const method = String(init.method || 'GET').toUpperCase();
  const path = url.pathname.replace(/^\/api\/?/, '');
  const query = url.searchParams;
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const body = await parseBody(init);
  const id = parts[1];
  const collectionMap = {
    bills: 'bills', clients: 'clients', templates: 'termsTemplates', products: 'products',
    productions: 'productions', expenses: 'expenses', recurring: 'recurring', receipts: 'receipts',
    purchases: 'purchases', 'purchase-orders': 'purchaseOrders', 'cash-book': 'cashBook', profiles: 'profiles',
  };

  // Main application collections
  if (collectionMap[parts[0]]) {
    const collection = collectionMap[parts[0]];
    if (method === 'GET' && parts.length === 1) {
      const sorters = {
        bills: (a, b) => String(b.invoiceDate || '').localeCompare(String(a.invoiceDate || '')),
        clients: sortName('name'), templates: sortName('name'), products: sortName('name'),
        productions: (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
        expenses: sortDateDesc('date'), recurring: sortName('clientName'), receipts: sortDateDesc('date'),
        purchases: sortDateDesc('date'), 'purchase-orders': (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.poNumber || '').localeCompare(String(a.poNumber || '')),
        'cash-book': (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
        profiles: sortName('businessName'),
      };
      if (parts[0] === 'templates' && db[collection].length === 0) {
        db[collection].push({ id: 'default', name: 'Standard Terms', content: '1. Payment is due within 15 days of invoice date unless otherwise agreed in writing.\n2. Interest @ 18% p.a. will be charged on overdue payments beyond the due date.\n3. The scope of work is limited to what is explicitly mentioned in the project proposal/agreement. Any additional requirements will be quoted and billed separately.\n4. This invoice is subject to the jurisdiction of courts at the seller\'s registered location.\n5. E. & O.E.' });
        await persist();
      }
      return response(list(collection, sorters[parts[0]]));
    }
    if (method === 'POST' && parts.length === 1) {
      const item = body && typeof body === 'object' ? body : {};
      if (collection === 'bills' && !item.id) return errorResponse('Bill must have an id', 400);
      if (collection === 'bills' && db.bills.some((row) => row.id === item.id) && query.get('overwrite') !== '1' && query.get('overwrite') !== 'true') {
        return errorResponse('A bill with this invoice number already exists', 409, { invoiceNumber: item.id });
      }
      if (collection === 'productions' && db.productions.some((row) => row.id === item.id)) return errorResponse('conflict', 409);
      if (collection === 'products' && item.kind === 'service') delete item.stock;
      if (collection === 'productions') {
        if (!item.id || typeof item.stockApplied !== 'object') return errorResponse('bad-request', 400);
        for (const [productId, change] of Object.entries(item.stockApplied || {})) {
          const product = db.products.find((row) => row.id === productId);
          if (!product || typeof change !== 'number' || !Number.isFinite(change)) return errorResponse('Product not found or invalid stock change', 400);
          if (product.kind !== 'service') product.stock = Math.round(((Number(product.stock) || 0) + change) * 1000) / 1000;
        }
      }
      if (collection === 'cashBook') {
        if (!item || typeof item !== 'object' || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0 || !item.date || !['in', 'out'].includes(item.direction)) return errorResponse('Invalid cash-book entry', 400);
      }
      if (collection === 'purchases' && Array.isArray(item.payments)) {
        const total = item.payments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0);
        if (total > (Number(item.grandTotal || item.total || item.amount) || 0) + 1) return errorResponse('Supplier payments exceed the purchase bill total', 400);
      }
      const newId = upsert(collection, item, collection.slice(0, 3));
      await persist();
      if (collection === 'cashBook') return response({ success: true, id: newId, entry: { ...item, id: newId } });
      return response({ success: true, id: newId });
    }
    if (method === 'DELETE' && id) {
      if (collection === 'bills') {
        const bill = db.bills.find((row) => row.id === id);
        if (bill && query.get('permanent') !== '1') {
          const force = query.get('force') === '1' || query.get('force') === 'true';
          const dependents = force ? [] : creditDependents(id);
          if (dependents.length) return errorResponse('client-credit-dependency', 409, { message: 'This bill is used as a client-credit source.', dependents });
          db.trash.push({ ...bill, _trashedAt: new Date().toISOString() });
        }
      }
      if (collection === 'productions') {
        const production = db.productions.find((row) => row.id === id);
        for (const [productId, change] of Object.entries(production?.stockApplied || {})) {
          const product = db.products.find((row) => row.id === productId);
          if (product && product.kind !== 'service') product.stock = Math.round(((Number(product.stock) || 0) - (Number(change) || 0)) * 1000) / 1000;
        }
      }
      remove(collection, id);
      await persist();
      return response({ success: true, trashed: collection === 'bills' && query.get('permanent') !== '1', permanent: collection === 'bills' && query.get('permanent') === '1' });
    }
  }

  if (path === 'profile') {
    if (method === 'GET') return response(db.profile || defaultDatabase().profile);
    if (method === 'POST') { db.profile = body || {}; await persist(); return response({ success: true }); }
  }

  if (parts[0] === 'meta' && parts[1]) {
    const key = parts[1];
    if (parts[2] === 'increment' && method === 'POST') {
      const start = Number(body?.start) || 1;
      const value = Math.max(Number(db.meta[key]) || 0, start - 1) + 1;
      db.meta[key] = value; await persist(); return response({ value });
    }
    if (method === 'GET') return response({ value: db.meta[key] ?? null });
    if (method === 'POST') { db.meta[key] = body?.value ?? null; await persist(); return response({ success: true }); }
  }

  if (path === 'number-series/rename' && method === 'POST') {
    const { from, to } = body || {};
    if (!from || !to || from === to) return errorResponse('bad-request', 400);
    const series = db.meta.invoiceNumberSeries || {};
    if (!series[from] || series[to]) return response({ moved: false });
    series[to] = series[from]; delete series[from]; db.meta.invoiceNumberSeries = series;
    for (const key of Object.keys(db.meta)) if (key.includes(`@${from}`)) { const next = key.replace(`@${from}`, `@${to}`); if (db.meta[next] == null) db.meta[next] = db.meta[key]; delete db.meta[key]; }
    await persist(); return response({ moved: true });
  }

  if (path === 'local-prefs') {
    if (method === 'GET') return response({ value: db.localPrefs || {} });
    if (method === 'POST') {
      for (const [key, value] of Object.entries(body?.set || {})) db.localPrefs[key] = value;
      for (const key of body?.remove || []) delete db.localPrefs[key];
      await persist(); return response({ success: true });
    }
  }

  if (path === 'lock') {
    if (method === 'GET') return response({ enabled: !!db.lock, length: db.lock?.length || 0 });
  }
  if (path === 'lock/verify' && method === 'POST') {
    if (!db.lock) return response({ ok: true });
    const actual = await sha256(`${db.lock.salt}:${String(body?.pin ?? '')}`);
    return actual === db.lock.hash ? response({ ok: true }) : errorResponse('wrong-pin', 401, { ok: false });
  }
  if (path === 'lock/set' && method === 'POST') {
    const pin = body?.pin;
    if (pin !== null && !/^\d{4,12}$/.test(String(pin ?? ''))) return errorResponse('bad-request', 400);
    if (db.lock) {
      const actual = await sha256(`${db.lock.salt}:${String(body?.currentPin ?? '')}`);
      if (actual !== db.lock.hash) return errorResponse('wrong-pin', 401, { ok: false });
    }
    if (pin === null) db.lock = null;
    else {
      const salt = crypto.randomUUID();
      db.lock = { salt, hash: await sha256(`${salt}:${pin}`), length: String(pin).length };
    }
    await persist(); return response({ ok: true, enabled: pin !== null });
  }

  if (path === 'export' && method === 'GET') {
    await waitForWrites();
    return response({
      bills: db.bills, profile: db.profile, profiles: db.profiles, clients: db.clients,
      termsTemplates: db.termsTemplates, products: db.products, productions: db.productions,
      expenses: db.expenses, cashBook: db.cashBook, recurring: db.recurring, receipts: db.receipts,
      purchases: db.purchases, purchaseOrders: db.purchaseOrders, meta: stripSensitiveLock(db.meta),
    });
  }

  if (path === 'import' && method === 'POST') {
    const overwrite = query.get('overwrite') === '1' || query.get('overwrite') === 'true';
    const specs = [
      ['bills', 'bill'], ['clients', 'client'], ['termsTemplates', 'template'], ['products', 'product'],
      ['expenses', 'expense'], ['recurring', 'recurring'], ['receipts', 'receipt'], ['profiles', 'profile'],
      ['purchases', 'purchase'], ['productions', 'production'], ['purchaseOrders', 'purchaseOrder'], ['cashBook', 'cashBook'],
    ];
    const counts = {};
    for (const [key, singular] of specs) {
      counts[`${singular}Count`] = 0; counts[`${singular}Skipped`] = 0;
      for (const item of (Array.isArray(body?.[key]) ? body[key] : [])) {
        if (!item?.id) continue;
        if (!overwrite && db[key].some((row) => row.id === item.id)) { counts[`${singular}Skipped`]++; continue; }
        upsert(key, item, singular); counts[`${singular}Count`]++;
      }
    }
    let profileCount = 0, profileSkipped = 0;
    if (body?.profile) { if (overwrite || !db.profile?.businessName) { db.profile = body.profile; profileCount = 1; } else profileSkipped = 1; }
    if (body?.meta) {
      if (overwrite || Object.keys(db.meta).length === 0) db.meta = { ...body.meta, ...(db.lock ? { appLock: db.lock } : {}) };
      else {
        db.meta.invoiceNumberSeries = { ...(body.meta.invoiceNumberSeries || {}), ...(db.meta.invoiceNumberSeries || {}) };
        for (const [key, value] of Object.entries(body.meta)) if (key.startsWith('counter_') && Number(value) > (Number(db.meta[key]) || 0)) db.meta[key] = Number(value);
        if (Array.isArray(body.meta.costCentres)) {
          const known = new Set((db.meta.costCentres || []).map((row) => row.id));
          db.meta.costCentres = [...(db.meta.costCentres || []), ...body.meta.costCentres.filter((row) => row?.id && !known.has(row.id))];
        }
      }
    }
    await persist();
    return response({ ...counts, profileCount, profileSkipped, hasProfile: !!body?.profile });
  }

  if (parts[0] === 'backups') {
    if (method === 'GET' && parts.length === 1) return response([...db.backups].sort((a, b) => String(b.date).localeCompare(String(a.date))));
    if (parts[1] === 'now' && method === 'POST') return response(await createBackup());
    if (parts[1] && parts[2] === 'restore' && method === 'POST') {
      const snapshot = db.backups.find((item) => item.date === parts[1]);
      if (!snapshot?.fileId) return errorResponse('Backup not found', 404);
      const previous = clone(db);
      try {
        const restoreStamp = new Date().toISOString().replace(/[:.]/g, '-');
        const preRestoreFile = await storeLocalFile(`free-gst-billing-backup-pre-restore-${restoreStamp}.json`, new Blob([backupContent()], { type: 'application/json' }), 'application/json');
        const snapshotBlob = await readLocalFile(snapshot.fileId);
        if (!snapshotBlob) throw new Error('Backup file is missing from this browser.');
        const parsed = JSON.parse(await snapshotBlob.text());
        const keepLock = db.lock;
        const keepBackups = [...db.backups, { date: `pre-restore-${restoreStamp}`, fileId: preRestoreFile.id, name: preRestoreFile.name, createdAt: new Date().toISOString(), protected: true }];
        db = { ...defaultDatabase(), ...parsed, lock: keepLock, backups: keepBackups, savedPdfs: db.savedPdfs, errorLog: db.errorLog };
        await persist();
        return response({ success: true, restored: parts[1], snapshot: `pre-restore-${restoreStamp}` });
      } catch (error) { db = previous; throw error; }
    }
    if (parts[1] && method === 'DELETE') {
      const index = db.backups.findIndex((item) => item.date === parts[1] && !item.protected);
      if (index >= 0) { const [item] = db.backups.splice(index, 1); if (item.fileId) await deleteLocalFile(item.fileId); await persist(); }
      return response({ success: true, date: parts[1] });
    }
  }
  if (path === 'backup-folder' && method === 'GET') return response({ path: 'This browser / IndexedDB', copiesIn: 'This browser profile', error: '' });
  if (path === 'backup-folder' && method === 'POST') return response({ ok: true, path: 'This browser / IndexedDB', copiesIn: 'This browser profile', error: '' });

  if (path === 'trash' && method === 'GET') return response([...db.trash].sort((a, b) => String(b._trashedAt || '').localeCompare(String(a._trashedAt || ''))));
  if (parts[0] === 'trash' && parts[1] && parts[2] === 'restore' && method === 'POST') {
    const bill = db.trash.find((row) => row.id === parts[1]);
    if (!bill) return errorResponse('Not in trash', 404);
    if (db.bills.some((row) => row.id === bill.id)) return errorResponse('An invoice with this number exists again. Rename or delete it first.', 409);
    const { _trashedAt, ...restored } = bill; db.bills.push(restored); remove('trash', bill.id); await persist(); return response({ success: true });
  }
  if (parts[0] === 'trash' && parts[1] && method === 'DELETE') { remove('trash', parts[1]); await persist(); return response({ success: true }); }

  if (path === 'health' && method === 'GET') return response({ ok: true, storage: 'indexeddb', ready, version: APP_VERSION });
  if (path === 'version' && method === 'GET') return response({ current: APP_VERSION });
  if (path === 'check-update' && method === 'GET') {
    const fallback = { current: APP_VERSION, latest: APP_VERSION, updateAvailable: false, checkedAt: new Date().toISOString() };
    try {
      const releaseResponse = await nativeFetch('https://api.github.com/repos/IamRamgarhia/Free-GST-Billing-Software/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store',
      });
      if (!releaseResponse.ok) return response({ ...fallback, error: `GitHub release check failed (${releaseResponse.status}).` });
      const release = await releaseResponse.json();
      const latest = String(release.tag_name || release.name || APP_VERSION).replace(/^v/i, '').trim();
      const versionParts = (value) => String(value).split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
      const currentParts = versionParts(APP_VERSION);
      const latestParts = versionParts(latest);
      let comparison = 0;
      for (let index = 0; index < 3; index++) {
        const latestPart = latestParts[index] || 0;
        const currentPart = currentParts[index] || 0;
        if (latestPart !== currentPart) { comparison = latestPart > currentPart ? 1 : -1; break; }
      }
      const newer = comparison > 0;
      return response({
        ...fallback, latest, updateAvailable: newer, releaseUrl: release.html_url || 'https://github.com/IamRamgarhia/Free-GST-Billing-Software/releases/latest',
        releasePublishedAt: release.published_at || null, releaseNotes: String(release.body || '').slice(0, 12000),
      });
    } catch (error) {
      return response({ ...fallback, error: error?.message || 'Could not check GitHub releases.' });
    }
  }
  if (path === 'changelog' && method === 'GET') {
    try {
      const changelogResponse = await nativeFetch(new URL('./CHANGELOG.md', window.location.href), { cache: 'no-store' });
      return response({ text: changelogResponse.ok ? await changelogResponse.text() : '', entries: [] });
    } catch { return response({ text: '', entries: [] }); }
  }
  if (path === 'client-errors' && method === 'POST') {
    const entry = { ...body, at: new Date().toISOString() };
    db.errorLog.push(entry); db.errorLog = db.errorLog.slice(-100); await persist(); return response({ ok: true });
  }
  if (path === 'errors-log' && method === 'GET') return response({ lines: db.errorLog.map((entry) => `[${entry.at}] ${String(entry.message || 'Client error').slice(0, 500)}`).slice(-100) });

  if (path === 'save-pdf' && method === 'POST') {
    const blob = init.body instanceof Blob ? init.body : new Blob([init.body || ''], { type: 'application/pdf' });
    const client = safeSegment(query.get('client') || 'General');
    const month = safeSegment(query.get('month') || new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }));
    const name = safeSegment(query.get('name') || `invoice-${Date.now()}.pdf`).replace(/\/?$/, '.pdf').replace(/\.pdf\.pdf$/i, '.pdf');
    const file = await storeLocalFile(name, blob, 'application/pdf');
    db.savedPdfs.push({ id: file.id, fileName: name, clientName: client, month, cancelled: false, trashed: false, createdAt: new Date().toISOString() });
    await persist();
    return response({ saved: true, relPath: `Local browser storage/${client}/${month}/${name}`, fileId: file.id });
  }
  if (path === 'saved-pdf/cancel-mark' && method === 'POST') {
    const record = db.savedPdfs.find((item) => item.fileName === body?.fileName && (!body?.clientName || item.clientName === body.clientName) && !item.trashed);
    if (!record) return response({ updated: 0, failed: 0 });
    if (typeof body.cancelled === 'boolean' && record.cancelled !== body.cancelled) {
      const currentBlob = await readLocalFile(record.id);
      if (!currentBlob) return errorResponse('Saved PDF was not found in this browser.', 404);
      if (body.cancelled) {
        if (!record.originalFileId) {
          const original = await storeLocalFile(`${record.fileName}.original.pdf`, currentBlob, 'application/pdf');
          record.originalFileId = original.id;
        }
        const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib');
        const source = await currentBlob.arrayBuffer();
        const pdf = await PDFDocument.load(source, { ignoreEncryption: true });
        const font = await pdf.embedFont(StandardFonts.HelveticaBold);
        for (const page of pdf.getPages()) {
          const { width, height } = page.getSize();
          const size = Math.min(width, height) / 6.5;
          const text = 'CANCELLED';
          const angle = Math.PI / 6;
          const textWidth = font.widthOfTextAtSize(text, size);
          page.drawText(text, {
            x: width / 2 - (textWidth / 2) * Math.cos(angle) + (size / 3) * Math.sin(angle),
            y: height / 2 - (textWidth / 2) * Math.sin(angle) - (size / 3) * Math.cos(angle),
            size, font, color: rgb(0.86, 0.15, 0.15), opacity: 0.28, rotate: degrees(30),
          });
        }
        await updateLocalFile(record.id, new Blob([await pdf.save()], { type: 'application/pdf' }), 'application/pdf');
      } else if (record.originalFileId) {
        const original = await readLocalFile(record.originalFileId);
        if (!original) throw new Error('Original PDF was not found in this browser.');
        await updateLocalFile(record.id, original, 'application/pdf');
        await deleteLocalFile(record.originalFileId);
        record.originalFileId = null;
      }
      record.cancelled = body.cancelled;
      await persist();
    }
    return response({ updated: 1, failed: 0 });
  }
  if (path === 'trash-pdf' && method === 'POST') {
    const record = db.savedPdfs.find((item) => item.fileName === body?.fileName && (!body?.clientName || item.clientName === body.clientName));
    if (record) { record.trashed = true; record.trashedAt = new Date().toISOString(); await persist(); }
    return response({ success: true, moved: !!record });
  }

  if (parts[0] === 'recurring' && parts[1] && parts[2] === 'generate' && method === 'POST') {
    const template = db.recurring.find((item) => item.id === parts[1]);
    if (!template) return errorResponse('Recurring template not found', 404);
    const today = localToday();
    const ended = (template.endMode === 'onDate' && template.endDate && today > template.endDate)
      || (template.endMode === 'afterN' && template.maxOccurrences && (template.occurrencesCreated || 0) >= template.maxOccurrences);
    if (ended) return errorResponse('This template has reached its end date or number of invoices', 409);
    const profile = db.profiles.find((item) => (item.gstin && template.ownerGstin && item.gstin === template.ownerGstin)
      || (item.id && template.profileId && item.id === template.profileId)
      || (item.businessName && item.businessName === (template.profileBusinessName || template.ownerName))) || db.profile || {};
    const prefixByType = { proforma: 'EST', quotation: 'QUO', 'credit-note': 'CN', 'bill-of-supply': 'BOS', composition: 'COMP', 'delivery-challan': 'DC' };
    const bizKey = businessKeyOf(profile);
    const series = numberSeriesFor(db.meta.invoiceNumberSettings, db.meta.invoiceNumberSeries, bizKey);
    const typePrefix = series.own ? (INVOICE_TYPES[template.invoiceType]?.prefix || 'INV') : (prefixByType[template.invoiceType] || 'INV');
    const counterKey = counterKeyFor(typePrefix, series, bizKey);
    const next = nextCounterValue(db.meta[counterKey], startFor(template.invoiceType || 'tax-invoice', series));
    db.meta[counterKey] = next;
    const invoiceNumber = formatDocNumber({ settings: series, typePrefix, next, fyLabel: getFinancialYearLabel(parseLocalDate(today)) });
    if (db.bills.some((bill) => bill.id === invoiceNumber)) return errorResponse('Invoice number already exists. Check the invoice number settings.', 409);
    const ytd = clientYearToDate(db.bills, template.clientName, today);
    const totals = templateTotals(template, profile, { tcsCumulativeThisYear: ytd, tdsCumulativeThisYear: ytd });
    const dueDays = Number(template.dueDays);
    const dueDate = Number.isFinite(dueDays) && dueDays >= 0 && template.dueDays !== '' && template.dueDays != null ? addLocalDays(today, dueDays) : '';
    const bill = {
      id: invoiceNumber, clientName: template.clientName, invoiceNumber, invoiceDate: today,
      invoiceType: template.invoiceType || 'tax-invoice', currency: template.invoiceOptions?.currency || 'INR',
      totalAmount: totals.total, totalTaxAmount: totals.totalTaxAmount, status: 'unpaid', paidAmount: 0, payments: [],
      generatedFrom: template.id, autoGenerated: true, autoGeneratedAt: new Date().toISOString(),
      data: {
        profile,
        client: { name: template.clientName, state: template.clientState, gstin: template.clientGstin, address: template.clientAddress, country: template.clientCountry, city: template.clientCity, pin: template.clientPin, email: template.clientEmail, phone: template.clientPhone, isSEZ: template.isSEZ },
        details: { invoiceNumber, invoiceDate: today, dueDate, placeOfSupply: template.placeOfSupply || '' },
        items: (template.items || []).map((item) => ({ ...item, name: item.name || item.description || '' })),
        totals, invoiceType: template.invoiceType || 'tax-invoice', customTerms: template.customTerms || '', customNotes: template.customNotes || '',
        extraSections: template.extraSections || [], invoiceOptions: template.invoiceOptions || {}, taxInclusive: !!template.taxInclusive,
      },
    };
    db.bills.push(bill);
    template.anchorDay ||= template.frequency !== 'weekly' ? Number((template.nextDate || today).slice(8, 10)) : undefined;
    template.nextDate = advanceDate(template.nextDate || today, template.frequency, template.interval, template.anchorDay);
    template.lastGenerated = today;
    template.occurrencesCreated = (template.occurrencesCreated || 0) + 1;
    await persist();
    return response({ success: true, invoiceNumber });
  }

  // These actions depend on controlling the user's local operating system or
  // reading arbitrary local folders. Browsers intentionally do not allow that.
  if (parts[0] === 'control-panel') return errorResponse("This control-panel action is not available in the browser-only edition. Your records are stored in this browser's local database.", 501, { ok: false });
  return errorResponse(`Unsupported browser API route: /api/${path}`, 404);
}

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function addLocalDays(iso, days) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function advanceDate(iso, frequency, interval, anchorDay) {
  const date = new Date(`${iso}T12:00:00`);
  const step = Math.max(1, parseInt(interval, 10) || 1);
  if (frequency === 'weekly') date.setDate(date.getDate() + 7 * step);
  else {
    const months = frequency === 'quarterly' ? 3 * step : frequency === 'yearly' ? 12 * step : step;
    const day = Math.min(31, Math.max(1, parseInt(anchorDay, 10) || date.getDate()));
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1, 12);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
    target.setDate(Math.min(day, lastDay));
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function safeSegment(value) {
  return String(value || 'General').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\.\./g, '_').trim().slice(0, 100) || 'General';
}

export function installLocalApi() {
  if (nativeFetch || typeof window === 'undefined') return;
  nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    if (!rawUrl) return nativeFetch(input, init);
    let url;
    try { url = new URL(rawUrl, window.location.href); } catch { return nativeFetch(input, init); }
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    try {
      const merged = { ...(input instanceof Request ? { method: input.method, headers: input.headers } : {}), ...init };
      if (input instanceof Request && merged.body == null && !['GET', 'HEAD'].includes(merged.method || 'GET')) merged.body = await input.clone().text();
      return await handleApi(url, merged);
    } catch (error) {
      console.error('[Local database]', error);
      return errorResponse(error?.message || 'Local database request failed', 503);
    }
  };
}

export function restoreNativeFetch() {
  if (nativeFetch && typeof window !== 'undefined') window.fetch = nativeFetch;
  nativeFetch = null;
}

