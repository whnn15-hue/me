import {test,expect} from '@playwright/test';
test('desktop overview shows every career, filters the matrix, opens details and leaves data unchanged',async({page})=>{
 await page.setViewportSize({width:1600,height:1100});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const before=await (await page.request.get('/api/data')).json();let extraId='';
 try{
  const response=await page.request.post('/api/careers',{data:{title:'한눈검증 가상 연구대회',category:'연구대회',organization:'한눈검증 교육청',role:'연구자',startDate:'2026',datePrecision:'year',awardGrade:'1등급',awardStages:['본선'],evidenceStatus:'unneeded',verified:true}});expect(response.ok()).toBeTruthy();extraId=(await response.json()).id;
  await page.goto('/');await page.getByRole('button',{name:'이력 한눈에 보기',exact:true}).click();
  const overview=page.getByRole('region',{name:'이력 한눈에 보기',exact:true});await expect(overview).toBeVisible();
  await expect(overview.locator('.overview-records tbody tr')).toHaveCount(before.careers.length+1);
  await expect(overview.locator('.overview-matrix tfoot td').last()).toHaveText(String(before.careers.length+1));
  await overview.getByLabel('전체 이력 검색').fill('한눈검증 1등급');await expect(overview.locator('.overview-records tbody tr')).toHaveCount(1);await expect(overview).toContainText('한눈검증 교육청');await expect(overview).toContainText('연구자');await expect(overview).toContainText('본선');
  await overview.getByRole('button',{name:'2026 연구대회 1건',exact:true}).click();await expect(overview.getByRole('button',{name:'전체 펼치기'})).toBeVisible();
  await overview.getByRole('button',{name:'한눈검증 가상 연구대회',exact:true}).click();await expect(page.getByRole('dialog',{name:'경력 상세'})).toContainText('한눈검증 교육청');await page.getByRole('button',{name:'상세 닫기'}).click();
  await expect(overview).toBeVisible();await overview.getByLabel('전체 이력 검색 지우기').click();await overview.getByRole('button',{name:'전체 펼치기'}).click();
  await expect(overview.locator('.overview-records tbody tr')).toHaveCount(before.careers.length+1);
  await page.screenshot({path:'/workspace/artifacts/career-overview-light.png',animations:'disabled'});
  await page.getByRole('group',{name:'화면 모드',exact:true}).getByRole('button',{name:'다크',exact:true}).click();await expect(overview).toHaveCSS('background-color','rgb(32, 32, 32)');await page.screenshot({path:'/workspace/artifacts/career-overview-dark.png',animations:'disabled'});
  await page.setViewportSize({width:1280,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.emulateMedia({media:'print'});await expect(page.locator('.sidebar')).toBeHidden();await expect(overview.locator('.overview-records')).toBeVisible();await page.emulateMedia({media:'screen'});
  await page.getByRole('button',{name:'목록 관리',exact:true}).click();await expect(page.locator('.career-row').filter({hasText:'한눈검증 가상 연구대회'})).toBeVisible();expect(errors).toEqual([]);
 }finally{if(extraId)expect((await page.request.delete(`/api/careers/${extraId}`)).ok()).toBeTruthy();}
 expect((await (await page.request.get('/api/data')).json()).careers).toEqual(before.careers);
});
