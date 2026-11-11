import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import JSZip from 'jszip';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createApp } from '../server/index.mjs';
import { Store } from '../server/store.mjs';
import { restoreBackup } from '../server/backup.mjs';
import { readWorkspace } from '../server/workspace.mjs';
import { mergeWorkspaceData, normalizeWorkspace, normalizeWorkspaceItem, RESEARCH_TYPES, workspaceFromRows, workspaceToRows } from '../shared/workspace.mjs';

test('research files need no contest name, validate their type and survive cloud row encoding; legacy rows stay unchanged', () => {
  const item = normalizeWorkspaceItem({ id: 'research_file', kind: 'material', purpose: 'research', researchType: '보고서', title: '가상 연구 보고서', ownership: 'created', sourceFile: { name: '보고서.txt', size: 24, sha256: 'a'.repeat(64) } });
  assert.equal(item.eventName, ''); assert.equal(item.date, ''); assert.equal(item.purpose, 'research'); assert.equal(item.researchType, '보고서');
  const workspace = { schemaVersion: 1, items: [item], links: [], revision: 0 };
  assert.deepEqual(workspaceFromRows(workspaceToRows(workspace), [], 0), workspace);
  assert.deepEqual(RESEARCH_TYPES, ['계획서', '보고서', '발표자료', '부록·증빙', '참고자료', '기타']);
  for (const researchType of RESEARCH_TYPES) assert.equal(normalizeWorkspaceItem({ ...item, researchType }).researchType, researchType);
  assert.throws(() => normalizeWorkspaceItem({ ...item, researchType: 'invalid' }), /연구대회 자료 종류/);
  assert.throws(() => normalizeWorkspaceItem({ ...item, purpose: 'unknown' }), /보관할 곳/);
  // Pre-existing lecture and classroom rows gain no new fields.
  const legacy = normalizeWorkspaceItem({ id: 'old_material', kind: 'material', title: 'Existing lecture' });
  assert.equal(Object.hasOwn(legacy, 'purpose'), false); assert.equal(Object.hasOwn(legacy, 'researchType'), false);
  const classroom = normalizeWorkspaceItem({ id: 'class_material', kind: 'material', title: '학급 자료', purpose: 'classroom' });
  assert.equal(Object.hasOwn(classroom, 'researchType'), false);
  // JSON import merge keeps research rows intact.
  const merged = mergeWorkspaceData(normalizeWorkspace({ schemaVersion: 1, items: [legacy], links: [], revision: 3 }), workspace, []);
  assert.deepEqual(merged.workspace.items.find(row => row.id === 'research_file'), item);
});

test('local server: research original, career link and edits survive ZIP restore; deleting an original in use is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-archive-'));
  const app = createApp({ dataDir: join(root, 'source'), seedPath: null, localMode: true, appUrl: '', automaticBackups: false, aiKey: '' });
  const server = await new Promise(resolve => { const listener = app.app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const target = new Store(join(root, 'restored'), null);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, method = 'GET', body, status = 200) => {
    const response = await fetch(base + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  try {
    const bytes = Buffer.from('가상 연구 보고서\n실제 인물과 기관 정보가 없는 로컬 테스트 문서입니다.');
    const form = new FormData(); form.append('files', new Blob([bytes], { type: 'text/plain' }), '가상_보고서.txt');
    const response = await fetch(base + '/documents', { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const document = (await response.json()).documents[0];
    assert.equal(document.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(Object.hasOwn(document, 'storageName'), false);
    const career = await request('/careers', 'POST', { title: '가상 연구대회 참여', category: '연구대회' }, 201);
    let workspace = await request('/workspace/items', 'POST', { item: { kind: 'material', purpose: 'research', researchType: '보고서', title: '가상 보고서', ownership: 'created', sourceFile: { name: document.name, size: document.size, sha256: document.sha256 } }, links: [`career:${career.id}`], expectedRevision: 0 }, 201);
    const item = workspace.items[0];
    workspace = await request(`/workspace/items/${item.id}`, 'PUT', { item: { ...item, title: '가상 보고서 최종본', summary: '수정된 내용', eventName: '가상 연구대회', date: '2026', researchType: '발표자료' }, links: [`career:${career.id}`], expectedRevision: workspace.revision });
    await request(`/workspace/items/${item.id}`, 'PUT', { item: { ...item, title: '오래된 화면' }, links: [], expectedRevision: 0 }, 409);
    assert.deepEqual(await request('/workspace'), workspace);
    await request(`/documents/${document.id}`, 'DELETE', undefined, 409);
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/documents/${document.id}/file`)).arrayBuffer()), bytes);
    const archive = Buffer.from(await (await fetch(base + '/backup/export')).arrayBuffer());
    const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.deepEqual(manifest.workspace.items, workspace.items);
    await restoreBackup(target, archive);
    assert.deepEqual(readWorkspace(target).items, workspace.items);
    assert.deepEqual(readWorkspace(target).links, workspace.links);
    const restored = readWorkspace(target).items[0];
    assert.equal(restored.researchType, '발표자료');
    const original = target.documents().find(doc => doc.sha256 === restored.sourceFile.sha256);
    assert.ok(original);
    assert.deepEqual(await readFile(join(target.dataDir, 'originals', original.storageName)), bytes);
    // Removing the research entry leaves the original and the career intact; then the original can go.
    await request(`/workspace/items/${item.id}`, 'DELETE', { expectedRevision: workspace.revision });
    assert.equal((await request('/data')).documents.length, 1);
    assert.deepEqual((await request('/data')).careers, [career]);
    await request(`/documents/${document.id}`, 'DELETE');
    assert.equal((await request('/data')).documents.length, 0);
  } finally {
    await new Promise(resolve => server.close(resolve)); app.close(); target.close(); await rm(root, { recursive: true, force: true });
  }
});

const browserPath = ['/usr/bin/chromium', '/opt/pw-browsers/chromium'].find(path => existsSync(path));
test('research view groups by year and contest, filters by type and favorites, uploads through the archive path and keeps lecture lists separate', { skip: !browserPath }, async () => {
  const sha = 'b'.repeat(64);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';import ResearchView from './src/workspace/ResearchView';import WorkspaceTree from './src/WorkspaceTree';
import {normalizeWorkspaceItem,mutateWorkspace} from './shared/workspace.mjs';
window.fixture={saves:[],uploads:[]};
const stamp='2026-10-01T00:00:00.000Z';
const make=(id,fields)=>normalizeWorkspaceItem({id,kind:'material',purpose:'research',ownership:'created',createdAt:stamp,updatedAt:stamp,...fields});
const initial={schemaVersion:1,revision:0,links:[],items:[
  make('r1',{title:'2026 계획서',researchType:'계획서',eventName:'현장교육연구대회',date:'2026',sourceFile:{name:'계획서.pdf',size:2048,sha256:'${sha}'}}),
  make('r2',{title:'2026 보고서 최종',researchType:'보고서',eventName:'현장교육연구대회',date:'2026',summary:'최종 제출본'}),
  make('r3',{title:'2024 발표자료',researchType:'발표자료',eventName:'교육자료전',date:'2024',favorite:true}),
  normalizeWorkspaceItem({id:'lecture1',kind:'material',title:'일반 강의 자료',createdAt:stamp,updatedAt:stamp}),
]};
const documents=[{id:'doc1',name:'계획서.pdf',size:2048,mime:'application/pdf',createdAt:stamp,recordIds:[],sha256:'${sha}'}];
function Fixture(){const [workspace,setWorkspace]=useState(initial);return <><nav id="tree"><WorkspaceTree view="research" careers={[]} documents={[]} workspace={workspace} category="전체" onView={()=>{}} onCategory={()=>{}} onSection={()=>{}}/></nav><ResearchView workspace={workspace} documents={documents} careers={[]} onError={e=>{throw e;}} onOpen={()=>{}}
onSave={async(item,links,expectedRevision)=>{fixture.saves.push(item);setWorkspace(current=>mutateWorkspace(current,{operation:item.id?'update':'create',id:item.id||undefined,item:{...item,id:item.id||'new_research'},links,expectedRevision},[]));}}
onDelete={async(id,expectedRevision)=>setWorkspace(current=>mutateWorkspace(current,{operation:'delete',id,expectedRevision},[]))}
onUploadFile={async file=>{fixture.uploads.push(file.name);return {id:'doc2',name:file.name,size:file.size,mime:file.type,createdAt:stamp,recordIds:[],sha256:'c'.repeat(64)};}}/></>;}
createRoot(document.getElementById('root')).render(<Fixture/>);` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', outdir: '/tmp/research-ui', define: { 'import.meta.env': '{}' } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = ['styles.css', 'theme.css', 'refinements.css', 'portfolio-library.css', 'workspace-upgrade.css', 'record-room.css'].filter(file => existsSync('src/' + file)).map(file => readFileSync('src/' + file, 'utf8')).join('\n') + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || '');
  const server = createServer((req, res) => req.url === '/bundle.js' ? res.writeHead(200, { 'Content-Type': 'application/javascript' }).end(js) : res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<style>${css}</style><div id="root" class="app-shell"></div><script src="/bundle.js"></script>`));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading', { name: /연구대회 자료/ }).first().waitFor().catch(error => { throw new Error(error.message + ' page errors: ' + errors.join(' | ')); });
    // Sidebar counts research separately from 자료실.
    assert.match(await page.locator('#tree').getByRole('button', { name: /연구대회 자료/ }).textContent(), /3/);
    // Newest year first, grouped by contest.
    assert.deepEqual(await page.locator('.research-group h2').allTextContents(), ['2026년 현장교육연구대회 2개', '2024년 교육자료전 1개']);
    assert.equal(await page.locator('.research-card').count(), 3);
    assert.match(await page.locator('.research-card').first().textContent(), /원본 보관됨/);
    await page.getByRole('group', { name: '자료 종류로 거르기' }).getByRole('button', { name: /^보고서/ }).click();
    assert.equal(await page.locator('.research-card').count(), 1);
    await page.getByRole('group', { name: '자료 종류로 거르기' }).getByRole('button', { name: /^전체/ }).click();
    await page.getByRole('button', { name: '즐겨찾기만' }).click();
    assert.equal(await page.locator('.research-card').count(), 1);
    await page.getByRole('button', { name: '즐겨찾기만' }).click();
    await page.getByRole('button', { name: '2026 보고서 최종 즐겨찾기' }).click();
    await page.waitForFunction(() => fixture.saves.some(item => item.id === 'r2' && item.favorite === true));
    // New file goes through onUploadFile and is saved as a research material with its original identity.
    await page.getByRole('button', { name: '자료 보관' }).first().click();
    await page.getByLabel('연구대회 원본 파일').setInputFiles({ name: '2025 부록.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic') });
    await page.getByRole('radio', { name: '부록, 증빙' }).click();
    await page.getByLabel('대회명 선택').fill('현장교육연구대회');
    await page.getByLabel('연도 선택').fill('2025');
    await page.getByRole('button', { name: '자료 저장' }).click();
    await page.waitForFunction(() => fixture.saves.some(item => item.title === '2025 부록'));
    const saved = await page.evaluate(() => fixture.saves.find(item => item.title === '2025 부록'));
    assert.equal(saved.purpose, 'research'); assert.equal(saved.researchType, '부록·증빙'); assert.equal(saved.date, '2025');
    assert.deepEqual(saved.sourceFile, { name: '2025 부록.pdf', size: 18, sha256: 'c'.repeat(64) });
    assert.deepEqual(await page.evaluate(() => fixture.uploads), ['2025 부록.pdf']);
    assert.equal(await page.locator('.research-card').count(), 4);
    // Detail and delete.
    await page.getByRole('button', { name: '2024 발표자료 자세히 보기' }).click();
    await page.getByRole('button', { name: '자료 삭제' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '자료 삭제' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.research-card').length === 3);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); }
});
