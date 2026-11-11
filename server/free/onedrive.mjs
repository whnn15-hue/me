import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { networkFetch } from '../auth.mjs';
import { validOneDriveItemId } from '../../shared/storage-id.mjs';

// Microsoft OneDrive (personal accounts) storage provider. It implements the same
// interface as createFreeDrive so the API, backups and document reads stay the
// same. Files live only in the app folder (Files.ReadWrite.AppFolder), the
// OneDrive counterpart of Google's drive.file scope.
export const ONEDRIVE_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
export const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder';
export const ONEDRIVE_SCOPES = `openid profile offline_access User.Read ${ONEDRIVE_SCOPE}`;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
// Upload-session fragments must be multiples of 320 KiB and at most 60 MiB.
export const UPLOAD_CHUNK_BYTES = 320 * 1024 * 32;
const KINDS = ['document', 'template', 'export', 'output', 'backup'];
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const normalizedEmail = value => String(value || '').trim().toLowerCase();
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && !['.', '..'].includes(value);
const expiration = seconds => Date.now() + Math.min(86400, Math.max(1, Number(seconds) || 3600)) * 1000;
const tokenHeaders = token => ({ Authorization: `Bearer ${token}` });
const grantedScope = (scope, wanted) => String(scope || '').split(/\s+/).some(item => item === wanted || item.endsWith(`/${wanted}`));
// OneDrive rejects these characters and trailing dots/spaces in item names.
export function oneDriveName(value) {
  const name = String(value || '').replace(/[\r\n\0"*:<>?/\\|]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 240);
  return name && !/^~\$/.test(name) ? name : '';
}
// Archive ownership, kind and SHA-256 are kept in the item description (an
// OneDrive Personal property) like Google Drive appProperties.
export function encodeArchiveDescription({ archiveUid, kind, sha256 }) {
  return JSON.stringify({ v: 1, archiveUid, kind, sha256 });
}
export function decodeArchiveDescription(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (parsed?.v !== 1 || typeof parsed.archiveUid !== 'string' || !KINDS.includes(parsed.kind)) return null;
    return { archiveUid: parsed.archiveUid, kind: parsed.kind, ...(/^[a-f0-9]{64}$/.test(parsed.sha256 || '') ? { sha256: parsed.sha256 } : {}) };
  } catch { return null; }
}
// Graph driveItem → the Drive metadata shape the rest of the server already reads.
export function driveShapedMetadata(item) {
  return { id: item.id, name: item.name, mimeType: item.file?.mimeType || 'application/octet-stream',
    size: String(item.size ?? ''), trashed: Boolean(item.deleted), parents: item.parentReference?.id ? [item.parentReference.id] : [],
    appProperties: decodeArchiveDescription(item.description) || {} };
}

export function createFreeOneDrive({ vault, config, fetcher = networkFetch, captureBackup, captureSnapshot, refreshFirebaseOwner }) {
  let appURL;
  try { appURL = new URL(config.appUrl); } catch { /* An incomplete deployment stays disconnected. */ }
  const ownerEmail = normalizedEmail(config.ownerEmail);
  const configured = Boolean(config.driveEnabled !== false && ownerEmail && config.microsoftClientId && config.microsoftClientSecret
    && appURL?.protocol === 'https:' && appURL.href === `${appURL.origin}/`
    && !appURL.username && !appURL.password);
  const callbackURL = configured ? `${appURL.origin}/api/auth/onedrive/callback` : null;

  function requireConfigured() {
    if (!configured) throw fault('OneDrive 연결에는 HTTPS APP_URL, OWNER_EMAIL, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET 설정이 필요합니다.', 503);
  }
  function requireOwner(account) {
    if (!account || !validUid(account.uid) || normalizedEmail(account.email) !== ownerEmail || !ownerEmail) throw fault('본인 구글 계정으로 로그인해 주세요.', 403);
    return account.uid;
  }
  function requestOwner(req) {
    if (!req.user) throw fault('먼저 로그인해 주세요.', 401);
    return requireOwner(req.user);
  }
  async function boundOwner(uid) {
    if (!validUid(uid)) throw fault('계정 정보가 올바르지 않습니다.', 403);
    const owner = await vault.getJSON('configuredOwner');
    if (owner?.uid !== uid || normalizedEmail(owner.email) !== ownerEmail) throw fault('본인 계정을 확인할 수 없습니다.', 403);
  }
  async function bindOwner(uid) {
    const release = await vault.acquireLease('ownerBinding', 30000);
    try {
      const owner = await vault.getJSON('configuredOwner');
      if (owner && (owner.uid !== uid || normalizedEmail(owner.email) !== ownerEmail)) throw fault('기존에 연결한 본인 계정으로 로그인해 주세요.', 403);
      if (!owner) await vault.setJSON('configuredOwner', { uid, email: ownerEmail });
    } finally { await release(); }
  }

  async function status(account) {
    const base = { storageProvider: 'onedrive' };
    if (!account) return { ...base, driveConfigured: configured, driveConnected: false, lastBackup: null };
    const uid = requireOwner(account);
    if (!configured) return { ...base, driveConfigured: false, driveConnected: false, lastBackup: null };
    const [tokens, firebaseTokens, lastBackup, backupError, lastBackupKind] = await Promise.all([
      vault.getJSON(`oneDriveTokens/${uid}`), vault.getJSON(`firebaseTokens/${uid}`),
      vault.getJSON(`lastBackup/${uid}`), vault.getJSON(`backupError/${uid}`), vault.getJSON(`lastBackupKind/${uid}`),
    ]);
    return { ...base, driveConfigured: configured, driveConnected: Boolean(tokens?.refresh_token && firebaseTokens?.refreshToken),
      ...(tokens?.accountEmail ? { storageAccount: tokens.accountEmail } : {}),
      lastBackup: lastBackup || null, ...(backupError ? { backupError } : {}),
      ...(['snapshot', 'full'].includes(lastBackupKind) ? { lastBackupKind } : {}) };
  }

  async function start(req, res) {
    requireConfigured();
    const uid = requestOwner(req);
    const refreshToken = req.body?.firebaseRefreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 10000) throw fault('자동 백업에 사용할 로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.', 400);
    const refreshed = await refreshFirebaseOwner(refreshToken, { uid });
    if (refreshed?.uid !== uid || normalizedEmail(refreshed.email) !== ownerEmail || !refreshed.idToken) throw fault('자동 백업 계정이 로그인한 본인 계정과 다릅니다.', 403);
    await bindOwner(uid);
    const release = await vault.acquireLease(`drive/${uid}`);
    try {
      await vault.setJSON(`firebaseTokens/${uid}`, { refreshToken: refreshed.refreshToken || refreshToken });
      let version = await vault.getJSON(`oneDriveConnectionVersion/${uid}`);
      if (!version) { version = randomUUID(); await vault.setJSON(`oneDriveConnectionVersion/${uid}`, version); }
      const state = randomBytes(32).toString('hex');
      const verifier = randomBytes(32).toString('base64url');
      await vault.setJSON(`oauthStates/${createHash('sha256').update(state).digest('hex')}`, {
        provider: 'onedrive', uid, email: ownerEmail, verifier, version, expiresAt: Date.now() + 10 * 60 * 1000,
      });
      const url = new URL(`${ONEDRIVE_AUTHORITY}/authorize`);
      Object.entries({ client_id: config.microsoftClientId, redirect_uri: callbackURL, response_type: 'code',
        response_mode: 'query', scope: ONEDRIVE_SCOPES, state, prompt: 'select_account',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      }).forEach(([name, value]) => url.searchParams.set(name, value));
      res.set?.('Cache-Control', 'no-store');
      return res.json({ url: url.href });
    } finally { await release(); }
  }

  async function tokenRequest(values) {
    return fetcher(`${ONEDRIVE_AUTHORITY}/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.microsoftClientId, client_secret: config.microsoftClientSecret, scope: ONEDRIVE_SCOPES, ...values }),
      signal: AbortSignal.timeout(20000),
    });
  }

  async function callback(req, res) {
    try {
      requireConfigured();
      const state = typeof req.query?.state === 'string' ? req.query.state : '';
      if (!/^[a-f0-9]{64}$/.test(state)) throw fault('OneDrive 연결 요청이 올바르지 않습니다. 다시 시도해 주세요.');
      const saved = await vault.consumeJSON(`oauthStates/${createHash('sha256').update(state).digest('hex')}`);
      if (typeof req.query?.error === 'string') throw fault('OneDrive 연결이 취소되었거나 권한이 허용되지 않았습니다. 다시 시도해 주세요.', 403);
      if (!saved || saved.provider !== 'onedrive' || !Number.isFinite(saved.expiresAt) || saved.expiresAt < Date.now() || !validUid(saved.uid) || saved.email !== ownerEmail
        || typeof saved.verifier !== 'string' || !saved.verifier
        || typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096) {
        throw fault('OneDrive 연결 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.');
      }
      await boundOwner(saved.uid);
      const release = await vault.acquireLease(`drive/${saved.uid}`);
      try {
        if (await vault.getJSON(`oneDriveConnectionVersion/${saved.uid}`) !== saved.version) throw fault('OneDrive 연결이 취소되었습니다. 다시 연결해 주세요.', 409);
        const response = await tokenRequest({ code: req.query.code, redirect_uri: callbackURL, grant_type: 'authorization_code', code_verifier: saved.verifier });
        if (!response.ok) throw fault('OneDrive 인증을 완료하지 못했습니다. 다시 연결해 주세요.', 502);
        const tokens = await response.json();
        if (typeof tokens.access_token !== 'string' || !tokens.access_token || !grantedScope(tokens.scope, ONEDRIVE_SCOPE)) throw fault('OneDrive 앱 폴더 사용 권한을 허용해 주세요.', 403);
        const profileResponse = await fetcher(`${GRAPH}/me?$select=id,userPrincipalName,mail`, { headers: tokenHeaders(tokens.access_token), signal: AbortSignal.timeout(20000) });
        if (!profileResponse.ok) throw fault('마이크로소프트 계정을 확인하지 못했습니다. 다시 연결해 주세요.', 502);
        const profile = await profileResponse.json();
        if (typeof profile.id !== 'string' || !profile.id) throw fault('마이크로소프트 계정을 확인하지 못했습니다.', 502);
        const previous = await vault.getJSON(`oneDriveTokens/${saved.uid}`);
        // Reconnecting a different Microsoft account would orphan stored file IDs.
        if (previous?.accountId && previous.accountId !== profile.id && await vault.getJSON(`oneDriveFolder/${saved.uid}`)) {
          throw fault('처음 연결한 마이크로소프트 계정으로 다시 연결해 주세요. 다른 계정의 OneDrive에서는 기존 원본을 찾을 수 없습니다.', 403);
        }
        const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token
          : previous?.accountId === profile.id ? previous.refresh_token : null;
        if (!refreshToken) throw fault('자동 백업 권한을 허용하고 OneDrive를 다시 연결해 주세요.', 409);
        await vault.setJSON(`oneDriveTokens/${saved.uid}`, { access_token: tokens.access_token, refresh_token: refreshToken,
          expiresAt: expiration(tokens.expires_in), accountId: profile.id,
          accountEmail: normalizedEmail(profile.mail || profile.userPrincipalName) || null });
        await vault.deleteJSON(`backupError/${saved.uid}`);
        return res.redirect(`${appURL.origin}/?connected=drive`);
      } finally { await release(); }
    } catch (error) {
      return res.status(error.status || 502).send(error.status ? error.message : 'OneDrive 연결을 완료하지 못했습니다. 설정을 확인하고 다시 시도해 주세요.');
    }
  }

  // Call only while holding the per-owner storage lease.
  async function accessToken(uid) {
    const tokens = await vault.getJSON(`oneDriveTokens/${uid}`);
    if (!tokens) throw fault('공문 보관과 백업을 위해 OneDrive를 먼저 연결해 주세요.', 409);
    if (tokens.access_token && Number(tokens.expiresAt) > Date.now() + 60000) return { accessToken: tokens.access_token, expiresAt: tokens.expiresAt };
    if (!tokens.refresh_token) throw fault('OneDrive를 다시 연결해 주세요.', 409);
    const response = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: 'refresh_token' });
    if (!response.ok) throw fault('OneDrive 권한을 갱신하지 못했습니다. 다시 연결해 주세요.', 502);
    const fresh = await response.json();
    if (typeof fresh.access_token !== 'string' || !fresh.access_token) throw fault('OneDrive 권한을 갱신하지 못했습니다.', 502);
    const expiresAt = expiration(fresh.expires_in);
    // Microsoft rotates refresh tokens; always keep the newest one.
    await vault.setJSON(`oneDriveTokens/${uid}`, { ...tokens, access_token: fresh.access_token,
      refresh_token: typeof fresh.refresh_token === 'string' && fresh.refresh_token ? fresh.refresh_token : tokens.refresh_token, expiresAt });
    return { accessToken: fresh.access_token, expiresAt };
  }

  async function folderFor(uid, token) {
    const key = `oneDriveFolder/${uid}`;
    const response = await fetcher(`${GRAPH}/me/drive/special/approot?$select=id,name,folder`, { headers: tokenHeaders(token), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw fault('OneDrive 앱 폴더를 확인하지 못했습니다.', 502);
    const folder = (await response.json()).id;
    if (!validOneDriveItemId(folder)) throw fault('OneDrive 앱 폴더 응답이 올바르지 않습니다.', 502);
    const saved = await vault.getJSON(key);
    if (saved !== folder) await vault.setJSON(key, folder);
    return folder;
  }

  async function accessFor(uid) {
    requireConfigured();
    await boundOwner(uid);
    const release = await vault.acquireLease(`drive/${uid}`);
    try {
      const token = await accessToken(uid);
      const folderId = await folderFor(uid, token.accessToken);
      return { ...token, folderId, provider: 'onedrive' };
    } finally { await release(); }
  }
  async function access(req, res) {
    const uid = requestOwner(req);
    const value = await accessFor(uid);
    res.set?.('Cache-Control', 'no-store');
    return res.json(value);
  }

  async function requireFile(uid, fileId, { kind, driveAccessToken } = {}) {
    if (!validOneDriveItemId(fileId)) throw fault('공문 파일 정보가 올바르지 않습니다.');
    let token, folderId;
    if (driveAccessToken) {
      requireConfigured();
      await boundOwner(uid);
      token = driveAccessToken;
      folderId = await folderFor(uid, token);
    } else {
      ({ accessToken: token, folderId } = await accessFor(uid));
    }
    const response = await fetcher(`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}?$select=id,name,size,file,parentReference,description,deleted`, {
      headers: tokenHeaders(token), signal: AbortSignal.timeout(20000),
    });
    if ([400, 404].includes(response.status)) throw fault('OneDrive에서 원본 파일을 찾지 못했습니다. 구글 드라이브에 보관된 원본이면 OneDrive로 옮긴 뒤 다시 시도해 주세요.', 404);
    if (!response.ok) throw fault('OneDrive 원본 파일을 확인하지 못했습니다.', 502);
    const metadata = driveShapedMetadata(await response.json());
    if (metadata.trashed || metadata.appProperties?.archiveUid !== uid || !metadata.parents.includes(folderId)
      || !KINDS.includes(metadata.appProperties?.kind) || (kind && metadata.appProperties.kind !== kind)) throw fault('이 경력 보관함의 원본 파일이 아닙니다.', 403);
    // Graph answers /content with a redirect to a pre-authenticated download URL.
    const download = () => fetcher(`${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}/content`, { headers: tokenHeaders(token), redirect: 'follow', signal: AbortSignal.timeout(25000) });
    return { metadata, accessToken: token, download };
  }

  async function uploadFile(uid, token, folderId, buffer, fileName, mime, kind) {
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BACKUP_BYTES) throw fault('파일은 200MB 이하여야 합니다.', 413);
    if (!buffer.length) throw fault('빈 파일은 보관할 수 없습니다.');
    const name = oneDriveName(fileName);
    if (!name || !KINDS.includes(kind)) throw fault('파일 이름 또는 종류가 올바르지 않습니다.');
    const contentType = typeof mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : 'application/octet-stream';
    const description = encodeArchiveDescription({ archiveUid: uid, kind, sha256: createHash('sha256').update(buffer).digest('hex') });
    // An upload session sets the description atomically with the content, for
    // every size; fragments go to the pre-authorized URL without the token.
    const session = await fetcher(`${GRAPH}/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: 'POST', headers: { ...tokenHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name, description } }), signal: AbortSignal.timeout(20000),
    });
    if (!session.ok) throw fault(session.status === 507 ? 'OneDrive 저장 공간이 부족합니다.' : 'OneDrive 파일 업로드를 시작하지 못했습니다.', session.status === 507 ? 507 : 502);
    const { uploadUrl } = await session.json();
    let uploadOrigin;
    try { uploadOrigin = new URL(uploadUrl); } catch { /* checked below */ }
    if (uploadOrigin?.protocol !== 'https:') throw fault('OneDrive 업로드 주소가 올바르지 않습니다.', 502);
    let item = null;
    try {
      for (let offset = 0; offset < buffer.length; offset += UPLOAD_CHUNK_BYTES) {
        const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + UPLOAD_CHUNK_BYTES));
        const end = offset + chunk.length - 1;
        const response = await fetcher(uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${offset}-${end}/${buffer.length}`, 'Content-Type': contentType }, body: chunk, signal: AbortSignal.timeout(120000) });
        if (response.status === 202) continue;
        if (!response.ok) throw fault('OneDrive 파일 업로드에 실패했습니다.', 502);
        item = await response.json();
        break;
      }
    } catch (error) {
      await fetcher(uploadUrl, { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => {});
      throw error.status ? error : fault('OneDrive 파일 업로드에 실패했습니다.', 502);
    }
    if (!validOneDriveItemId(item?.id)) throw fault('OneDrive 업로드 응답이 올바르지 않습니다.', 502);
    return { driveFileId: item.id, fileName: item.name || name, mime: contentType };
  }
  async function upload(uid, buffer, fileName, mime, kind = 'export') {
    requireConfigured();
    await boundOwner(uid);
    const release = await vault.acquireLease(`drive/${uid}`);
    try {
      const { accessToken: token } = await accessToken(uid);
      const folder = await folderFor(uid, token);
      return await uploadFile(uid, token, folder, buffer, fileName, mime, kind);
    } finally { await release(); }
  }

  // Finds an archive file already in the app folder by its recorded SHA-256, so
  // an interrupted copy can be resumed without uploading the same file twice.
  async function findArchivedFile(uid, sha256, kind = 'document') {
    if (!/^[a-f0-9]{64}$/.test(sha256 || '')) return null;
    const { accessToken: token, folderId } = await accessFor(uid);
    let next = `${GRAPH}/me/drive/items/${encodeURIComponent(folderId)}/children?$select=id,name,size,description,deleted&$top=200`;
    for (let page = 0; next && page < 100; page++) {
      if (!next.startsWith(`${GRAPH}/`)) throw fault('OneDrive 목록 주소가 올바르지 않습니다.', 502);
      const response = await fetcher(next, { headers: tokenHeaders(token), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw fault('OneDrive 앱 폴더 목록을 읽지 못했습니다.', 502);
      const data = await response.json();
      for (const item of data.value || []) {
        const meta = decodeArchiveDescription(item.description);
        if (!item.deleted && validOneDriveItemId(item.id) && meta?.archiveUid === uid && meta.kind === kind && meta.sha256 === sha256) return { driveFileId: item.id, size: Number(item.size) };
      }
      next = typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null;
    }
    return null;
  }

  async function backup(account) {
    requireConfigured();
    const uid = requireOwner(account);
    await boundOwner(uid);
    const idToken = account.idToken || account.token;
    if (typeof idToken !== 'string' || !idToken) throw fault('백업에 사용할 로그인 정보를 확인하지 못했습니다.', 401);
    const release = await vault.acquireLease(`drive/${uid}`);
    try {
      const { accessToken: token } = await accessToken(uid);
      const snapshot = typeof captureSnapshot === 'function';
      const buffer = snapshot ? await captureSnapshot(uid, { idToken }) : await captureBackup(uid, { idToken, driveAccessToken: token });
      if (!Buffer.isBuffer(buffer) || buffer.length > (snapshot ? MAX_SNAPSHOT_BYTES : MAX_BACKUP_BYTES)) {
        throw fault(snapshot ? '경력 데이터 백업은 5MB 이하여야 합니다.' : '백업 파일은 200MB 이하여야 합니다.', 413);
      }
      if (snapshot) {
        try { JSON.parse(buffer.toString('utf8')); }
        catch { throw fault('경력 데이터 백업 형식이 올바르지 않습니다.', 502); }
      }
      const folder = await folderFor(uid, token);
      const timestamp = new Date().toISOString();
      const name = `career-${snapshot ? 'snapshot' : 'backup'}-${timestamp.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.${snapshot ? 'json' : 'zip'}`;
      const uploaded = await uploadFile(uid, token, folder, buffer, name, snapshot ? 'application/json' : 'application/zip', 'backup');
      const lastBackupKind = snapshot ? 'snapshot' : 'full';
      await vault.setJSON(`lastBackup/${uid}`, timestamp);
      await vault.setJSON(`lastBackupKind/${uid}`, lastBackupKind);
      await vault.deleteJSON(`backupError/${uid}`);
      return { ok: true, lastBackup: timestamp, lastBackupKind, ...uploaded, name };
    } catch (error) {
      await vault.setJSON(`backupError/${uid}`, error.status ? error.message : 'OneDrive 백업을 완료하지 못했습니다. 연결과 설정을 확인해 주세요.');
      throw error.status ? error : fault('OneDrive 백업을 완료하지 못했습니다. 연결과 설정을 확인해 주세요.', 502);
    } finally { await release(); }
  }

  async function disconnect(req, res) {
    const uid = requestOwner(req);
    const release = await vault.acquireLease(`drive/${uid}`);
    try {
      const tokens = await vault.getJSON(`oneDriveTokens/${uid}`);
      await vault.setJSON(`oneDriveConnectionVersion/${uid}`, randomUUID());
      // Keep accountId so a reconnect is checked against the same Microsoft account.
      await Promise.all([
        tokens?.accountId ? vault.setJSON(`oneDriveTokens/${uid}`, { accountId: tokens.accountId, accountEmail: tokens.accountEmail || null }) : vault.deleteJSON(`oneDriveTokens/${uid}`),
        vault.deleteJSON(`firebaseTokens/${uid}`), vault.deleteJSON(`backupError/${uid}`),
      ]);
      // Microsoft has no per-token revoke endpoint for personal accounts; the
      // owner can remove the app at account.live.com/consent/Manage.
      return res.json({ ok: true, revoked: false });
    } finally { await release(); }
  }

  async function scheduled() {
    if (!configured) return { skipped: 'drive-not-configured' };
    const owner = await vault.getJSON('configuredOwner');
    if (!owner || !validUid(owner.uid) || normalizedEmail(owner.email) !== ownerEmail) return { skipped: 'owner-not-connected' };
    const uid = owner.uid;
    if (!(await vault.getJSON(`oneDriveTokens/${uid}`))?.refresh_token) return { skipped: 'drive-not-connected' };
    const firebaseTokens = await vault.getJSON(`firebaseTokens/${uid}`);
    if (!firebaseTokens?.refreshToken) return { skipped: 'firebase-not-connected' };
    try {
      const refreshed = await refreshFirebaseOwner(firebaseTokens.refreshToken, { uid });
      if (refreshed?.uid !== uid || normalizedEmail(refreshed.email) !== ownerEmail || !refreshed.idToken) throw fault('자동 백업 계정 정보를 확인하지 못했습니다. 다시 로그인하고 OneDrive를 연결해 주세요.', 403);
      if (refreshed.refreshToken && refreshed.refreshToken !== firebaseTokens.refreshToken) {
        const release = await vault.acquireLease(`drive/${uid}`);
        try {
          const current = await vault.getJSON(`firebaseTokens/${uid}`);
          if (current?.refreshToken !== firebaseTokens.refreshToken) throw fault('자동 백업 연결이 변경되었습니다.', 409);
          await vault.setJSON(`firebaseTokens/${uid}`, { refreshToken: refreshed.refreshToken });
        } finally { await release(); }
      }
      return { results: [{ uid, ...(await backup(refreshed)) }] };
    } catch (error) {
      const message = error.status ? error.message : '자동 백업을 완료하지 못했습니다. 로그인과 OneDrive 연결을 확인해 주세요.';
      await vault.setJSON(`backupError/${uid}`, message);
      return { results: [{ uid, ok: false, error: message }] };
    }
  }

  return { provider: 'onedrive', configured, status, start, callback, disconnect, access, accessFor, requireFile, upload, findArchivedFile, backup, scheduled, scheduledBackup: scheduled };
}
