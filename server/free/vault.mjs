import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const KEY_NAME = '__private_vault_key_v1';
const aad = key => Buffer.from(`career-archive-vault-v1:${key}`);

// The named Blobs store is site-scoped and accessed only from Netlify Functions.
// Every value is encrypted; its randomly generated key stays in the same private
// server vault and is never returned to the browser or committed into the repo.
export async function createPrivateVault(store) {
  let entry = await store.get(KEY_NAME, { type: 'json', consistency: 'strong' });
  if (!entry) {
    const candidate = { key: randomBytes(32).toString('base64'), createdAt: new Date().toISOString() };
    const created = await store.setJSON(KEY_NAME, candidate, { onlyIfNew: true });
    entry = created.modified ? candidate : await store.get(KEY_NAME, { type: 'json', consistency: 'strong' });
  }
  const key = Buffer.from(entry?.key || '', 'base64');
  if (key.length !== 32) throw fault('비공개 백업 보관함을 열지 못했습니다.', 503);
  function encrypt(value, name) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad(name));
    return { version: 1, ciphertext: Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64') };
  }
  function decrypt(envelope, name) {
    if (!envelope) return null;
    try {
      if (envelope.version !== 1) throw new Error('version');
      const bytes = Buffer.from(envelope.ciphertext, 'base64'); const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAAD(aad(name)); decipher.setAuthTag(bytes.subarray(-16));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8'));
    } catch { throw fault('저장된 연결 정보를 열지 못했습니다. 구글 드라이브를 다시 연결해 주세요.', 409); }
  }
  const validateKey = name => { if (typeof name !== 'string' || name === KEY_NAME || name.length > 300 || /[\u0000-\u001f]/.test(name)) throw fault('보관함 항목이 올바르지 않습니다.'); };
  const read = async name => { validateKey(name); const row = await store.getWithMetadata(name, { type: 'json', consistency: 'strong' }); return row ? { value: decrypt(row.data, name), etag: row.etag } : null; };
  const write = async (name, value, conditions = {}) => { validateKey(name); return store.setJSON(name, encrypt(value, name), conditions); };
  return {
    async getJSON(name) { return (await read(name))?.value ?? null; },
    async setJSON(name, value) { await write(name, value); },
    async deleteJSON(name) { validateKey(name); await store.delete(name); },
    async consumeJSON(name) {
      const row = await read(name); if (!row || row.value?.consumed) return null;
      if (!row.etag) throw fault('연결 요청을 안전하게 확인하지 못했습니다.', 503);
      const result = await write(name, { consumed: true, consumedAt: Date.now() }, { onlyIfMatch: row.etag });
      return result.modified ? row.value : null;
    },
    async acquireLease(name, ttlMs = 600000) {
      const keyName = `leases/${name}`; const row = await read(keyName); const leaseId = randomUUID();
      if (row?.value?.expiresAt > Date.now()) throw fault('작업이 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.', 409);
      const conditions = row ? { onlyIfMatch: row.etag } : { onlyIfNew: true };
      if (row && !row.etag) throw fault('백업 작업을 안전하게 잠그지 못했습니다.', 503);
      const result = await write(keyName, { leaseId, expiresAt: Date.now() + ttlMs }, conditions);
      if (!result.modified) throw fault('작업이 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.', 409);
      return async () => {
        const current = await read(keyName);
        if (current?.value?.leaseId === leaseId && current.etag) await write(keyName, { released: true, expiresAt: 0 }, { onlyIfMatch: current.etag });
      };
    },
  };
}
