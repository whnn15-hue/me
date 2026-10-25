export const WORKSPACE_KINDS = ['project', 'material', 'course', 'assignment', 'paper', 'idea', 'photo', 'submission'];
export const WORKSPACE_ROW_PREFIX = '__workspace_';
export const WORKSPACE_ROW_TAG = 'introduce-me-workspace';
export const MAX_WORKSPACE_ITEMS = 5000;
export const MAX_WORKSPACE_LINKS = 10000;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const encoder = new TextEncoder();
const size = value => encoder.encode(JSON.stringify(value)).byteLength;
const object = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('학습 기록의 객체 형식이 올바르지 않습니다.');
  return value;
};
export const validWorkspaceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) && !value.startsWith(WORKSPACE_ROW_PREFIX);
const text = (value, max = 20000) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) fail('학습 기록의 텍스트 형식 또는 길이를 확인해 주세요.');
  return value.trim();
};
const list = (value, max, map) => {
  const input = value ?? [];
  if (!Array.isArray(input) || input.length > max) fail('학습 기록 목록의 개수가 제한을 초과했습니다.');
  return input.map(map);
};
const strings = (value, max = 30, length = 60) => [...new Set(list(value, max, item => text(item, length)).filter(Boolean))];
function date(value) {
  const result = text(value, 10);
  if (result && !/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/.test(result)) fail('날짜는 YYYY, YYYY-MM 또는 YYYY-MM-DD 형식으로 입력해 주세요.');
  if (result.length === 10 && new Date(result + 'T00:00:00Z').toISOString().slice(0, 10) !== result) fail('실제 존재하는 날짜를 입력해 주세요.');
  return result;
}
function timestamp(value, fallback) {
  const result = value == null || value === '' ? fallback : text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) fail('학습 기록 시각이 올바르지 않습니다.');
  return result;
}
export function normalizeWorkspaceUrl(value, { httpsOnly = false, driveOnly = false } = {}) {
  const result = text(value, 2000); if (!result) return '';
  let url;
  try { url = new URL(result); } catch { fail('올바른 웹 주소를 입력해 주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || httpsOnly && url.protocol !== 'https:' || url.username || url.password)
    fail(httpsOnly ? 'HTTPS 웹 주소를 입력해 주세요.' : 'HTTP 또는 HTTPS 웹 주소만 저장할 수 있습니다.');
  if (driveOnly && (!['drive.google.com', 'docs.google.com'].includes(url.hostname.toLowerCase()) || url.protocol !== 'https:' || url.port))
    fail('구글 드라이브 또는 구글 문서의 HTTPS 공유 주소를 입력해 주세요.');
  return url.href;
}
export function workspaceItemRef(item) { return `${item.kind}:${item.id}`; }
// JSON imports can reuse an existing original under a different ID. Translate
// photo/report references too, after the caller has verified the actual bytes.
export function translateWorkspaceOriginals(workspace, resolve) {
  return { ...workspace, items: workspace.items.map(item => {
    if (item.kind === 'photo') {
      const documentId = resolve(item.documentId, item.sha256);
      if (!documentId) fail('사진 원본을 확인하지 못했습니다. 원본이 포함된 ZIP을 먼저 복원해 주세요.');
      return { ...item, documentId };
    }
    if (item.kind === 'submission') return { ...item, documentIds: item.documentIds.map(id => {
      const translated = resolve(id);
      if (!translated) fail('제출본 원본을 확인하지 못했습니다. 원본이 포함된 ZIP을 먼저 복원해 주세요.');
      return translated;
    }) };
    return item;
  }) };
}
export function parseWorkspaceRef(value) {
  if (typeof value !== 'string') fail('연결할 기록의 주소가 올바르지 않습니다.');
  const match = /^(career|project|material|course|assignment|paper|idea|photo|submission):([A-Za-z0-9_-]{1,100})$/.exec(value);
  if (!match || match[1] !== 'career' && !validWorkspaceId(match[2])) fail('연결할 기록의 주소가 올바르지 않습니다.');
  return { kind: match[1], id: match[2] };
}
export function emptyWorkspace(revision = 0) { return { schemaVersion: 1, items: [], links: [], revision }; }
export function normalizeWorkspaceItem(value, previous) {
  const input = object(value), old = previous ? object(previous) : {}, merged = { ...old, ...input };
  const id = previous?.id || merged.id || crypto.randomUUID();
  if (!validWorkspaceId(id) || !WORKSPACE_KINDS.includes(merged.kind) || previous && merged.kind !== previous.kind) fail('학습 기록의 ID 또는 종류가 올바르지 않습니다.');
  const now = new Date().toISOString();
  const result = { id, kind: merged.kind, title: text(merged.title, 300), tags: strings(merged.tags),
    createdAt: timestamp(previous?.createdAt ?? merged.createdAt, now), updatedAt: timestamp(merged.updatedAt, now) };
  if (merged.favorite !== undefined) {
    if (typeof merged.favorite !== 'boolean') fail('즐겨찾기 값이 올바르지 않습니다.');
    result.favorite = merged.favorite;
  }
  if (!result.title) fail('기록 제목을 입력해 주세요.');
  const linkList = (value, max, httpsOnly = false) => list(value, max, entry => {
    const input = object(entry); return { label: text(input.label, 300), url: normalizeWorkspaceUrl(input.url, { httpsOnly }) };
  });
  switch (result.kind) {
    case 'photo': {
      const documentId = text(merged.documentId, 100), sha256 = text(merged.sha256, 64);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(documentId) || !/^[a-f0-9]{64}$/.test(sha256)
        || typeof merged.reviewed !== 'boolean' || !Number.isInteger(merged.star) || merged.star < 0 || merged.star > 3) fail('사진 원본과 검토 상태를 확인해 주세요.');
      Object.assign(result, { documentId, sha256, caption: text(merged.caption, 2000), reviewed: merged.reviewed, star: merged.star }); break;
    }
    case 'submission': {
      const status = merged.status ?? 'preparing', year = text(merged.year, 4);
      if (!['preparing', 'submitted', 'result'].includes(status) || year && !/^\d{4}$/.test(year)) fail('제출 상태와 연도를 확인해 주세요.');
      const documentIds = strings(merged.documentIds, 100, 100);
      if (documentIds.some(id => !/^[A-Za-z0-9_-]{1,100}$/.test(id))) fail('제출 파일 연결을 확인해 주세요.');
      const slots = list(merged.slots, 30, entry => {
        const input = object(entry), id = text(input.id, 80), photoId = text(input.photoId, 80);
        if (!validWorkspaceId(id) || photoId && !validWorkspaceId(photoId)) fail('사진 배치 정보를 확인해 주세요.');
        return { id, title: text(input.title, 300), tags: strings(input.tags), quote: text(input.quote, 2000), photoId, caption: text(input.caption, 2000) };
      });
      const selected = slots.filter(slot => slot.photoId).map(slot => slot.photoId);
      if (new Set(slots.map(slot => slot.id)).size !== slots.length || new Set(selected).size !== selected.length) fail('한 제출본 안에서는 같은 사진을 한 번만 배치해 주세요.');
      Object.assign(result, { competition: text(merged.competition, 300), year, status, submittedOn: date(merged.submittedOn),
        result: text(merged.result, 2000), documentIds, brief: text(merged.brief, 30000), slots }); break;
    }
    case 'project': Object.assign(result, {
      schoolYear: text(merged.schoolYear, 100), grade: text(merged.grade, 100), startDate: date(merged.startDate), endDate: date(merged.endDate),
      subjects: list(merged.subjects, 100, entry => ({ subject: text(object(entry).subject, 300), unit: text(entry.unit, 300) })),
      drivingQuestion: text(merged.drivingQuestion), lessonFlow: text(merged.lessonFlow), activities: text(merged.activities),
      tools: strings(merged.tools, 50, 100), outputs: linkList(merged.outputs, 50), photos: linkList(merged.photos, 100, true), reflection: text(merged.reflection),
    }); if (result.startDate && result.endDate && result.endDate < result.startDate) fail('종료일이 시작일보다 빠릅니다.'); break;
    case 'material': {
      const ownership = merged.ownership ?? 'created', format = merged.format ?? '기타';
      if (!['created', 'collected'].includes(ownership) || !['PPT', 'PDF', 'HWP', 'TXT', 'HTML', '영상', '기타'].includes(format)) fail('자료 종류를 확인해 주세요.');
      // Legacy material rows stay byte-for-byte shaped as before. An absent
      // purpose is interpreted as lecture by the view, not persisted here.
      if (merged.purpose !== undefined) {
        if (!['classroom', 'lecture'].includes(merged.purpose)) fail('자료를 보관할 곳을 확인해 주세요.');
        result.purpose = merged.purpose;
      }
      for (const field of ['subjects', 'trainings']) if (merged[field] !== undefined) result[field] = strings(merged[field], 30, 100);
      if (merged.sourceFile !== undefined) {
        const file = object(merged.sourceFile);
        if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 25 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) fail('자료 원본 정보를 확인해 주세요.');
        result.sourceFile = {name:text(file.name,300),size:file.size,sha256:file.sha256};
      }
      Object.assign(result, { ownership, author: text(merged.author, 300), eventName: text(merged.eventName, 300), date: date(merged.date),
        audience: strings(merged.audience, 50, 100), format, fileUrl: normalizeWorkspaceUrl(merged.fileUrl, { httpsOnly: true, driveOnly: true }), summary: text(merged.summary) }); break;
    }
    case 'course': Object.assign(result, { semester: text(merged.semester, 100), professor: text(merged.professor, 300) }); break;
    case 'assignment': {
      const status = merged.status ?? 'planned', courseId = text(merged.courseId, 80);
      if (!['planned', 'in-progress', 'submitted'].includes(status) || courseId && !validWorkspaceId(courseId)) fail('과제 상태 또는 과목 연결을 확인해 주세요.');
      Object.assign(result, { courseId, dueDate: date(merged.dueDate), status, submissionUrl: normalizeWorkspaceUrl(merged.submissionUrl) }); break;
    }
    case 'paper': Object.assign(result, { authors: text(merged.authors, 2000), year: text(merged.year, 4), summary: text(merged.summary), thoughts: text(merged.thoughts),
      quotations: list(merged.quotations, 100, entry => ({ text: text(object(entry).text, 5000), page: text(entry.page, 100) })), courseIds: strings(merged.courseIds, 100, 80) });
      if (result.year && !/^\d{4}$/.test(result.year) || result.courseIds.some(id => !validWorkspaceId(id))) fail('논문 연도 또는 과목 연결을 확인해 주세요.'); break;
    case 'idea': Object.assign(result, { body: text(merged.body) }); break;
  }
  if (size(result) > 128 * 1024) fail('기록 한 건의 크기가 128 KB를 초과합니다.', 413);
  return result;
}
export function normalizeWorkspace(value, { careerIds = [], revision, pruneMissingCareerLinks = false } = {}) {
  const input = object(value ?? emptyWorkspace());
  if (input.schemaVersion !== 1) fail('지원하지 않는 학습 기록 버전입니다.');
  const actualRevision = revision ?? input.revision ?? 0;
  if (!Number.isSafeInteger(actualRevision) || actualRevision < 0) fail('학습 기록 버전이 올바르지 않습니다.');
  const items = list(input.items, MAX_WORKSPACE_ITEMS, item => normalizeWorkspaceItem(item));
  const refs = new Set(items.map(workspaceItemRef)), ids = new Set(items.map(item => item.id));
  if (ids.size !== items.length) fail('중복된 학습 기록 ID가 있습니다.');
  for (const id of careerIds) { parseWorkspaceRef(`career:${id}`); refs.add(`career:${id}`); }
  const courses = new Set(items.filter(item => item.kind === 'course').map(item => item.id));
  const photos = new Set(items.filter(item => item.kind === 'photo').map(item => item.id));
  for (const item of items) {
    if (item.kind === 'submission' && item.slots.some(slot => slot.photoId && !photos.has(slot.photoId))) fail('제출본에 연결한 사진을 찾을 수 없습니다.');
    if (item.kind === 'assignment' && item.courseId && !courses.has(item.courseId) || item.kind === 'paper' && item.courseIds.some(id => !courses.has(id))) fail('연결된 대학원 과목을 찾을 수 없습니다.');
  }
  const keys = new Set(), links = [];
  for (const value of list(input.links, MAX_WORKSPACE_LINKS, object)) {
    const from = value.from, to = value.to;
    const first = parseWorkspaceRef(from), second = parseWorkspaceRef(to);
    if (from === to) fail('같은 기록끼리 연결할 수 없습니다.');
    if (!refs.has(from) || !refs.has(to)) {
      const missing = [!refs.has(from) && first, !refs.has(to) && second].filter(Boolean);
      if (pruneMissingCareerLinks && missing.every(ref => ref.kind === 'career')) continue;
      fail('연결할 경력 또는 학습 기록을 찾을 수 없습니다.');
    }
    const [a, b] = [from, to].sort(), key = `${a}\n${b}`;
    if (!keys.has(key)) { keys.add(key); links.push({ from: a, to: b }); }
  }
  links.sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0);
  const result = { schemaVersion: 1, items, links, revision: actualRevision };
  if (size(result) > 5 * 1024 * 1024) fail('학습 기록 전체 크기가 5 MB를 초과합니다.', 413);
  return result;
}
export function mutateWorkspace(workspace, mutation, careers) {
  const current = normalizeWorkspace(workspace, { careerIds: careers.map(item => item.id) });
  if (!Number.isSafeInteger(mutation.expectedRevision) || mutation.expectedRevision !== current.revision || current.revision === Number.MAX_SAFE_INTEGER) fail('다른 화면에서 기록이 변경되었습니다. 새로 불러온 뒤 다시 시도해 주세요.', 409);
  let items = current.items, links = current.links;
  if (mutation.operation === 'delete') {
    const previous = items.find(item => item.id === mutation.id); if (!previous) fail('삭제할 기록을 찾을 수 없습니다.', 404);
    if (previous.kind === 'photo' && items.some(item => item.kind === 'submission' && item.slots.some(slot => slot.photoId === previous.id))) fail('제출본에서 사용 중인 사진입니다. 제출본에서 연결을 해제한 뒤 삭제해 주세요.', 409);
    const ref = workspaceItemRef(previous);
    items = items.filter(item => item.id !== previous.id).map(item => {
      if (previous.kind !== 'course') return item;
      if (item.kind === 'assignment' && item.courseId === previous.id) return { ...item, courseId: '', updatedAt: new Date().toISOString() };
      if (item.kind === 'paper' && item.courseIds.includes(previous.id)) return { ...item, courseIds: item.courseIds.filter(id => id !== previous.id), updatedAt: new Date().toISOString() };
      return item;
    });
    links = links.filter(link => link.from !== ref && link.to !== ref);
  } else {
    if (!['create', 'update'].includes(mutation.operation)) fail('학습 기록 작업을 확인해 주세요.');
    const previous = mutation.operation === 'update' ? items.find(item => item.id === mutation.id) : undefined;
    if (mutation.operation === 'update' && !previous) fail('수정할 기록을 찾을 수 없습니다.', 404);
    if (!Array.isArray(mutation.links)) fail('연결할 기록 목록을 확인해 주세요.');
    const item = normalizeWorkspaceItem({ ...object(mutation.item), updatedAt: new Date().toISOString() }, previous);
    if (!previous && items.some(existing => existing.id === item.id)) fail('이미 사용 중인 학습 기록 ID입니다.', 409);
    items = previous ? items.map(existing => existing.id === previous.id ? item : existing) : [...items, item];
    const ref = workspaceItemRef(item);
    links = links.filter(link => link.from !== ref && link.to !== ref);
    for (const target of strings(mutation.links, 1000, 110)) { parseWorkspaceRef(target); links.push({ from: ref, to: target }); }
  }
  return normalizeWorkspace({ schemaVersion: 1, items, links, revision: current.revision + 1 }, { careerIds: careers.map(item => item.id) });
}
export function mergeWorkspaceData(current, incoming, careers) {
  const careerIds = careers.map(item => item.id);
  const old = normalizeWorkspace(current, { careerIds }), next = normalizeWorkspace(incoming, { careerIds });
  const items = [...old.items], existing = new Map(items.map(item => [item.id, item])), conflicts = [];
  let addedItems = 0;
  for (const item of next.items) {
    const previous = existing.get(item.id);
    if (previous) { if (JSON.stringify(previous) !== JSON.stringify(item)) conflicts.push({ ref: workspaceItemRef(item), reason: '현재 기록을 유지했습니다.' }); }
    else { items.push(item); existing.set(item.id, item); addedItems++; }
  }
  const courses = new Set(items.filter(item => item.kind === 'course').map(item => item.id));
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.kind === 'assignment' && item.courseId && !courses.has(item.courseId)) {
      conflicts.push({ ref: workspaceItemRef(item), reason: '현재 기록과 과목 ID가 충돌하여 과목 연결을 제외했습니다.' });
      items[index] = { ...item, courseId: '' };
    } else if (item.kind === 'paper' && item.courseIds.some(id => !courses.has(id))) {
      conflicts.push({ ref: workspaceItemRef(item), reason: '현재 기록과 과목 ID가 충돌하여 해당 과목 연결을 제외했습니다.' });
      items[index] = { ...item, courseIds: item.courseIds.filter(id => courses.has(id)) };
    }
  }
  const refs = new Set([...items.map(workspaceItemRef), ...careerIds.map(id => `career:${id}`)]);
  const links = [...old.links];
  for (const link of next.links) {
    if (!refs.has(link.from) || !refs.has(link.to)) { conflicts.push({ ref: `${link.from} / ${link.to}`, reason: '현재 기록 종류와 다른 연결을 제외했습니다.' }); continue; }
    links.push(link);
  }
  const uniqueLinks = new Map();
  for (const link of links) {
    const [from, to] = [link.from, link.to].sort();
    uniqueLinks.set(`${from}\n${to}`, { from, to });
  }
  const workspace = normalizeWorkspace({ schemaVersion: 1, items, links: [...uniqueLinks.values()], revision: old.revision }, { careerIds });
  return { workspace, conflicts, added: { items: addedItems, links: workspace.links.length - old.links.length } };
}
export function isWorkspaceMetadataRow(row) { return typeof row?.id === 'string' && row.id.startsWith(WORKSPACE_ROW_PREFIX) || row?.rowKind === WORKSPACE_ROW_TAG; }
export function workspaceToRows(workspace) {
  const chunks = []; for (let index = 0; index < workspace.links.length; index += 100) chunks.push(workspace.links.slice(index, index + 100));
  return [
    { id: '__workspace_meta_v1', rowKind: WORKSPACE_ROW_TAG, rowType: 'meta', schemaVersion: 1, itemCount: workspace.items.length, linkChunks: chunks.length },
    ...workspace.items.map(item => ({ id: `__workspace_item_${item.id}`, rowKind: WORKSPACE_ROW_TAG, rowType: 'item', schemaVersion: 1, item })),
    ...chunks.map((links, index) => ({ id: `__workspace_links_${index}`, rowKind: WORKSPACE_ROW_TAG, rowType: 'links', schemaVersion: 1, links })),
  ];
}
export function workspaceFromRows(rows, careerIds, revision = 0) {
  if (!rows.length) return emptyWorkspace(revision);
  const meta = rows.find(row => row.id === '__workspace_meta_v1');
  if (!meta || meta.rowKind !== WORKSPACE_ROW_TAG || meta.rowType !== 'meta' || meta.schemaVersion !== 1 || !Number.isSafeInteger(meta.itemCount) || meta.itemCount < 0 || meta.itemCount > MAX_WORKSPACE_ITEMS || !Number.isSafeInteger(meta.linkChunks) || meta.linkChunks < 0 || meta.linkChunks > 100) fail('학습 기록 저장 정보를 읽을 수 없습니다.');
  const items = [], chunks = new Map(), ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id) || row.rowKind !== WORKSPACE_ROW_TAG || row.schemaVersion !== 1) fail('중복되거나 손상된 학습 기록 저장 항목입니다.');
    ids.add(row.id);
    if (row.id === meta.id) continue;
    if (row.rowType === 'item' && row.id === `__workspace_item_${row.item?.id}`) items.push(row.item);
    else if (row.rowType === 'links' && /^__workspace_links_(0|[1-9]\d*)$/.test(row.id) && Array.isArray(row.links) && row.links.length <= 100) chunks.set(Number(row.id.split('_').at(-1)), row.links);
    else fail('학습 기록 저장 위치와 형식이 일치하지 않습니다.');
  }
  if (items.length !== meta.itemCount || chunks.size !== meta.linkChunks) fail('학습 기록 목록이 일부 누락되었습니다.');
  const links = []; for (let index = 0; index < meta.linkChunks; index++) { if (!chunks.has(index)) fail('학습 기록 연결이 일부 누락되었습니다.'); links.push(...chunks.get(index)); }
  return normalizeWorkspace({ schemaVersion: 1, items, links, revision }, { careerIds, pruneMissingCareerLinks: true });
}
