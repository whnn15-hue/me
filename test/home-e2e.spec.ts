import {test,expect} from '@playwright/test';

test('desktop record room: home overview, retired sections, independent libraries, compact rows and themes',async({page})=>{
  await page.setViewportSize({width:1600,height:1100});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const original=await (await page.request.get('/api/data')).json();
  const originalWorkspace=await (await page.request.get('/api/workspace')).json();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const createdItems:string[]=[];let careerId='';
  try{
    const response=await page.request.post('/api/careers',{data:{title:'홈검증 오늘 특강',startDate:today,category:'강의·연수',organization:'홈검증 연수원',role:'강사',datePrecision:'day',verified:true,evidenceStatus:'unneeded'}});
    expect(response.ok()).toBeTruthy();careerId=(await response.json()).id;
    for(const item of [
      {kind:'assignment',title:'홈검증 오늘 과제',dueDate:today,status:'in-progress'},
      {kind:'assignment',title:'홈검증 제출한 과제',dueDate:today,status:'submitted'},
      {kind:'material',title:'홈검증 최근 강의안',format:'PDF',fileUrl:'https://drive.google.com/file/d/home-fixture/view',favorite:true},
    ]){
      const workspace=await (await page.request.get('/api/workspace')).json();
      const result=await page.request.post('/api/workspace/items',{data:{item,links:[],expectedRevision:workspace.revision}});expect(result.ok()).toBeTruthy();createdItems.push((await result.json()).items.find((row:{title:string})=>row.title===item.title).id);
    }
    await page.emulateMedia({colorScheme:'light'});await page.goto('/');
    await expect(page).toHaveTitle('나의 기록실');
    const menu=page.getByRole('navigation',{name:'주 메뉴',exact:true});
    await expect(menu.getByRole('button',{name:'홈',exact:true})).toHaveAttribute('aria-current','page');
    await expect(menu.getByText('대학원', {exact:true})).toHaveCount(0);
    await expect(menu.locator(':scope > button').filter({hasText:'사진 보관함'})).toHaveCount(1);
    await expect(menu.locator(':scope > button').filter({hasText:'공모전 제출본'})).toHaveCount(1);
    await expect(page.getByRole('region',{name:'경력 요약'})).toBeVisible();
    await expect(page.getByRole('region',{name:'연도별 성장 지도'})).toBeVisible();
    await expect(page.getByText('최근 작업',{exact:true})).toHaveCount(0);
    await expect(page.getByText('최근 활동',{exact:true})).toHaveCount(0);
    await expect(page.getByText('일정과 마감',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'네이버 캘린더 열기'})).toHaveCount(0);
    await expect(page.locator('.top-avatar')).toHaveCount(0);
    await expect(page.locator('body')).toHaveCSS('font-size','16px');
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    expect((await page.request.get(icon!)).status()).toBe(200);
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.fonts.check('14px "Pretendard Variable"','이력 수업 강의 자료 대학원'))).toBe(true);
    await expect(page.locator('body')).toHaveCSS('font-family',/Pretendard Variable/);
    await page.screenshot({path:'/tmp/record-room-home-light.png',animations:'disabled'});
    await page.getByRole('region',{name:'선택한 연도 기록'}).getByRole('button',{name:/홈검증 오늘 특강/}).click();
    await expect(page.getByRole('dialog',{name:'경력 상세',exact:true})).toContainText('홈검증 연수원');
    await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
    await expect(page.getByRole('region',{name:'경력 요약'})).toHaveCount(0);
    await menu.getByRole('button',{name:'홈',exact:true}).click();
    await page.getByRole('region',{name:'즐겨찾는 기록',exact:true}).getByRole('button',{name:/홈검증 최근 강의안/}).click();
    await expect(page.getByRole('dialog',{name:'홈검증 최근 강의안',exact:true})).toBeVisible();
    await expect(page.getByRole('dialog')).not.toContainText('제작자 또는 출처');
    await page.getByRole('dialog').getByRole('button',{name:'닫기',exact:true}).first().click();
    await expect(page.locator('.materials-grid')).toHaveClass(/library-list/);
    await expect(page.locator('.material-card').first()).toHaveCSS('box-shadow','none');
    expect((await page.locator('.material-card').first().boundingBox())!.height).toBeLessThan(115);
    const row = page.locator('.material-card').first();
    const dateBox = await row.locator('.record-upload-date').boundingBox();
    const actionsBox = await row.locator('.library-card-actions').boundingBox();
    expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(actionsBox!.x);
    await page.screenshot({path:'/workspace/artifacts/record-room-compact-materials.png',animations:'disabled'});
    await menu.getByRole('button',{name:'백업 및 설정',exact:true}).click();
    const settingsModes=page.getByRole('group',{name:'설정 화면 모드',exact:true});
    await settingsModes.getByRole('button',{name:'다크',exact:true}).click();
    const topModes=page.getByRole('group',{name:'화면 모드',exact:true});
    await expect(topModes.getByRole('button',{name:'다크',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.app-build')).toContainText('화면 버전');
    await menu.getByRole('button',{name:'홈',exact:true}).click();await page.reload();
    await expect(page.locator('.home-card').first()).toHaveCSS('background-color','rgb(32, 32, 32)');
    await page.screenshot({path:'/tmp/record-room-home-dark.png',animations:'disabled'});
    await page.setViewportSize({width:1280,height:900});
    await expect(topModes).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'경력 추가',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'새 경력 기록하기',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'취소',exact:true}).click();
    expect(errors).toEqual([]);
  } finally {
    if(careerId)expect((await page.request.delete(`/api/careers/${careerId}`)).ok()).toBeTruthy();
    for(const id of createdItems){const workspace=await (await page.request.get('/api/workspace')).json();expect((await page.request.delete(`/api/workspace/items/${id}`,{data:{expectedRevision:workspace.revision}})).ok()).toBeTruthy();}
  }
  expect(await (await page.request.get('/api/data')).json()).toEqual(original);
  const after=await (await page.request.get('/api/workspace')).json();expect(after.items).toEqual(originalWorkspace.items);expect(after.links).toEqual(originalWorkspace.links);
});
