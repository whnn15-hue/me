// Presentation categories are exclusive. Legacy stored values remain valid for backups.
export const careerCategoryChoices = ['강의·연수', '위원회·지원단', '연구대회', '표창', '파견', '집필', '콘텐츠 제작', '자격증', '기타'];
const fold = value => String(value || '').normalize('NFC').replaceAll('_', ' ');
const isKeris = text => /KERIS|한국교육학술정보원/i.test(text);
const internalProgramme = /수학탐험대.*디지털\s*교구.*활용사례집.*제작|연구학교.*성과보고회.*시도.*운영\s*용역|인공지능.*초등수학.*온라인\s*연수.*운영\s*계획|AI\s*디지털교과서.*수정\s*보완.*검토위원회.*운영\s*계획/i;

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
  const originals = documents.filter(document => career.documentIds?.includes(document.id)).map(document => document.name).join(' ');
  if (secondmentWork(career, originals)) return '파견';
  const title = fold(career.title), role = fold(career.role), primary = `${title} ${role}`;
  if (career.category === '표창' || /표창|감사장|공로상|훈장|포장\s*수여/.test(primary)) return '표창';
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
  return careerCategoryChoices.includes(career.category) ? career.category : '기타';
}

export function careerCollections(career, documents = []) {
  const collection = { '파견': 'secondment', '집필': 'writing', '콘텐츠 제작': 'content' }[careerSection(career, documents)];
  return collection ? [collection] : [];
}
export function careerCategoryLabel(career, documents = []) {
  return careerSection(career, documents).replaceAll('·', ', ');
}
export function matchesCareerCategory(career, category, documents = []) {
  if (category === '전체') return true;
  return careerSection(career, documents) === category;
}
export function careerOrganization(career, documents = []) {
  const original = fold(career.organization).trim();
  if (original) return original.replaceAll('·', ', ');
  if (careerSection(career, documents) === '파견' && (isKeris([career.title, career.description, ...(career.tags || [])].join(' ')) || internalProgramme.test(fold(career.title)))) return '한국교육학술정보원(KERIS)';
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
