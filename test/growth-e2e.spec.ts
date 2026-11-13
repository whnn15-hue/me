import {test,expect} from '@playwright/test';

test('desktop growth journey animates real records, supports reduced motion and opens the selected year',async({page})=>{
  await page.setViewportSize({width:1600,height:1100});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto('/#home');
  const original=(await (await page.request.get('/api/data')).json());
  const originalWorkspace=(await (await page.request.get('/api/workspace')).json());
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const currentYear=Number(today.slice(0,4));
  const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+24*60*60*1000).toISOString().slice(0,10);
  const created=[];
  const createdItems:string[]=[];
  try {
  const careerFixtures=[
    {title:'성장검증 과거 강의',startDate:`${currentYear-2}-03-02`},
    {title:'성장검증 오늘 강의',startDate:today},
    {title:'성장검증 같은 해 다른 특강',startDate:today},
    {title:'성장검증 교육장 표창',startDate:today,category:'표창'},
    {title:'성장검증 교육감 표창',startDate:today,category:'표창'},
    {title:'성장검증 장관 표창',startDate:today,category:'표창'},
    {title:'성장검증 예정 강의',startDate:`${currentYear+1}-03-02`},
    {title:'성장검증 여러 해 활동',startDate:`${currentYear-3}-03-02`,endDate:today},
    ...(tomorrow.startsWith(String(currentYear))?[{title:'성장검증 올해 예정 강의',startDate:tomorrow}]:[]),
  ];
  for(const item of careerFixtures){
    const result=await page.request.post('/api/careers',{data:{category:'강의·연수',...item,organization:'성장검증 기관',role:'강사',evidenceStatus:'unneeded',datePrecision:'day',verified:true}});
    expect(result.ok()).toBeTruthy();created.push(await result.json());
  }
  const items=[
    {id:'growth_lesson',kind:'project',title:'성장검증 수업',startDate:today},
    {id:'growth_material',kind:'material',title:'성장검증 수학 자료',subjects:['수학'],favorite:true,format:'PDF'},
  ];
  for(const item of items){
    const workspace=(await (await page.request.get('/api/workspace')).json());
    const result=await page.request.post('/api/workspace/items',{data:{item,links:[],expectedRevision:workspace.revision}});expect(result.ok()).toBeTruthy();createdItems.push((await result.json()).items.find((saved:{title:string})=>saved.title===item.title).id);
  }
  await page.reload();
  await expect(page.getByRole('region',{name:'나의 성장',exact:true})).toBeVisible();
  const map=page.getByRole('region',{name:'연도별 성장 지도',exact:true});
  const actual=(await (await page.request.get('/api/data')).json()).careers;
  await expect(map.locator('.atlas-pagination')).toHaveCount(0);
  await expect(map.locator('.atlas-pin')).toHaveCount(currentYear-2020+1);
  for(let year=2020;year<=currentYear;year++){
    const annual=actual.filter((career:{startDate:string})=>career.startDate.startsWith(String(year))&&career.startDate<=today).length;
    const pin=map.getByRole('button',{name:`${year}년 이력 보기, 이 해에 시작한 기록 ${annual}건`,exact:true});
    await expect(pin).toBeVisible();
    if(!annual)await expect(pin).toBeDisabled();else await expect(pin).toBeEnabled();
  }
  const count=actual.filter((career:{startDate:string})=>career.startDate.startsWith(String(currentYear))&&career.startDate<=today).length;
  await expect(map.getByRole('button',{name:`${currentYear}년 이력 보기, 이 해에 시작한 기록 ${count}건`,exact:true})).toBeVisible();
  await expect(map.getByRole('button',{name:new RegExp(`^${currentYear+1}년 이력 보기`)})).toHaveCount(0);
  await expect(map.getByText('GROWTH JOURNEY',{exact:true})).toHaveCount(0);
  await expect(map.getByText('집계 기준',{exact:true})).toHaveCount(0);
  const currentPin=map.getByRole('button',{name:`${currentYear}년 이력 보기, 이 해에 시작한 기록 ${count}건`,exact:true});
  const preview=map.locator('.atlas-milestone');
  await currentPin.hover();
  await expect(preview).toHaveAttribute('aria-label',`${currentYear}년 기록 미리보기`);
  const previewTitle=await preview.locator('strong').innerText();
  const eligibleTitles=actual.filter((career:{startDate:string})=>career.startDate.startsWith(String(currentYear))&&career.startDate<=today).map((career:{title:string})=>career.title.replaceAll('·',','));
  expect(eligibleTitles).toContain(previewTitle);
  await currentPin.focus();
  await expect(preview.locator('strong')).toHaveText(previewTitle);
  await map.locator('.atlas-range').first().hover();
  await currentPin.hover();
  await expect(preview.locator('strong')).not.toHaveText(previewTitle);
  expect(eligibleTitles).toContain(await preview.locator('strong').innerText());
  expect(await preview.locator('strong').evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(24);
  await expect(preview.locator('i')).toHaveCount(0);
  const reel=map.locator('.atlas-reel');
  await expect(reel).toHaveAttribute('aria-label','빛나는 순간');
  await expect(reel.locator('li')).toHaveCount(3);
  const alignment=await reel.evaluate(element=>{
    const panel=element.getBoundingClientRect(),label=element.querySelector('.atlas-reel-label')!.getBoundingClientRect();
    const cards=[...element.querySelectorAll('li')].map(item=>item.getBoundingClientRect());
    return {center:(panel.left+panel.right)/2,label:(label.left+label.right)/2,cards:(cards[0].left+cards.at(-1)!.right)/2};
  });
  expect(Math.abs(alignment.center-alignment.label)).toBeLessThanOrEqual(2);
  expect(Math.abs(alignment.center-alignment.cards)).toBeLessThanOrEqual(2);

  const previewBox=await preview.boundingBox(),canvasBox=await map.locator('.atlas-canvas').boundingBox();
  // The route intentionally climbs behind the title, but the selected title remains readable.
  expect(canvasBox!.y).toBeLessThan(previewBox!.y+previewBox!.height);
  await expect(preview.getByRole('button').first()).toBeVisible();
  const titleVisible=await preview.locator('strong').evaluate(element=>{
    const box=element.getBoundingClientRect(),hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
    return Boolean(hit&&(element.contains(hit)||hit.contains(element)));
  });
  expect(titleVisible).toBe(true);

  const trail=map.locator('.atlas-reveal');
  await expect(trail).toHaveCSS('animation-name','atlas-reveal');
  await expect(trail).toHaveCSS('animation-iteration-count','1');
  // The drawn trail must reach the latest year's pin, not stop short of it.
  await expect.poll(()=>trail.evaluate(element=>element.getAnimations().every(animation=>animation.playState!=='running'))).toBe(true);
  const reach=await map.evaluate(root=>{const line=root.querySelector('.atlas-trail')!.getBoundingClientRect(),pins=[...root.querySelectorAll('.atlas-pin-core')].map(pin=>pin.getBoundingClientRect());const last=pins.at(-1)!;return {lineEnd:line.right,pin:last.left+last.width/2,reveal:getComputedStyle(root.querySelector('.atlas-reveal')!).transform};});
  expect(reach.lineEnd).toBeGreaterThanOrEqual(reach.pin-2);
  expect(['none','matrix(1, 0, 0, 1, 0, 0)']).toContain(reach.reveal);
  await expect(page.getByRole('button',{name:'성장 지도 모션 다시 보기',exact:true})).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(trail).toHaveCSS('animation-name','none');
  await expect(map.locator('.atlas-pin').first()).toHaveCSS('animation-name','none');
  await expect(page.getByRole('button',{name:'성장 지도 모션 다시 보기',exact:true})).toBeHidden();
  await expect(trail).toHaveCSS('transform','none');
  await map.getByRole('button',{name:`${currentYear}년 이력 보기, 이 해에 시작한 기록 ${count}건`,exact:true}).click();
  await expect(page.locator('.career-row')).toHaveCount(count);
  await expect(page.locator('.career-row').filter({hasText:'성장검증 여러 해 활동'})).toHaveCount(0);
  await expect(page.locator('.career-row').filter({hasText:'성장검증 올해 예정 강의'})).toHaveCount(0);
  // The remaining contextual filter can be cleared without leaving hidden constraints.
  await expect(page.locator('.career-context-filter')).toContainText(String(currentYear));
  await page.getByRole('button',{name:'전체 이력 보기',exact:true}).click();
  await expect(page.locator('.career-row').filter({hasText:'성장검증 여러 해 활동'})).toBeVisible();
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'홈',exact:true}).click();
  // A map pin opens the career list filtered to that year (the per-year card and charts were removed from home).
  await map.getByRole('button',{name:new RegExp(`${currentYear-2}년 이력 보기`)}).click();
  await expect(page.locator('.career-context-filter')).toContainText(String(currentYear-2));
  await expect(page.getByRole('combobox',{name:'연도 필터',exact:true})).toHaveCount(0);
  await page.locator('.career-row').filter({hasText:'성장검증 과거 강의'}).click();
  await expect(page.getByRole('dialog',{name:'경력 상세',exact:true})).toContainText('성장검증 과거 강의');
  await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
  await page.getByRole('navigation',{name:'주 메뉴'}).getByRole('button',{name:'홈',exact:true}).click();
  await expect(page.getByRole('region',{name:'연도별 성장 차트',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'선택한 연도 기록',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'기록 달력',exact:true})).toHaveCount(0);
  const main=page.getByRole('navigation',{name:'주 메뉴',exact:true});
  await main.getByRole('button',{name:'홈',exact:true}).click();
  await expect(page.getByRole('region',{name:'분야별 이력 건수',exact:true})).toHaveCount(0);
  await main.getByRole('button',{name:'경력 아카이브',exact:true}).click();
  await page.getByRole('navigation',{name:'이력 분류',exact:true}).getByRole('button',{name:/^강의, 연수/}).click();
  await expect(page.locator('.career-row').filter({hasText:'성장검증 오늘 강의'})).toBeVisible();
  const tree=page.getByRole('navigation',{name:'주 메뉴',exact:true});
  await expect(tree.getByRole('button',{name:/이력 하위 메뉴/})).toHaveCount(1);
  await tree.getByRole('button',{name:'학교 하위 메뉴 펼치기',exact:true}).click();await tree.getByRole('button',{name:'학교에서 학급 자료 보기',exact:true}).click();
  await expect(page.getByRole('tab',{name:/학급 자료/})).toHaveAttribute('aria-selected','true');
  await tree.getByRole('button',{name:'학교에서 수업 자료 보기',exact:true}).click();await expect(page.getByRole('tab',{name:/수업 자료/})).toHaveAttribute('aria-selected','true');
  await tree.getByRole('button',{name:'교안',exact:true}).click();
  await page.getByRole('combobox',{name:'과목 필터',exact:true}).selectOption('수학');
  await expect(page.getByRole('combobox',{name:'과목 필터',exact:true})).toHaveValue('수학');
  await expect(page.getByRole('button',{name:/즐겨찾/})).toHaveCount(0);
  await main.getByRole('button',{name:'홈',exact:true}).click();
  const growth=page.getByRole('region',{name:'나의 성장',exact:true});
  await expect(growth.getByRole('button',{name:/^(접기|펼치기)$/})).toHaveCount(0);
  await page.evaluate(()=>localStorage.setItem('introduce-me-growth-open','false'));
  await page.reload();
  await expect(map).toBeVisible();
  await expect(map.locator('.atlas-pin')).toHaveCount(currentYear-2020+1);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'/tmp/growth-e2e-desktop.png',animations:'disabled'});
  } finally {
    for(const item of created)expect((await page.request.delete(`/api/careers/${item.id}`)).ok()).toBeTruthy();
    for(const id of createdItems){const workspace=(await (await page.request.get('/api/workspace')).json());expect((await page.request.delete(`/api/workspace/items/${id}`,{data:{expectedRevision:workspace.revision}})).ok()).toBeTruthy();}
  }
  const after=(await (await page.request.get('/api/data')).json());expect(after.careers).toEqual(original.careers);expect(after.documents).toEqual(original.documents);
  const afterWorkspace=(await (await page.request.get('/api/workspace')).json());expect(afterWorkspace.items).toEqual(originalWorkspace.items);expect(afterWorkspace.links).toEqual(originalWorkspace.links);
});
