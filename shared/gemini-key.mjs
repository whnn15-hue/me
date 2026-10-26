// The provider, not a guessed key prefix or alphabet, decides validity.
// Only normalize clear clipboard wrappers and enforce safe HTTP header input.
// Never include the supplied value in an error message.
export function normalizeGeminiKey(input) {
  let key = typeof input === 'string' ? input.trim() : '';
  const wrappers = [['"','"'],["'","'"],['`','`'],['“','”'],['‘','’']];
  if (key.length >= 2 && wrappers.some(([start,end])=>key.startsWith(start) && key.endsWith(end))) key = key.slice(1,-1).trim();
  if (!key) throw new Error('Gemini API 키를 붙여 넣어 주세요.');
  if (key.length > 4096) throw new Error('입력값이 너무 깁니다. 코드나 설명을 제외하고 API 키만 복사해 주세요.');
  if (/\*{2,}|\.{3,}|…|[•●]{2,}/u.test(key)) throw new Error('일부가 가려진 키입니다. Google AI Studio의 API 키 복사 버튼으로 전체 값을 복사해 주세요.');
  if (/\s/u.test(key)) throw new Error('키 중간에 공백이나 줄바꿈이 있습니다. Google AI Studio의 API 키 복사 버튼으로 다시 복사해 주세요.');
  if (!/^[\x21-\x7e]+$/.test(key)) throw new Error('키에 사용할 수 없는 문자나 보이지 않는 문자가 포함되어 있습니다. API 키 복사 버튼으로 다시 복사해 주세요.');
  return key;
}
