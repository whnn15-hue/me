import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createCipheriv, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';

const root = new URL('..', import.meta.url).pathname;
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const decoderOutput = await build({ entryPoints: ['src/backup-code.ts'], absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', write: false });
const { backupFileFromCode, backupFileFromImportCode, evidenceFileFromImportCode, materialFileFromImportCode } = await import(`data:text/javascript;base64,${Buffer.from(decoderOutput.outputFiles[0].contents).toString('base64')}`);
const backupOutput = await build({ entryPoints: ['src/free/backup.ts'], absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', write: false });
const { readBackupFile } = await import(`data:text/javascript;base64,${Buffer.from(backupOutput.outputFiles[0].contents).toString('base64')}`);

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
function encryptedImport(bytes, prefix = "IMBK2") {
  const key = randomBytes(32), iv = randomBytes(12), id = randomBytes(8).toString('hex');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.concat([Buffer.from(`${prefix}:`, 'ascii'), iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  return { key, id, payload, code: `${prefix}:${id}.${key.toString('base64url')}` };
}
async function withImportFetch(fetcher, action) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await action(); } finally { globalThis.fetch = previous; }
}
const binaryResponse = payload => new Response(payload, { headers: { 'Content-Type': 'application/octet-stream; charset=utf-8' } });
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

test('short encrypted import code decrypts an exact synthetic ZIP and keeps its key out of fetch requests', async () => {
  const encrypted = encryptedImport(archive);
  assert.equal(encrypted.code.length, 66);
  const requests = [];
  await withImportFetch(async (path, options) => {
    requests.push({ path, options });
    return binaryResponse(encrypted.payload);
  }, async () => {
    const file = await backupFileFromImportCode(wrapped(encrypted.code));
    assert.ok(file instanceof File);
    assert.equal(file.type, 'application/zip');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), archive);
    const result = await readBackupFile(file);
    assert.deepEqual(result.careers, fakeCareers().map(career => ({ ...career, source: '' })));
    assert.deepEqual(result.documents, []);
  });
  assert.deepEqual(requests, [{ path: `/imports/${encrypted.id}.bin`, options: {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  } }]);
  assert.ok(!JSON.stringify(requests).includes(encrypted.key.toString('base64url')));
  await withImportFetch(() => { throw new Error('Legacy codes must not fetch an asset'); }, async () => {
    assert.deepEqual(Buffer.from(await (await backupFileFromImportCode(code(archive))).arrayBuffer()), archive);
  });
});

test('encrypted imports reject unauthenticated content, wrong keys, tampering and unbounded responses safely', async () => {
  const encrypted = encryptedImport(archive);
  const wrongKey = Buffer.from(encrypted.key); wrongKey[0] ^= 1;
  const wrongCode = `IMBK2:${encrypted.id}.${wrongKey.toString('base64url')}`;
  const tampered = Buffer.from(encrypted.payload); tampered[tampered.length - 1] ^= 1;
  const badMagic = Buffer.from(encrypted.payload); badMagic[0] ^= 1;
  const redirected = binaryResponse(encrypted.payload);
  Object.defineProperty(redirected, 'redirected', { value: true });
  const nonZip = encryptedImport(Buffer.from('This authenticated plaintext is deliberately not a ZIP archive.'));
  const cases = [
    [wrongCode, () => binaryResponse(encrypted.payload)],
    [encrypted.code, () => binaryResponse(tampered)],
    [encrypted.code, () => binaryResponse(badMagic)],
    [encrypted.code, () => new Response('PRIVATE_INPUT_SENTINEL', { status: 404 })],
    [encrypted.code, () => new Response(encrypted.payload, { status: 206, headers: { 'Content-Type': 'application/octet-stream' } })],
    [encrypted.code, () => new Response('<script>PRIVATE_INPUT_SENTINEL</script>', { headers: { 'Content-Type': 'text/html' } })],
    [encrypted.code, () => new Response(encrypted.payload, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(1024 * 1024 + 1) } })],
    [encrypted.code, () => redirected],
    [encrypted.code, () => { throw new TypeError('PRIVATE_INPUT_SENTINEL: redirect disallowed'); }],
    [nonZip.code, () => binaryResponse(nonZip.payload)],
    [encrypted.code, () => binaryResponse(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([0x49, 0x4d]));
      controller.error(new Error('PRIVATE_INPUT_SENTINEL network body failure'));
    } }))],
  ];
  for (const [value, response] of cases) {
    await withImportFetch(response, () => assert.rejects(backupFileFromImportCode(value), error => {
      safeKoreanError(error);
      assert.ok(!error.message.includes(encrypted.key.toString('base64url')));
      assert.ok(!error.message.includes(wrongKey.toString('base64url')));
      assert.doesNotMatch(error.message, /OperationError|DOMException/);
      return true;
    }));
  }

  // Missing or misleading Content-Length cannot bypass the streamed byte cap.
  for (const contentLength of [undefined, '1']) {
    let canceled = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
      cancel() { canceled = true; },
    });
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (contentLength !== undefined) headers['Content-Length'] = contentLength;
    await withImportFetch(() => new Response(stream, { headers }), () =>
      assert.rejects(backupFileFromImportCode(encrypted.code), safeKoreanError));
    assert.equal(canceled, true);
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = encrypted.code.at(-1);
  const noncanonicalKey = encrypted.code.slice(0, -1) + alphabet[alphabet.indexOf(last) | 1];
  let malformedRequests = 0;
  await withImportFetch(() => { malformedRequests++; throw new Error('Malformed codes must not make network requests'); }, async () => {
    for (const input of [encrypted.code.slice(0, -1), encrypted.code.replace('IMBK2:', 'IMBK3:'), noncanonicalKey, 'IMBK2:PRIVATE_INPUT_SENTINEL'])
      await assert.rejects(backupFileFromImportCode(input), safeKoreanError);
  });
  assert.equal(malformedRequests, 0);
});

test('evidence codes transport larger original files and cannot enter the replacement restore flow', async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: fakeCareers(), documents: [],
    evidenceImport: { format: 'career-evidence-import', version: 1 } }));
  zip.file('originals/synthetic.txt', randomBytes(2 * 1024 * 1024));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const encrypted = encryptedImport(bytes, 'IMEV1');
  let requests = 0;
  await withImportFetch(async (path, options) => {
    requests++;
    assert.equal(path, `/imports/${encrypted.id}.bin`);
    assert.equal(options.credentials, 'same-origin');
    assert.ok(!JSON.stringify([path, options]).includes(encrypted.key.toString('base64url')));
    return binaryResponse(encrypted.payload);
  }, async () => {
    const file = await evidenceFileFromImportCode(encrypted.code);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    await assert.rejects(backupFileFromImportCode(encrypted.code), safeKoreanError);
    await assert.rejects(evidenceFileFromImportCode(encrypted.code.replace('IMEV1:', 'IMBK2:')), safeKoreanError);
    assert.equal(requests, 1);
    await assert.rejects(readBackupFile(file), /정리한 증빙 가져오기/);
  });
});

test('evidence code rejects tampering and stops oversized streamed downloads at 16 MiB', async () => {
  const encrypted = encryptedImport(archive, 'IMEV1');
  const tampered = Buffer.from(encrypted.payload); tampered[tampered.length - 1] ^= 1;
  await withImportFetch(() => binaryResponse(tampered), () => assert.rejects(evidenceFileFromImportCode(encrypted.code), safeKoreanError));
  for (const contentLength of [undefined, '1', String(16 * 1024 * 1024 + 1)]) {
    let canceled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)); }, cancel() { canceled = true; } });
    const headers = { 'Content-Type': 'application/octet-stream' };
    if (contentLength !== undefined) headers['Content-Length'] = contentLength;
    await withImportFetch(() => new Response(stream, { headers }), () => assert.rejects(evidenceFileFromImportCode(encrypted.code), /16 MiB/));
    assert.equal(canceled, true);
  }
});

test('classroom material codes keep keys off requests and cannot enter full restore or evidence import', async () => {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ format: 'career-archive', version: 1, careers: [], documents: [],
    materialImport: { format: 'classroom-material-import', version: 1, materials: [] } }));
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const encrypted = encryptedImport(bytes, 'IMMT1');
  let requests = 0;
  await withImportFetch(async (path, options) => {
    requests++;
    assert.equal(path, `/imports/${encrypted.id}.bin`);
    assert.equal(options.redirect, 'error');
    assert.ok(!JSON.stringify([path, options]).includes(encrypted.key.toString('base64url')));
    return binaryResponse(encrypted.payload);
  }, async () => {
    const file = await materialFileFromImportCode(encrypted.code);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    await assert.rejects(backupFileFromImportCode(encrypted.code), safeKoreanError);
    await assert.rejects(evidenceFileFromImportCode(encrypted.code), safeKoreanError);
    assert.equal(requests, 1);
    await assert.rejects(readBackupFile(file), /학급 자료/);
    await assert.rejects(readBackupFile(file, { allowEvidenceImport: true }), /학급 자료/);
  });
  const damaged = Buffer.from(encrypted.payload); damaged[damaged.length - 1] ^= 1;
  await withImportFetch(() => binaryResponse(damaged), () => assert.rejects(materialFileFromImportCode(encrypted.code), safeKoreanError));
});

async function browserFixtureBundle() {
  const output = await build({
    absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents: `
      import {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import BackupSettings from './src/BackupSettings';
      import {backupFileFromImportCode} from './src/backup-code';
      import {readBackupFile} from './src/free/backup';
      globalThis.decodeImportFixture=async code=>{
        const file=await backupFileFromImportCode(code), result=await readBackupFile(file);
        return {bytes:Array.from(new Uint8Array(await file.arrayBuffer())),careers:result.careers.length,documents:result.documents.length};
      };
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
  return output.outputFiles[0].text;
}

test('browser code restore requires confirmation, cancels safely, and validates before writing', {
  skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()),
}, async () => {
  const bundle = await browserFixtureBundle();
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
    if (page) console.error('Backup-code browser fixture:', JSON.stringify({ pageErrors, inputs: await page.locator('textarea').evaluateAll(elements => elements.map(element => ({ ariaLabel: element.getAttribute('aria-label'), labelLengths: [...element.labels].map(label => label.textContent.length), disabled: element.disabled }))).catch(() => []) }));
    throw error;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('browser short import code authenticates its asset and preserves existing records until confirmed', {
  skip: !existsSync(chromiumPath) && !existsSync(chromium.executablePath()),
}, async () => {
  const bundle = await browserFixtureBundle();
  const encrypted = encryptedImport(archive);
  const wrongKey = Buffer.from(encrypted.key); wrongKey[0] ^= 1;
  const tampered = encryptedImport(archive); tampered.payload[tampered.payload.length - 1] ^= 1;
  const html = encryptedImport(archive), oversized = encryptedImport(archive), redirect = encryptedImport(archive), missing = encryptedImport(archive);
  const assets = new Map([
    [encrypted.id, { body: encrypted.payload }],
    [tampered.id, { body: tampered.payload }],
    [html.id, { body: '<script>PRIVATE_INPUT_SENTINEL</script>', type: 'text/html' }],
    [oversized.id, { body: oversized.payload, length: 1024 * 1024 + 1 }],
    [redirect.id, { status: 302, location: `/imports/${encrypted.id}.bin` }],
  ]);
  const assetRequests = [];
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(bundle); return; }
    if (request.url === '/fixture') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'fixture_gate=passed; HttpOnly; SameSite=Lax; Path=/' })
        .end('<div id="root"></div><script src="/bundle.js"></script>');
      return;
    }
    const matched = /^\/imports\/([a-f0-9]{16})\.bin$/.exec(request.url);
    if (matched) {
      assetRequests.push({ path: request.url, cookie: request.headers.cookie || '' });
      if (!request.headers.cookie?.includes('fixture_gate=passed')) { response.writeHead(401).end(); return; }
      const asset = assets.get(matched[1]);
      if (!asset) { response.writeHead(404).end(); return; }
      if (asset.location) { response.writeHead(asset.status, { Location: asset.location }).end(); return; }
      const headers = { 'Content-Type': asset.type || 'application/octet-stream' };
      if (asset.length) headers['Content-Length'] = String(asset.length);
      response.writeHead(200, headers).end(asset.body);
      return;
    }
    response.writeHead(404).end();
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: existsSync(chromiumPath) ? chromiumPath : undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const externalRequests = [], pageErrors = [], consoleMessages = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => consoleMessages.push(message.text()));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    await page.goto(origin + '/fixture');
    const input = page.getByLabel('백업 코드', { exact: true });
    const restoreCode = page.getByRole('button', { name: '백업 코드로 복원', exact: true });
    const dialog = page.getByRole('dialog', { name: '백업으로 전체 기록을 복원할까요?', exact: true });
    await input.waitFor({ state: 'visible' });
    const state = () => page.evaluate(() => ({ calls:globalThis.fixture.calls, writes:globalThis.fixture.writes,
      errors:globalThis.fixture.errors, refreshes:globalThis.fixture.refreshes, toasts:globalThis.fixture.toasts,
      records:globalThis.fixture.records }));
    const baseline = await state();
    const decoded = await page.evaluate(value => globalThis.decodeImportFixture(value), encrypted.code);
    assert.deepEqual(decoded.bytes, Array.from(archive));
    assert.equal(decoded.careers, 2); assert.equal(decoded.documents, 0);
    assert.deepEqual(await state(), baseline);

    const wrongCode = `IMBK2:${encrypted.id}.${wrongKey.toString('base64url')}`;
    for (const value of [wrongCode, tampered.code, missing.code, html.code, oversized.code, redirect.code]) {
      const priorRequests = assetRequests.length;
      await input.fill(value); await restoreCode.click();
      await page.waitForFunction(() => document.querySelector('textarea')?.disabled === false && !!document.querySelector('[role="alert"]'));
      const message = await page.getByRole('alert').innerText();
      assert.match(message, /[가-힣]/);
      assert.doesNotMatch(message, /PRIVATE_INPUT_SENTINEL|<script>|OperationError|DOMException/);
      assert.ok(!message.includes(encrypted.key.toString('base64url')));
      assert.ok(assetRequests.length > priorRequests);
      assert.equal(await dialog.count(), 0);
      assert.deepEqual(await state(), baseline);
    }
    // The redirect target must not be requested: accepting it would bypass the
    // static asset's same-origin, exact-status and authentication boundary.
    assert.equal(assetRequests.at(-1).path, `/imports/${redirect.id}.bin`);

    await input.fill(encrypted.code); await restoreCode.click();
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await input.inputValue(), '');
    assert.deepEqual(await state(), baseline);
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await state(), baseline);

    await input.fill(encrypted.code); await restoreCode.click();
    await dialog.waitFor({ state: 'visible' });
    assert.deepEqual(await state(), baseline);
    const confirm = dialog.getByRole('button', { name: '전체 기록 복원', exact: true });
    await confirm.click();
    await page.waitForFunction(() => typeof globalThis.fixture.releaseRestore === 'function');
    assert.equal(await confirm.isDisabled(), true);
    assert.equal((await state()).writes.length, 0);
    await page.evaluate(() => globalThis.fixture.releaseRestore());
    await page.waitForFunction(() => globalThis.fixture.toasts.length === 1);
    await dialog.waitFor({ state: 'hidden' });
    const result = await state();
    assert.equal(result.calls.length, 1); assert.equal(result.writes.length, 1);
    assert.deepEqual(result.writes[0].bytes, Array.from(archive));
    assert.equal(result.writes[0].careers, 2); assert.equal(result.writes[0].documents, 0);
    assert.deepEqual(result.records, fakeCareers().map(career => ({ ...career, source: '' })));
    assert.equal(result.refreshes, 1); assert.equal(result.toasts.length, 1);
    assert.deepEqual(result.errors, []);
    assert.ok(assetRequests.every(request => request.cookie.includes('fixture_gate=passed')));
    assert.ok(assetRequests.every(request => /^\/imports\/[a-f0-9]{16}\.bin$/.test(request.path)));
    assert.ok(!JSON.stringify(assetRequests).includes(encrypted.key.toString('base64url')));
    assert.ok(consoleMessages.every(message => !message.includes(encrypted.key.toString('base64url')) && !message.includes(wrongKey.toString('base64url'))));
    assert.deepEqual(externalRequests, []); assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
