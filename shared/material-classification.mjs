export const materialSubjects = ['국어', '수학', '사회', '과학', '영어', '도덕', '체육', '음악', '미술', '정보', '통합교과'];
export const materialTrainings = ['읽기', '쓰기', '말하기', '어휘', '수 연산', '문해력', '주의 집중', '사회성', '학급 운영', '디지털 활용'];
const subjectRules = [
  ['국어', /국어|속담|어휘|독서|문해|스피치|글쓰기|말하기/], ['수학', /수학|연산|분수|도형|수감각/],
  ['사회', /사회과|역사|지리|민주|경제/], ['과학', /과학|실험|생물|물리|화학|지구/], ['영어', /영어|english|phonics/i],
  ['도덕', /도덕|윤리|인성/], ['체육', /체육|운동|스포츠/], ['음악', /음악|동요|악기|리듬/],
  ['미술', /미술|그림|미적|색채/], ['정보', /정보교육|인공지능|\bAI\b|디지털|코딩|프로그래밍/i], ['통합교과', /통합교과|바른\s*생활|슬기로운\s*생활|즐거운\s*생활/],
];
const trainingRules = [
  ['읽기', /읽기|읽어|독서|책\s*읽/], ['쓰기', /쓰기|글쓰기|작문|일기/], ['말하기', /말하기|스피치|발표|토론|의사소통/],
  ['어휘', /어휘|속담|낱말|단어/], ['수 연산', /연산|계산|덧셈|뺄셈|곱셈|나눗셈/], ['문해력', /문해|독해/],
  ['주의 집중', /주의\s*집중|집중력|주의력/], ['사회성', /사회성|관계|협동|갈등|학교폭력|어울림/],
  ['학급 운영', /학급|우리반|우리\s*반|아침\s*활동|생활지도/], ['디지털 활용', /디지털|인공지능|\bAI\b|코딩|영상|미디어|에듀테크/i],
];
export function inferMaterialClassification(value = '') {
  const text = String(value).normalize('NFC');
  return { subjects: subjectRules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name), trainings: trainingRules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name) };
}
export function materialClassification(item) {
  const inferred = inferMaterialClassification([item.title, item.summary, item.eventName, ...(item.tags || [])].join(' '));
  return { subjects: item.subjects ?? inferred.subjects, trainings: item.trainings ?? inferred.trainings };
}
// Deterministic suggestions only: never turn people, dates or URLs into tags.
// Existing tags take priority and are never replaced by inferred categories.
export function recordTags(item) {
  const existing = [...new Set(item.tags || [])];
  if (!['material', 'project'].includes(item.kind)) return existing;
  const subjects = (item.subjects || []).map(value => typeof value === 'string' ? value : value.subject);
  const text = [item.title, item.summary, item.sourceFile?.name, item.drivingQuestion, item.activities, ...subjects, ...(item.trainings || [])].filter(Boolean).join(' ').normalize('NFC');
  const inferred = inferMaterialClassification(text);
  const extra = ['인공지능', '디지털', '영상', '독서', '속담', '스피치', '토론', '코딩'].filter(tag => text.includes(tag));
  return [...existing, ...[...new Set([...inferred.subjects, ...inferred.trainings, ...extra])].filter(tag => !existing.includes(tag)).slice(0, Math.max(0, 30 - existing.length))];
}
export function materialFileFormat(name) {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return { html: 'HTML', htm: 'HTML', ppt: 'PPT', pptx: 'PPT', pdf: 'PDF', hwp: 'HWP', hwpx: 'HWP', txt: 'TXT', mp4: '영상', mov: '영상' }[extension] || '기타';
}
export function materialDraft(name, text = '', purpose = 'lecture') {
  const title = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/^\d{8}[_ -]+/, '').trim().slice(0, 300) || '새 자료';
  const classification = inferMaterialClassification(`${title}\n${text.slice(0, 60000)}`);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  // Student name/topic lists are useful originals; names do not belong in card summaries.
  const metadataLabel = /^(?:작성자|제작자|출처|강의명|연수명|행사명|수업명|대상|교육대상|일시|일자|제목|교과|단원|학년|목표|준비물|활동명|성명|이름|내용|주제)\s*[:：]/;
  const roster = lines.filter(line => /^[가-힣]{2,5}\s*[:：]/.test(line) && !metadataLabel.test(line)).length;
  const safeLines = lines.filter(line => !/^[가-힣]{2,5}\s*[:：]|@|010[- ]?\d|성명\s*[:：]|이름\s*[:：]|\b\d{6}[- ]\d{7}\b/.test(line));
  const summary = roster >= 3 ? `학생별 활동 주제를 정리한 목록, ${lines.length}개 항목` : safeLines.slice(0, 3).join('\n').slice(0, 500);
  const tags = [...new Set([...classification.subjects, ...classification.trainings, ...['인공지능', '디지털', '영상', '독서', '속담', '스피치'].filter(tag => `${title} ${text}`.includes(tag))])];
  const explicit = field => lines.find(line => new RegExp(`^(?:${field})\\s*[:：]`).test(line))?.replace(/^.*?[:：]\s*/, '').slice(0, 300) || '';
  const dateSource = explicit('작성일|제작일|강의일|행사일') || name;
  const match = /(20\d{2})\s*[.년/_ -]\s*(\d{1,2})\s*[.월/_ -]\s*(\d{1,2})/.exec(dateSource);
  const candidate = match ? `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}` : '';
  const parsed = candidate ? new Date(`${candidate}T00:00:00Z`) : null;
  const date = parsed && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === candidate ? candidate : '';
  const target = explicit('대상|교육 대상');
  const audience = purpose === 'classroom' ? ['학생'] : /교사|교원/.test(target || title) ? ['교원'] : /학부모/.test(target || title) ? ['학부모'] : /학생/.test(target) ? ['학생'] : [];
  return { kind: 'material', purpose, title, ownership: 'collected', author: explicit('작성자|제작자|출처'), eventName: explicit('강의명|행사명|연수명|수업명'), date, audience,
    format: materialFileFormat(name), fileUrl: '', summary, tags, ...classification };
}
