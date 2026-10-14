import {test,expect} from '@playwright/test';

test('separate career tabs preserve identities, show award stages, load Paperlogy and support phone layouts',async({page})=>{
  await page.goto('/');
  const before=(await (await page.request.get('/api/data')).json()).careers;
  const fixtures=[
    {title:'구성검증 현장교사 파견',category:'근무·파견',description:'가상 기관 현장교사 파견'},
    {title:'구성검증 집필과 영상 콘텐츠',category:'집필·콘텐츠',role:'집필, 촬영'},
    {title:'구성검증 연구대회',category:'연구·수상',awardLevel:'전국',awardGrade:'1등급',awardStages:['예선','본선']},
  ];
  const created=[];
  for(const item of fixtures){const response=await page.request.post('/api/careers',{data:{...item,startDate:'2026',datePrecision:'year',verified:false,evidenceStatus:'unneeded'}});expect(response.ok()).toBeTruthy();created.push(await response.json());}
  await page.reload();
  const navigate=async(name:string)=>page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name,exact:true}).click();
  await page.locator('.category-tabs').getByRole('button',{name:/연구, 수상/}).click();
  await navigate('파견');
  await expect(page.locator('.career-row').filter({hasText:fixtures[0].title})).toBeVisible();
  await expect(page.locator('.career-row').filter({hasText:fixtures[1].title})).toHaveCount(0);
  await navigate('집필');await expect(page.locator('.career-row').filter({hasText:fixtures[1].title})).toBeVisible();
  await navigate('콘텐츠 제작');await expect(page.locator('.career-row').filter({hasText:fixtures[1].title})).toBeVisible();
  await navigate('경력 아카이브');await page.getByRole('textbox',{name:'경력 검색',exact:true}).fill(fixtures[2].title);
  const award=page.locator('.career-row').filter({hasText:fixtures[2].title});
  await expect(award.locator('.recognition-badges')).toContainText('전국');await expect(award.locator('.recognition-badges')).toContainText('1등급');await expect(award.locator('.recognition-badges')).toContainText('예선');await expect(award.locator('.recognition-badges')).toContainText('본선');
  await award.click();const detail=page.getByRole('dialog',{name:'경력 상세',exact:true});
  await detail.getByRole('button',{name:'경력 수정하기',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'경력 수정하기',exact:true});
  await editor.getByLabel('등급 또는 수상 결과',{exact:true}).fill('최우수상');
  await editor.getByRole('checkbox',{name:'최종',exact:true}).check();
  await editor.getByRole('button',{name:'확인하고 저장',exact:true}).click();await expect(editor).toHaveCount(0);
  await expect(page.locator('.recognition-badges').first()).toContainText('최우수상');
  await page.getByRole('button',{name:'상세 닫기',exact:true}).click();
  expect(await page.evaluate(async()=>{await document.fonts.load('600 24px Paperlogy','수업');return document.fonts.check('600 24px Paperlogy','수업');})).toBeTruthy();
  expect(await page.locator('h1').first().evaluate(element=>getComputedStyle(element).fontFamily)).toContain('Paperlogy');
  await expect(page.getByText('하나씩 쌓아온 경험을, 한눈에 정리하세요.',{exact:true})).toHaveCount(0);
  await page.setViewportSize({width:375,height:812});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('.sidebar').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));
  await page.screenshot({path:'/tmp/streamlined-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});await navigate('강의 자료');await page.getByRole('button',{name:'자료 추가',exact:true}).click();
  const material=page.getByRole('dialog',{name:'강의 자료 추가',exact:true});
  await expect(material.locator('details.optional-fields')).not.toHaveAttribute('open');await expect(material.getByText('내가 만든 자료',{exact:true})).toHaveCount(0);
  await material.getByRole('button',{name:'취소',exact:true}).click();
  for(const item of created)expect((await page.request.delete(`/api/careers/${item.id}`)).ok()).toBeTruthy();
  expect((await (await page.request.get('/api/data')).json()).careers).toEqual(before);
});
