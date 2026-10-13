import { networkFetch } from '../auth.mjs';
const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const decode = value => {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
};
export const decodeFields = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
export class FreeRestRepository {
  constructor({ projectId, uid, idToken, fetcher = networkFetch }) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || !/^[A-Za-z0-9-]+$/.test(projectId)) throw fault('경력 보관함 설정이 올바르지 않습니다.');
    this.uid = uid; this.idToken = idToken; this.fetcher = fetcher;
    this.base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/careerArchives/${uid}`;
  }
  async get(path = '') {
    const response = await this.fetcher(this.base + path, { headers: { Authorization: `Bearer ${this.idToken}` }, signal: AbortSignal.timeout(20000) });
    if (response.status === 404) return null;
    if (!response.ok) throw fault(response.status === 403 ? '경력 데이터를 읽을 권한이 없습니다. Firestore 보안 규칙을 확인해 주세요.' : '경력 데이터를 읽지 못했습니다.', response.status === 403 ? 403 : 502);
    return response.json();
  }
  async list(path) {
    const result = []; let token = '';
    do {
      const query = new URLSearchParams({ pageSize: '300' }); if (token) query.set('pageToken', token);
      const response = await this.get(`${path}?${query}`);
      for (const document of response?.documents || []) result.push({ ...decodeFields(document.fields), id: document.name.split('/').at(-1) });
      token = response?.nextPageToken || '';
      if (result.length > 100000) throw fault('경력 데이터가 백업 범위를 초과했습니다.', 413);
    } while (token);
    return result;
  }
  async snapshot() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const root = await this.get(); if (!root) return { careers: [], documents: [], revision: 0, activeVersion: null };
      const before = decodeFields(root.fields);
      if (typeof before.activeVersion !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(before.activeVersion)) throw fault('경력 보관함 버전이 올바르지 않습니다.');
      const base = `/versions/${before.activeVersion}`;
      const [careers, documents] = await Promise.all([this.list(base + '/careers'), this.list(base + '/documents')]);
      const afterDocument = await this.get(); const after = decodeFields(afterDocument?.fields);
      if (after.activeVersion === before.activeVersion && after.revision === before.revision) return { careers, documents, revision: before.revision, activeVersion: before.activeVersion };
    }
    throw fault('경력 수정이 진행 중이라 백업을 보류했습니다. 잠시 후 다시 시도해 주세요.', 409);
  }
}
