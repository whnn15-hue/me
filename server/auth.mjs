import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fetch, EnvHttpProxyAgent } from 'undici';

const isLoopback = host => ['localhost', '127.0.0.1', '[::1]', '::1', '::ffff:127.0.0.1'].includes(String(host).toLowerCase());
const hash = value => createHash('sha256').update(value).digest('hex');
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')).filter(pair => pair.length === 2));
let proxyDispatcher;
export function networkFetch(url, options = {}) {
  if ((process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) && !proxyDispatcher) proxyDispatcher = new EnvHttpProxyAgent();
  return fetch(url, { ...options, ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}) });
}
export class Auth {
  constructor(store, config) {
    this.store = store; this.config = config; this.states = new Map();
    this.local = config.localMode === true;
    this.owner = String(config.ownerEmail || '').trim().toLowerCase();
    try { this.url = new URL(config.appUrl); } catch { this.url = null; }
    this.configured = Boolean(config.googleClientId && config.googleClientSecret && this.owner && this.url && (this.url.protocol === 'https:' || this.url.protocol === 'http:' && isLoopback(this.url.hostname)));
    const keyPath = join(store.dataDir, 'encryption.key');
    if (config.encryptionKey) this.key = createHash('sha256').update(config.encryptionKey).digest();
    else {
      try { this.key = readFileSync(keyPath); }
      catch { this.key = randomBytes(32); writeFileSync(keyPath, this.key, { mode: 0o600, flag: 'wx' }); }
      chmodSync(keyPath, 0o600);
      if (this.key.length !== 32) throw new Error('저장된 암호화 키 형식이 올바르지 않습니다.');
    }
  }
  encrypt(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64'); }
  decrypt(value) { if (!value) return null; try { const data = Buffer.from(value, 'base64'); const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(-16)); return JSON.parse(Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString()); } catch { return null; } }
  tokens() { return this.decrypt(this.store.getSetting('driveTokens')); }
  saveTokens(tokens) { this.store.setSetting('driveTokens', this.encrypt(tokens)); }
  localRequest(req) {
    let host;
    try { host = new URL(`http://${req.headers.host || ''}`).hostname; } catch { return false; }
    return isLoopback(host) && isLoopback(req.socket.remoteAddress);
  }
  session(req) { const cookie = cookies(req).career_session; return cookie ? this.store.session(hash(cookie)) : null; }
  accessible(req) { return this.local ? this.localRequest(req) : this.configured && this.session(req)?.email === this.owner; }
  status(req) { return { mode: this.local ? 'local' : 'google', user: this.accessible(req) && this.owner && this.session(req)?.email === this.owner ? this.session(req) : null, googleConfigured: this.configured, ownerConfigured: Boolean(this.owner), aiConfigured: Boolean(this.config.aiKey), driveConnected: this.accessible(req) && Boolean(this.tokens()?.refresh_token || this.tokens()?.access_token), lastBackup: this.accessible(req) ? this.store.getSetting('lastBackup') : null, ...(this.accessible(req) && this.store.getSetting('backupError') ? { backupError: this.store.getSetting('backupError') } : {}) }; }
  accessMiddleware(req, res, next) {
    if (!this.accessible(req)) return res.status(this.local ? 403 : this.configured ? 401 : 503).json({ error: this.local ? '로컬 모드는 이 컴퓨터의 localhost에서만 접근할 수 있습니다.' : this.configured ? '본인 구글 계정으로 로그인해 주세요.' : '외부 접속에는 APP_URL, OWNER_EMAIL과 구글 로그인 설정이 필요합니다.' });
    next();
  }
  csrfMiddleware(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        const url = new URL(origin);
        const allowed = this.local ? isLoopback(url.hostname) && this.localRequest(req) && (!this.url || url.origin === this.url.origin) : this.url && url.origin === this.url.origin;
        if (!allowed) throw new Error('bad origin');
      } catch { return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' }); }
    } else if (!this.localRequest(req) && req.headers['sec-fetch-site'] !== 'same-origin') return res.status(403).json({ error: '요청 출처를 확인할 수 없습니다.' });
    next();
  }
  register(app) {
    app.get('/api/status', (req, res) => res.json(this.status(req)));
    const start = purpose => (req, res) => {
      if (!this.configured) return res.status(503).json({ error: 'APP_URL, OWNER_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET을 설정해 주세요.' });
      if (this.local && !this.localRequest(req)) return res.status(403).json({ error: '로컬 접근만 허용됩니다.' });
      if (purpose === 'drive' && !this.accessible(req)) return res.status(401).json({ error: '먼저 로그인해 주세요.' });
      const state = randomBytes(32).toString('hex'); const verifier = randomBytes(32).toString('base64url');
      for (const [id, stored] of this.states) if (stored.expires < Date.now()) this.states.delete(id);
      this.states.set(state, { purpose, verifier, expires: Date.now() + 10 * 60000 });
      res.cookie('career_oauth', state, { httpOnly: true, sameSite: 'lax', secure: this.url.protocol === 'https:', maxAge: 10 * 60000, path: '/api/auth' });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      Object.entries({ client_id: this.config.googleClientId, redirect_uri: `${this.url.origin}/api/auth/callback`, response_type: 'code', scope: `openid email profile${purpose === 'drive' ? ' https://www.googleapis.com/auth/drive.file' : ''}`, state, access_type: 'offline', prompt: purpose === 'drive' ? 'consent' : 'select_account', code_challenge: hashBase64(verifier), code_challenge_method: 'S256' }).forEach(([key, value]) => url.searchParams.set(key, value));
      res.redirect(url.toString());
    };
    app.get('/api/auth/google', start('login'));
    app.get('/api/auth/drive', start('drive'));
    app.get('/api/auth/callback', async (req, res) => {
      const state = String(req.query.state || ''); const cookie = cookies(req).career_oauth || ''; const saved = this.states.get(state); this.states.delete(state);
      res.clearCookie('career_oauth', { path: '/api/auth', httpOnly: true, sameSite: 'lax', secure: this.url?.protocol === 'https:' });
      if (!saved || saved.expires < Date.now() || state.length !== cookie.length || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie)) || !req.query.code) return res.status(400).send('로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.');
      try {
        const response = await networkFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: String(req.query.code), client_id: this.config.googleClientId, client_secret: this.config.googleClientSecret, redirect_uri: `${this.url.origin}/api/auth/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier }), signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('token exchange failed');
        const tokens = await response.json();
        const profileResponse = await networkFetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(20000) });
        if (!profileResponse.ok) throw new Error('profile failed');
        const profile = await profileResponse.json();
        if (!profile.email_verified || String(profile.email).toLowerCase() !== this.owner) return res.status(403).send('이 앱은 지정된 본인 계정으로만 사용할 수 있습니다.');
        if (saved.purpose === 'drive') {
          if (!String(tokens.scope || '').split(' ').includes('https://www.googleapis.com/auth/drive.file')) throw new Error('drive scope missing');
          const previous = this.tokens() || {};
          this.saveTokens({ access_token: tokens.access_token, refresh_token: tokens.refresh_token || previous.refresh_token, expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 });
        }
        const sessionId = randomBytes(32).toString('base64url'); const maxAge = 14 * 86400000;
        this.store.putSession(hash(sessionId), { name: String(profile.name || profile.email).slice(0, 100), email: this.owner }, Date.now() + maxAge);
        res.cookie('career_session', sessionId, { httpOnly: true, sameSite: 'lax', secure: this.url.protocol === 'https:', maxAge, path: '/' });
        res.redirect(`${this.url.origin}/?connected=${saved.purpose}`);
      } catch { res.status(502).send('구글 연결을 완료하지 못했습니다. 로그인 및 리디렉션 설정을 확인한 후 다시 시도해 주세요.'); }
    });
    app.post('/api/auth/logout', this.accessMiddleware.bind(this), this.csrfMiddleware.bind(this), (req, res) => { const token = cookies(req).career_session; if (token) this.store.deleteSession(hash(token)); res.clearCookie('career_session', { httpOnly: true, sameSite: 'lax', secure: this.url?.protocol === 'https:', path: '/' }); res.json({ ok: true }); });
    app.post('/api/auth/drive/disconnect', this.accessMiddleware.bind(this), this.csrfMiddleware.bind(this), (req, res) => { this.store.setSetting('driveTokens', null); this.store.setSetting('driveFolder', null); this.store.setSetting('backupError', null); res.json({ ok: true }); });
  }
  async driveAccessToken() {
    const tokens = this.tokens(); if (!tokens) throw Object.assign(new Error('백업 설정에서 구글 드라이브를 먼저 연결해 주세요.'), { status: 409 });
    if (tokens.access_token && tokens.expiresAt > Date.now() + 60000) return tokens.access_token;
    if (!tokens.refresh_token) throw Object.assign(new Error('구글 드라이브를 다시 연결해 주세요.'), { status: 409 });
    const response = await networkFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.config.googleClientId, client_secret: this.config.googleClientSecret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Object.assign(new Error('드라이브 권한을 갱신하지 못했습니다. 다시 연결해 주세요.'), { status: 502 });
    const newTokens = await response.json(); this.saveTokens({ ...tokens, access_token: newTokens.access_token, expiresAt: Date.now() + Number(newTokens.expires_in || 3600) * 1000 }); return newTokens.access_token;
  }
}
function hashBase64(value) { return createHash('sha256').update(value).digest('base64url'); }
