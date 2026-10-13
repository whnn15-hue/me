import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function workspace(page:Page) {
  const response=await page.request.get('/api/workspace');
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function careerData(page:Page) { return (await page.request.get('/api/data')).json(); }
async function tab(page:Page,name:string) {
  await page.getByRole('navigation',{name:'기록 종류',exact:true}).getByRole('button',{name,exact:true}).click();
}
async function tag(dialog:ReturnType<Page['getByRole']>,value:string) {
  await dialog.getByRole('textbox',{name:'태그 추가',exact:true}).fill(value);
  await dialog.getByRole('textbox',{name:'태그 추가',exact:true}).press('Enter');
}

test('new tabs preserve careers, link both directions, search, and round-trip all JSON data',async({page})=>{
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  const before=await careerData(page);
  // Add a synthetic target only when the archive is empty, without modifying any existing career.
  let target=before.careers[0];
  if(!target){
    const response=await page.request.post('/api/careers',{data:{title:'연결 검증 경력',category:'기타',datePrecision:'year',documentIds:[],tags:['통합검증'],evidenceStatus:'unneeded',verified:true}});
    expect(response.ok()).toBeTruthy();target=await response.json();
  }
  const protectedData=await careerData(page);await page.reload();
  await tab(page,'프로젝트');
  await page.getByRole('button',{name:'프로젝트 추가',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByPlaceholder('예: 우리 동네를 바꾸는 작은 실천').fill('통합검증 생태 수업 프로젝트');
  await dialog.getByLabel('학년도',{exact:true}).fill('2026');
  await dialog.getByLabel('학년',{exact:true}).fill('초등 4학년');
  await dialog.getByLabel('시작일',{exact:true}).fill('2026-03-02');
  await dialog.getByLabel('종료일',{exact:true}).fill('2026-03-20');
  await dialog.getByRole('button',{name:'교과 추가',exact:true}).click();
  await dialog.getByLabel('교과 1',{exact:true}).fill('과학');
  await dialog.getByLabel('단원 1',{exact:true}).fill('생태계');
  await dialog.getByLabel('핵심 질문',{exact:true}).fill('우리 학교 생태계는 어떻게 달라질까?');
  await dialog.getByLabel('수업 흐름',{exact:true}).fill('관찰, 조사, 발표');
  await dialog.getByLabel('주요 활동',{exact:true}).fill('학교 생물 관찰');
  await dialog.getByPlaceholder('예: 패들렛, 캔바, 구글 설문지').fill('패들렛, 캔바');
  await dialog.getByLabel('수업 성찰',{exact:true}).fill('다음에는 관찰 기간을 늘리기');
  await dialog.getByRole('button',{name:'결과물 추가',exact:true}).click();
  await dialog.getByLabel('결과물 제목 1',{exact:true}).fill('관찰 결과');
  await dialog.getByLabel('결과물 주소 1',{exact:true}).fill('https://example.test/ecology');
  await tag(dialog,'통합검증');
  await dialog.getByRole('textbox',{name:'연결할 기록 검색',exact:true}).fill(target.title);
  await dialog.locator('.workspace-link-option').filter({hasText:target.title.replaceAll('·',', ')}).getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'프로젝트 저장',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let state=await workspace(page);const project=state.items.find((i:any)=>i.title==='통합검증 생태 수업 프로젝트');
  expect(project.subjects).toEqual([{subject:'과학',unit:'생태계'}]);expect(project.tools).toEqual(['패들렛','캔바']);
  await page.getByRole('combobox',{name:'학년도 필터',exact:true}).selectOption('2026');
  await page.getByRole('combobox',{name:'교과 필터',exact:true}).selectOption('과학');
  await expect(page.getByRole('button',{name:'통합검증 생태 수업 프로젝트 자세히 보기',exact:true})).toBeVisible();
  await tab(page,'강의 자료');await page.getByRole('button',{name:'자료 추가',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'강의 자료 추가',exact:true});
  await dialog.getByPlaceholder('다시 찾기 쉬운 자료 제목').fill('통합검증 생태 강의안');
  await dialog.getByLabel('제작자 또는 출처',{exact:true}).fill('직접 제작');
  await dialog.getByLabel('사용한 행사 또는 강의',{exact:true}).fill('생태 교원 연수');
  await dialog.getByLabel('자료 날짜',{exact:true}).fill('2026-04-01');
  await dialog.getByLabel('자료 형식',{exact:true}).selectOption('PDF');
  await dialog.getByLabel('대상',{exact:true}).fill('교사, 학생');
  await dialog.getByPlaceholder('https://drive.google.com/...').fill('https://drive.google.com/file/d/synthetic-material/view');
  await dialog.getByLabel('핵심 내용과 활용 메모',{exact:true}).fill('생태 활동의 수업 적용');
  await tag(dialog,'통합검증');
  await dialog.getByRole('textbox',{name:'연결할 기록 검색',exact:true}).fill(project.title);
  await dialog.locator('.workspace-link-option').filter({hasText:project.title}).getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'자료 저장',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('combobox',{name:'자료 대상 필터',exact:true}).selectOption('교사');
  await page.getByRole('combobox',{name:'자료 형식 필터',exact:true}).selectOption('PDF');
  await page.getByRole('button',{name:'통합검증 생태 강의안 상세보기',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'통합검증 생태 강의안',exact:true});
  await dialog.locator('.workspace-related').getByRole('button',{name:new RegExp(project.title)}).click();
  dialog=page.getByRole('dialog',{name:project.title,exact:true});
  await expect(dialog.locator('.workspace-related')).toContainText('통합검증 생태 강의안');
  await dialog.locator('.workspace-related').getByRole('button',{name:new RegExp(target.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replaceAll('·',', '))}).click();
  const career=page.getByRole('dialog',{name:'경력 상세',exact:true});
  await expect(career.locator('.workspace-related')).toContainText(project.title);
  await career.getByRole('button',{name:'상세 닫기',exact:true}).click();
  await page.getByRole('button',{name:'모든 기록 검색 열기',exact:true}).click();
  const search=page.getByRole('dialog',{name:'모든 기록 검색',exact:true});
  await search.getByRole('textbox',{name:'모든 기록 검색어',exact:true}).fill('통합검증');
  await search.getByRole('combobox',{name:'통합 검색 태그',exact:true}).selectOption('통합검증');
  await expect(search).toContainText(project.title);await expect(search).toContainText('통합검증 생태 강의안');
  await search.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'백업 및 설정',exact:true}).click();
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'전체 기록 JSON 내보내기',exact:true}).click();
  const downloaded=await downloading;const json=JSON.parse(await readFile((await downloaded.path())!,'utf8'));
  expect(json.format).toBe('introduce-me-workspace');expect(json.careers).toEqual(protectedData.careers);
  expect(json.workspace.items.some((i:any)=>i.id===project.id)).toBeTruthy();
  const savedCount=json.workspace.items.length;
  await page.getByLabel('가져올 전체 기록 JSON',{exact:true}).setInputFiles(await downloaded.path() as string);
  const confirm=page.getByRole('dialog',{name:'JSON 기록을 가져올까요?',exact:true});
  await expect(confirm).toBeVisible();
  expect((await workspace(page)).items).toHaveLength(savedCount);
  await confirm.getByRole('button',{name:'현재 기록에 추가',exact:true}).click();
  await expect(confirm).toHaveCount(0);
  expect((await workspace(page)).items).toHaveLength(savedCount);
  expect(await careerData(page)).toEqual(protectedData);
  await page.reload();expect((await workspace(page)).items).toHaveLength(savedCount);
  expect(errors).toEqual([]);
});

test('graduate records persist, sort deadlines, keep course dependents, and work on mobile',async({page})=>{
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');const before=await careerData(page);
  await tab(page,'대학원');
  await page.getByRole('button',{name:'강좌 추가',exact:true}).first().click();
  let dialog=page.getByRole('dialog',{name:'강좌 추가',exact:true});
  await dialog.getByLabel('강좌명 *',{exact:true}).fill('통합검증 교육연구방법');
  await dialog.getByLabel('학기',{exact:true}).fill('2026년 2학기');
  await dialog.getByLabel('교수명',{exact:true}).fill('검증 교수');
  await tag(dialog,'통합검증');await dialog.getByRole('button',{name:'저장',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const course=(await workspace(page)).items.find((i:any)=>i.title==='통합검증 교육연구방법');
  await page.getByRole('tab',{name:/^과제/}).click();
  for(const [title,due] of [['통합검증 늦은 과제','2026-12-20'],['통합검증 가까운 과제','2026-10-20']]){
    await page.getByRole('button',{name:'과제 추가',exact:true}).first().click();
    dialog=page.getByRole('dialog',{name:'과제 추가',exact:true});
    await dialog.getByLabel('과제명 *',{exact:true}).fill(title);
    await dialog.getByLabel('연결 강좌',{exact:true}).selectOption(course.id);
    await dialog.getByLabel('마감일',{exact:true}).fill(due);
    await dialog.getByLabel('상태',{exact:true}).selectOption('in-progress');
    await dialog.getByLabel('제출물 링크',{exact:true}).fill('https://docs.google.com/document/d/synthetic-assignment');
    await dialog.getByRole('button',{name:'저장',exact:true}).click();await expect(dialog).toHaveCount(0);
  }
  await expect(page.locator('.grad-records .grad-card').first()).toContainText('통합검증 가까운 과제');
  await page.getByRole('button',{name:'통합검증 가까운 과제 수정',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'과제 수정',exact:true});
  await dialog.getByLabel('상태',{exact:true}).selectOption('submitted');
  await dialog.getByRole('button',{name:'저장',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('combobox',{name:'과제 상태 필터',exact:true}).selectOption('submitted');
  await expect(page.locator('.grad-card')).toHaveCount(1);
  await page.getByRole('tab',{name:/^논문 노트/}).click();
  await page.getByRole('button',{name:'논문 노트 추가',exact:true}).first().click();
  dialog=page.getByRole('dialog',{name:'논문 노트 추가',exact:true});
  await dialog.getByLabel('제목 *',{exact:true}).fill('통합검증 협력학습 논문');
  await dialog.getByLabel('저자',{exact:true}).fill('검증 저자');
  await dialog.getByLabel('연도',{exact:true}).fill('2025');
  await dialog.getByLabel('핵심 내용 요약',{exact:true}).fill('협력 과정에 대한 분석');
  await dialog.getByLabel('내 생각',{exact:true}).fill('생태 프로젝트에 적용');
  await dialog.getByRole('button',{name:'인용문 추가',exact:true}).click();
  await dialog.getByLabel('인용문 1',{exact:true}).fill('서로 설명하는 과정에서 배움이 깊어진다');
  await dialog.getByLabel('쪽수 1',{exact:true}).fill('12-14');
  await dialog.locator('.grad-course-checks').getByRole('checkbox',{name:'통합검증 교육연구방법 2026년 2학기',exact:true}).check();
  await tag(dialog,'통합검증');await dialog.getByRole('button',{name:'저장',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('searchbox',{name:'논문 노트 검색',exact:true}).fill('배움이 깊어진다');
  await expect(page.locator('.grad-card')).toHaveCount(1);
  await page.getByRole('button',{name:'통합검증 협력학습 논문 상세 보기',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'통합검증 협력학습 논문',exact:true});
  await expect(dialog).toContainText('12-14쪽');
  await dialog.getByRole('button',{name:'닫기',exact:true}).first().click();
  await page.getByRole('tab',{name:/^논문 주제 메모/}).click();
  await page.getByRole('button',{name:'논문 주제 메모 추가',exact:true}).first().click();
  dialog=page.getByRole('dialog',{name:'논문 주제 메모 추가',exact:true});
  await dialog.getByLabel('제목 *',{exact:true}).fill('통합검증 연구 질문');
  await dialog.getByLabel('자유 메모',{exact:true}).fill('협력적 생태 탐구가 학습에 미치는 영향');
  await dialog.getByRole('button',{name:'저장',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.reload();await tab(page,'대학원');
  await page.getByRole('button',{name:'통합검증 교육연구방법 삭제',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'강좌 삭제',exact:true});
  await expect(dialog).toContainText('과제와 논문 노트는 그대로');
  await dialog.getByRole('button',{name:'삭제',exact:true}).click();await expect(dialog).toHaveCount(0);
  const after=await workspace(page);
  expect(after.items.find((i:any)=>i.title==='통합검증 가까운 과제').courseId).toBe('');
  expect(after.items.find((i:any)=>i.title==='통합검증 협력학습 논문').courseIds).toEqual([]);
  expect(after.items.some((i:any)=>i.title==='통합검증 연구 질문')).toBeTruthy();
  expect(await careerData(page)).toEqual(before);
  await page.setViewportSize({width:375,height:812});
  for(const name of ['프로젝트','강의 자료','대학원']){
    await tab(page,name);await expect(page.locator('.workspace-main-tabs')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(await page.locator('main').innerText()).not.toContain('·');
  }
  expect(errors).toEqual([]);
});
