import {test,expect} from '@playwright/test';

test('visible theme controls override the OS, persist, and sync between desktop tabs',async({page,context})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.emulateMedia({colorScheme:'light'});
  await page.goto('/');
  const original=await (await page.request.get('/api/data')).json();
  const originalWorkspace=await (await page.request.get('/api/workspace')).json();
  const modes=page.getByRole('group',{name:'화면 모드',exact:true});
  const root=page.locator('.main-shell');
  for(const label of ['라이트','다크','시스템']){
    await expect(modes.getByRole('button',{name:label,exact:true})).toBeInViewport();
  }
  await expect(modes.getByRole('button',{name:'시스템',exact:true})).toHaveAttribute('aria-pressed','true');
  await modes.getByRole('button',{name:'다크',exact:true}).click();
  await expect(root).toHaveCSS('background-color','rgb(20, 20, 20)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#141414');
  await page.reload();
  await expect(modes.getByRole('button',{name:'다크',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(root).toHaveCSS('background-color','rgb(20, 20, 20)');
  await page.emulateMedia({colorScheme:'dark'});
  await page.emulateMedia({colorScheme:'light'});
  await expect(root).toHaveCSS('background-color','rgb(20, 20, 20)');
  await page.emulateMedia({colorScheme:'dark'});
  await modes.getByRole('button',{name:'라이트',exact:true}).click();
  await expect(root).toHaveCSS('background-color','rgb(243, 243, 243)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#f3f3f3');
  await page.reload();
  await expect(modes.getByRole('button',{name:'라이트',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(root).toHaveCSS('background-color','rgb(243, 243, 243)');
  // A second tab follows saved preferences, while each tab resolves its own OS mode.
  const second=await context.newPage();
  await second.emulateMedia({colorScheme:'light'});
  await second.goto('/');
  const secondModes=second.getByRole('group',{name:'화면 모드',exact:true});
  await expect(secondModes.getByRole('button',{name:'라이트',exact:true})).toHaveAttribute('aria-pressed','true');
  await modes.getByRole('button',{name:'다크',exact:true}).click();
  await expect(second.locator('.main-shell')).toHaveCSS('background-color','rgb(20, 20, 20)');
  await modes.getByRole('button',{name:'시스템',exact:true}).click();
  await expect(root).toHaveCSS('background-color','rgb(20, 20, 20)');
  await expect(second.locator('.main-shell')).toHaveCSS('background-color','rgb(243, 243, 243)');
  await expect(secondModes.getByRole('button',{name:'시스템',exact:true})).toHaveAttribute('aria-pressed','true');
  await second.close();
  // Standard keyboard focus can activate the control as well.
  await modes.getByRole('button',{name:'라이트',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect(root).toHaveCSS('background-color','rgb(243, 243, 243)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await (await page.request.get('/api/data')).json()).toEqual(original);
  expect(await (await page.request.get('/api/workspace')).json()).toEqual(originalWorkspace);
});

test('theme selection works when browser storage is blocked',async({page})=>{
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>{
    Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}});
  });
  await page.goto('/');
  const modes=page.getByRole('group',{name:'화면 모드',exact:true});
  await expect(modes).toBeVisible();
  await modes.getByRole('button',{name:'다크',exact:true}).click();
  await expect(page.locator('.main-shell')).toHaveCSS('background-color','rgb(20, 20, 20)');
  await expect(modes.getByRole('button',{name:'다크',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('desktop palette follows the system live across all workspaces without losing drafts or changing data',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1600,height:1200});
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>{
    if(!localStorage.getItem('introduce-me-theme')) localStorage.setItem('introduce-me-theme','invalid');
  });
  await page.goto('/#home');
  const original=await (await page.request.get('/api/data')).json();
  const originalWorkspace=await (await page.request.get('/api/workspace')).json();
  const main=page.getByRole('navigation',{name:'주 메뉴',exact:true});
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
  for(const [tab,add,dialog] of [['수업','수업 추가','새 수업 기록'],['강의 자료','자료 추가','강의 자료 추가']]){
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
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'홈',exact:true}).click();
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
