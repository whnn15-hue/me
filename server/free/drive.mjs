import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { networkFetch } from '../auth.mjs';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const normalizedEmail = value => String(value || '').trim().toLowerCase();
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && !['.', '..'].includes(value);
const validFileId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,300}$/.test(value);
const expiration = seconds => Date.now() + Math.min(86400, Math.max(1, Number(seconds) || 3600)) * 1000;
const tokenHeaders = token => ({ Authorization: `Bearer ${token}` });

// The private vault encrypts every JSON value with its key as the AEAD context.
// No Drive or Firebase refresh token is returned to the browser. Short-lived
// Drive access tokens are returned only after verifying the owner's Firebase JWT.
export function createFreeDrive({ vault, config, fetcher = networkFetch, captureBackup, captureSnapshot, refreshFirebaseOwner }) {
  let appURL;
  try { appURL = new URL(config.appUrl); } catch { /* An incomplete deployment stays disconnected. */ }
  const ownerEmail = normalizedEmail(config.ownerEmail);
  const configured = Boolean(config.driveEnabled !== false && ownerEmail && config.googleClientId && config.googleClientSecret
    && appURL?.protocol === 'https:' && appURL.href === `${appURL.origin}/`
    && !appURL.username && !appURL.password);
  const callbackURL = configured ? `${appURL.origin}/api/auth/callback` : null;

  function requireConfigured() {
    if (!configured) throw fault('드라이브 연결에는 HTTPS APP_URL, OWNER_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 설정이 필요합니다.', 503);
  }
  function requireOwner(account) {
    if (!account || !validUid(account.uid) || normalizedEmail(account.email) !== ownerEmail || !ownerEmail) {
      throw fault('본인 구글 계정으로 로그인해 주세요.', 403);
    }
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
    if (!account) return { driveConfigured: configured, driveConnected: false, lastBackup: null };
    const uid = requireOwner(account);
    const [tokens, firebaseTokens, lastBackup, backupError, lastBackupKind] = await Promise.all([
      vault.getJSON(`driveTokens/${uid}`), vault.getJSON(`firebaseTokens/${uid}`),
      vault.getJSON(`lastBackup/${uid}`), vault.getJSON(`backupError/${uid}`), vault.getJSON(`lastBackupKind/${uid}`),
    ]);
    return { driveConfigured: configured, driveConnected: configured && Boolean(tokens?.refresh_token && firebaseTokens?.refreshToken),
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
      let version = await vault.getJSON(`driveConnectionVersion/${uid}`);
      if (!version) { version = randomUUID(); await vault.setJSON(`driveConnectionVersion/${uid}`, version); }
      const state = randomBytes(32).toString('hex');
      const verifier = randomBytes(32).toString('base64url');
      await vault.setJSON(`oauthStates/${createHash('sha256').update(state).digest('hex')}`, {
        uid, email: ownerEmail, verifier, version, expiresAt: Date.now() + 10 * 60 * 1000,
        ...(req.user.firebase?.identities?.['google.com']?.[0] ? { googleSub: req.user.firebase.identities['google.com'][0] } : {}),
      });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      Object.entries({ client_id: config.googleClientId, redirect_uri: callbackURL,
        response_type: 'code', scope: `openid email profile ${DRIVE_SCOPE}`, state,
        access_type: 'offline', prompt: 'consent', login_hint: ownerEmail,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      }).forEach(([name, value]) => url.searchParams.set(name, value));
      res.set?.('Cache-Control', 'no-store');
      return res.json({ url: url.href });
    } finally { await release(); }
  }

  async function callback(req, res) {
    try {
      requireConfigured();
      const state = typeof req.query?.state === 'string' ? req.query.state : '';
      if (!/^[a-f0-9]{64}$/.test(state)) throw fault('드라이브 연결 요청이 올바르지 않습니다. 다시 시도해 주세요.');
      // CAS consumption happens before any network request and across instances.
      const saved = await vault.consumeJSON(`oauthStates/${createHash('sha256').update(state).digest('hex')}`);
      if (!saved || !Number.isFinite(saved.expiresAt) || saved.expiresAt < Date.now() || !validUid(saved.uid) || saved.email !== ownerEmail
        || typeof saved.verifier !== 'string' || !saved.verifier
        || typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096) {
        throw fault('드라이브 연결 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.');
      }
      await boundOwner(saved.uid);
      const release = await vault.acquireLease(`drive/${saved.uid}`);
      try {
        if (await vault.getJSON(`driveConnectionVersion/${saved.uid}`) !== saved.version) throw fault('드라이브 연결이 취소되었습니다. 다시 연결해 주세요.', 409);
        const response = await fetcher('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: req.query.code, client_id: config.googleClientId,
            client_secret: config.googleClientSecret, redirect_uri: callbackURL,
            grant_type: 'authorization_code', code_verifier: saved.verifier }), signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw fault('구글 드라이브 인증을 완료하지 못했습니다. 다시 연결해 주세요.', 502);
        const tokens = await response.json();
        if (typeof tokens.access_token !== 'string' || !tokens.access_token
          || !String(tokens.scope || '').split(/\s+/).includes(DRIVE_SCOPE)) throw fault('구글 드라이브 파일 보관 권한을 허용해 주세요.', 403);
        const profileResponse = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: tokenHeaders(tokens.access_token), signal: AbortSignal.timeout(20000),
        });
        if (!profileResponse.ok) throw fault('구글 계정을 확인하지 못했습니다. 다시 연결해 주세요.', 502);
        const profile = await profileResponse.json();
        if (profile.email_verified !== true || normalizedEmail(profile.email) !== ownerEmail || typeof profile.sub !== 'string' || !profile.sub
          || (saved.googleSub && saved.googleSub !== profile.sub)) throw fault('지정된 본인 구글 계정의 드라이브에만 연결할 수 있습니다.', 403);
        const previous = await vault.getJSON(`driveTokens/${saved.uid}`);
        const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token
          : previous?.accountSub === profile.sub ? previous.refresh_token : null;
        if (!refreshToken) throw fault('자동 백업 권한을 허용하고 드라이브를 다시 연결해 주세요.', 409);
        await vault.setJSON(`driveTokens/${saved.uid}`, { access_token: tokens.access_token,
          refresh_token: refreshToken, expiresAt: expiration(tokens.expires_in), accountSub: profile.sub });
        await vault.deleteJSON(`backupError/${saved.uid}`);
        return res.redirect(`${appURL.origin}/?connected=drive`);
      } finally { await release(); }
    } catch (error) {
      return res.status(error.status || 502).send(error.status ? error.message : '구글 드라이브 연결을 완료하지 못했습니다. 설정을 확인하고 다시 시도해 주세요.');
    }
  }

  // Call only while holding the per-owner Drive lease.
  async function accessToken(uid) {
    const tokens = await vault.getJSON(`driveTokens/${uid}`);
    if (!tokens) throw fault('공문 보관과 백업을 위해 구글 드라이브를 먼저 연결해 주세요.', 409);
    if (tokens.access_token && Number(tokens.expiresAt) > Date.now() + 60000) return { accessToken: tokens.access_token, expiresAt: tokens.expiresAt };
    if (!tokens.refresh_token) throw fault('구글 드라이브를 다시 연결해 주세요.', 409);
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret,
        refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw fault('드라이브 권한을 갱신하지 못했습니다. 다시 연결해 주세요.', 502);
    const fresh = await response.json();
    if (typeof fresh.access_token !== 'string' || !fresh.access_token) throw fault('드라이브 권한을 갱신하지 못했습니다.', 502);
    const expiresAt = expiration(fresh.expires_in);
    await vault.setJSON(`driveTokens/${uid}`, { ...tokens, access_token: fresh.access_token,
      refresh_token: typeof fresh.refresh_token === 'string' && fresh.refresh_token ? fresh.refresh_token : tokens.refresh_token, expiresAt });
    return { accessToken: fresh.access_token, expiresAt };
  }

  async function folderFor(uid, token) {
    const key = `driveFolder/${uid}`;
    const kind = 'archive-folder';
    let folder = await vault.getJSON(key);
    if (!validFileId(folder)) folder = null;
    if (folder) {
      const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder)}?fields=id,trashed,mimeType,appProperties`, {
        headers: tokenHeaders(token), signal: AbortSignal.timeout(20000),
      });
      if (response.status === 404) folder = null;
      else if (!response.ok) throw fault('드라이브 보관 폴더를 확인하지 못했습니다.', 502);
      else {
        const metadata = await response.json();
        if (metadata.trashed) folder = null;
        else if (metadata.mimeType !== 'application/vnd.google-apps.folder' || metadata.appProperties?.archiveUid !== uid || metadata.appProperties?.kind !== kind) throw fault('드라이브 보관 폴더의 계정 정보를 확인하지 못했습니다.', 403);
      }
    }
    if (!folder) {
      const response = await fetcher('https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST', headers: { ...tokenHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '나의 경력 보관함',
          mimeType: 'application/vnd.google-apps.folder', appProperties: { archiveUid: uid, kind } }), signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw fault('드라이브 보관 폴더를 만들지 못했습니다.', 502);
      folder = (await response.json()).id;
      if (!validFileId(folder)) throw fault('드라이브 폴더 응답이 올바르지 않습니다.', 502);
      await vault.setJSON(key, folder);
    }
    return folder;
  }

  async function accessFor(uid) {
    requireConfigured();
    await boundOwner(uid);
    const release = await vault.acquireLease(`drive/${uid}`);
    try {
      const token = await accessToken(uid);
      const folderId = await folderFor(uid, token.accessToken);
      return { ...token, folderId };
    } finally { await release(); }
  }
  async function access(req, res) {
    const uid = requestOwner(req);
    const value = await accessFor(uid);
    res.set?.('Cache-Control', 'no-store');
    return res.json(value);
  }

  async function requireFile(uid, fileId, { kind, driveAccessToken } = {}) {
    if (!validFileId(fileId)) throw fault('공문 파일 정보가 올바르지 않습니다.');
    let token, folderId;
    if (driveAccessToken) {
      // Backup already holds the Drive lease. This token comes only from the
      // internal captureBackup context, never from an HTTP request body.
      requireConfigured();
      await boundOwner(uid);
      token = driveAccessToken;
      folderId = await folderFor(uid, token);
    } else {
      ({ accessToken: token, folderId } = await accessFor(uid));
    }
    const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,trashed,parents,appProperties`, {
      headers: tokenHeaders(token), signal: AbortSignal.timeout(20000),
    });
    if (response.status === 404) throw fault('드라이브에서 원본 파일을 찾지 못했습니다.', 404);
    if (!response.ok) throw fault('드라이브 원본 파일을 확인하지 못했습니다.', 502);
    const metadata = await response.json();
    if (metadata.trashed || metadata.appProperties?.archiveUid !== uid || !Array.isArray(metadata.parents) || !metadata.parents.includes(folderId)
      || !['document', 'template', 'export', 'output', 'backup'].includes(metadata.appProperties?.kind)
      || (kind && metadata.appProperties.kind !== kind)) throw fault('이 경력 보관함의 원본 파일이 아닙니다.', 403);
    return { metadata, accessToken: token };
  }

  async function uploadFile(uid, token, folderId, buffer, fileName, mime, kind) {
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BACKUP_BYTES) throw fault('파일은 200MB 이하여야 합니다.', 413);
    const name = String(fileName || '').replace(/[\r\n\0]/g, '').slice(0, 240);
    if (!name || !['document', 'template', 'export', 'output', 'backup'].includes(kind)) throw fault('파일 이름 또는 종류가 올바르지 않습니다.');
    const contentType = typeof mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : 'application/octet-stream';
    const boundary = `career_${randomUUID()}`;
    const metadata = { name, parents: [folderId], appProperties: { archiveUid: uid, kind, sha256: createHash('sha256').update(buffer).digest('hex') } };
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const response = await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
      method: 'POST', headers: { ...tokenHeaders(token), 'Content-Type': `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw fault('드라이브 파일 업로드에 실패했습니다.', 502);
    const result = await response.json();
    if (!validFileId(result.id)) throw fault('드라이브 업로드 응답이 올바르지 않습니다.', 502);
    return { driveFileId: result.id, fileName: name, mime: contentType };
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
      await vault.setJSON(`backupError/${uid}`, error.status ? error.message : '드라이브 백업을 완료하지 못했습니다. 연결과 설정을 확인해 주세요.');
      throw error.status ? error : fault('드라이브 백업을 완료하지 못했습니다. 연결과 설정을 확인해 주세요.', 502);
    } finally { await release(); }
  }

  async function disconnect(req, res) {
    const uid = requestOwner(req);
    const release = await vault.acquireLease(`drive/${uid}`);
    try {
      const tokens = await vault.getJSON(`driveTokens/${uid}`);
      await vault.setJSON(`driveConnectionVersion/${uid}`, randomUUID());
      await Promise.all([
        vault.deleteJSON(`driveTokens/${uid}`), vault.deleteJSON(`firebaseTokens/${uid}`),
        vault.deleteJSON(`backupError/${uid}`),
      ]);
      // Keep the private folder pointer and its originals/backups. Reconnecting
      // the same account and OAuth client must preserve existing document links.
      let revoked = false;
      if (tokens?.refresh_token || tokens?.access_token) {
        try {
          const response = await fetcher('https://oauth2.googleapis.com/revoke', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }), signal: AbortSignal.timeout(20000),
          });
          revoked = response.ok;
        } catch { /* Revocation failure does not retain local credentials. */ }
      }
      return res.json({ ok: true, revoked });
    } finally { await release(); }
  }

  async function scheduled() {
    if (!configured) return { skipped: 'drive-not-configured' };
    const owner = await vault.getJSON('configuredOwner');
    if (!owner || !validUid(owner.uid) || normalizedEmail(owner.email) !== ownerEmail) return { skipped: 'owner-not-connected' };
    const uid = owner.uid;
    if (!(await vault.getJSON(`driveTokens/${uid}`))) return { skipped: 'drive-not-connected' };
    const firebaseTokens = await vault.getJSON(`firebaseTokens/${uid}`);
    if (!firebaseTokens?.refreshToken) return { skipped: 'firebase-not-connected' };
    try {
      const refreshed = await refreshFirebaseOwner(firebaseTokens.refreshToken, { uid });
      if (refreshed?.uid !== uid || normalizedEmail(refreshed.email) !== ownerEmail || !refreshed.idToken) throw fault('자동 백업 계정 정보를 확인하지 못했습니다. 다시 로그인하고 드라이브를 연결해 주세요.', 403);
      if (refreshed.refreshToken && refreshed.refreshToken !== firebaseTokens.refreshToken) {
        const release = await vault.acquireLease(`drive/${uid}`);
        try {
          // Never restore a deleted session after a simultaneous disconnect.
          const current = await vault.getJSON(`firebaseTokens/${uid}`);
          if (current?.refreshToken !== firebaseTokens.refreshToken) throw fault('자동 백업 연결이 변경되었습니다.', 409);
          await vault.setJSON(`firebaseTokens/${uid}`, { refreshToken: refreshed.refreshToken });
        } finally { await release(); }
      }
      return { results: [{ uid, ...(await backup(refreshed)) }] };
    } catch (error) {
      const message = error.status ? error.message : '자동 백업을 완료하지 못했습니다. 로그인과 드라이브 연결을 확인해 주세요.';
      await vault.setJSON(`backupError/${uid}`, message);
      return { results: [{ uid, ok: false, error: message }] };
    }
  }

  return { configured, status, start, callback, disconnect, access, accessFor, requireFile, upload, backup, scheduled, scheduledBackup: scheduled };
}
