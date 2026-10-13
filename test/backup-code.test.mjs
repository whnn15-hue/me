import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const decoderOutput = await build({ entryPoints: ['src/backup-code.ts'], absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', write: false });
const { backupFileFromCode } = await import(`data:text/javascript;base64,${Buffer.from(decoderOutput.outputFiles[0].contents).toString('base64')}`);

// These records are synthetic. Personal seed data and real credentials must not
// enter the fixture bundle or the browser used for this test.
function fakeCareers(suffix = '') {
  return [
    { id: 'fixture_one', title: `테스트 강의${suffix}`, category: '강의·연수', organization: '가상 기관', role: '강사', startDate: '2024', endDate: '', datePrecision: 'year', description: '복원 검사용 자료', tags: ['검증'], evidenceStatus: 'unneeded', verified: false, documentIds: [] },
    { id: 'fixture_two', title: `테스트 연구${suffix}`, category: '연구·수상', organization: '가상 연구회', role: '연구원', startDate: '2025-03-14', endDate: '', datePrecision: 'day', description: '실제 경력이 아닌 테스트 자료', tags: [], evidenceStatus: 'later', verified: false, documentIds: [] },
  ];
}
async function syntheticZip(suffix = '') {
  const archive = new JSZip();
  archive.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, createdAt: '2026-01-01T00:00:00.000Z', careers: fakeCareers(suffix), documents: [] }));
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const archive = await syntheticZip();
const code = bytes => `IMBK1:${Buffer.from(bytes).toString('base64')}`;
const wrapped = value => ` \r\n${value.slice(0, 6)}\n\t${value.slice(6).match(/.{1,53}/g).join('\r\n ')}\t `;
const safeKoreanError = error => {
  assert.ok(error instanceof Error);
  assert.match(error.message, /[가-힣]/);
  assert.doesNotMatch(error.message, /PRIVATE_INPUT_SENTINEL|InvalidCharacterError|atob|RangeError|<script>/);
  return true;
};

test('backup code preserves synthetic ZIP bytes and Korean records after whitespace wrapping', async () => {
  for (const input of [code(archive), wrapped(code(archive))]) {
    const file = backupFileFromCode(input);
    assert.ok(file instanceof File);
    assert.equal(file.type, 'application/zip');
    assert.match(file.name, /\.zip$/);
    const result = Buffer.from(await file.arrayBuffer());
    assert.deepEqual(result, archive);
    const zip = await JSZip.loadAsync(result, { checkCRC32: true });
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.deepEqual(manifest.careers, fakeCareers());
    assert.deepEqual(manifest.documents, []);
  }
});

test('backup code rejects missing versions, malformed or truncated base64 and non-ZIP data safely', () => {
  const header = Buffer.alloc(31); header.set([0x50, 0x4b, 0x03, 0x04]);
  const noncanonical = header.toString('base64').slice(0, -4) + 'AB==';
  const invalid = [
    '', archive.toString('base64'), code(archive).replace('IMBK1:', 'IMBK2:'),
    code(archive).replace('IMBK1:', 'imbk1:'), `설명 ${code(archive)}`,
    'IMBK1:<script>PRIVATE_INPUT_SENTINEL</script>', 'IMBK1:AA-A', 'IMBK1:AA_A',
    'IMBK1:AA==AAAA', 'IMBK1:AAAA====', 'IMBK1:====', 'IMBK1:AAA',
    code(archive).slice(0, -1), `IMBK1:${noncanonical}`,
    code(Buffer.from('ZIP이 아닌 일반 텍스트와 테스트 내용입니다.')),
    code(Buffer.from([0x50, 0x4b])),
  ];
  for (const value of invalid) assert.throws(() => backupFileFromCode(value), safeKoreanError);
});

test('backup code checks the raw 1 MiB text boundary including whitespace and UTF-8 bytes', async () => {
  const limit = 1024 * 1024;
  const valid = code(archive);
  const atLimit = valid + ' '.repeat(limit - valid.length);
  assert.equal(atLimit.length, limit);
  assert.deepEqual(Buffer.from(await backupFileFromCode(atLimit).arrayBuffer()), archive);
  assert.throws(() => backupFileFromCode(atLimit + ' '), safeKoreanError);
  const utf8Oversize = valid + '\u3000'.repeat(Math.floor((limit - valid.length) / 3) + 1);
  assert.ok(utf8Oversize.length < limit);
  assert.ok(Buffer.byteLength(utf8Oversize) > limit);
  assert.throws(() => backupFileFromCode(utf8Oversize), safeKoreanError);
});

test('large permitted backup codes decode without regex stack failures or byte corruption', async () => {
  const bytes = Buffer.alloc(500 * 1024);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
  bytes.set([0x50, 0x4b, 0x03, 0x04]);
  const input = code(bytes);
  assert.ok(input.length < 1024 * 1024);
  const file = backupFileFromCode(input);
  assert.equal(file.size, bytes.length);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
});

test('browser code restore requires confirmation, cancels safely, and validates before writing', {
  skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()),
}, async () => {
  const output = await build({
    absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import BackupSettings from './src/BackupSettings';
      globalThis.fixture = { calls:[], writes:[], errors:[], toasts:[], refreshes:0, holdWrites:true,
        releaseRestore:null, records:[{id:'existing_fixture', title:'기존 테스트 기록'}] };
      function Fixture() {
        const [error,setError]=useState('');
        return <>
          {error && <div role="alert">{error}</div>}
          <BackupSettings careers={1} documents={0}
            status={{mode:'firebase',deploymentMode:'free',firebaseConfigured:true,googleConfigured:true,
              ownerConfigured:true,driveConfigured:false,driveConnected:false,aiConfigured:false,lastBackup:null,
              user:{name:'Fixture Owner',email:'owner@example.test'}}}
            onRefresh={async()=>{globalThis.fixture.refreshes++;}}
            onError={value=>{const message=value instanceof Error?value.message:String(value);globalThis.fixture.errors.push(message);setError(message);}}
            onToast={message=>globalThis.fixture.toasts.push(message)}/>
        </>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, platform: 'browser', format: 'iife', write: false, jsx: 'automatic',
    plugins: [{ name: 'isolated-backup-code-fixture', setup(builder) {
      builder.onResolve({ filter: /^\.\/api$/ }, ({ importer }) => importer.endsWith('/BackupSettings.tsx') ? { path: 'api', namespace: 'fixture' } : undefined);
      builder.onResolve({ filter: /^\.\/cloud$/ }, ({ importer }) => importer.endsWith('/BackupSettings.tsx') ? { path: 'cloud', namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', resolveDir: root, contents: path === 'cloud' ? `
        export const cloudMode=true, freeMode=true;
        export const cloudRefreshToken=async()=>{throw new Error('Unexpected auth action');};
        export const signInCloud=cloudRefreshToken, signOutCloud=cloudRefreshToken;
      ` : `
        import {readBackupFile} from '${root}src/free/backup.ts';
        export async function api(path,options={}) {
          globalThis.fixture.calls.push({path,method:options.method});
          if(path!=='/backup/restore'||options.method!=='POST'||!(options.body instanceof FormData))
            throw new Error('Unexpected fixture API request');
          const file=options.body.get('file');
          if(!(file instanceof File)) throw new Error('Restore did not contain a file');
          const bytes=Array.from(new Uint8Array(await file.arrayBuffer()));
          const result=await readBackupFile(file);
          if(globalThis.fixture.holdWrites) await new Promise(resolve=>{globalThis.fixture.releaseRestore=resolve;});
          globalThis.fixture.writes.push({path,method:options.method,bytes,type:file.type,name:file.name,
            careers:result.careers.length,documents:result.documents.length});
          globalThis.fixture.records=result.careers;
          return {ok:true};
        }
        export async function download(){throw new Error('Unexpected download action');}
      ` }));
    } }],
  });
  const bundle = output.outputFiles[0].text;
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle); return; }
    if (request.url === '/fixture') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<div id="root"></div><script src="/bundle.js"></script>'); return; }
    response.writeHead(404).end();
  });
  let browser, page;
  const pageErrors = [];
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: existsSync(chromiumPath) ? chromiumPath : undefined, args: ['--no-sandbox'] });
    page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const externalRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    await page.goto(origin + '/fixture');
    const input = page.getByLabel('백업 코드', { exact: true });
    const restoreCode = page.getByRole('button', { name: '백업 코드로 복원', exact: true });
    const dialog = page.getByRole('dialog', { name: '백업으로 전체 기록을 복원할까요?', exact: true });
    await input.waitFor({ state: 'visible' });
    assert.equal(await restoreCode.isDisabled(), true);
    const state = () => page.evaluate(() => ({ calls:globalThis.fixture.calls, writes:globalThis.fixture.writes,
      errors:globalThis.fixture.errors, refreshes:globalThis.fixture.refreshes, toasts:globalThis.fixture.toasts,
      records:globalThis.fixture.records }));

    await input.fill('IMBK1:<script>PRIVATE_INPUT_SENTINEL</script>');
    await restoreCode.click();
    await page.getByRole('alert').waitFor({ state: 'visible' });
    const message = await page.getByRole('alert').innerText();
    assert.match(message, /[가-힣]/);
    assert.doesNotMatch(message, /PRIVATE_INPUT_SENTINEL|<script>|atob/);
    assert.equal(await dialog.count(), 0);
    assert.deepEqual((await state()).calls, []);
    assert.equal((await state()).records[0].id, 'existing_fixture');

    await input.fill(wrapped(code(archive)));
    await restoreCode.click();
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await input.inputValue(), '');
    assert.deepEqual((await state()).calls, []);
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual((await state()).writes, []);
    assert.equal(await restoreCode.isDisabled(), true);

    const secondArchive = await syntheticZip(' 다시 시도');
    await input.fill(code(secondArchive)); await restoreCode.click();
    await dialog.waitFor({ state: 'visible' }); await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual((await state()).calls, []);

    await input.fill(code(secondArchive)); await restoreCode.click();
    await dialog.waitFor({ state: 'visible' });
    const confirm = dialog.getByRole('button', { name: '전체 기록 복원', exact: true });
    await confirm.click();
    await page.waitForFunction(() => typeof globalThis.fixture.releaseRestore === 'function');
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(await input.isDisabled(), true);
    assert.equal((await state()).calls.length, 1);
    assert.equal((await state()).writes.length, 0);
    assert.equal((await state()).refreshes, 0);
    await page.evaluate(() => globalThis.fixture.releaseRestore());
    await page.waitForFunction(() => globalThis.fixture.toasts.length === 1);
    await dialog.waitFor({ state: 'hidden' });
    const result = await state();
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].path, '/backup/restore');
    assert.equal(result.writes[0].method, 'POST');
    assert.equal(result.writes[0].type, 'application/zip');
    assert.match(result.writes[0].name, /\.zip$/);
    assert.deepEqual(result.writes[0].bytes, Array.from(secondArchive));
    assert.equal(result.writes[0].careers, 2); assert.equal(result.writes[0].documents, 0);
    assert.deepEqual(result.records.map(record => record.title), fakeCareers(' 다시 시도').map(record => record.title));
    assert.equal(result.refreshes, 1); assert.equal(result.toasts.length, 1);
    assert.match(result.toasts[0], /복원/); assert.deepEqual(result.errors, []);

    // A valid transport header cannot replace archive integrity validation.
    const truncatedZip = archive.subarray(0, 36);
    await input.fill(code(truncatedZip)); await restoreCode.click();
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: '전체 기록 복원', exact: true }).click();
    await page.waitForFunction(() => globalThis.fixture.errors.length === 1);
    const rejected = await state();
    assert.equal(rejected.writes.length, 1); assert.equal(rejected.refreshes, 1);
    assert.equal(rejected.toasts.length, 1);
    assert.deepEqual(rejected.records, result.records);
    assert.match(rejected.errors[0], /[가-힣]/);
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
  } catch (error) {
    if (page) console.error('Backup-code browser fixture:', JSON.stringify({ pageErrors, inputs: await page.locator('textarea').evaluateAll(elements => elements.map(element => ({ ariaLabel: element.getAttribute('aria-label'), labels: [...element.labels].map(label => label.textContent.slice(0, 100)), disabled: element.disabled }))).catch(() => []) }));
    throw error;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
