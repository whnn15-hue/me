import {test,expect} from '@playwright/test';
test('desktop overview shows every career, filters the matrix, opens details and leaves data unchanged',async({page})=>{
 await page.setViewportSize({width:1600,height:1100});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const before=await (await page.request.get('/api/data')).json();const extraIds:string[]=[];
 try{
  const response=await page.request.post('/api/careers',{data:{title:'한눈검증 가상 연구대회',category:'연구대회',organization:'한눈검증 교육청',role:'연구자',startDate:'2026',datePrecision:'year',awardGrade:'1등급',awardStages:['본선'],evidenceStatus:'unneeded',verified:true}});expect(response.ok()).toBeTruthy();extraIds.push((await response.json()).id);
  const honor=await page.request.post('/api/careers',{data:{title:'한눈검증 가상 교육 유공 표창',category:'표창',organization:'한눈검증 교육청',startDate:'2024',datePrecision:'year',awardLevel:'시도',awardGrade:'교육감 표창',evidenceStatus:'unneeded',verified:true}});expect(honor.ok()).toBeTruthy();extraIds.push((await honor.json()).id);
  await page.goto('/');await page.getByRole('button',{name:'이력 한눈에 보기',exact:true}).click();
  const overview=page.getByRole('region',{name:'이력 한눈에 보기',exact:true});await expect(overview).toBeVisible();
  await expect(overview.locator('.overview-records tbody tr')).toHaveCount(before.careers.length+extraIds.length);
  await expect(overview.locator('.overview-matrix tfoot td').last()).toHaveText(String(before.careers.length+extraIds.length));
  const honorRow=overview.locator('.overview-records tbody tr').filter({hasText:'한눈검증 가상 교육 유공 표창'});
  await expect(honorRow.locator('td').nth(4)).toHaveText('시도 교육감 표창');
  await expect(honorRow.locator('td').nth(1)).toHaveText('표창');
  await overview.getByLabel('전체 이력 검색').fill('한눈검증 1등급');await expect(overview.locator('.overview-records tbody tr')).toHaveCount(1);await expect(overview).toContainText('한눈검증 교육청');await expect(overview).not.toContainText('연구자');await expect(overview).toContainText('본선');
  await expect(overview.getByRole('columnheader',{name:'역할',exact:true})).toHaveCount(0);
  await overview.getByRole('button',{name:'2026 연구대회 1건',exact:true}).click();await expect(overview.getByRole('button',{name:'전체 펼치기'})).toBeVisible();
  await overview.getByRole('button',{name:'한눈검증 가상 연구대회',exact:true}).click();await expect(page.getByRole('dialog',{name:'경력 상세'})).toContainText('한눈검증 교육청');await page.getByRole('button',{name:'상세 닫기'}).click();
  await expect(overview).toBeVisible();await overview.getByLabel('전체 이력 검색 지우기').click();await overview.getByRole('button',{name:'전체 펼치기'}).click();
  await expect(overview.locator('.overview-records tbody tr')).toHaveCount(before.careers.length+extraIds.length);
  await page.screenshot({path:'/workspace/artifacts/career-overview-light.png',animations:'disabled'});
  // The top-bar theme control was removed; the default "system" mode follows the OS.
  await page.emulateMedia({colorScheme:'dark'});await expect(overview).toHaveCSS('background-color','rgb(32, 32, 32)');await page.screenshot({path:'/workspace/artifacts/career-overview-dark.png',animations:'disabled'});
  await page.setViewportSize({width:1280,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.emulateMedia({media:'print'});await expect(page.locator('.sidebar')).toBeHidden();await expect(overview.locator('.overview-records')).toBeVisible();await page.emulateMedia({media:'screen'});
  await page.getByRole('navigation',{name:'이력 화면',exact:true}).getByRole('button',{name:'목록 관리'}).click();await expect(page.locator('.career-row').filter({hasText:'한눈검증 가상 연구대회'})).toBeVisible();expect(errors).toEqual([]);
  const current=(await (await page.request.get('/api/data')).json()).careers;
  expect(current.find((career:{id:string})=>career.id===extraIds[0]).role).toBe('연구자');
 }finally{for(const id of extraIds)expect((await page.request.delete(`/api/careers/${id}`)).ok()).toBeTruthy();}
 expect((await (await page.request.get('/api/data')).json()).careers).toEqual(before.careers);
});
