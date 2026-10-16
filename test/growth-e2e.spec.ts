import {test,expect} from '@playwright/test';

test('growth map, real-data charts and nested workspace routes preserve the archive',async({page})=>{
  await page.goto('/#careers');
  const original=(await (await page.request.get('/api/data')).json());
  const originalWorkspace=(await (await page.request.get('/api/workspace')).json());
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const currentYear=Number(today.slice(0,4));
  const created=[];
  const createdItems:string[]=[];
  try {
  for(const [title,startDate] of [['성장검증 과거 강의',`${currentYear-2}-03-02`],['성장검증 오늘 강의',today]]){
    const result=await page.request.post('/api/careers',{data:{title,startDate,category:'강의·연수',organization:'성장검증 기관',role:'강사',evidenceStatus:'unneeded',datePrecision:'day',verified:true}});
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
  await map.getByRole('button',{name:new RegExp(`${currentYear-2}년 성장 기록`)}).click();
  const yearRecords=page.getByRole('region',{name:'선택한 연도 기록',exact:true});
  await expect(yearRecords.getByRole('heading')).toContainText(`${currentYear-2}년`);
  await yearRecords.getByRole('button',{name:/성장검증 과거 강의/}).click();
  await expect(page.getByRole('dialog',{name:'경력 상세',exact:true})).toContainText('성장검증 과거 강의');
  await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
  const chart=page.getByRole('region',{name:'연도별 성장 차트',exact:true});
  await chart.getByRole('button',{name:'연도별',exact:true}).click();await expect(chart.getByRole('button',{name:'연도별',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(chart.locator('svg rect')).not.toHaveCount(0);
  await chart.getByRole('button',{name:'수치 보기',exact:true}).click();
  await expect(chart.getByRole('table')).toBeVisible();
  await chart.getByRole('button',{name:'누적',exact:true}).click();
  await chart.getByRole('combobox',{name:'성장 차트 기간',exact:true}).selectOption('all');
  await chart.getByRole('button',{name:'수치 접기',exact:true}).click();
  await expect(page.getByRole('region',{name:'기록 달력',exact:true})).toHaveCount(0);
  const main=page.getByRole('navigation',{name:'기록 종류',exact:true});
  await main.getByRole('button',{name:'이력',exact:true}).click();
  const fields=page.getByRole('region',{name:'분야별 이력 건수',exact:true});
  await fields.getByRole('button',{name:/강의, 연수/}).click();
  await expect(page.locator('.career-row').filter({hasText:'성장검증 오늘 강의'})).toBeVisible();
  const tree=page.getByRole('navigation',{name:'주 메뉴',exact:true});
  await tree.getByRole('button',{name:'이력 하위 메뉴 접기',exact:true}).click();
  await page.reload();await expect(tree.getByRole('button',{name:'이력 하위 메뉴 펼치기',exact:true})).toHaveAttribute('aria-expanded','false');
  await tree.getByRole('button',{name:'수업 하위 메뉴 펼치기',exact:true}).click();await tree.getByRole('button',{name:'수업에서 학급 자료 보기',exact:true}).click();
  await expect(page.getByRole('tab',{name:/학급 자료/})).toHaveAttribute('aria-selected','true');
  await tree.getByRole('button',{name:'수업에서 수업 기록 보기',exact:true}).click();await expect(page.getByRole('tab',{name:/수업 기록/})).toHaveAttribute('aria-selected','true');
  await tree.getByRole('button',{name:'강의 자료 하위 메뉴 펼치기',exact:true}).click();await tree.getByRole('button',{name:'강의 자료에서 수학 보기',exact:true}).click();
  await expect(page.getByRole('group',{name:'과목 필터',exact:true}).getByRole('button',{name:/^수학/})).toHaveAttribute('aria-pressed','true');
  await tree.getByRole('button',{name:'강의 자료에서 즐겨찾기 보기',exact:true}).click();
  await expect(page.getByRole('group',{name:'자료 빠른 필터',exact:true}).getByRole('button',{name:/즐겨찾기/})).toHaveAttribute('aria-pressed','true');
  await tree.getByRole('button',{name:'대학원 하위 메뉴 펼치기',exact:true}).click();await tree.getByRole('button',{name:'대학원에서 논문 노트 보기',exact:true}).click();
  await expect(page.getByRole('tab',{name:/논문 노트/})).toHaveAttribute('aria-selected','true');
  await main.getByRole('button',{name:'이력',exact:true}).click();
  const growth=page.getByRole('region',{name:'나의 성장',exact:true});
  await growth.getByRole('button',{name:'접기',exact:true}).click();await expect(map).toHaveCount(0);await page.reload();await expect(map).toHaveCount(0);await growth.getByRole('button',{name:'펼치기',exact:true}).click();
  expect((await page.request.get('/art/growth-landscape.webp')).ok()).toBeTruthy();expect((await page.request.get('/art/workspace-symbols.webp')).ok()).toBeTruthy();
  await page.setViewportSize({width:1600,height:1200});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'/tmp/growth-e2e-desktop.png',animations:'disabled'});
  } finally {
    for(const item of created)expect((await page.request.delete(`/api/careers/${item.id}`)).ok()).toBeTruthy();
    for(const id of createdItems){const workspace=(await (await page.request.get('/api/workspace')).json());expect((await page.request.delete(`/api/workspace/items/${id}`,{data:{expectedRevision:workspace.revision}})).ok()).toBeTruthy();}
  }
  const after=(await (await page.request.get('/api/data')).json());expect(after.careers).toEqual(original.careers);expect(after.documents).toEqual(original.documents);
  const afterWorkspace=(await (await page.request.get('/api/workspace')).json());expect(afterWorkspace.items).toEqual(originalWorkspace.items);expect(afterWorkspace.links).toEqual(originalWorkspace.links);
});
