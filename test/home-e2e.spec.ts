import {test,expect} from '@playwright/test';

test('desktop home emphasizes missing evidence, keeps libraries accessible and removes repeated summaries',async({page})=>{
  await page.setViewportSize({width:1800,height:1100});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const original=await (await page.request.get('/api/data')).json();
  const originalWorkspace=await (await page.request.get('/api/workspace')).json();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const createdItems:string[]=[];let careerId='';
  try{
    const response=await page.request.post('/api/careers',{data:{title:'홈검증 오늘 특강',startDate:today,category:'강의·연수',organization:'홈검증 연수원',role:'강사',datePrecision:'day',verified:true,evidenceStatus:'later'}});
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
    await expect(page).toHaveTitle('C아카이브');
    const brandAlignment=await page.locator('.sidebar .brand').evaluate(element=>{
      const sidebar=element.closest('.sidebar')!.getBoundingClientRect(),mark=element.querySelector('.brand-icon')!.getBoundingClientRect(),name=element.querySelector('.archive-wordmark')!.getBoundingClientRect();
      const letters=[...element.querySelectorAll('.archive-wordmark > span')].map(span=>span.getBoundingClientRect());
      return {offset:Math.abs((mark.left+name.right)/2-(sidebar.left+sidebar.right)/2),markGap:name.left-mark.right,letterGap:letters[1].left-letters[0].right};
    });
    expect(brandAlignment.offset).toBeLessThanOrEqual(3);
    expect(brandAlignment.markGap).toBeGreaterThanOrEqual(14);
    expect(brandAlignment.letterGap).toBeGreaterThanOrEqual(5);
    const menu=page.getByRole('navigation',{name:'주 메뉴',exact:true});
    await expect(menu.getByRole('button',{name:'홈',exact:true})).toHaveAttribute('aria-current','page');
    await expect(menu.getByText('대학원', {exact:true})).toHaveCount(0);
    await expect(menu.locator('.tree-parent > .nav-item')).toHaveText(['홈','이력','학교','연구 자료','교안','영상 작업']);
    await expect(menu.getByText('보관 도구',{exact:true})).toHaveCount(0);
    await expect(menu.getByRole('button',{name:'백업 및 설정',exact:true})).toHaveCount(0);
    await expect(menu.getByRole('button',{name:'사진 보관함',exact:true})).toHaveCount(0);
    const home=page.locator('.home-dashboard');
    await expect(home).toBeVisible();
    await expect(home.locator('.home-identity,.home-date,.stats-grid,.attention-grid,.home-bottom-actions,.home-backup')).toHaveCount(0);
    await expect(home.getByRole('heading',{name:'C아카이브',exact:true})).toHaveCount(0);
    await expect(home.getByRole('heading',{name:'나의 성장',exact:true})).toHaveCount(0);
    await expect(page.getByRole('region',{name:'경력 요약'})).toHaveCount(0);
    await expect(home.getByRole('button',{name:/이력서와 제출용 증빙 만들기|전체 기록 백업|날짜 입력|공문 연결/})).toHaveCount(0);
    await expect(page.getByRole('region',{name:'연도별 성장 지도'})).toBeVisible();
    expect(await home.evaluate(element=>Boolean(element.querySelector('.growth-overview')!.compareDocumentPosition(element.querySelector('.home-evidence-focus')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    const missing=home.getByRole('button',{name:/증빙 보완할 경력/});
    await expect(missing).toBeVisible();
    const totalMissing=original.careers.filter((career:{documentIds:string[];evidenceStatus:string})=>career.evidenceStatus!=='unneeded'&&!career.documentIds.some(id=>original.documents.some((document:{id:string})=>document.id===id))).length+1;
    await expect(missing).toContainText(String(totalMissing));
    await missing.click();
    await expect(page.locator('.career-context-filter')).toContainText('증빙');
    await expect(page.getByRole('button',{name:'전체 이력 보기',exact:true})).toBeVisible();
    await expect(page.locator('.career-row').filter({hasText:'홈검증 오늘 특강'})).toBeVisible();
    await expect(page.getByText('이 기록은 본인만 볼 수 있어요.',{exact:true})).toHaveCount(0);
    await expect(page.locator('.career-search-toolbar,.career-extra-filters,.archive-result-bar,.active-filter-chips')).toHaveCount(0);
    await menu.getByRole('button',{name:'홈',exact:true}).click();
    await expect(page.getByText('최근 작업',{exact:true})).toHaveCount(0);
    await expect(page.getByText('최근 활동',{exact:true})).toHaveCount(0);
    await expect(page.getByText('일정과 마감',{exact:true})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'네이버 캘린더 열기'})).toHaveCount(0);
    await expect(page.locator('.top-avatar')).toHaveCount(0);
    await expect(page.locator('body')).toHaveCSS('font-size','16px');
    const icon = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
    expect((await page.request.get(icon!)).status()).toBe(200);
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.fonts.check('14px "Pretendard Variable"','이력 수업 강의 자료 대학원'))).toBe(true);
    await expect(page.locator('body')).toHaveCSS('font-family',/Pretendard Variable/);
    await page.screenshot({path:'/workspace/artifacts/workspace-home-light.png',animations:'disabled'});
    // The per-year card was removed; the growth map opens the year in the career list instead.
    await expect(page.getByRole('region',{name:'선택한 연도 기록'})).toHaveCount(0);
    await expect(home.getByRole('button',{name:/^(접기|펼치기)$/})).toHaveCount(0);
    await page.getByRole('button',{name:new RegExp(`^${today.slice(0,4)}년 이력 보기`)}).click();
    await expect(page.locator('.career-row').filter({hasText:'홈검증 오늘 특강'})).toBeVisible();
    await expect(page.getByRole('region',{name:'경력 요약'})).toHaveCount(0);
    await menu.getByRole('button',{name:'홈',exact:true}).click();
    await expect(page.getByRole('region',{name:'즐겨찾는 기록',exact:true})).toHaveCount(0);
    await menu.getByRole('button',{name:'교안',exact:true}).click();
    await page.getByRole('button',{name:'홈검증 최근 강의안 상세보기',exact:true}).click();
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
    await page.getByRole('button',{name:'보관함과 설정',exact:true}).click();
    await page.getByRole('menu',{name:'보관함과 설정',exact:true}).getByRole('menuitem',{name:'백업 및 설정',exact:true}).click();
    const settingsModes=page.getByRole('group',{name:'설정 화면 모드',exact:true});
    await settingsModes.getByRole('button',{name:'다크',exact:true}).click();
    // The top-bar theme control was removed; settings is the only place to choose it.
    await expect(page.getByRole('group',{name:'화면 모드',exact:true})).toHaveCount(0);
    await expect(settingsModes.getByRole('button',{name:'다크',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.app-build')).toContainText('화면 버전');
    await menu.getByRole('button',{name:'홈',exact:true}).click();await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await expect(page.getByRole('region',{name:'연도별 성장 지도'})).toBeVisible();
    await page.screenshot({path:'/workspace/artifacts/workspace-home-dark.png',animations:'disabled'});
    for(const viewport of [{width:1440,height:900},{width:1366,height:768}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(()=>window.scrollTo(0,0));
      await expect(page.getByRole('combobox',{name:'모든 기록 검색어',exact:true})).toBeInViewport();
      await expect(home.locator('.home-support-row')).toBeInViewport({ratio:1});
      const layout=await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,screenWidth:innerWidth,screenHeight:innerHeight}));
      expect(layout.width).toBeLessThanOrEqual(layout.screenWidth);
      expect(layout.height).toBeLessThanOrEqual(layout.screenHeight+2);
      for(const stat of await home.locator('.atlas-hero-stats > div').all()) {
        await expect(stat.locator('dt')).toHaveCSS('text-align','center');
        await expect(stat.locator('dd')).toHaveCSS('justify-content','center');
      }
      for(const pin of await home.locator('.atlas-pin:not(:disabled)').all()) {
        const hit=await pin.evaluate(element=>{
          const core=element.querySelector('.atlas-pin-core')!.getBoundingClientRect();
          const target=document.elementFromPoint(core.x+core.width/2,core.y+core.height/2);
          return {name:element.getAttribute('aria-label'),clickable:target?.closest('.atlas-pin')===element};
        });
        expect(hit.clickable,`${viewport.width}x${viewport.height}: ${hit.name}`).toBe(true);
      }
      await page.screenshot({path:`/workspace/artifacts/dashboard-${viewport.width}x${viewport.height}.png`,animations:'disabled'});
    }
    const input=page.getByRole('combobox',{name:'모든 기록 검색어',exact:true});
    await input.fill('홈검증 오늘 특강');
    await expect(input).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const results=page.getByRole('region',{name:'통합 검색 결과',exact:true});
    await expect(results.getByRole('listbox',{name:'검색 결과',exact:true}).getByRole('option').first()).toContainText('홈검증 오늘 특강');
    await input.press('Enter');
    await expect(page.getByRole('dialog',{name:'경력 상세',exact:true})).toContainText('홈검증 오늘 특강');
    await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
    await menu.getByRole('button',{name:'홈',exact:true}).click();
    await page.keyboard.press('Control+k');
    await expect(input).toBeFocused();
    await input.fill('');
    await input.press('Escape');
    await expect(results).toHaveCount(0);
    await page.getByRole('button',{name:'경력 추가',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'새 경력 기록하기',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'취소',exact:true}).click();
    await page.setViewportSize({width:1440,height:900});
    await menu.getByRole('button',{name:'경력 아카이브',exact:true}).click();
    const selectedCategory=page.locator('.career-collections button.active');
    await expect(selectedCategory).toHaveAttribute('aria-pressed','true');
    const categoryContrast=await selectedCategory.evaluate(element=>{
      const style=getComputedStyle(element),inactive=getComputedStyle(element.parentElement!.querySelector('button:not(.active)')!);
      const luminance=(color:string)=>{
        const channels=color.match(/[\d.]+/g)!.slice(0,3).map(value=>Number(value)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
        return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
      };
      const foreground=luminance(style.color),background=luminance(style.backgroundColor);
      return {contrast:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05),distinct:style.backgroundColor!==inactive.backgroundColor};
    });
    expect(categoryContrast.distinct).toBe(true);
    expect(categoryContrast.contrast).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({path:'/workspace/artifacts/dashboard-career-dark.png',animations:'disabled'});
    await menu.getByRole('button',{name:'연구 자료',exact:true}).click();
    await expect(page.getByRole('heading',{name:/^연구대회 자료/})).toBeVisible();
    await page.screenshot({path:'/workspace/artifacts/dashboard-research-dark.png',animations:'disabled'});
    expect(errors).toEqual([]);
  } finally {
    if(careerId)expect((await page.request.delete(`/api/careers/${careerId}`)).ok()).toBeTruthy();
    for(const id of createdItems){const workspace=await (await page.request.get('/api/workspace')).json();expect((await page.request.delete(`/api/workspace/items/${id}`,{data:{expectedRevision:workspace.revision}})).ok()).toBeTruthy();}
  }
  expect(await (await page.request.get('/api/data')).json()).toEqual(original);
  const after=await (await page.request.get('/api/workspace')).json();expect(after.items).toEqual(originalWorkspace.items);expect(after.links).toEqual(originalWorkspace.links);
});
