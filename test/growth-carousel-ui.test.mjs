import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const browserOptions = { skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()) };
const bundle = await build({
  absWorkingDir: root,
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {StrictMode,useEffect,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import GrowthOverview from './src/growth/GrowthOverview';
    const record=(id,title,startDate)=>({id,title,startDate,endDate:'',datePrecision:startDate?'day':'year',category:'강의·연수',organization:'가상 교육원',role:'강사',description:'',tags:[],documentIds:[],evidenceStatus:'unneeded',verified:true});
    const initial=[record('old','첫 걸음 연수','2020-03-01'),record('first','함께하는 수업','2021-04-01'),record('second','배움 나눔 연수','2021-09-01'),record('recent','성장하는 교실','2025-03-01'),record('undated','연도 없는 자격',''),record('future','예정된 미래 연수','2030-01-01')];
    const snapshots=[];
    const retain=records=>{snapshots.push({records,original:JSON.stringify(records)});return records;};
    globalThis.fixture={ready:false,opened:[],years:[],initial,snapshots,hidden:false};
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>fixture.hidden});
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>fixture.hidden?'hidden':'visible'});
    fixture.visibility=value=>{fixture.hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
    function Fixture(){
      const [careers,setCareers]=useState(()=>retain(initial));
      useEffect(()=>{fixture.ready=true;},[]);
      fixture.replace=records=>setCareers(retain(records));
      return <><button id="outside">다른 영역</button><GrowthOverview careers={careers} documents={[]} today="2026-11-13" onYear={year=>fixture.years.push(year)} onOpen={ref=>fixture.opened.push(ref)}/></>;
    }
    createRoot(document.getElementById('root')).render(<StrictMode><Fixture/></StrictMode>);
  ` },
  bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic', loader: { '.css': 'empty' },
  // The component and pure helper have the same stem with different case;
  // esbuild's extensionless resolver otherwise mistakes the helper for the TSX.
  plugins: [{ name: 'exact-celebration-helper', setup(build) {
    build.onResolve({ filter: /^\.\/celebration$/ }, () => ({ path: root + '/src/growth/celebration.ts' }));
  } }],
});

async function fixture(run, reducedMotion = 'no-preference') {
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') return response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle.outputFiles[0].text);
    if (request.url === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<style>body{margin:0;padding:20px}button{margin:4px;min-height:30px}.atlas-route,.atlas-contours,.atlas-horizon,.atlas-watermark,.atlas-pin-orbit{display:none}.atlas-pin{position:static}.atlas-milestone{padding:20px;min-height:100px}.atlas-milestone-record{display:block}small{display:block}</style><div id="root"></div><script src="/bundle.js"></script>');
    response.writeHead(404).end();
  });
  let browser;
  const errors = [], external = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: existsSync(chromiumPath) ? chromiumPath : undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion });
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.addInitScript(() => { sessionStorage.setItem('c-archive-home-intro-v1', 'played'); localStorage.setItem('introduce-me-growth-open', 'false'); });
    const now = new Date('2026-11-13T03:00:00Z');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(new Date(now.getTime() + 1000));
    await page.goto(origin);
    await expect.poll(() => page.evaluate(() => Boolean(globalThis.fixture?.ready))).toBe(true);
    await run(page);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.equal(await page.evaluate(() => fixture.snapshots.every(({records,original}) => JSON.stringify(records) === original)), true, 'Carousel must never modify input records');
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

const title = page => page.locator('.atlas-milestone-record strong');
const next = page => page.getByRole('button', { name: '다음 이력', exact: true });
const previous = page => page.getByRole('button', { name: '이전 이력', exact: true });
const pause = page => page.getByRole('button', { name: '이력 자동 넘김 일시정지', exact: true });
const play = page => page.getByRole('button', { name: '이력 자동 넘김 재생', exact: true });
async function away(page) {
  await page.locator('#outside').hover();
  await page.locator('#outside').focus();
}
async function focusRecordWithKeyboard(page) {
  await page.locator('#outside').focus();
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.keyboard.press('Tab');
    if (await page.locator('.atlas-milestone-record').evaluate(element => element === document.activeElement)) {
      assert.equal(await page.locator('.atlas-milestone-record').evaluate(element => element.matches(':focus-visible')), true);
      return;
    }
  }
  assert.fail('The shown career must be reachable with the keyboard');
}
async function advance(page, milliseconds = 5000) {
  await page.clock.runFor(milliseconds);
  await page.evaluate(() => Promise.resolve());
}

test('growth preview advances every five seconds through actual careers and opens the shown record', browserOptions, async () => {
  await fixture(async page => {
    await pause(page).waitFor();
    const first = await title(page).innerText();
    await advance(page, 4999); await expect(title(page)).toHaveText(first);
    await advance(page, 1); await expect(title(page)).not.toHaveText(first);
    const seen = [first, await title(page).innerText()];
    for (let index = 0; index < 3; index++) { await advance(page); await expect(title(page)).not.toHaveText(seen.at(-1)); seen.push(await title(page).innerText()); }
    assert.equal(new Set(seen).size, 5, 'A cycle visits every eligible career without repetitions');
    assert.deepEqual(new Set(seen), new Set(['첫 걸음 연수','함께하는 수업','배움 나눔 연수','성장하는 교실','연도 없는 자격']));
    const before = await title(page).innerText();
    await next(page).click(); await expect(title(page)).not.toHaveText(before);
    await previous(page).click(); await expect(title(page)).toHaveText(before);
    const shown = await title(page).innerText();
    await page.locator('.atlas-milestone-record').click();
    assert.deepEqual(await page.evaluate(() => fixture.opened), [`career:${await page.evaluate(value => fixture.initial.find(item => item.title === value).id, shown)}`]);
    assert.deepEqual(await page.evaluate(() => fixture.years), []);
  });
});

test('reading and explicit pause hold the preview while year pins retain their random scoped preview', browserOptions, async () => {
  await fixture(async page => {
    await page.locator('.atlas-milestone').hover();
    const hovered = await title(page).innerText();
    await advance(page, 15000); await expect(title(page)).toHaveText(hovered);
    await page.locator('#outside').hover();
    await focusRecordWithKeyboard(page);
    await advance(page, 10000); await expect(title(page)).toHaveText(hovered);
    await away(page); await advance(page); await expect(title(page)).not.toHaveText(hovered);
    const pin = page.getByRole('button', { name: '2021년 이력 보기, 이 해에 시작한 기록 2건', exact: true });
    await pin.hover();
    await expect(page.locator('.atlas-milestone')).toHaveAttribute('aria-label', '2021년 기록 미리보기');
    const yearTitle = await title(page).innerText();
    assert.ok(['함께하는 수업','배움 나눔 연수'].includes(yearTitle));
    await advance(page, 15000); await expect(title(page)).toHaveText(yearTitle);
    await pin.focus(); await expect(title(page)).toHaveText(yearTitle);
    await away(page); await pin.hover(); await expect(title(page)).not.toHaveText(yearTitle);
    await pause(page).click(); await away(page);
    const paused = await title(page).innerText();
    await advance(page, 15000); await expect(title(page)).toHaveText(paused);
    await next(page).click(); await expect(title(page)).not.toHaveText(paused);
    await away(page); const manuallyChanged = await title(page).innerText();
    await advance(page, 10000); await expect(title(page)).toHaveText(manuallyChanged);
    await play(page).click();
    await page.locator('#outside').hover();
    assert.equal(await pause(page).evaluate(element => element === document.activeElement), true, 'Pointer playback leaves focus on its control');
    await expect(page.locator('.atlas-milestone')).toHaveAttribute('data-running', 'true');
    await advance(page);
    await expect(title(page)).not.toHaveText(manuallyChanged);
    await focusRecordWithKeyboard(page);
    const focusedRecord = await title(page).innerText();
    await advance(page, 10000); await expect(title(page)).toHaveText(focusedRecord);
    await pin.hover();
    await expect(title(page)).not.toHaveText(focusedRecord);
    const replacement = await title(page).innerText();
    assert.equal(await page.locator('.atlas-milestone-record').evaluate(element => element === document.activeElement), false, 'The previous focused slide was replaced');
    await page.locator('#outside').hover();
    await expect(page.locator('.atlas-milestone')).toHaveAttribute('data-running', 'true');
    await advance(page); await expect(title(page)).not.toHaveText(replacement);
  });
});

test('maps stay visible despite old collapse preferences, hidden tabs pause, and reduced motion allows manual playback', browserOptions, async () => {
  await fixture(async page => {
    await play(page).waitFor();
    const original = await title(page).innerText();
    await advance(page, 15000); await expect(title(page)).toHaveText(original);
    await next(page).click(); await expect(title(page)).not.toHaveText(original);
    await play(page).click(); await away(page);
    const start = await title(page).innerText(); await advance(page); await expect(title(page)).not.toHaveText(start);
    await page.evaluate(() => fixture.visibility(true));
    const hidden = await title(page).innerText(); await advance(page, 20000); await expect(title(page)).toHaveText(hidden);
    await page.evaluate(() => fixture.visibility(false));
    await advance(page, 4999); await expect(title(page)).toHaveText(hidden);
    await advance(page, 1); await expect(title(page)).not.toHaveText(hidden);
    await expect(page.getByRole('button', { name: '접기', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '성장 지도 모션 다시 보기', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '연도별 성장 지도', exact: true })).toBeVisible();
  }, 'reduce');
});

test('empty and one-record archives avoid carousel controls and live changes never leave a stale record', browserOptions, async () => {
  await fixture(async page => {
    await page.evaluate(() => fixture.replace([]));
    await expect(page.locator('.atlas-milestone')).toHaveCount(0);
    await expect(next(page)).toHaveCount(0); await advance(page, 10000);
    await page.evaluate(() => fixture.replace([fixture.initial.find(item => item.id === 'undated')]));
    await expect(title(page)).toHaveText('연도 없는 자격');
    await expect(page.locator('.atlas-milestone')).toHaveAttribute('aria-label', '이력 미리보기');
    await expect(next(page)).toHaveCount(0); await expect(play(page)).toHaveCount(0); await expect(pause(page)).toHaveCount(0);
    await advance(page, 10000); await expect(title(page)).toHaveText('연도 없는 자격');
    await page.evaluate(() => fixture.replace(fixture.initial.filter(item => item.id === 'first' || item.id === 'second')));
    await next(page).waitFor();
    await page.evaluate(() => fixture.replace([{...fixture.initial.find(item => item.id === 'recent'),title:'수정된 최근 연수'}]));
    await expect(title(page)).toHaveText('수정된 최근 연수');
    await expect(next(page)).toHaveCount(0);
    await advance(page, 10000); await expect(title(page)).toHaveText('수정된 최근 연수');
    await page.evaluate(() => fixture.replace([fixture.initial.find(item => item.id === 'future')]));
    await expect(page.locator('.atlas-milestone')).toHaveCount(0);
  });
});
