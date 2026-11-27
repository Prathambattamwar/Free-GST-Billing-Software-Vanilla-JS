// Optional Google Drive backup support for the static browser edition.
// OAuth access tokens remain in memory only; they are never persisted to storage.

import { GOOGLE_DRIVE_CLIENT_ID } from '../config/googleDrive.js';

const GOOGLE_IDENTITY_URL = 'https://accounts.google.com/gsi/client';
const LEGACY_CLIENT_ID_KEY = 'gst_google_drive_client_id';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_FOLDER_NAME = 'GST Billing Backups';
const BACKUP_FILE_NAME = 'gst-billing-backup-latest.json';

let identityScriptPromise = null;
let currentAccessToken = '';
let tokenExpiresAt = 0;
let currentClientId = '';

export function getGoogleDriveClientId() {
  // Prefer the deployment-level value. Retain the old browser value only as a
  // migration path for users who configured the earlier experimental UI.
  const configured = String(GOOGLE_DRIVE_CLIENT_ID || '').trim();
  if (configured) return configured;
  try { return localStorage.getItem(LEGACY_CLIENT_ID_KEY) || ''; }
  catch { return ''; }
}

function clearAccessToken() {
  currentAccessToken = '';
  tokenExpiresAt = 0;
}

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (identityScriptPromise) return identityScriptPromise;

  identityScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity-services]');
    const script = existing || document.createElement('script');
    const onLoad = () => window.google?.accounts?.oauth2
      ? resolve()
      : reject(new Error('Google sign-in loaded, but its authorization API is unavailable.'));
    const onError = () => reject(new Error('Could not load Google sign-in. Check your internet connection and try again.'));

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_URL;
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentityServices = 'true';
      document.head.appendChild(script);
    } else if (window.google?.accounts?.oauth2) {
      resolve();
    }
  }).catch((error) => {
    identityScriptPromise = null;
    const failedScript = document.querySelector('script[data-google-identity-services]');
    if (failedScript && !window.google?.accounts?.oauth2) failedScript.remove();
    throw error;
  });

  return identityScriptPromise;
}

function requestGoogleAccessToken(clientId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        include_granted_scopes: true,
        callback: (response) => {
          if (response?.error) {
            finish(reject, new Error(response.error_description || response.error));
            return;
          }
          if (!response?.access_token) {
            finish(reject, new Error('Google did not return an access token. Please connect again.'));
            return;
          }
          if (response.scope && !response.scope.split(/\s+/).includes(DRIVE_SCOPE)) {
            finish(reject, new Error('Google Drive permission was not granted. Please connect again and approve Drive file access.'));
            return;
          }
          currentClientId = clientId;
          currentAccessToken = response.access_token;
          tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          finish(resolve, response.access_token);
        },
        error_callback: (error) => {
          finish(reject, new Error(error?.type === 'popup_closed'
            ? 'Google sign-in was closed before it finished.'
            : 'Google sign-in popup could not be opened. Allow popups for this site and try again.'));
        },
      });
      tokenClient.requestAccessToken();
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function getAccessToken(clientId) {
  const id = String(clientId || '').trim();
  if (!id || !id.endsWith('.apps.googleusercontent.com')) {
    throw new Error('Enter a valid Google OAuth Web Client ID first.');
  }

  if (currentClientId === id && currentAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return currentAccessToken;
  }

  await loadGoogleIdentityServices();
  return requestGoogleAccessToken(id);
}

async function driveRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = '';
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error_description || '';
    } catch { /* response may be plain text */ }
    if (response.status === 401) {
      clearAccessToken();
      throw new Error('Google Drive access expired. Click Connect Google Drive and try again.');
    }
    if (response.status === 403) {
      throw new Error(message || 'Google Drive denied access. Check that the Drive API is enabled for this Google Cloud project.');
    }
    throw new Error(message || `Google Drive request failed (${response.status}).`);
  }
  return response;
}

async function driveJson(url, token, options) {
  const response = await driveRequest(url, token, options);
  return response.status === 204 ? null : response.json();
}

async function findBackupFolder(token) {
  const query = `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({ q: query, fields: 'files(id,name)', pageSize: '10', spaces: 'drive' });
  const result = await driveJson(`https://www.googleapis.com/drive/v3/files?${params}`, token);
  return result.files?.[0] || null;
}

async function ensureBackupFolder(token) {
  const existing = await findBackupFolder(token);
  if (existing) return existing.id;
  const created = await driveJson('https://www.googleapis.com/drive/v3/files?fields=id,name', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!created?.id) throw new Error('Google Drive did not create the backup folder.');
  return created.id;
}

async function findLatestBackupFile(folderId, token) {
  const query = `name='${BACKUP_FILE_NAME}' and '${folderId}' in parents and trashed=false`;
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,modifiedTime,webViewLink,size)',
    pageSize: '10',
    spaces: 'drive',
    orderBy: 'modifiedTime desc',
  });
  const result = await driveJson(`https://www.googleapis.com/drive/v3/files?${params}`, token);
  return result.files?.[0] || null;
}

export function prepareGoogleDriveConnect() {
  return loadGoogleIdentityServices();
}

export async function connectGoogleDrive(clientId) {
  await getAccessToken(clientId);
  return true;
}

export async function disconnectGoogleDrive() {
  const token = currentAccessToken;
  clearAccessToken();
  if (!token || !window.google?.accounts?.oauth2?.revoke) return;
  // Clear the local session immediately. Google revocation is best-effort so
  // disconnect remains responsive even when Offline mode is enabled.
  try { window.google.accounts.oauth2.revoke(token, () => {}); }
  catch { /* local disconnect is already complete */ }
}

export async function saveBackupToGoogleDrive(json, clientId) {
  const token = await getAccessToken(clientId);
  const folderId = await ensureBackupFolder(token);
  const existing = await findLatestBackupFile(folderId, token);
  const date = new Date().toISOString().slice(0, 10);

  if (existing?.id) {
    const updated = await driveJson(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,name,modifiedTime,webViewLink`,
      token,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json },
    );
    return { ...updated, name: updated?.name || BACKUP_FILE_NAME, created: false };
  }

  const metadata = {
    name: BACKUP_FILE_NAME,
    mimeType: 'application/json',
    parents: [folderId],
    description: `GST Billing backup updated ${date}`,
  };
  const boundary = `gst_billing_${Date.now()}`;
  const multipartBody = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n`,
    `--${boundary}--`,
  ].join('');
  const created = await driveJson(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,webViewLink',
    token,
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipartBody },
  );
  if (!created?.id) throw new Error('Google Drive did not return the saved backup file.');
  return { ...created, created: true };
}

export async function getLatestBackupFromGoogleDrive(clientId) {
  const token = await getAccessToken(clientId);
  const folder = await findBackupFolder(token);
  if (!folder?.id) throw new Error('No GST Billing Backups folder was found in this Google Drive yet.');
  const file = await findLatestBackupFile(folder.id, token);
  if (!file?.id) throw new Error('No GST Billing backup was found in this Google Drive folder yet.');
  const response = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    token,
  );
  const text = await response.text();
  return { file, text };
}

export function getGoogleDriveBackupFolderName() {
  return BACKUP_FOLDER_NAME;
}
