import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';
import { networkFetch } from '../auth.mjs';

const fault = (message, status = 400) => Object.assign(new Error(message), { status });
export function createFreeAuth(config, { fetcher = networkFetch, verifyJwt } = {}) {
  const projectId = String(config.projectId || '').trim(), owner = String(config.ownerEmail || '').trim().toLowerCase();
  const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'), { cacheMaxAge: 3600000, cooldownDuration: 30000, timeoutDuration: 10000, [customFetch]: fetcher });
  async function verifyToken(token) {
    if (!projectId || !owner) throw fault('Firebase 프로젝트와 본인 계정을 먼저 설정해 주세요.', 503);
    let claims;
    try { claims = verifyJwt ? await verifyJwt(token) : (await jwtVerify(token, keys, { algorithms: ['RS256'], issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, clockTolerance: 30 })).payload; }
    catch { throw fault('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401); }
    const uid = claims.sub;
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || claims.email_verified !== true || String(claims.email || '').trim().toLowerCase() !== owner || claims.firebase?.sign_in_provider !== 'google.com') throw fault('이 앱은 지정된 본인 구글 계정으로만 사용할 수 있습니다.', 403);
    const now = Date.now() / 1000;
    if (claims.iss !== `https://securetoken.google.com/${projectId}` || claims.aud !== projectId || typeof claims.exp !== 'number' || claims.exp < now - 30 || typeof claims.auth_time !== 'number' || claims.auth_time > now + 30 || typeof claims.iat !== 'number' || claims.iat > now + 30) throw fault('로그인 정보를 확인하지 못했습니다.', 401);
    return { uid, email: owner, name: String(claims.name || claims.email).slice(0, 100), token, firebase: claims.firebase };
  }
  async function identify(request) {
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') || '');
    if (!match) throw fault('본인 구글 계정으로 로그인해 주세요.', 401);
    return verifyToken(match[1]);
  }
  async function refreshFirebaseOwner(refreshToken, { uid } = {}) {
    if (!config.firebaseWebApiKey || typeof refreshToken !== 'string' || refreshToken.length < 20 || refreshToken.length > 10000) throw fault('자동 백업용 로그인 정보가 없습니다. 다시 로그인하고 드라이브를 연결해 주세요.', 409);
    const response = await fetcher(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.firebaseWebApiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw fault('자동 백업 로그인이 만료되었습니다. 다시 로그인하고 드라이브를 연결해 주세요.', 409);
    const result = await response.json(); const user = await verifyToken(result.id_token);
    if (uid && user.uid !== uid || result.user_id && result.user_id !== user.uid) throw fault('자동 백업 계정이 본인 로그인과 일치하지 않습니다.', 403);
    return { uid: user.uid, email: user.email, idToken: result.id_token, refreshToken: result.refresh_token || refreshToken };
  }
  return { verifyToken, identify, refreshFirebaseOwner };
}
