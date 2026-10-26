import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function workspace(page:Page) {
  const response=await page.request.get('/api/workspace');
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function careerData(page:Page) { return (await page.request.get('/api/data')).json(); }
async function tab(page:Page,name:string) {
  const tabs = page.getByRole('navigation',{name:'주 메뉴',exact:true});
  if (await tabs.isVisible()) await tabs.getByRole('button',{name,exact:true}).click();
  else await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name,exact:true}).click();
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
  await tab(page,'수업');
  await page.getByRole('button',{name:'수업 추가',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByPlaceholder('예: 우리 동네를 바꾸는 작은 실천').fill('통합검증 생태 수업 프로젝트');
  await dialog.getByLabel('학년도',{exact:true}).fill('2026');
  await dialog.getByLabel('학년',{exact:true}).fill('초등 4학년');
  await dialog.getByLabel('시작일',{exact:true}).fill('2026-03-02');
  await dialog.getByLabel('종료일',{exact:true}).fill('2026-03-20');
  await dialog.getByRole('button',{name:'교과 추가',exact:true}).click();
  await dialog.getByLabel('교과 1',{exact:true}).fill('과학');
  await dialog.getByLabel('단원 1',{exact:true}).fill('생태계');
  if(await dialog.locator('details.optional-fields:not([open])').count()) await dialog.locator('details.optional-fields > summary').click();
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
  await dialog.getByRole('button',{name:'수업 저장',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let state=await workspace(page);const project=state.items.find((i:any)=>i.title==='통합검증 생태 수업 프로젝트');
  expect(project.subjects).toEqual([{subject:'과학',unit:'생태계'}]);expect(project.tools).toEqual(['패들렛','캔바']);
  await page.getByRole('combobox',{name:'학년도 필터',exact:true}).selectOption('2026');
  await page.getByRole('combobox',{name:'교과 필터',exact:true}).selectOption('과학');
  await expect(page.getByRole('button',{name:'통합검증 생태 수업 프로젝트 자세히 보기',exact:true})).toBeVisible();
  await tab(page,'강의 자료');await page.getByRole('button',{name:'자료 추가',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'강의 자료 추가',exact:true});
  await dialog.getByPlaceholder('다시 찾기 쉬운 자료 제목').fill('통합검증 생태 강의안');
  if(await dialog.locator('details.optional-fields:not([open])').count()) await dialog.locator('details.optional-fields > summary').click();
  await dialog.getByLabel('자료 형식',{exact:true}).selectOption('PDF');
  await dialog.getByPlaceholder('https://drive.google.com/...').fill('https://drive.google.com/file/d/synthetic-material/view');
  await dialog.getByRole('textbox',{name:'핵심 내용과 활용 메모',exact:true}).fill('생태 활동의 수업 적용');
  await tag(dialog,'통합검증');
  await dialog.getByRole('textbox',{name:'연결할 기록 검색',exact:true}).fill(project.title);
  await dialog.locator('.workspace-link-option').filter({hasText:project.title}).getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'자료 저장',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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
  await search.getByRole('combobox',{name:'모든 기록 검색어',exact:true}).fill('통합검증');
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

test('retired graduate records and relationships remain in JSON backups without appearing in navigation or search',async({page})=>{
    const original = await workspace(page);
    const result = await page.request.post('/api/workspace/items',{data:{item:{kind:'course',title:'보존 검증 강좌',semester:'2026-2',professor:'가상 교수'},links:[],expectedRevision:original.revision}});
    expect(result.ok()).toBeTruthy(); const saved = await result.json();
    await page.goto('/#graduate');
    await expect(page.getByRole('heading',{name:'나의 기록실',exact:true})).toBeVisible();
    await expect(page.getByRole('navigation',{name:'주 메뉴'}).getByText('대학원',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'모든 기록 검색 열기'}).click();
    await page.getByRole('combobox',{name:'모든 기록 검색어'}).fill('보존 검증 강좌');
    await expect(page.locator('.global-search-result')).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).click();
    await tab(page,'백업 및 설정');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button',{name:'전체 기록 JSON 내보내기'}).click();
    const downloaded = await downloading;
    const backup = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
    expect(backup.workspace.items).toEqual(saved.items);
    expect(backup.workspace.links).toEqual(saved.links);
    expect((await workspace(page)).items).toEqual(saved.items);
  });

test('classroom materials stay under lessons, link both ways, and survive JSON restoration without changing legacy records',async({page})=>{
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const originalCareers=await careerData(page);
  let current=await workspace(page);
  // Older lecture data deliberately has no purpose field. It must keep its original meaning.
  for(const item of [
    {kind:'project',title:'학급검증 말하기 수업',schoolYear:'2026',grade:'초등',tags:['학급검증']},
    {kind:'material',title:'학급검증 기존 교원 강의안',format:'PDF',fileUrl:'https://drive.google.com/file/d/synthetic-legacy-lecture/view',tags:['학급검증']},
  ]){
    const result=await page.request.post('/api/workspace/items',{data:{item,links:[],expectedRevision:current.revision}});
    expect(result.ok()).toBeTruthy();current=await result.json();
  }
  const project=current.items.find((i:any)=>i.title==='학급검증 말하기 수업');
  const legacy=current.items.find((i:any)=>i.title==='학급검증 기존 교원 강의안');
  expect(legacy.purpose).toBeUndefined();
  await page.goto('/');await tab(page,'수업');
  await page.getByRole('tab',{name:/^학급 자료/}).click();
  await page.getByRole('button',{name:'자료 추가',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'학급 자료 추가',exact:true});
  await dialog.getByPlaceholder('다시 찾기 쉬운 자료 제목').fill('학급검증 스피치 활동지');
  if(await dialog.locator('details.optional-fields:not([open])').count()) await dialog.locator('details.optional-fields > summary').click();
  if(await dialog.locator('details.optional-fields:not([open])').count()) await dialog.locator('details.optional-fields > summary').click();
  await dialog.getByLabel('자료 형식',{exact:true}).selectOption('HWP');
  await dialog.getByPlaceholder('https://drive.google.com/...').fill('https://drive.google.com/file/d/synthetic-classroom-material/view');
  await dialog.getByRole('textbox',{name:'핵심 내용과 활용 메모',exact:true}).fill('학급검증 짝과 함께 발표 순서 정하기');
  await tag(dialog,'학급검증');
  await dialog.getByRole('textbox',{name:'연결할 기록 검색',exact:true}).fill(project.title);
  await dialog.locator('.workspace-link-option').filter({hasText:project.title}).getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'자료 저장',exact:true}).click();await expect(dialog).toHaveCount(0);
  let saved=await workspace(page);
  const material=saved.items.find((i:any)=>i.title==='학급검증 스피치 활동지');
  expect(material.purpose).toBe('classroom');expect(material.format).toBe('HWP');
  expect(material.ownership).toBe('created');expect(material.audience).toEqual([]);
  await expect(page.getByRole('button',{name:`${legacy.title} 상세보기`,exact:true})).toHaveCount(0);
  await page.getByLabel('학급 자료 검색',{exact:true}).fill('발표 순서');
  await expect(page.getByRole('button',{name:`${material.title} 상세보기`,exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'자료 형식 필터',exact:true}).selectOption('HWP');
  await page.getByRole('button',{name:`${material.title} 상세보기`,exact:true}).click();
  dialog=page.getByRole('dialog',{name:material.title,exact:true});
  await dialog.locator('.workspace-related').getByRole('button',{name:new RegExp(project.title)}).click();
  dialog=page.getByRole('dialog',{name:project.title,exact:true});
  await expect(page.getByRole('tab',{name:/^수업 기록/})).toHaveAttribute('aria-selected','true');
  await expect(dialog.locator('.workspace-related')).toContainText(material.title);
  await dialog.locator('.workspace-related').getByRole('button',{name:new RegExp(material.title)}).click();
  dialog=page.getByRole('dialog',{name:material.title,exact:true});
  await expect(page.getByRole('tab',{name:/^학급 자료/})).toHaveAttribute('aria-selected','true');
  await expect(dialog.getByRole('link',{name:'드라이브에서 열기',exact:true})).toHaveAttribute('href',material.fileUrl);
  await dialog.getByRole('button',{name:'닫기',exact:true}).first().click();

  await tab(page,'강의 자료');
  await expect(page.getByRole('button',{name:`${legacy.title} 상세보기`,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:`${material.title} 상세보기`,exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'모든 기록 검색 열기',exact:true}).click();
  let search=page.getByRole('dialog',{name:'모든 기록 검색',exact:true});
  await search.getByRole('combobox',{name:'모든 기록 검색어',exact:true}).fill('학급검증');
  await search.getByRole('combobox',{name:'검색할 기록 종류',exact:true}).selectOption({label:'수업 전체'});
  await expect(search.locator('.global-search-results')).toContainText(material.title);
  await expect(search.locator('.global-search-results')).toContainText(project.title);
  await expect(search.locator('.global-search-results')).not.toContainText(legacy.title);
  await search.getByRole('combobox',{name:'검색할 기록 종류',exact:true}).selectOption({label:'학급 자료'});
  await expect(search.locator('.global-search-results')).toContainText(material.title);
  await expect(search.locator('.global-search-results')).not.toContainText(legacy.title);
  await expect(search.locator('.global-search-results')).not.toContainText(project.title);
  await search.locator('.global-search-result').filter({hasText:material.title}).click();
  await expect(page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'수업',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('tab',{name:/^학급 자료/})).toHaveAttribute('aria-selected','true');
  dialog=page.getByRole('dialog',{name:material.title,exact:true});
  await dialog.getByRole('button',{name:'수정하기',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'학급 자료 수정',exact:true});
  if(await dialog.locator('details.optional-fields:not([open])').count()) await dialog.locator('details.optional-fields > summary').click();
  await dialog.getByLabel('자료 형식',{exact:true}).selectOption('TXT');
  await dialog.getByRole('textbox',{name:'핵심 내용과 활용 메모',exact:true}).fill('학급검증 다음 수업에는 한 문장 발표로 시작하기');
  await dialog.getByRole('button',{name:'자료 저장',exact:true}).click();
  dialog=page.getByRole('dialog',{name:material.title,exact:true});
  await expect(dialog).toContainText('다음 수업에는 한 문장 발표로 시작하기');
  await expect(dialog).toContainText('TXT 자료');
  await dialog.getByRole('button',{name:'닫기',exact:true}).first().click();
  const beforeBackup=await workspace(page);
  expect(beforeBackup.items.find((i:any)=>i.id===legacy.id)).toEqual(legacy);
  const updated=beforeBackup.items.find((i:any)=>i.id===material.id);
  expect(updated.purpose).toBe('classroom');expect(updated.format).toBe('TXT');
  await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'백업 및 설정',exact:true}).click();
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'전체 기록 JSON 내보내기',exact:true}).click();
  const downloaded=await downloadEvent;const backupPath=(await downloaded.path())!;
  const backup=JSON.parse(await readFile(backupPath,'utf8'));
  expect(backup.careers).toEqual(originalCareers.careers);
  expect(backup.workspace.items.find((i:any)=>i.id===material.id)).toEqual(updated);

  await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'수업',exact:true}).click();
  await page.getByRole('tab',{name:/^학급 자료/}).click();
  if (!process.env.TEST_DESKTOP_ONLY) await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(await page.locator('main').innerText()).not.toContain('·');
  await page.getByRole('button',{name:`${material.title} 상세보기`,exact:true}).click();
  dialog=page.getByRole('dialog',{name:material.title,exact:true});
  await dialog.getByRole('button',{name:'삭제',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'학급 자료를 삭제할까요?',exact:true});
  await expect(dialog).toContainText('구글 드라이브 원본 파일은 유지됩니다');
  await dialog.getByRole('button',{name:'자료 삭제',exact:true}).click();await expect(dialog).toHaveCount(0);
  saved=await workspace(page);
  expect(saved.items.some((i:any)=>i.id===material.id)).toBeFalsy();
  expect(saved.links.some((link:any)=>link.from===`material:${material.id}`||link.to===`material:${material.id}`)).toBeFalsy();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'백업 및 설정',exact:true}).click();
  await page.getByLabel('가져올 전체 기록 JSON',{exact:true}).setInputFiles(backupPath);
  const confirm=page.getByRole('dialog',{name:'JSON 기록을 가져올까요?',exact:true});
  await confirm.getByRole('button',{name:'현재 기록에 추가',exact:true}).click();await expect(confirm).toHaveCount(0);
  saved=await workspace(page);
  expect(saved.items.find((i:any)=>i.id===material.id)).toEqual(updated);
  expect(saved.items.find((i:any)=>i.id===legacy.id)).toEqual(legacy);
  expect(saved.links).toEqual(beforeBackup.links);
  expect(await careerData(page)).toEqual(originalCareers);
  await page.reload();await tab(page,'수업');await page.getByRole('tab',{name:/^학급 자료/}).click();
  await expect(page.getByRole('button',{name:`${material.title} 상세보기`,exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
