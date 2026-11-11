import { randomUUID } from 'node:crypto';

// A small Netlify-Blobs-compatible store backed by Upstash Redis over its REST
// API (Vercel Marketplace "Upstash for Redis" injects KV_REST_API_URL/TOKEN).
// Only the subset used by the private vault is implemented:
//   get(name, { type: 'json' }), getWithMetadata(name, { type: 'json' }),
//   setJSON(name, value, { onlyIfNew } | { onlyIfMatch }), delete(name).
// Every write is a Lua script so the conditional writes are atomic. Values are
// already encrypted by the vault before they reach this store.

const READ = "local v = redis.call('HGET', KEYS[1], 'v'); if not v then return nil end; return {v, redis.call('HGET', KEYS[1], 'e')}";
const WRITE = [
  "local mode = ARGV[3]",
  "if mode == 'new' and redis.call('EXISTS', KEYS[1]) == 1 then return 0 end",
  "if mode == 'match' and redis.call('HGET', KEYS[1], 'e') ~= ARGV[4] then return 0 end",
  "redis.call('HSET', KEYS[1], 'v', ARGV[1], 'e', ARGV[2])",
  'return 1',
].join('\n');

const fault = (message, status = 503) => Object.assign(new Error(message), { status, name: 'PrivateStoreError' });

export function redisStoreConfig(env = process.env) {
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const token = String(env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '');
  return url && token ? { url, token } : null;
}

export function createRedisStore({ name, url, token, fetcher = fetch }) {
  if (!name || !url || !token) throw fault('비공개 보관함(Redis) 설정을 확인해 주세요.');
  if (!/^https:\/\//.test(url)) throw fault('비공개 보관함 주소는 HTTPS여야 합니다.');
  const key = item => `${name}:${item}`;
  async function command(args) {
    let response;
    try {
      response = await fetcher(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    } catch { throw fault('비공개 보관함에 연결하지 못했습니다.'); }
    let data = null; try { data = await response.json(); } catch { /* handled below */ }
    // Never surface the upstream body: it may echo the command (and its key).
    if (!response.ok || !data || data.error) throw Object.assign(fault('비공개 보관함 요청을 처리하지 못했습니다.'), { upstreamStatus: response.status });
    return data.result;
  }
  const parse = raw => { try { return JSON.parse(raw); } catch { throw fault('비공개 보관함 데이터를 읽지 못했습니다.'); } };
  async function getWithMetadata(item) {
    const result = await command(['EVAL', READ, '1', key(item)]);
    if (!Array.isArray(result) || result[0] == null) return null;
    return { data: parse(result[0]), etag: result[1] || null };
  }
  return {
    async get(item) { return (await getWithMetadata(item))?.data ?? null; },
    getWithMetadata,
    async setJSON(item, value, conditions = {}) {
      const etag = randomUUID();
      const mode = conditions.onlyIfNew ? 'new' : conditions.onlyIfMatch ? 'match' : 'any';
      const result = await command(['EVAL', WRITE, '1', key(item), JSON.stringify(value), etag, mode, String(conditions.onlyIfMatch || '')]);
      const modified = Number(result) === 1;
      return { modified, etag: modified ? etag : undefined };
    },
    async delete(item) { await command(['DEL', key(item)]); },
  };
}
