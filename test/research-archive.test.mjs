import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createApp } from '../server/index.mjs';
import { Store } from '../server/store.mjs';
import { restoreBackup } from '../server/backup.mjs';
import { readWorkspace } from '../server/workspace.mjs';
import { normalizeWorkspaceItem, workspaceFromRows, workspaceToRows } from '../shared/workspace.mjs';

test('individual research files need no contest name and retain metadata through cloud row encoding', () => {
  const item = normalizeWorkspaceItem({id: 'research_file', kind: 'material', purpose: 'research', researchType: '보고서', title: '가상 연구 보고서', ownership: 'created', sourceFile: {name: '보고서.txt', size: 24, sha256: 'a'.repeat(64)}});
  assert.equal(item.eventName, ''); assert.equal(item.date, '');
  const workspace = {schemaVersion: 1, items: [item], links: [], revision: 0};
  assert.deepEqual(workspaceFromRows(workspaceToRows(workspace), [], 0), workspace);
  assert.throws(() => normalizeWorkspaceItem({...item, researchType: 'invalid'}), /자료 종류/);
  const legacy = normalizeWorkspaceItem({id:'old_material', kind:'material', title:'Existing lecture'});
  assert.equal(Object.hasOwn(legacy, 'purpose'), false);
  assert.equal(Object.hasOwn(legacy, 'researchType'), false);
});

test('research original, related career and edits survive ZIP restore; deletion protects originals in use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'research-archive-'));
  const app = createApp({dataDir: join(root, 'source'), seedPath: null, localMode: true, automaticBackups: false, ownerEmail:'',googleClientId:'',googleClientSecret:'',aiKey:''});
  const server = await new Promise(resolve => {const listener = app.app.listen(0, '127.0.0.1', () => resolve(listener));});
  const target = new Store(join(root, 'restored'), null);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, method='GET', body, status=200) => {
    const response = await fetch(base+path, {method, ...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  try {
    const bytes = Buffer.from('가상 연구 보고서\n실제 인물과 기관 정보가 없는 로컬 테스트 문서입니다.');
    const form = new FormData(); form.append('files', new Blob([bytes], {type:'text/plain'}), '가상_보고서.txt');
    const response = await fetch(base+'/documents', {method:'POST', body:form});
    assert.equal(response.status, 201);
    const document = (await response.json()).documents[0];
    assert.equal(document.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(Object.hasOwn(document, 'storageName'), false);
    const career = await request('/careers','POST',{title:'가상 연구대회 참여',category:'연구대회'},201);
    let workspace = await request('/workspace/items','POST',{item:{kind:'material',purpose:'research',researchType:'보고서',title:'가상 보고서',ownership:'created',sourceFile:{name:document.name,size:document.size,sha256:document.sha256}},links:[`career:${career.id}`],expectedRevision:0},201);
    const item = workspace.items[0];
    assert.equal(item.eventName, '');
    workspace = await request(`/workspace/items/${item.id}`,'PUT',{item:{...item,title:'가상 보고서 최종본',summary:'수정된 내용',eventName:'가상 연구대회',date:'2026'},links:[`career:${career.id}`],expectedRevision:workspace.revision});
    await request(`/workspace/items/${item.id}`,'PUT',{item:{...item,title:'오래된 화면'},links:[],expectedRevision:0},409);
    assert.deepEqual(await request('/workspace'),workspace);
    await request(`/documents/${document.id}`,'DELETE',undefined,409);
    assert.deepEqual(Buffer.from(await (await fetch(`${base}/documents/${document.id}/file`)).arrayBuffer()),bytes);
    const archive = Buffer.from(await (await fetch(base+'/backup/export')).arrayBuffer());
    const zip = await JSZip.loadAsync(archive,{checkCRC32:true});
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    assert.deepEqual(manifest.workspace.items, workspace.items);
    await restoreBackup(target,archive);
    assert.deepEqual(readWorkspace(target).items,workspace.items);
    assert.deepEqual(readWorkspace(target).links,workspace.links);
    const restoredItem = readWorkspace(target).items[0];
    const original = target.documents().find(doc=>doc.sha256===restoredItem.sourceFile.sha256);
    assert.ok(original);
    assert.deepEqual(await readFile(join(target.dataDir,'originals',original.storageName)),bytes);
    // Metadata removal leaves the reusable original and unrelated career intact.
    await request(`/workspace/items/${item.id}`,'DELETE',{expectedRevision:workspace.revision});
    assert.equal((await request('/data')).documents.length,1);
    assert.deepEqual((await request('/data')).careers,[career]);
    await request(`/documents/${document.id}`,'DELETE');
    assert.equal((await request('/data')).documents.length,0);
  } finally {
    await new Promise(resolve=>server.close(resolve)); app.close(); target.close(); await rm(root,{recursive:true,force:true});
  }
});
