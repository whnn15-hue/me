import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { networkFetch } from '../auth.mjs';

const ARCHIVES = 'careerArchives';
const OAUTH_STATES = 'careerArchiveOAuthStates';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const email = value => String(value || '').trim().toLowerCase();
const uidOK = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && value !== '.' && value !== '..';
const millis = value => value?.toMillis ? value.toMillis() : value instanceof Date ? value.getTime() : Number(value || 0);
const expiresAt = seconds => Date.now() + Math.min(86400, Math.max(1, Number(seconds) || 3600)) * 1000;
const fileID = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,300}$/.test(value);

// Firestore rules deny client access to these collections. Tokens and PKCE
// verifiers are additionally encrypted with a Secret Manager supplied key.
export function createCloudDrive({ db, storeFactory, config, fetcher = networkFetch, captureBackup }) {
  let appURL, callbackURL;
  try {
    appURL = new URL(config.appUrl);
    callbackURL = new URL(config.driveCallbackUrl);
  } catch { /* Missing configuration leaves the integration disabled. */ }
  const ownerEmail = email(config.ownerEmail);
  const configured = Boolean(ownerEmail && config.googleClientId && config.googleClientSecret
    && typeof config.encryptionKey === 'string' && Buffer.byteLength(config.encryptionKey) >= 32
    && appURL?.protocol === 'https:' && appURL.href === `${appURL.origin}/`
    && callbackURL?.protocol === 'https:' && !callbackURL.username && !callbackURL.password
    && !callbackURL.search && !callbackURL.hash);
  const key = configured ? createHash('sha256').update(config.encryptionKey).digest() : null;

  function requireConfigured() {
    if (!configured) throw fault('드라이브 백업에는 APP_URL, APP_API_URL, OWNER_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET 및 32바이트 이상의 APP_ENCRYPTION_KEY 설정이 필요합니다.', 503);
  }
  function requireOwner(repo) {
    if (!repo || !uidOK(repo.uid) || email(repo.email) !== ownerEmail || !ownerEmail) throw fault('본인 계정으로 로그인해 주세요.', 403);
  }
  function encrypt(value, context) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(context));
    return `v1:${Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64')}`;
  }
  function decrypt(value, context) {
    if (!key || typeof value !== 'string' || !value.startsWith('v1:')) return null;
    try {
      const data = Buffer.from(value.slice(3), 'base64');
      if (data.length < 29) return null;
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(data.subarray(-16));
      return JSON.parse(Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString());
    } catch { return null; }
  }
  const tokensFor = async repo => decrypt(await repo.getSetting('driveTokens'), `drive:${repo.uid}`);
  const saveTokens = (repo, tokens) => repo.setSetting('driveTokens', encrypt(tokens, `drive:${repo.uid}`));

  async function status(repo) {
    if (!repo) return { driveConfigured: configured, driveConnected: false, lastBackup: null };
    requireOwner(repo);
    const [tokens, lastBackup, backupError] = await Promise.all([
      tokensFor(repo), repo.getSetting('lastBackup'), repo.getSetting('backupError'),
    ]);
    return { driveConfigured: configured, driveConnected: configured && Boolean(tokens?.refresh_token || tokens?.access_token),
      lastBackup: lastBackup || null, ...(backupError ? { backupError } : {}) };
  }

  async function start(req, res) {
    requireConfigured();
    const repo = req.repo;
    requireOwner(repo);
    if (req.user?.uid !== repo.uid || email(req.user?.email) !== ownerEmail) throw fault('먼저 본인 계정으로 로그인해 주세요.', 401);
    const state = randomBytes(32).toString('hex');
    const verifier = randomBytes(32).toString('base64url');
    await db.collection(OAUTH_STATES).doc(createHash('sha256').update(state).digest('hex')).create({
      uid: repo.uid, email: ownerEmail, expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      verifier: encrypt({ verifier }, `oauth:${repo.uid}`),
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    Object.entries({ client_id: config.googleClientId, redirect_uri: callbackURL.href,
      response_type: 'code', scope: `openid email profile ${DRIVE_SCOPE}`, state,
      access_type: 'offline', prompt: 'consent', login_hint: ownerEmail,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).forEach(([name, value]) => url.searchParams.set(name, value));
    return res.json({ url: url.href });
  }

  async function callback(req, res) {
    try {
      requireConfigured();
      const state = typeof req.query?.state === 'string' ? req.query.state : '';
      if (!/^[a-f0-9]{64}$/.test(state)) throw fault('드라이브 연결 요청이 올바르지 않습니다. 다시 시도해 주세요.');
      const stateRef = db.collection(OAUTH_STATES).doc(createHash('sha256').update(state).digest('hex'));
      // Consuming state atomically prevents replay across function instances.
      const saved = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(stateRef);
        if (!snapshot.exists) return null;
        transaction.delete(stateRef);
        return snapshot.data();
      });
      if (!saved || millis(saved.expiresAt) < Date.now() || !uidOK(saved.uid) || saved.email !== ownerEmail
        || typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096) {
        throw fault('드라이브 연결 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.');
      }
      const verifier = decrypt(saved.verifier, `oauth:${saved.uid}`)?.verifier;
      if (!verifier) throw fault('드라이브 연결 설정이 변경되었습니다. 다시 연결해 주세요.');
      const account = await db.collection(ARCHIVES).doc(saved.uid).get();
      if (!account.exists || email(account.data()?.email) !== ownerEmail) throw fault('본인 계정을 확인할 수 없습니다.', 403);
      const response = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: req.query.code, client_id: config.googleClientId,
          client_secret: config.googleClientSecret, redirect_uri: callbackURL.href,
          grant_type: 'authorization_code', code_verifier: verifier }), signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw fault('구글 드라이브 인증을 완료하지 못했습니다. 다시 연결해 주세요.', 502);
      const tokens = await response.json();
      if (typeof tokens.access_token !== 'string' || !tokens.access_token
        || !String(tokens.scope || '').split(/\s+/).includes(DRIVE_SCOPE)) throw fault('구글 드라이브 파일 백업 권한을 허용해 주세요.', 403);
      const profileResponse = await fetcher('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20000),
      });
      if (!profileResponse.ok) throw fault('구글 계정을 확인하지 못했습니다. 다시 연결해 주세요.', 502);
      const profile = await profileResponse.json();
      if (profile.email_verified !== true || email(profile.email) !== ownerEmail || typeof profile.sub !== 'string' || !profile.sub) {
        throw fault('드라이브 백업은 지정된 본인 구글 계정에만 연결할 수 있습니다.', 403);
      }
      const repo = await storeFactory(saved.uid, ownerEmail);
      requireOwner(repo);
      const previous = await tokensFor(repo);
      const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token ? tokens.refresh_token : previous?.refresh_token;
      if (!refreshToken) throw fault('자동 백업에 필요한 구글 드라이브 권한을 허용하고 다시 연결해 주세요.', 409);
      await saveTokens(repo, { access_token: tokens.access_token, refresh_token: refreshToken,
        expiresAt: expiresAt(tokens.expires_in), accountSub: profile.sub });
      await repo.setSetting('backupError', null);
      return res.redirect(`${appURL.origin}/?connected=drive`);
    } catch (error) {
      return res.status(error.status || 502).send(error.status ? error.message : '구글 드라이브 연결을 완료하지 못했습니다. 설정을 확인하고 다시 시도해 주세요.');
    }
  }

  async function accessToken(repo) {
    const tokens = await tokensFor(repo);
    if (!tokens) throw fault('백업 설정에서 구글 드라이브를 먼저 연결해 주세요.', 409);
    if (tokens.access_token && Number(tokens.expiresAt) > Date.now() + 60000) return tokens.access_token;
    if (!tokens.refresh_token) throw fault('구글 드라이브를 다시 연결해 주세요.', 409);
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret,
        refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw fault('드라이브 권한을 갱신하지 못했습니다. 다시 연결해 주세요.', 502);
    const fresh = await response.json();
    if (typeof fresh.access_token !== 'string' || !fresh.access_token) throw fault('구글 드라이브 권한을 갱신하지 못했습니다.', 502);
    await saveTokens(repo, { ...tokens, access_token: fresh.access_token, expiresAt: expiresAt(fresh.expires_in) });
    return fresh.access_token;
  }

  async function acquireLease(repo) {
    const leaseRef = db.collection(ARCHIVES).doc(repo.uid).collection('settings').doc('driveBackupLease');
    const leaseID = randomUUID();
    const acquired = await db.runTransaction(async transaction => {
      const current = await transaction.get(leaseRef);
      if (current.exists && millis(current.data()?.expiresAt) > Date.now()) return false;
      transaction.set(leaseRef, { value: { id: leaseID }, expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
      return true;
    });
    if (!acquired) throw fault('드라이브 백업이 진행 중입니다. 잠시 후 백업 상태를 확인해 주세요.', 409);
    return async () => {
      await db.runTransaction(async transaction => {
        const current = await transaction.get(leaseRef);
        if (current.exists && current.data()?.value?.id === leaseID) transaction.delete(leaseRef);
      });
    };
  }

  async function backup(repo) {
    requireConfigured();
    requireOwner(repo);
    const releaseLease = await acquireLease(repo);
    try {
      const token = await accessToken(repo);
      const buffer = await captureBackup(repo);
      if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BACKUP_BYTES) throw fault('백업 파일은 200MB 이하여야 합니다.', 413);
      const headers = { Authorization: `Bearer ${token}` };
      let folder = await repo.getSetting('driveFolder');
      if (!fileID(folder)) folder = null;
      if (folder) {
        const check = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folder)}?fields=id,trashed`, { headers, signal: AbortSignal.timeout(20000) });
        if (check.status === 404) folder = null;
        else if (!check.ok) throw fault('드라이브 백업 폴더를 확인하지 못했습니다.', 502);
        else if ((await check.json()).trashed) folder = null;
      }
      if (!folder) {
        const response = await fetcher('https://www.googleapis.com/drive/v3/files?fields=id', {
          method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '나의 경력 보관함 백업', mimeType: 'application/vnd.google-apps.folder' }), signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw fault('드라이브 백업 폴더를 만들지 못했습니다.', 502);
        folder = (await response.json()).id;
        if (!fileID(folder)) throw fault('드라이브 백업 폴더 응답이 올바르지 않습니다.', 502);
        await repo.setSetting('driveFolder', folder);
      }
      const timestamp = new Date().toISOString();
      const name = `career-backup-${timestamp.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.zip`;
      const boundary = `career_${randomUUID()}`;
      const metadata = { name, parents: [folder] };
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`), buffer, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const response = await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
        method: 'POST', headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw fault('드라이브 백업 업로드에 실패했습니다.', 502);
      const result = await response.json();
      if (!fileID(result.id)) throw fault('드라이브 백업 완료 응답이 올바르지 않습니다.', 502);
      await repo.setSetting('lastBackup', timestamp);
      await repo.setSetting('backupError', null);
      return { ok: true, lastBackup: timestamp, name };
    } catch (error) {
      await repo.setSetting('backupError', error.status ? error.message : '드라이브 백업을 완료하지 못했습니다. 연결과 설정을 확인해 주세요.');
      throw error.status ? error : fault('드라이브 백업을 완료하지 못했습니다. 연결과 설정을 확인해 주세요.', 502);
    } finally {
      await releaseLease();
    }
  }

  async function disconnect(req, res) {
    const repo = req.repo;
    requireOwner(repo);
    const releaseLease = await acquireLease(repo);
    try {
      // Removing local tokens succeeds even if Google's revocation endpoint is
      // unavailable. A previously-created dated backup remains in the user's Drive.
      const tokens = await tokensFor(repo);
      await repo.setSetting('driveTokens', null);
      await repo.setSetting('driveFolder', null);
      await repo.setSetting('backupError', null);
      let revoked = false;
      if (tokens?.refresh_token || tokens?.access_token) {
        try {
          const response = await fetcher('https://oauth2.googleapis.com/revoke', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: tokens.refresh_token || tokens.access_token }), signal: AbortSignal.timeout(20000),
          });
          revoked = response.ok;
        } catch { /* Local disconnection is complete; no credentials are retained. */ }
      }
      return res.json({ ok: true, revoked });
    } finally { await releaseLease(); }
  }

  async function scheduledBackup() {
    if (!configured) return { skipped: 'drive-not-configured' };
    const accounts = await db.collection(ARCHIVES).where('email', '==', ownerEmail).get();
    const results = [];
    for (const document of accounts.docs) {
      const repo = await storeFactory(document.id, ownerEmail);
      if (!(await tokensFor(repo))) continue;
      try { results.push({ uid: document.id, ...(await backup(repo)) }); }
      catch (error) { results.push({ uid: document.id, ok: false, error: error.status ? error.message : '드라이브 백업을 완료하지 못했습니다.' }); }
    }
    return { results };
  }

  return { configured, status, start, callback, disconnect, backup, scheduledBackup };
}
