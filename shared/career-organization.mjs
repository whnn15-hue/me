// Presentation categories are exclusive. Legacy stored values remain valid for backups.
export const careerCategoryChoices = ['강의·연수', '위원회·지원단', '연구대회', '공모전 수상', '표창', '활동 경력', '집필', '콘텐츠 제작', '자격증'];
// The legacy secondment value remains a contextual filter within activity careers.
export const careerNavigationChoices = [...careerCategoryChoices];
const fold = value => String(value || '').normalize('NFC').replaceAll('_', ' ');
const isKeris = text => /KERIS|한국교육학술정보원/i.test(text);
const internalProgramme = /수학탐험대.*디지털\s*교구.*활용사례집.*제작|연구학교.*성과보고회.*시도.*운영\s*용역|인공지능.*초등수학.*온라인\s*연수.*운영\s*계획|AI\s*디지털교과서.*수정\s*보완.*검토위원회.*운영\s*계획/i;
const originalNames = (career, documents) => documents.filter(document => career.documentIds?.includes(document.id)).map(document => document.name).join(' ');

/** Membership in a creator community is a career, not a produced asset. Keep
 * this narrow: an organization/tag mention alone cannot reclassify an output. */
function communityMembership(career) {
  if (!['집필·콘텐츠', '콘텐츠 제작', '근무·파견', '근무', '기타'].includes(career.category)) return false;
  const title = fold(career.title).replace(/[\s「」『』()（）]/g, ''), role = fold(career.role);
  const membership = /회원|운영진|운영위원|대표|회장|임원|소속|교사\s*모임/.test(role);
  if (!membership && /강사|강의|출강|촬영|편집|저작|집필|제작/.test(role)) return false;
  // The actual legacy entry is "영상제작 콘텐츠 교사 모임 몽당분필".
  return /^(?:영상제작콘텐츠교사모임|교사모임)?몽당분필(?:교사모임)?(?:활동|소속활동|회원활동|정회원|회원|운영진활동|운영진|운영위원|대표|회장|임원|가입|참여|활동경력)?$/.test(title);
}

/** Internal KERIS plans are secondment work, not outside invitations to teach. */
function secondmentWork(career, originals) {
  const title = fold(career.title), role = fold(career.role);
  const text = [title, role, career.organization, career.description, ...(career.tags || []), originals].map(fold).join(' ');
  if (career.category === '파견' || /파견/.test(`${title} ${role} ${originals}`) || career.tags?.includes('파견')) return true;
  if (/파견\s*(근무|업무|기간|중)/.test(fold(career.description))) return true;
  // These named public programmes identify internal plans even in old imports with an empty institution.
  if (internalProgramme.test(title)) return true;
  return isKeris(text) && /운영\s*(용역\s*)?(추진\s*)?계획|제작\s*계획|사업\s*(기획|운영)|구매\s*계획/.test(title) && !/강사|출강|강의\s*요청|초빙/.test(`${title} ${role}`);
}

/** One destination per career; classification never changes the original record. */
export function careerSection(career, documents = []) {
  const originals = originalNames(career, documents);
  if (career.category === '활동 경력' || secondmentWork(career, originals) || communityMembership(career)) return '활동 경력';
  const title = fold(career.title), role = fold(career.role), primary = `${title} ${role}`;
  if (career.category === '표창' || /표창|감사장|공로상|훈장|포장\s*수여/.test(primary)) return '표창';
  if (career.category === '공모전 수상') return '공모전 수상';
  const competition = /공모(?:전)?/.test(title) && !/연구\s*대회|교육\s*연구|교육자료전/.test(title);
  const judging = /심사\s*위원|평가\s*위원|선정\s*위원|심사\s*협의|공모\s*운영|운영\s*계획|공모\s*안내|참가\s*안내|수상\s*(?:목표|예정|계획)|선정\s*(?:기준|계획)/.test(primary);
  const awarded = /수상|입상|최종\s*선정|선정작|우수작품.*선정|선정.*우수작품|최우수상|우수상|장려상|금상|은상|동상|입선|대상\s*$/.test(primary)
    || /선정/.test(role) || Boolean(career.awardGrade?.trim())
    || ['연구·수상','연구대회'].includes(career.category) && /수상|입상|최우수상|우수상|장려상|금상|은상|동상|입선/.test(fold(career.description));
  // The owner confirmed this archive programme's reviewed representative entry
  // belongs with competitions. Its result list supplies no personal rank/grade.
  const classroomArchiveEntry = /교실\s*수업\s*실천\s*사례\s*아카이브\s*공모/.test(title)
    && /공모작\s*대표자/.test(role);
  if (competition && (awarded || classroomArchiveEntry) && !judging) return '공모전 수상';
  if (career.category === '연구대회' || career.category === '연구·수상') return '연구대회';
  const combined = ['집필·콘텐츠', '집필'].includes(career.category);
  const author = /집필|저술|저서|저자|출판/.test(primary);
  const book = /(?:^|[\s「『〈《])책(?:[\s」』〉》]|$)|단행본|도서|저서|공저|출판|ISBN/.test(primary) || /학교폭력/.test(primary) && /자료집|집필/.test(primary);
  // Explicit book records may have an abstract title without the word 'book'.
  const nonBook = !book && /영상|콘텐츠|컨텐츠|교육자료|홍보자료|안내자료|활용사례집|학습지/.test(primary);
  if (career.category === '집필' && !nonBook || author && book && (combined || !['강의·연수','위원회·지원단'].includes(career.category))) return '집필';
  const reviewer = /평가위원|심사위원|질관리|품질\s*관리/.test(primary) || /검토/.test(primary) && !/제작|촬영|편집|집필|저작/.test(primary);
  const creator = /제작|촬영|편집|개발|저작|집필/.test(primary);
  if (career.category === '콘텐츠 제작' || creator && !reviewer && (combined || !['강의·연수','위원회·지원단'].includes(career.category))) return '콘텐츠 제작';
  if (combined) return reviewer ? '위원회·지원단' : '콘텐츠 제작';
  if (['근무·파견', '근무'].includes(career.category)) return '기타';
  // Classify old catch-all records without mutating their saved data. Unknown
  // records remain in the full archive, never deleted or guessed into a field.
  if (career.category === '기타') {
    if (/자격증|자격\s*취득|컴퓨터활용능력|정보처리기사/.test(primary)) return '자격증';
    if (/강사|강의|출강|초빙|연수/.test(primary)) return '강의·연수';
    if (/위원|지원단|서포터즈|선도교사|마스터\s*교원|연구회|컨설팅/.test(primary)) return '위원회·지원단';
  }
  return careerCategoryChoices.includes(career.category) ? career.category : '기타';
}

export function careerCollections(career, documents = []) {
  // Existing consumers may still ask specifically for secondment work.
  if (secondmentWork(career, originalNames(career, documents))) return ['secondment'];
  const collection = { '집필': 'writing', '콘텐츠 제작': 'content' }[careerSection(career, documents)];
  return collection ? [collection] : [];
}
export function careerCategoryLabel(career, documents = []) {
  const section = careerSection(career, documents);
  return section === '기타' ? '' : section.replaceAll('·', ', ');
}
export function matchesCareerCategory(career, category, documents = []) {
  if (category === '전체') return true;
  if (category === '파견') return secondmentWork(career, originalNames(career, documents));
  return careerSection(career, documents) === category;
}
export function careerOrganization(career, documents = []) {
  const original = fold(career.organization).trim();
  if (original) return original.replaceAll('·', ', ');
  if (secondmentWork(career, originalNames(career, documents)) && (isKeris([career.title, career.description, ...(career.tags || [])].join(' ')) || internalProgramme.test(fold(career.title)))) return '한국교육학술정보원(KERIS)';
  return '기관 미입력';
}
export function recognitionDetails(career) {
  const text = [career.title, career.description, ...(career.tags || [])].join(' ');
  const scoped = [...text.matchAll(/(전국|시도|시[·ㆍ, ]도|지역|(?:대구|서울|부산|인천|광주|대전|울산|세종)(?:광역시|특별시|특별자치시)?|(?:경기|경상북|경상남|충청북|충청남|전라북|전라남|강원|제주)(?:도|특별자치도)?|경북|경남|충북|충남|전북|전남)\s*(?:(예선|본선|최종)\s*)?(?:연구대회|대회)?\s*([1-5]\s*등급|[1-5]\s*등|최우수상|우수상|장려상|금상|은상|동상|대상(?!\s*[:：])|입선)/g)];
  const pairs = scoped.map(match => ({level: match[1] === '전국' ? '전국' : match[1] === '지역' ? '지역' : '시도', stage:match[2] || '', grade:match[3]}));
  for (const match of text.matchAll(/(예선|본선|최종)\s*([1-5]\s*등급|[1-5]\s*등|최우수상|우수상|장려상|금상|은상|동상|입선)/g)) {
    if (!scoped.some(source => match.index >= source.index && match.index < source.index + source[0].length)) pairs.push({level:'',stage:match[1],grade:match[2]});
  }
  const distinct = [...new Map(pairs.map(pair => [`${pair.level}:${pair.stage}:${pair.grade}`,pair])).values()];
  const level = career.awardLevel ?? (distinct.some(pair=>pair.level) ? [...new Set(distinct.map(pair=>pair.level).filter(Boolean))].join(', ') : /전국|전국대회/.test(text) ? '전국' : /시도|시[·ㆍ, ]도|광역시|도교육청/.test(text) ? '시도' : /교육지원청|지역대회|시군구/.test(text) ? '지역' : '');
  const fallbackGrade = text.match(/(?:[1-5]\s*등급|[1-5]\s*등|최우수상|우수상|장려상|금상|은상|동상|입선)/)?.[0] || (/대상\s*수상|수상\s*대상/.test(text) || /(?:대회|공모전).*대상\s*$/.test(career.title || '') || career.tags?.includes('대상') ? '대상' : '');
  const grade = career.awardGrade ?? (distinct.length > 1 ? distinct.map(pair=>[pair.level,pair.stage,pair.grade].filter(Boolean).join(' ')).join(', ') : distinct[0]?.grade || fallbackGrade);
  const stages = career.awardStages ?? ['예선', '본선', '최종'].filter(stage => text.includes(stage));
  return { level, grade, stages };
}

const scopePattern = '(전국|시도|시[·ㆍ, ]도|지역|(?:대구|서울|부산|인천|광주|대전|울산|세종)(?:광역시|특별시|특별자치시)?|(?:경기|경상북|경상남|충청북|충청남|전라북|전라남|강원|제주)(?:도|특별자치도)?|경북|경남|충북|충남|전북|전남)';
const gradePattern = '([1-5]\\s*등급|[1-5]\\s*등|최우수상|우수상|장려상|금상|은상|동상|대상(?!\\s*[:：])|입선)';
const normalizeScope = value => value === '전국' ? '전국' : value === '지역' ? '지역' : '시도';
const comparisonScope = value => new RegExp(`^${scopePattern}$`).test(value) ? normalizeScope(value) : value;
const normalizeGrade = value => value.replace(/([1-5])\s+(등급|등)/g, '$1$2');
const cleanLabel = value => String(value || '').replace(/[·ㆍ·⋅]/g, ', ').trim();

function pairedOutcomes(text) {
  const scoped = [...text.matchAll(new RegExp(`${scopePattern}\\s*(?:(예선|본선|최종)\\s*)?(?:연구대회|대회)?\\s*${gradePattern}`, 'g'))];
  const pairs = scoped.map(match => ({level:normalizeScope(match[1]),stage:match[2] || '',grade:normalizeGrade(match[3])}));
  for (const match of text.matchAll(new RegExp(`(예선|본선|최종)\\s*${gradePattern}`, 'g'))) {
    if (!scoped.some(source => match.index >= source.index && match.index < source.index + source[0].length))
      pairs.push({level:'',stage:match[1],grade:normalizeGrade(match[2])});
  }
  return pairs;
}

/** Display complete scope/grade pairs once. Keep the old aggregate fields for
 * editor/search compatibility, but do not concatenate them into award badges.
 * Stages without an explicit associated grade remain independent stage labels. */
export function recognitionOutcomes(career) {
  const details = recognitionDetails(career);
  const explicitGrade = typeof career.awardGrade === 'string';
  const explicitLevel = typeof career.awardLevel === 'string';
  const explicitStages = Array.isArray(career.awardStages);
  const text = explicitGrade ? career.awardGrade : [career.title, career.description, ...(career.tags || [])].join(' ');
  const level = cleanLabel(details.level), grade = cleanLabel(details.grade);
  const levels = level.replace(/시\s*[,/]\s*도/g, '시도').split(/[,/]+/).map(value => comparisonScope(value.trim())).filter(Boolean);
  let stages = details.stages.map(cleanLabel).filter(Boolean);
  let outcomes = pairedOutcomes(text);
  if (outcomes.length) {
    if (explicitLevel && !level) outcomes = outcomes.map(pair => ({...pair,level:''}));
    else if (explicitLevel && levels.length === 1) {
      // An explicit scope also governs a previously saved compound grade. A
      // different scope cannot acquire a grade by removing its original label.
      const previous = outcomes;
      outcomes = outcomes.filter(pair => !pair.level || pair.level === levels[0]);
      if (!explicitStages) stages = stages.filter(stage => outcomes.some(pair => pair.stage === stage)
        || !previous.some(pair => pair.level && pair.stage === stage));
    }
    if (outcomes.length === 1 && !outcomes[0].level && levels.length === 1)
      outcomes[0] = {...outcomes[0],level};
  } else if (grade) outcomes.push({level,stage:'',grade:normalizeGrade(grade)});
  if (explicitStages) outcomes = outcomes.map(pair => ({...pair,stage:stages.includes(pair.stage) ? pair.stage : ''}));
  if (level && !outcomes.some(pair => pair.level)) outcomes.unshift({level,stage:'',grade:''});
  for (const stage of stages) if (!outcomes.some(pair => pair.stage === stage)) outcomes.push({level:'',stage,grade:''});
  return [...new Map(outcomes.filter(pair => pair.level || pair.stage || pair.grade)
    .map(pair => [`${pair.level}:${pair.stage}:${pair.grade}`,pair])).values()];
}

export function recognitionLabels(career) {
  return [...new Set(recognitionOutcomes(career).map(pair => [pair.level,pair.stage,pair.grade].filter(Boolean).join(' ')))];
}
