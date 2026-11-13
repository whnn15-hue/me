import {test,expect} from '@playwright/test';

test('careers use one compact list with aligned institutions and a concise detail drawer without rewriting records',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const before=await (await page.request.get('/api/data')).json();
  const extraIds:string[]=[];
  const fixtures=[
    {title:'목록검증 가상 연구대회',category:'연구대회',organization:'목록검증 교육청',role:'보존할 연구 역할',startDate:'2026',datePrecision:'year',awardLevel:'전국',awardGrade:'1등급',awardStages:['본선'],description:'보존할 개인 연구 메모',tags:['연구메모'],source:'기술적인 가져오기 출처'},
    {title:'목록검증 가상 교원 연수',category:'강의·연수',organization:'목록검증 교육연수원',startDate:'2026-10-01',datePrecision:'day'},
    {title:'목록검증 교육자료 공모전',category:'공모전 수상',organization:'목록검증 공모기관',startDate:'2026-09-02',datePrecision:'day',awardGrade:'우수상'},
    {title:'목록검증 기관 없는 지원단',category:'위원회·지원단',startDate:'2026',datePrecision:'year'},
  ];
  try{
    for(const item of fixtures){
      const response=await page.request.post('/api/careers',{data:{...item,evidenceStatus:'unneeded',verified:true}});
      expect(response.ok()).toBeTruthy();extraIds.push((await response.json()).id);
    }
    const seeded=(await (await page.request.get('/api/data')).json()).careers;
    await page.goto('/');await page.getByRole('button',{name:'이력 보기',exact:true}).click();
    await expect(page.locator('.career-mode-tabs,.career-overview')).toHaveCount(0);
    await expect(page.getByRole('navigation',{name:'이력 화면',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'한눈에 보기',exact:true})).toHaveCount(0);
    await expect(page.locator('.career-row')).toHaveCount(seeded.length);
    await expect(page.locator('.archive-upload-hint')).toHaveCount(0);
    const row=(index:number)=>page.locator(`.career-entry[data-career-id="${extraIds[index]}"] .career-row`);
    const measures=[];
    for(let index=0;index<fixtures.length;index++){
      await expect(row(index)).toBeVisible();
      await expect(row(index).locator('.career-row-organization')).toHaveText(fixtures[index].organization??'');
      const measure=await row(index).evaluate(element=>{
        const box=element.getBoundingClientRect(),title=element.querySelector('h4')!.getBoundingClientRect(),org=element.querySelector('.career-row-organization')!.getBoundingClientRect();
        return {height:box.height,titleRight:title.right,orgLeft:org.left,titleCenter:title.y+title.height/2,orgCenter:org.y+org.height/2};
      });
      expect(measure.height).toBeLessThanOrEqual(92);
      expect(measure.orgLeft).toBeGreaterThanOrEqual(measure.titleRight);
      measures.push(measure);
    }
    expect(Math.max(...measures.map(item=>item.orgLeft))-Math.min(...measures.map(item=>item.orgLeft))).toBeLessThanOrEqual(2);
    await expect(row(3)).not.toContainText('기관 미입력');
    await expect(row(0).locator('.recognition-badges')).toContainText('전국');
    await expect(row(0).locator('.recognition-badges')).toContainText('1등급');
    await row(0).click();
    const detail=page.getByRole('dialog',{name:'경력 상세',exact:true});
    await expect(detail).toContainText(fixtures[0].organization!);
    await expect(detail).toContainText('2026');
    await expect(detail.getByText('보존할 연구 역할',{exact:true})).toHaveCount(0);
    await expect(detail.locator('.source-note,.detail-empty')).toHaveCount(0);
    await expect(detail.locator('.detail-more')).not.toHaveAttribute('open');
    await expect(detail.getByText('보존할 개인 연구 메모',{exact:true})).toBeHidden();
    await detail.locator('.detail-more > summary').click();
    await expect(detail.getByText('보존할 개인 연구 메모',{exact:true})).toBeVisible();
    await detail.getByRole('button',{name:'상세 닫기',exact:true}).click();
    await row(3).click();
    await expect(detail.locator('.detail-more,.detail-empty,.source-note')).toHaveCount(0);
    await expect(detail).not.toContainText('기관 미입력');
    await expect(detail).not.toContainText('등록된 태그가 없어요');
    await detail.getByRole('button',{name:'상세 닫기',exact:true}).click();
    for(const viewport of [{width:1440,height:900},{width:1366,height:768}]){
      await page.setViewportSize(viewport);await page.emulateMedia({colorScheme:'dark'});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`/workspace/artifacts/polished-careers-${viewport.width}.png`,animations:'disabled'});
    }
    await page.getByRole('navigation',{name:'이력 분류',exact:true}).getByRole('button',{name:/^연구대회/}).click();
    expect((await row(0).boundingBox())!.height).toBeLessThanOrEqual(92);
    expect((await (await page.request.get('/api/data')).json()).careers).toEqual(seeded);
    expect(errors).toEqual([]);
  }finally{for(const id of extraIds)expect((await page.request.delete(`/api/careers/${id}`)).ok()).toBeTruthy();}
  expect((await (await page.request.get('/api/data')).json()).careers).toEqual(before.careers);
});
