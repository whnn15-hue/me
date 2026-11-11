import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import JSZip from 'jszip';
import {resourceType,libraryStorage,driveQuota,extraFileTypes,validExtraFile} from '../shared/resources.mjs';
import {materialDraft,recordTags} from '../shared/material-classification.mjs';
import {normalizeWorkspaceItem,normalizeWorkspace,mutateWorkspace} from '../shared/workspace.mjs';
import {validateFile} from '../server/cloud/files.mjs';
import {ALLOWED_EXTENSIONS} from '../server/backup.mjs';

const output=await build({stdin:{contents:`export {validateDriveUploadFile,readDriveStorage} from './src/free/drive';export {prepareMaterialFiles} from './src/free/material-files';export {loadMaterialAudio} from './src/free/material-preview';export {createBackupBlob,readBackupFile} from './src/free/backup';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,plugins:[{name:'isolated-owner',setup(builder){
  builder.onResolve({filter:/^\.\.\/(api|cloud)$/},args=>args.importer.endsWith('/free/drive.ts')?{path:args.path,namespace:'owner'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'owner'},args=>({contents:args.path.endsWith('/api')?'export const api=async()=>({accessToken:"synthetic-access",folderId:"folder-fixture"});':'export const readyCloudUser=async()=>({uid:"owner-fixture"});export const cloudUserError=()=>"";'}));
}}]});
const client=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
const bytes=text=>new TextEncoder().encode(text);
const samples={mp3:bytes('ID3\x04\0\0\0\0\0\0'),wav:bytes('RIFF\x24\0\0\0WAVEfmt '),ogg:bytes('OggS\0\0\0\0'),m4a:bytes('\0\0\0\x18ftypM4A \0\0\0\0M4A '),flac:bytes('fLaC\0\0\0\0'),potx:bytes('PK\x03\x04'),dotx:bytes('PK\x03\x04'),xltx:bytes('PK\x03\x04')};

test('new audio and template formats have matching browser/server validators and reject renamed HTML',async()=>{
  for(const [extension,content] of Object.entries(samples)) {
    assert.equal(validExtraFile(extension,content),true);assert.ok(ALLOWED_EXTENSIONS.has('.'+extension));
    assert.equal(await client.validateDriveUploadFile(new File([content],'sample.'+extension)),extraFileTypes[extension]);
    assert.equal(validateFile({originalname:'sample.'+extension,buffer:Buffer.from(content)}).mime,extraFileTypes[extension]);
    await assert.rejects(client.validateDriveUploadFile(new File(['<html>Not audio</html>'],'sample.'+extension)),/형식/);
    assert.throws(()=>validateFile({originalname:'sample.'+extension,buffer:Buffer.from('<html>Not audio</html>')}));
  }
  await assert.rejects(client.validateDriveUploadFile(new File([samples.mp3],'sample.mp3'),'template'),/HWPX/);
});

test('dragged files get resource classifications, automatic tags and duplicate hashes without network calls',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Must not call network while preparing files');};
  try {
    const zip=new JSZip();zip.file('ppt/slides/slide1.xml','<a:t>수업 목표</a:t>');const template=await zip.generateAsync({type:'uint8array'});
    const prepared=await client.prepareMaterialFiles([new File([samples.mp3],'박수 효과음.mp3'),new File([samples.wav],'BGM 음악.wav'),new File([template],'발표 템플릿.potx'),new File([samples.mp3],'중복.mp3')],'lecture');
    assert.equal(prepared.materials.length,3);
    assert.deepEqual(prepared.materials.map(entry=>entry.item.resourceType),['sound','music','template']);
    assert.ok(prepared.materials[0].item.tags.includes('효과음과 오디오'));
    assert.equal(prepared.materials[2].item.format,'PPT');assert.match(prepared.materials[2].item.summary,/수업 목표/);
    for(const {item} of prepared.materials)assert.equal(normalizeWorkspaceItem(item).resourceType,item.resourceType);
    await assert.rejects(client.prepareMaterialFiles([new File([new Uint8Array(25*1024*1024+1)],'큰파일.mp3')],'lecture'),/링크/);
  } finally {globalThis.fetch=previous;}
});

test('legacy rows and relationships remain intact and replacing a link clears obsolete original metadata',()=>{
  const old={...materialDraft('기존 강의.pptx'),id:'old',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
  delete old.resourceType;delete old.purpose;
  const normalized=normalizeWorkspaceItem(old);assert.equal(Object.hasOwn(normalized,'resourceType'),false);assert.equal(resourceType(normalized),'lecture');
  const audio=normalizeWorkspaceItem({...materialDraft('효과음.mp3'),id:'sound',sourceFile:{name:'효과음.mp3',size:10,sha256:'a'.repeat(64)},fileUrl:'https://drive.google.com/file/d/original01/view'});
  const workspace=normalizeWorkspace({schemaVersion:1,revision:0,items:[normalized,audio],links:[{from:'career:career_one',to:'material:old'}]},{careerIds:['career_one']});
  const updated=mutateWorkspace(workspace,{operation:'update',id:audio.id,expectedRevision:0,item:{...audio,title:'짧은 효과음',resourceType:'music'},links:['material:old']},[{id:'career_one'}]);
  assert.deepEqual(updated.items.find(item=>item.id==='old'),normalized);assert.equal(updated.links.length,2);
  const changed=normalizeWorkspaceItem({...audio,fileUrl:'https://drive.google.com/file/d/replaced01/view'},audio);
  assert.equal(changed.sourceFile,undefined);assert.ok(recordTags(changed).includes('효과음과 오디오'));
  assert.throws(()=>normalizeWorkspaceItem({...old,resourceType:'unsupported'}));
});

test('storage totals distinguish known files from links and quota failures never become zero usage',()=>{
  const first={fileUrl:'https://drive.google.com/file/d/file-one/view',sourceFile:{size:123}};
  const unknown={fileUrl:'https://docs.google.com/presentation/d/linked-only/edit'};
  assert.deepEqual(libraryStorage([first,first,unknown,unknown,{fileUrl:first.fileUrl}]),{bytes:123,files:1,unknown:1});
  assert.deepEqual(driveQuota({usage:'100',limit:'1000'}),{used:100,limit:1000,remaining:900});
  assert.deepEqual(driveQuota({usage:'100'}),{used:100,limit:null,remaining:null});
  for(const value of [null,{}, {usage:'garbage'},{usage:'-1'},{usage:'9007199254740992'}])assert.throws(()=>driveQuota(value));
});

test('Drive usage uses existing credentials with a read-only request and audio previews retain owner/hash checks',async()=>{
  const previous=globalThis.fetch,calls=[];let bad=false;
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer synthetic-access');
    if(url.includes('/about?'))return Response.json({storageQuota:{usage:'1024',limit:'4096'}});
    if(url.includes('alt=media'))return new Response(bad?bytes('<html>bad</html>'):samples.mp3);
    return Response.json({id:'original01',name:'박수.mp3',size:String(samples.mp3.length),parents:['folder-fixture'],appProperties:{archiveUid:'owner-fixture',kind:'document'}});
  };
  try {
    assert.equal((await client.readDriveStorage()).remaining,3072);assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);
    const hash=Buffer.from(await crypto.subtle.digest('SHA-256',samples.mp3)).toString('hex');
    const item={format:'오디오',fileUrl:'https://drive.google.com/file/d/original01/view',sourceFile:{name:'박수.mp3',size:samples.mp3.length,sha256:hash}};
    assert.equal((await client.loadMaterialAudio(item)).type,'audio/mpeg');
    const before=calls.length;await assert.rejects(client.loadMaterialAudio({...item,fileUrl:'https://other.example/file/d/original01/view'}));assert.equal(calls.length,before);
    bad=true;await assert.rejects(client.loadMaterialAudio(item));
  }finally{globalThis.fetch=previous;}
});

test('JSON normalization and ZIP backup preserve new formats, categories and existing career links',async()=>{
  const content=samples.mp3,hash=Buffer.from(await crypto.subtle.digest('SHA-256',content)).toString('hex');
  const item=normalizeWorkspaceItem({...materialDraft('박수.mp3'),id:'resource_sound',fileUrl:'https://drive.google.com/file/d/original01/view',sourceFile:{name:'박수.mp3',size:content.length,sha256:hash}});
  const workspace=normalizeWorkspace({schemaVersion:1,revision:0,items:[item],links:[]});
  const doc={id:'audio_doc',name:'박수.mp3',size:content.length,mime:'audio/mpeg',createdAt:'2026-01-01T00:00:00Z',text:'',analysisStatus:'자료',sha256:hash,recordIds:[],bytes:content};
  const blob=await client.createBackupBlob({careers:[],documents:[doc],workspace});
  const restored=await client.readBackupFile(new File([blob],'backup.zip'));
  assert.equal(restored.workspace.items[0].resourceType,'sound');assert.equal(restored.workspace.items[0].fileUrl,item.fileUrl);
  assert.deepEqual(restored.documents[0].bytes,content);
  assert.equal(JSON.parse(JSON.stringify(workspace)).items[0].sourceFile.sha256,hash);
});
