export const careerCategoryChoices = ['강의·연수', '위원회·지원단', '연구·수상', '집필', '콘텐츠 제작', '근무', '파견', '자격증', '기타'];

/** Virtual collections preserve IDs, original category values and evidence links. */
export function careerCollections(career, documents = []) {
  const text = [career.title, career.role, career.description, ...(career.tags || [])].join(' ');
  const collections = [];
  const originals = documents.filter(document => career.documentIds?.includes(document.id)).map(document => document.name).join(' ');
  if (career.category === '파견' || /파견/.test(`${text} ${originals}`)) collections.push('secondment');
  const combined = career.category === '집필·콘텐츠';
  const writing = /집필|저술|저서|저자|원고\s*작성|책\s*출판/.test(text);
  const creator = /제작|촬영|집필|개발|저작/.test([career.title, career.role].join(' '));
  const reviewer = /평가위원|심사위원|질관리|품질\s*관리/.test([career.title, career.role].join(' '));
  const content = /콘텐츠|컨텐츠|영상|동영상|미디어/.test(text);
  if (career.category === '집필' || writing && (combined || /집필|저술|저자|집필진/.test(career.role || ''))) collections.push('writing');
  if (career.category === '콘텐츠 제작' || content && creator && !reviewer && (combined || !['강의·연수', '연구·수상'].includes(career.category))) collections.push('content');
  if (combined && !collections.some(value => ['writing', 'content'].includes(value))) collections.push(content ? 'content' : 'writing');
  return collections;
}
export function careerCategoryLabel(career, documents = []) {
  const collections = careerCollections(career, documents);
  if (collections.includes('secondment')) return '파견';
  if (career.category === '근무·파견') return '근무';
  if (career.category === '집필·콘텐츠') return collections.filter(value => value !== 'secondment').map(value => value === 'writing' ? '집필' : '콘텐츠 제작').join(', ');
  return career.category.replaceAll('·', ', ');
}
export function matchesCareerCategory(career, category, documents = []) {
  if (category === '전체') return true;
  if (category === '파견') return careerCollections(career, documents).includes('secondment');
  if (category === '집필') return careerCollections(career).includes('writing');
  if (category === '콘텐츠 제작') return careerCollections(career).includes('content');
  if (category === '근무') return ['근무·파견', '근무'].includes(career.category) && !careerCollections(career, documents).includes('secondment');
  return career.category === category;
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
