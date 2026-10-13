import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const CATEGORIES = ['강의·연수', '위원회·지원단', '연구·수상', '집필·콘텐츠', '근무·파견', '자격증', '기타'];
export const cleanText = (value, max = 10000) => String(value ?? '').trim().slice(0, max);
export function normalizeCareer(input, previous = {}) {
  const title = cleanText(input.title ?? previous.title, 300);
  if (!title) throw Object.assign(new Error('활동명을 입력해 주세요.'), { status: 400 });
  const category = input.category ?? previous.category ?? '기타';
  if (!CATEGORIES.includes(category)) throw Object.assign(new Error('유효하지 않은 경력 분류입니다.'), { status: 400 });
  const result = {
    id: previous.id || input.id || randomUUID(), title, category,
    organization: cleanText(input.organization ?? previous.organization, 300),
    role: cleanText(input.role ?? previous.role, 300),
    startDate: cleanText(input.startDate ?? previous.startDate, 10),
    endDate: cleanText(input.endDate ?? previous.endDate, 10),
    datePrecision: input.datePrecision ?? previous.datePrecision ?? 'day',
    description: cleanText(input.description ?? previous.description),
    tags: [...new Set((Array.isArray(input.tags) ? input.tags : previous.tags || []).map(tag => cleanText(tag, 60)).filter(Boolean))].slice(0, 30),
    evidenceStatus: input.evidenceStatus ?? previous.evidenceStatus ?? 'later',
    verified: input.verified ?? previous.verified ?? true,
    documentIds: [...new Set(Array.isArray(input.documentIds) ? input.documentIds : previous.documentIds || [])],
    source: cleanText(input.source ?? previous.source, 200),
  };
  for (const field of ['startDate', 'endDate']) {
    if (result[field] && !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(result[field])) {
      throw Object.assign(new Error('날짜는 YYYY, YYYY-MM 또는 YYYY-MM-DD 형식이어야 합니다.'), { status: 400 });
    }
    if (result[field].length === 10) {
      const parsed = new Date(`${result[field]}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result[field]) throw Object.assign(new Error('실제 존재하는 날짜를 입력해 주세요.'), { status: 400 });
    }
  }
  if (!['year', 'month', 'day'].includes(result.datePrecision) || !['attached', 'later', 'unneeded'].includes(result.evidenceStatus) || typeof result.verified !== 'boolean') throw Object.assign(new Error('경력 항목 형식이 올바르지 않습니다.'), { status: 400 });
  if (result.documentIds.length) result.evidenceStatus = 'attached';
  if (!result.documentIds.length && result.evidenceStatus === 'attached') result.evidenceStatus = 'later';
  return result;
}
export function publicDocument(document, careers) {
  const { storageName, sha256, ...visible } = document;
  return { ...visible, recordIds: careers.filter(c => c.documentIds.includes(document.id)).map(c => c.id) };
}
export class Store {
  constructor(dataDir, seedPath) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    mkdirSync(join(dataDir, 'originals'), { recursive: true, mode: 0o700 });
    this.dataDir = dataDir;
    this.db = new DatabaseSync(join(dataDir, 'archive.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS careers(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, sha256 TEXT UNIQUE NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);');
    if (!this.getSetting('initialized')) {
      let seeds = [];
      if (seedPath && existsSync(seedPath)) {
        const loaded = JSON.parse(readFileSync(seedPath, 'utf8'));
        seeds = Array.isArray(loaded) ? loaded : loaded.careers || [];
      }
      this.transaction(() => {
        for (const seed of seeds) this.putCareer(normalizeCareer({ ...seed, documentIds: [], verified: false, source: seed.source || '업로드한 경력 정리 PDF' }));
        this.setSetting('initialized', 'true');
      });
    }
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  careers() { return this.db.prepare('SELECT data FROM careers').all().map(row => JSON.parse(row.data)); }
  documents() { return this.db.prepare('SELECT data FROM documents').all().map(row => JSON.parse(row.data)); }
  career(id) { const row = this.db.prepare('SELECT data FROM careers WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  document(id) { const row = this.db.prepare('SELECT data FROM documents WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
  byHash(hash) { const row = this.db.prepare('SELECT data FROM documents WHERE sha256=?').get(hash); return row ? JSON.parse(row.data) : null; }
  putCareer(career) { this.db.prepare('INSERT OR REPLACE INTO careers(id,data) VALUES (?,?)').run(career.id, JSON.stringify(career)); }
  putDocument(document) { this.db.prepare('INSERT OR REPLACE INTO documents(id,sha256,data) VALUES (?,?,?)').run(document.id, document.sha256, JSON.stringify(document)); }
  deleteCareer(id) { this.db.prepare('DELETE FROM careers WHERE id=?').run(id); }
  deleteDocument(id) { this.db.prepare('DELETE FROM documents WHERE id=?').run(id); }
  getSetting(key) { return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || null; }
  setSetting(key, value) { if (value === null) this.db.prepare('DELETE FROM settings WHERE key=?').run(key); else this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(key, String(value)); }
  session(id) { const row = this.db.prepare('SELECT data,expires FROM sessions WHERE id=?').get(id); return row && row.expires > Date.now() ? JSON.parse(row.data) : null; }
  putSession(id, session, expires) { this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()); this.db.prepare('INSERT OR REPLACE INTO sessions(id,data,expires) VALUES (?,?,?)').run(id, JSON.stringify(session), expires); }
  deleteSession(id) { this.db.prepare('DELETE FROM sessions WHERE id=?').run(id); }
  close() { this.db.close(); }
}
