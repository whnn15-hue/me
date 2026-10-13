import { randomUUID } from 'node:crypto';
import { normalizeCareer } from '../store.mjs';

const fault = (message, status = 400) => Object.assign(new Error(message), { status });
const safeId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const stateFrom = (careers, documents) => ({ careers: new Map(careers.docs.map(doc => [doc.id, doc.data()])), documents: new Map(documents.docs.map(doc => [doc.id, doc.data()])) });

// Firestore transactions read one active version and its complete metadata before
// writing. Originals are immutable, so the returned snapshot remains exportable
// even when a different request deletes a record or activates a restored version.
export class CloudStore {
  constructor(db, uid, email, seeds = []) {
    if (!safeId(uid)) throw fault('로그인 계정 형식이 올바르지 않습니다.', 403);
    this.db = db; this.uid = uid; this.email = email; this.seeds = seeds;
    this.root = db.collection('careerArchives').doc(uid);
  }
  version(id) { return this.root.collection('versions').doc(id); }
  async ensureInitialized() {
    await this.db.runTransaction(async tx => {
      const root = await tx.get(this.root);
      if (root.exists) return;
      const activeVersion = randomUUID(); const version = this.version(activeVersion);
      const initial = Array.isArray(this.seeds) ? this.seeds : [];
      tx.set(this.root, { activeVersion, revision: 0, email: this.email, createdAt: new Date().toISOString() });
      tx.set(version, { createdAt: new Date().toISOString(), state: 'active' });
      for (const seed of initial) {
        const career = normalizeCareer({ ...seed, documentIds: [], verified: false, source: seed.source || '업로드한 경력 정리 PDF' });
        tx.set(version.collection('careers').doc(career.id), career);
      }
    });
  }
  async readTransaction(tx) {
    const rootSnapshot = await tx.get(this.root);
    if (!rootSnapshot.exists) throw fault('경력 보관함이 아직 준비되지 않았습니다.', 503);
    const root = rootSnapshot.data(); const version = this.version(root.activeVersion);
    const [careers, documents] = await Promise.all([tx.get(version.collection('careers')), tx.get(version.collection('documents'))]);
    return { ...stateFrom(careers, documents), root, version };
  }
  async snapshot() {
    await this.ensureInitialized();
    return this.db.runTransaction(async tx => {
      const state = await this.readTransaction(tx);
      return { careers: [...state.careers.values()], documents: [...state.documents.values()], activeVersion: state.root.activeVersion, revision: state.root.revision };
    });
  }
  async mutate(action) {
    await this.ensureInitialized();
    return this.db.runTransaction(async tx => {
      const state = await this.readTransaction(tx);
      const previous = { careers: new Map(state.careers), documents: new Map(state.documents) };
      const result = action(state);
      if (result && typeof result.then === 'function') throw new Error('CloudStore mutations must not perform asynchronous I/O');
      const writes = [];
      for (const name of ['careers', 'documents']) {
        for (const [id, value] of state[name]) if (!same(previous[name].get(id), value)) writes.push({ ref: state.version.collection(name).doc(id), value });
        for (const id of previous[name].keys()) if (!state[name].has(id)) writes.push({ ref: state.version.collection(name).doc(id) });
      }
      if (writes.length > 480) throw fault('한 번에 변경할 경력이 너무 많습니다. 연결된 경력을 나누어 수정해 주세요.', 413);
      for (const write of writes) write.value ? tx.set(write.ref, write.value) : tx.delete(write.ref);
      if (writes.length) tx.update(this.root, { revision: state.root.revision + 1, updatedAt: new Date().toISOString(), email: this.email });
      return result;
    });
  }
  async stageAndActivate(snapshot, expected) {
    const id = randomUUID(); const version = this.version(id);
    const records = [{ ref: version, value: { createdAt: new Date().toISOString(), state: 'staged' } }, ...snapshot.careers.map(value => ({ ref: version.collection('careers').doc(value.id), value })), ...snapshot.documents.map(value => ({ ref: version.collection('documents').doc(value.id), value }))];
    for (let offset = 0; offset < records.length; offset += 450) {
      const batch = this.db.batch();
      for (const record of records.slice(offset, offset + 450)) batch.set(record.ref, record.value);
      await batch.commit();
    }
    // Staging may take time. Refuse replacement if another request edited data
    // after restore began; a retry must capture a fresh explicit user request.
    await this.db.runTransaction(async tx => {
      const root = await tx.get(this.root); const actual = root.data();
      if (!root.exists || actual.activeVersion !== expected.activeVersion || actual.revision !== expected.revision) throw fault('복원 중 경력이 변경되어 현재 데이터를 보존했습니다. 다시 확인한 뒤 복원해 주세요.', 409);
      tx.update(this.root, { activeVersion: id, revision: actual.revision + 1, updatedAt: new Date().toISOString() });
      tx.update(version, { state: 'active' });
    });
    return { ok: true, careers: snapshot.careers.length, documents: snapshot.documents.length };
  }
  async getSetting(key) { const row = await this.root.collection('settings').doc(key).get(); return row.exists ? row.data().value : null; }
  async setSetting(key, value) { const ref = this.root.collection('settings').doc(key); if (value === null) await ref.delete(); else await ref.set({ value }); }
  upload(id) { if (!safeId(id)) throw fault('복원 업로드를 찾을 수 없습니다.', 404); return this.root.collection('restoreUploads').doc(id); }
}

export function ensureLinks(career, documents) {
  if (career.documentIds.some(id => typeof id !== 'string' || !documents.has(id))) throw fault('연결할 공문 파일을 찾을 수 없습니다.');
}
