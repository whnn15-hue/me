import { test, expect, type Page } from '@playwright/test';

const data = async (page:Page) => (await page.request.get('/api/data')).json();
const workspace = async (page:Page) => (await page.request.get('/api/workspace')).json();
const home = (page:Page) => page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'홈',exact:true});

test('archive desk connects review queues, favorites, keyboard search and selected resume without changing records',async({page})=>{
  const original=await data(page), originalWorkspace=await workspace(page);
  const created:string[]=[]; let materialId='';
  const errors:string[]=[]; page.on('pageerror',error=>errors.push(error.message));
  try {
    for(const item of [
      {title:'업그레이드검증 수학 연수',organization:'검증연수원',startDate:'2025-05-03',description:'연수 기록',verified:true},
      {title:'업그레이드검증 날짜 없는 기록',organization:'검증연수원',startDate:'',description:'수학 연수 참고 내용',verified:false},
    ]) {
      const response=await page.request.post('/api/careers',{data:{...item,category:'강의·연수',role:'강사',datePrecision:'day',tags:['업그레이드검증'],evidenceStatus:'later'}});
      expect(response.ok()).toBeTruthy(); created.push((await response.json()).id);
    }
    const state=await workspace(page);
    const result=await page.request.post('/api/workspace/items',{data:{item:{kind:'material',title:'업그레이드검증 즐겨찾는 강의안',format:'PDF',favorite:true,fileUrl:'https://drive.google.com/file/d/upgrade-fixture/view'},links:[],expectedRevision:state.revision}});
    expect(result.ok()).toBeTruthy(); materialId=(await result.json()).items.find((item:{title:string})=>item.title==='업그레이드검증 즐겨찾는 강의안').id;
    const protectedData=await data(page),protectedWorkspace=await workspace(page);
    await page.goto('/');
    const queue=page.getByRole('region',{name:'정리할 기록',exact:true});
    await queue.getByRole('button',{name:/날짜 입력/}).click();
    await expect(page.locator('.career-row').filter({hasText:'업그레이드검증 날짜 없는 기록'})).toBeVisible();
    await expect(page.locator('.career-row').filter({hasText:'업그레이드검증 수학 연수'})).toHaveCount(0);
    await expect(page.getByRole('region',{name:'정리할 기록',exact:true})).toHaveCount(0);
    await page.getByLabel('경력 검색',{exact:true}).fill('검증연수원 업그레이드검증');
    await expect(page.locator('.career-row')).toHaveCount(1);
    await page.getByRole('button',{name:'이력서로 만들기',exact:true}).click();
    await expect(page.locator('.selection-count')).toHaveText('1개 선택');
    await expect(page.locator('.resume-career.selected')).toContainText('업그레이드검증 날짜 없는 기록');
    await home(page).click();
    await page.getByRole('region',{name:'즐겨찾는 기록'}).getByRole('button',{name:/업그레이드검증 즐겨찾는 강의안/}).click();
    await expect(page.getByRole('dialog',{name:'업그레이드검증 즐겨찾는 강의안',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await home(page).click();
    await page.getByRole('button',{name:/어떤 기록을 찾으세요/}).click();
    const search=page.getByRole('dialog',{name:'모든 기록 검색',exact:true});
    const input=search.getByRole('combobox',{name:'모든 기록 검색어',exact:true});
    await expect(input).toBeFocused();
    await input.fill('업그레이드검증 수학 연수');
    await expect(search.getByRole('listbox',{name:'검색 결과'}).getByRole('option').first()).toContainText('업그레이드검증 수학 연수');
    await input.press('ArrowDown'); await expect(search.getByRole('listbox',{name:'검색 결과'}).getByRole('option').nth(1)).toHaveAttribute('aria-selected','true');
    await input.press('ArrowUp'); await input.press('Enter');
    const detail=page.getByRole('dialog',{name:'경력 상세',exact:true});
    await expect(detail).toContainText('업그레이드검증 수학 연수');
    await expect(detail.getByRole('button',{name:'상세 닫기',exact:true})).toBeFocused();
    await detail.getByRole('button',{name:'이력서에 담기',exact:true}).click();
    await expect(page.locator('.selection-count')).toHaveText('1개 선택');
    await expect(page.locator('.resume-career.selected')).toContainText('업그레이드검증 수학 연수');
    await home(page).click(); await page.keyboard.press('Control+k');
    await search.getByRole('navigation',{name:'빠른 작업'}).getByRole('button',{name:'경력 추가',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'새 경력 기록하기',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await data(page)).toEqual(protectedData); expect(await workspace(page)).toEqual(protectedWorkspace);
    await page.screenshot({path:'/tmp/archive-upgrade-home.png',fullPage:true});
    expect(errors).toEqual([]);
  } finally {
    for(const id of created) expect((await page.request.delete(`/api/careers/${id}`)).ok()).toBeTruthy();
    if(materialId) expect((await page.request.delete(`/api/workspace/items/${materialId}`,{data:{expectedRevision:(await workspace(page)).revision}})).ok()).toBeTruthy();
  }
  expect(await data(page)).toEqual(original);
  const after=await workspace(page); expect(after.items).toEqual(originalWorkspace.items); expect(after.links).toEqual(originalWorkspace.links);
});

test('document desk filters formats, sorts, previews text safely and links originals without losing data',async({page})=>{
  const original=await data(page); const documents:string[]=[]; let careerId='';
  try {
    const response=await page.request.post('/api/careers',{data:{title:'업그레이드검증 원본 연결 대상',category:'기타',verified:true,evidenceStatus:'later'}});
    expect(response.ok()).toBeTruthy();careerId=(await response.json()).id;
    for(const file of [
      {name:'upgrade-a.txt',mimeType:'text/plain',buffer:Buffer.from('업그레이드검증 연수원 수학\n<script>window.previewUnsafe=true</script>')},
      {name:'upgrade-z.html',mimeType:'text/html',buffer:Buffer.from('<!doctype html><html><body>업그레이드검증 HTML자료</body></html>')},
    ]) {
      const upload=await page.request.post('/api/documents',{multipart:{files:file}});expect(upload.ok()).toBeTruthy();documents.push((await upload.json()).documents[0].id);
    }
    const before=await data(page);
    await page.goto('/');
    await page.getByRole('region',{name:'정리할 기록'}).getByRole('button',{name:/공문 연결/}).click();
    await expect(page.getByRole('combobox',{name:'파일 연결 필터'})).toHaveValue('미연결 파일');
    await page.getByLabel('공문 검색',{exact:true}).fill('업그레이드검증');
    await page.getByRole('combobox',{name:'공문 정렬'}).selectOption('name');
    await expect(page.locator('.document-row').first()).toContainText('upgrade-a.txt');
    await page.getByRole('combobox',{name:'공문 파일 형식'}).selectOption('HTML');
    await expect(page.locator('.document-row')).toHaveCount(1); await expect(page.locator('.document-row')).toContainText('upgrade-z.html');
    await page.getByRole('combobox',{name:'공문 파일 형식'}).selectOption('문서');
    await page.getByLabel('공문 검색',{exact:true}).fill('수학 연수원');
    await expect(page.locator('.document-row')).toHaveCount(1);
    await page.getByRole('button',{name:'upgrade-a.txt 내용 살펴보기',exact:true}).click();
    const preview=page.getByRole('dialog',{name:'공문 살펴보기',exact:true});
    await expect(preview.getByRole('region',{name:'추출된 문서 내용'})).toContainText('<script>window.previewUnsafe=true</script>');
    expect(await page.evaluate(()=>(window as any).previewUnsafe)).toBeUndefined();
    await page.screenshot({path:'/tmp/archive-upgrade-document.png'});
    expect(await data(page)).toEqual(before);
    await preview.getByRole('button',{name:'경력에 연결',exact:true}).click();
    const link=page.getByRole('dialog',{name:'기존 경력에 공문 연결',exact:true});
    await link.getByRole('combobox').selectOption(careerId);await link.getByRole('button',{name:'연결하기',exact:true}).click();
    await expect(link).toHaveCount(0);await expect(page.locator('.document-row')).toHaveCount(0);
    await page.getByRole('combobox',{name:'파일 연결 필터'}).selectOption('연결된 파일');
    await page.getByRole('button',{name:'upgrade-a.txt 내용 살펴보기',exact:true}).click();
    await preview.getByRole('button',{name:/업그레이드검증 원본 연결 대상/}).click();
    const detail=page.getByRole('dialog',{name:'경력 상세',exact:true});await expect(detail).toContainText('upgrade-a.txt');
    await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);
    const after=await data(page);
    expect(after.documents).toHaveLength(original.documents.length+2);
    expect(after.careers.find((item:{id:string})=>item.id===careerId).documentIds).toEqual([documents[0]]);
  } finally {
    if(careerId)expect((await page.request.delete(`/api/careers/${careerId}`)).ok()).toBeTruthy();
    for(const id of documents)expect((await page.request.delete(`/api/documents/${id}`)).ok()).toBeTruthy();
  }
  expect(await data(page)).toEqual(original);
});
