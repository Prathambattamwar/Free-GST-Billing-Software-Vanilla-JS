import { h, useState, useEffect } from '../vanilla/dom.js';
import { Cloud, CheckCircle, Download, Upload, ShieldCheck } from '../vanilla/icons.js';
import { toast } from './Toast.js';
import { useOfflineMode } from '../utils/offlineMode.js';
import { exportAllData } from '../store.js';
import {
  getGoogleDriveClientId,
  prepareGoogleDriveConnect,
  connectGoogleDrive,
  disconnectGoogleDrive,
  saveBackupToGoogleDrive,
  getLatestBackupFromGoogleDrive,
  getGoogleDriveBackupFolderName,
} from '../utils/googleDrive.js';

const FULL_BACKUP_SELECTION = {
  profile: true, profiles: true, bills: true, clients: true, products: true,
  expenses: true, purchases: true, recurring: true, receipts: true,
  termsTemplates: true, meta: true, localStorage: true,
};

export default function GoogleDriveBackup({ onRestoreBackup }) {
  const [offline] = useOfflineMode();
  // OAuth credentials are supplied by the site owner in src/config/googleDrive.js.
  // They are deliberately not editable or displayed in the customer interface.
  const [clientId] = useState(() => getGoogleDriveClientId());
  const [connected, setConnected] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [identityError, setIdentityError] = useState(false);
  const [busy, setBusy] = useState('');
  const [lastBackup, setLastBackup] = useState('');

  useEffect(() => {
    let active = true;
    if (!clientId) return () => { active = false; };

    setIdentityReady(false);
    setIdentityError(false);
    prepareGoogleDriveConnect()
      .then(() => { if (active) setIdentityReady(true); })
      .catch((error) => {
        if (active) {
          setIdentityReady(false);
          setIdentityError(true);
          console.warn('[Google Drive] Sign-in library could not be prepared:', error?.message || error);
        }
      });
    return () => { active = false; };
  }, [clientId]);

  const handlePrepareAgain = async () => {
    setBusy('prepare');
    setIdentityError(false);
    try {
      await prepareGoogleDriveConnect();
      setIdentityReady(true);
      toast('Google is ready. Click Connect Google Drive to continue.', 'success');
    } catch (error) {
      setIdentityError(true);
      toast(error.message || 'Could not reach Google. Check your connection and try again.', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleConnect = async () => {
    if (offline) { toast('Turn off Offline mode to connect Google Drive.', 'info'); return; }
    if (!clientId) {
      toast('Google Drive is not enabled for this website yet. Please contact the app administrator.', 'info', 6000);
      return;
    }
    setBusy('connect');
    try {
      await connectGoogleDrive(clientId);
      setConnected(true);
      toast('Google Drive connected.', 'success');
    } catch (error) {
      setConnected(false);
      toast(error.message || 'Could not connect Google Drive.', 'error', 6000);
    } finally {
      setBusy('');
    }
  };

  const handleBackup = async () => {
    if (offline) { toast('Turn off Offline mode to back up to Google Drive.', 'info'); return; }
    setBusy('backup');
    try {
      const json = await exportAllData(FULL_BACKUP_SELECTION);
      const saved = await saveBackupToGoogleDrive(json, clientId);
      const savedAt = saved?.modifiedTime ? new Date(saved.modifiedTime).toLocaleString() : new Date().toLocaleString();
      setLastBackup(savedAt);
      setConnected(true);
      toast('Full backup saved to Google Drive.', 'success', 5000);
    } catch (error) {
      if (/access expired|sign-in|Google Drive access/i.test(error.message || '')) setConnected(false);
      toast(error.message || 'Google Drive backup failed.', 'error', 7000);
    } finally {
      setBusy('');
    }
  };

  const handleRestore = async () => {
    if (offline) { toast('Turn off Offline mode to restore from Google Drive.', 'info'); return; }
    setBusy('restore');
    try {
      const result = await getLatestBackupFromGoogleDrive(clientId);
      if (typeof onRestoreBackup === 'function') onRestoreBackup(result.text, result.file);
      setConnected(true);
      toast('Latest Drive backup loaded. Review the restore options before applying it.', 'success', 6000);
    } catch (error) {
      if (/access expired|sign-in|Google Drive access/i.test(error.message || '')) setConnected(false);
      toast(error.message || 'Could not load the Google Drive backup.', 'error', 7000);
    } finally {
      setBusy('');
    }
  };

  const handleDisconnect = async () => {
    setBusy('disconnect');
    try {
      await disconnectGoogleDrive();
      setConnected(false);
      setLastBackup('');
      toast('Google Drive disconnected.', 'info');
    } finally {
      setBusy('');
    }
  };

  const actionBusy = !!busy;
  const connectLabel = busy === 'connect'
    ? 'Connecting…'
    : (clientId && !identityReady && !identityError && busy !== 'prepare'
      ? 'Preparing Google…'
      : 'Connect Google Drive');

  return h('section', {
    className: 'google-drive-backup',
    style: {
      border: '1px solid var(--border)', borderRadius: 12,
      padding: '1rem', margin: '1rem 0', background: 'var(--bg-secondary, rgba(148,163,184,.06))',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' } },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '0.75rem', minWidth: 0, flex: '1 1 280px' } },
        h('div', { style: {
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          display: 'grid', placeItems: 'center', background: 'var(--card-bg)', border: '1px solid var(--border)',
        } }, h(Cloud, { size: 21, style: { color: 'var(--primary)' } })),
        h('div', { style: { minWidth: 0 } },
          h('h4', { style: { margin: '0 0 0.25rem', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' } },
            'Google Drive',
            connected && h('span', { style: {
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.68rem',
              color: 'var(--success, #15803d)', fontWeight: 600,
            } }, h(CheckCircle, { size: 13 }), 'Connected')),
          h('p', { style: { margin: 0, color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 } },
            connected
              ? 'Your Google Drive is connected. You can save a backup or restore an existing one.'
              : 'Connect your Google account to keep a backup of your GST records in your own Google Drive.'))),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' } },
        !connected
          ? h('button', {
            type: 'button', className: 'btn btn-primary', onClick: handleConnect,
            disabled: offline || actionBusy || (!!clientId && !identityReady && !identityError),
          }, h(Cloud, { size: 16 }), connectLabel)
          : h('button', { type: 'button', className: 'btn btn-secondary', onClick: handleDisconnect, disabled: actionBusy },
            'Disconnect'))),

    identityError && h('div', { style: { marginTop: '0.75rem' } },
      h('p', { style: { margin: '0 0 0.45rem', color: 'var(--text-muted)', fontSize: '0.78rem' } },
        'Google sign-in could not load. Check your internet connection and try again.'),
      h('button', { type: 'button', className: 'btn btn-secondary', onClick: handlePrepareAgain, disabled: actionBusy },
        busy === 'prepare' ? 'Connecting to Google…' : 'Retry')),

    connected && h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem', paddingTop: '0.85rem', borderTop: '1px solid var(--border)' } },
      h('button', { type: 'button', className: 'btn btn-primary', onClick: handleBackup, disabled: actionBusy || offline },
        h(Upload, { size: 16 }), busy === 'backup' ? 'Saving backup…' : 'Back up to Drive'),
      h('button', { type: 'button', className: 'btn btn-secondary', onClick: handleRestore, disabled: actionBusy || offline },
        h(Download, { size: 16 }), busy === 'restore' ? 'Loading backup…' : 'Restore from Drive'),
      lastBackup && h('span', { style: { alignSelf: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' } }, `Last saved: ${lastBackup}`)),

    offline && h('p', { style: { margin: '0.75rem 0 0', color: 'var(--text-muted)', fontSize: '0.76rem' } },
      'Offline mode is on. Turn it off to connect, back up, or restore using Google Drive.'),

    h('div', { style: { marginTop: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start', color: 'var(--text-muted)', fontSize: '0.74rem', lineHeight: 1.5 } },
      h(ShieldCheck, { size: 14, style: { flexShrink: 0, marginTop: 1 } }),
      h('span', null,
        `Your backup is stored in “${getGoogleDriveBackupFolderName()}” in your Drive. The app only accesses files it creates. Backups are uploaded only when you choose to save them.`)));
}
