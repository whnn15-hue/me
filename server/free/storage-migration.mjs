import { readDriveFile, fault } from './files.mjs';
import { validGoogleDriveId, validOneDriveItemId } from '../../shared/storage-id.mjs';

// One-time Google Drive → OneDrive copy of every archived original.
//
// Only document records (documents[].driveFileId) point at stored originals;
// photos and submissions point at documents by documentId and follow along.
// The server copies files and keeps an encrypted, idempotent ledger. The
// browser then swaps the IDs in Firestore through its revision-checked
// transaction (the only write path the security rules allow), so concurrent
// edits are never overwritten. Google files are never deleted.
export const LEDGER_VERSION = 1;
const ledgerKey = uid => `migration/onedrive/${uid}`;
const safeMessage = error => (error?.status && typeof error.message === 'string' ? error.message : '원본을 옮기지 못했습니다. 잠시 후 다시 시도해 주세요.').slice(0, 300);
const emptyLedger = () => ({ version: LEDGER_VERSION, files: {}, failures: {} });

export function migrationCounts(documents, ledger) {
  const counts = { total: documents.length, onOneDrive: 0, copied: 0, pending: 0, failed: 0 };
  for (const document of documents) {
    const id = document.driveFileId;
    if (!validGoogleDriveId(id)) { if (validOneDriveItemId(id)) counts.onOneDrive++; continue; }
    const entry = ledger.files[id];
    if (entry?.state === 'copied' && entry.sha256 === document.sha256) counts.copied++;
    else if (ledger.failures[id]) counts.failed++;
    else counts.pending++;
  }
  return counts;
}
// Mapping the browser applies: only fully verified copies of the same bytes.
export function migrationMapping(documents, ledger) {
  const mapping = {};
  for (const document of documents) {
    const entry = ledger.files[document.driveFileId];
    if (validGoogleDriveId(document.driveFileId) && entry?.state === 'copied' && entry.sha256 === document.sha256 && validOneDriveItemId(entry.oneDriveId))
      mapping[document.driveFileId] = { id: entry.oneDriveId, sha256: entry.sha256, size: entry.size };
  }
  return mapping;
}

export function createOneDriveMigration({ config, vault, drive, oneDrive, fetcher, repoFor, now = Date.now }) {
  const switched = config.storageProvider === 'onedrive';
  const available = !switched && Boolean(drive?.configured && oneDrive?.configured);
  const loadLedger = async uid => {
    const ledger = await vault.getJSON(ledgerKey(uid));
    return ledger?.version === LEDGER_VERSION && ledger.files && ledger.failures ? ledger : emptyLedger();
  };
  const saveLedger = (uid, ledger) => vault.setJSON(ledgerKey(uid), ledger);
  const requireAvailable = () => {
    if (switched) return { switched: true };
    if (!available) throw fault('OneDrive 이전에는 구글 드라이브와 마이크로소프트 앱 설정(MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET)이 모두 필요합니다.', 503);
    return null;
  };

  async function status(user) {
    if (switched) return { switched: true, available: false };
    if (!available) return { switched: false, available: false };
    const [oneDriveStatus, ledger, snapshot] = await Promise.all([oneDrive.status(user), loadLedger(user.uid), repoFor(user).snapshot()]);
    return { switched: false, available: true, connected: Boolean(oneDriveStatus.driveConnected),
      ...(oneDriveStatus.storageAccount ? { storageAccount: oneDriveStatus.storageAccount } : {}),
      counts: migrationCounts(snapshot.documents, ledger), mapping: migrationMapping(snapshot.documents, ledger),
      failures: Object.entries(ledger.failures).map(([, value]) => value) };
  }

  async function copyOne(uid, document, ledger) {
    const googleId = document.driveFileId; const expected = { kind: 'document', size: document.size, sha256: document.sha256 };
    let entry = ledger.files[googleId];
    if (entry && entry.sha256 !== document.sha256) entry = undefined; // replaced original: start over
    // Resume: a verified-but-unrecorded or an interrupted upload is reused.
    if (entry?.state === 'uploading') {
      const found = await oneDrive.findArchivedFile(uid, document.sha256, 'document');
      if (found) entry = { ...entry, state: 'uploaded', oneDriveId: found.driveFileId };
    }
    if (entry?.state === 'uploaded' && validOneDriveItemId(entry.oneDriveId)) {
      try {
        await readDriveFile(oneDrive, fetcher, uid, entry.oneDriveId, expected);
        ledger.files[googleId] = { ...entry, state: 'copied', verifiedAt: new Date(now()).toISOString() };
        return;
      } catch (error) { if (error.status !== 404) throw error; entry = undefined; }
    }
    ledger.files[googleId] = { state: 'uploading', sha256: document.sha256, size: document.size, startedAt: new Date(now()).toISOString() };
    await saveLedger(uid, ledger);
    const original = await readDriveFile(drive, fetcher, uid, googleId, expected);
    const uploaded = await oneDrive.upload(uid, original.buffer, original.name || document.name || 'document', original.mime || document.mime, 'document');
    ledger.files[googleId] = { ...ledger.files[googleId], state: 'uploaded', oneDriveId: uploaded.driveFileId };
    await saveLedger(uid, ledger);
    await readDriveFile(oneDrive, fetcher, uid, uploaded.driveFileId, expected);
    ledger.files[googleId] = { ...ledger.files[googleId], state: 'copied', verifiedAt: new Date(now()).toISOString() };
  }

  // Copies as many originals as fit in the time budget, then reports the
  // mapping for the browser to apply. Safe to call repeatedly from any tab.
  async function step(user, body = {}, { budgetMs = 40000, reserveMs = 15000 } = {}) {
    const blocked = requireAvailable(); if (blocked) return blocked;
    if (!(await oneDrive.status(user)).driveConnected) throw fault('먼저 OneDrive를 연결해 주세요.', 409);
    const started = now(); const uid = user.uid;
    const release = await vault.acquireLease(`migration/${uid}`, budgetMs + 60000);
    try {
      const ledger = await loadLedger(uid);
      const { documents } = await repoFor(user).snapshot();
      const retry = body.retryFailed === true; let processed = 0, stoppedForTime = false;
      if (retry) ledger.failures = {};
      for (const document of documents) {
        const id = document.driveFileId;
        if (!validGoogleDriveId(id)) continue;
        const entry = ledger.files[id];
        if (entry?.state === 'copied' && entry.sha256 === document.sha256 || ledger.failures[id]) continue;
        if (now() - started > budgetMs - reserveMs) { stoppedForTime = true; break; }
        try { await copyOne(uid, document, ledger); delete ledger.failures[id]; processed++; }
        catch (error) {
          ledger.failures[id] = { documentId: document.id, name: String(document.name || '').slice(0, 200), message: safeMessage(error), at: new Date(now()).toISOString() };
        }
        await saveLedger(uid, ledger);
      }
      const counts = migrationCounts(documents, ledger);
      return { switched: false, processed, stoppedForTime, done: counts.pending === 0 && counts.failed === 0, counts,
        mapping: migrationMapping(documents, ledger), failures: Object.values(ledger.failures) };
    } finally { await release(); }
  }

  async function start(req, res) {
    const blocked = requireAvailable(); if (blocked) return res.json(blocked);
    return oneDrive.start(req, res);
  }

  return { switched, available, status, step, start, callback: oneDrive?.callback };
}
