import {test,expect} from '@playwright/test';

test('four workspaces contain exclusive career collections, institution views and compatible records',async({page})=>{
  await page.goto('/#careers');
  const before=(await (await page.request.get('/api/data')).json()).careers;
  const fixtures=[
    {title:'구성검증 현장교사 파견',category:'근무·파견',description:'가상 기관 현장교사 파견'},
    {title:'구성검증 집필과 영상 콘텐츠',category:'집필·콘텐츠',role:'집필, 촬영'},
    {title:'구성검증 연구대회',category:'연구·수상',awardLevel:'전국',awardGrade:'1등급',awardStages:['예선','본선']},
    {title:'구성검증 학교폭력 Q&A 자료집',category:'집필·콘텐츠',role:'집필위원'},
    {title:'구성검증 교육 유공 표창',category:'연구·수상',organization:'가상 수여기관'},
    {title:'구성검증 수학탐험대 디지털 교구 활용사례집 제작 계획',category:'집필·콘텐츠'},
    {title:'구성검증 미디어 강의',category:'강의·연수',organization:'가상 교육연수원',role:'강사'},
    {title:'구성검증 수업 연수',category:'강의·연수',organization:'가상 대학교',role:'강사'},
    {title:'구성검증 기관 미기재 연수',category:'강의·연수'},
  ];
  const created=[];
  for(const item of fixtures){const response=await page.request.post('/api/careers',{data:{...item,startDate:'2026',datePrecision:'year',verified:false,evidenceStatus:'unneeded'}});expect(response.ok()).toBeTruthy();created.push(await response.json());}
  await page.reload();
  const menu=page.getByRole('navigation',{name:'주 메뉴',exact:true});
  const primary=page.getByRole('navigation',{name:'기록 종류',exact:true});
  await expect(primary.getByRole('button')).toHaveText(['이력','수업','강의 자료','대학원']);
  for(const name of ['파견','집필','콘텐츠 제작'])await expect(menu.getByRole('button',{name,exact:true})).toHaveCount(0);
  const categories=page.getByRole('navigation',{name:'이력 분류',exact:true});
  await expect(categories.getByRole('button',{name:/^근무/})).toHaveCount(0);
  await expect(categories.getByRole('button',{name:/연구, 수상/})).toHaveCount(0);
  const choose=async(name:string)=>categories.getByRole('button').filter({has:page.locator('strong',{hasText:new RegExp(`^${name}$`)})}).click();
  const row=(index:number)=>page.locator('.career-row').filter({hasText:fixtures[index].title});
  await choose('연구대회');await expect(row(2)).toBeVisible();await expect(row(4)).toHaveCount(0);
  await choose('표창');await expect(row(4)).toBeVisible();await expect(row(2)).toHaveCount(0);
  await expect(row(4).locator('.award-unknown')).toHaveCount(0);
  await choose('파견');await expect(row(0)).toBeVisible();await expect(row(5)).toBeVisible();await expect(row(1)).toHaveCount(0);
  await choose('집필');await expect(row(3)).toBeVisible();await expect(row(1)).toHaveCount(0);await expect(row(5)).toHaveCount(0);
  await choose('콘텐츠 제작');await expect(row(1)).toBeVisible();await expect(row(3)).toHaveCount(0);await expect(row(5)).toHaveCount(0);
  await choose('강의, 연수');
  await expect(page.getByRole('combobox',{name:'이력 묶어보기',exact:true})).toHaveValue('organization');
  await expect(row(6).locator('.lecture-institution')).toHaveText('가상 교육연수원');
  await page.getByRole('combobox',{name:'기관 필터',exact:true}).selectOption('가상 교육연수원');
  await expect(page.locator('.career-row')).toHaveCount(1);await expect(row(6)).toBeVisible();
  await page.getByRole('combobox',{name:'기관 필터',exact:true}).selectOption('기관 미입력');await expect(row(8)).toBeVisible();
  await choose('연구대회');await expect(page.getByRole('combobox',{name:'기관 필터',exact:true})).toHaveValue('전체 기관');
  await page.getByRole('textbox',{name:'경력 검색',exact:true}).fill(fixtures[2].title);
  const award=row(2);
  for(const text of ['전국','1등급','예선','본선'])await expect(award.locator('.recognition-badges')).toContainText(text);
  await award.click();const detail=page.getByRole('dialog',{name:'경력 상세',exact:true});
  await detail.getByRole('button',{name:'경력 수정하기',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'경력 수정하기',exact:true});
  await expect(editor.getByRole('combobox',{name:'분류',exact:true})).toHaveValue('연구대회');
  await editor.getByLabel('등급 또는 수상 결과',{exact:true}).fill('최우수상');
  await editor.getByRole('checkbox',{name:'최종',exact:true}).check();
  await editor.getByRole('button',{name:'확인하고 저장',exact:true}).click();await expect(editor).toHaveCount(0);
  await expect(page.locator('.recognition-badges').first()).toContainText('최우수상');
  await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
  // Browsing and editing unrelated fields must not rewrite legacy category values.
  const after=(await (await page.request.get('/api/data')).json()).careers;
  for(const item of created)expect(after.find((value:{id:string})=>value.id===item.id).category).toEqual(item.category);
  await choose('전체');
  await page.getByRole('button',{name:'경력 추가',exact:true}).click();
  const added=page.getByRole('dialog',{name:'새 경력 기록하기',exact:true});
  await added.getByPlaceholder('어떤 경험을 하셨나요?').fill('구성검증 새 표창 기록');
  await added.getByRole('combobox',{name:'분류',exact:true}).selectOption('표창');
  await expect(added.getByLabel('수여 기관',{exact:true})).toBeVisible();
  await added.getByRole('button',{name:'확인하고 저장',exact:true}).click();await expect(added).toHaveCount(0);
  const fresh=(await (await page.request.get('/api/data')).json()).careers.find((item:{title:string})=>item.title==='구성검증 새 표창 기록');created.push(fresh);
  await choose('표창');await expect(page.locator('.career-row').filter({hasText:fresh.title})).toBeVisible();
  expect(await page.evaluate(async()=>{await document.fonts.load('600 24px Paperlogy','수업');return document.fonts.check('600 24px Paperlogy','수업');})).toBeTruthy();
  expect(await page.locator('h1').first().evaluate(element=>getComputedStyle(element).fontFamily)).toContain('Paperlogy');
  await expect(page.getByText('하나씩 쌓아온 경험을, 한눈에 정리하세요.',{exact:true})).toHaveCount(0);
  await choose('강의, 연수');
  await page.screenshot({path:'/tmp/career-portfolio-desktop.png',animations:'disabled'});
  for(const width of [375,768]){
    await page.setViewportSize({width,height:900});
    await page.locator('.sidebar').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({width:375,height:812});await page.screenshot({path:'/tmp/career-portfolio-mobile.png',animations:'disabled'});
  await primary.getByRole('button',{name:'수업',exact:true}).click();await expect(page.getByRole('heading',{name:'수업 기록',exact:true})).toBeVisible();
  await primary.getByRole('button',{name:'강의 자료',exact:true}).click();await expect(page.getByRole('heading',{name:'강의 자료',exact:true})).toBeVisible();
  await primary.getByRole('button',{name:'대학원',exact:true}).click();await expect(page.getByRole('heading',{name:'대학원',exact:true})).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await primary.getByRole('button',{name:'강의 자료',exact:true}).click();await page.getByRole('button',{name:'자료 추가',exact:true}).click();
  const material=page.getByRole('dialog',{name:'강의 자료 추가',exact:true});
  await expect(material.locator('details.optional-fields')).not.toHaveAttribute('open');await expect(material.getByText('내가 만든 자료',{exact:true})).toHaveCount(0);
  await material.getByRole('button',{name:'취소',exact:true}).click();
  for(const item of created)expect((await page.request.delete(`/api/careers/${item.id}`)).ok()).toBeTruthy();
  expect((await (await page.request.get('/api/data')).json()).careers).toEqual(before);
});

test('HTML uploads remain attachments and library favorites persist with links and JSON backup',async({page})=>{
  await page.goto('/#careers');
  const original=(await (await page.request.get('/api/data')).json());
  const previous=(await (await page.request.get('/api/workspace')).json());
  const html=Buffer.from('<!doctype html><html><head><title>통합검증 HTML 수학 자료</title></head><body><h1>분수 연습</h1><script>window.HTML_EXECUTED=true</script></body></html>');
  await expect(page.getByLabel('공문 파일 선택',{exact:true})).toHaveAttribute('accept',/\.html,.htm/);
  const uploaded=await page.request.post('/api/documents',{multipart:{files:{name:'html-material.html',mimeType:'text/html',buffer:html}}});
  expect(uploaded.ok()).toBeTruthy();
  const doc=(await uploaded.json()).documents[0];
  const download=await page.request.get(`/api/documents/${doc.id}/file`);
  expect(download.headers()['content-disposition']).toMatch(/^attachment/);expect(await download.body()).toEqual(html);
  const links=original.careers[0]?[`career:${original.careers[0].id}`]:[];
  const response=await page.request.post('/api/workspace/items',{data:{item:{id:'html_library_e2e',kind:'material',title:'통합검증 HTML 수학 자료',format:'HTML',subjects:['수학'],trainings:['수 연산'],fileUrl:'https://drive.google.com/file/d/synthetic123/view'},links,expectedRevision:previous.revision}});
  expect(response.ok()).toBeTruthy();
  const materialId=(await response.json()).items.find((item:{title:string})=>item.title==='통합검증 HTML 수학 자료').id;
  await page.reload();
  const primary=page.getByRole('navigation',{name:'기록 종류',exact:true});
  await primary.getByRole('button',{name:'강의 자료',exact:true}).click();
  await page.getByRole('combobox',{name:'자료 형식 필터',exact:true}).selectOption('HTML');
  const favorite=page.getByRole('button',{name:'통합검증 HTML 수학 자료 즐겨찾기',exact:true});
  await favorite.click();await expect(favorite).toHaveAttribute('aria-pressed','true');
  await page.reload();await primary.getByRole('button',{name:'강의 자료',exact:true}).click();
  await expect(favorite).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'목록 보기',exact:true}).click();
  await page.getByRole('button',{name:'통합검증 HTML 수학 자료 상세보기',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'통합검증 HTML 수학 자료',exact:true});
  await dialog.getByRole('button',{name:'수정하기',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'강의 자료 수정',exact:true});
  await dialog.locator('details.optional-fields > summary').click();
  await expect(dialog.getByRole('combobox',{name:'자료 형식',exact:true})).toHaveValue('HTML');
  await dialog.getByRole('button',{name:'자료 저장',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'강의 자료 수정',exact:true})).toHaveCount(0);
  const saved=(await (await page.request.get('/api/workspace')).json());
  expect(saved.items.find((item:{id:string})=>item.id===materialId).favorite).toBe(true);
  if(links.length)expect(saved.links).toContainEqual({from:links[0],to:`material:${materialId}`});
  const backup=(await (await page.request.get('/api/workspace/export')).json());
  expect(backup.workspace.items.find((item:{id:string})=>item.id===materialId).format).toBe('HTML');
  expect(backup.careers).toEqual(original.careers);
  expect((await page.request.delete(`/api/workspace/items/${materialId}`,{data:{expectedRevision:saved.revision}})).ok()).toBeTruthy();
  expect((await page.request.delete(`/api/documents/${doc.id}`)).ok()).toBeTruthy();
  const after=(await (await page.request.get('/api/data')).json());
  expect(after.careers).toEqual(original.careers);expect(after.documents).toEqual(original.documents);
  expect((await (await page.request.get('/api/workspace')).json()).items).toEqual(previous.items);
});
