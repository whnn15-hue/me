import {test,expect} from '@playwright/test';

test('desktop palette follows the system live across all workspaces without losing drafts or changing data',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1600,height:1200});
  await page.emulateMedia({colorScheme:'light'});
  await page.goto('/');
  const original=await (await page.request.get('/api/data')).json();
  const originalWorkspace=await (await page.request.get('/api/workspace')).json();
  const main=page.getByRole('navigation',{name:'기록 종류',exact:true});
  const root=page.locator('.main-shell');
  await expect(root).toHaveCSS('background-color','rgb(243, 243, 243)');
  await expect(page.getByRole('region',{name:'기록 달력',exact:true})).toHaveCount(0);
  await expect(page.locator('.growth-card').first()).toHaveCSS('background-color','rgb(255, 255, 255)');
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'/tmp/introduce-me-neutral-light.png',animations:'disabled'});
  await page.getByRole('button',{name:'경력 추가',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'새 경력 기록하기',exact:true});
  const title=editor.getByPlaceholder('어떤 경험을 하셨나요?');
  await title.fill('테마 전환 중 유지할 작성 내용');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(root).toHaveCSS('background-color','rgb(20, 20, 20)');
  await expect(title).toHaveValue('테마 전환 중 유지할 작성 내용');
  await expect(editor).toHaveCSS('background-color','rgb(32, 32, 32)');
  await expect(title).toHaveCSS('color','rgb(237, 237, 237)');
  await page.screenshot({path:'/tmp/introduce-me-dark-editor.png',animations:'disabled'});
  await editor.getByRole('button',{name:'취소',exact:true}).click();
  await expect(page.locator('.growth-card').first()).toHaveCSS('background-color','rgb(32, 32, 32)');
  await expect(page.locator('.chart-axis').first()).toHaveCSS('fill','rgb(182, 182, 182)');
  await page.screenshot({path:'/tmp/introduce-me-neutral-dark.png',animations:'disabled'});
  // Every tab uses the same semantic surfaces, including its editor.
  for(const [tab,add,dialog] of [['수업','수업 추가','새 수업 기록'],['강의 자료','자료 추가','강의 자료 추가'],['대학원','강좌 추가','강좌 추가']]){
    await main.getByRole('button',{name:tab,exact:true}).click();
    await expect(root).toHaveCSS('background-color','rgb(20, 20, 20)');
    await page.getByRole('button',{name:add,exact:true}).first().click();
    const modal=page.getByRole('dialog',{name:dialog,exact:true});
    await expect(modal).toHaveCSS('background-color','rgb(32, 32, 32)');
    await expect(modal.locator('input').first()).toHaveCSS('color','rgb(237, 237, 237)');
    await modal.getByRole('button',{name:'취소',exact:true}).click();
  }
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'백업 및 설정',exact:true}).click();
  await expect(page.locator('.settings-card').first()).toHaveCSS('background-color','rgb(32, 32, 32)');
  await page.screenshot({path:'/tmp/introduce-me-dark-settings.png',animations:'disabled'});
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'경력 아카이브',exact:true}).click();
  await page.locator('.global-search-trigger').click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color','rgb(32, 32, 32)');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(root).toHaveCSS('background-color','rgb(20, 20, 20)');
  await page.emulateMedia({colorScheme:'light'});
  await expect(root).toHaveCSS('background-color','rgb(243, 243, 243)');
  await expect(page.locator('.growth-card').first()).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect(await (await page.request.get('/api/data')).json()).toEqual(original);
  expect(await (await page.request.get('/api/workspace')).json()).toEqual(originalWorkspace);
  expect(errors).toEqual([]);
});
