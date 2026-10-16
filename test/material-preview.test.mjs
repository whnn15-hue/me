import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const output=await build({entryPoints:['src/free/material-preview.ts'],absWorkingDir:new URL('..',import.meta.url).pathname,bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'owned-drive-fixture',setup(builder){builder.onResolve({filter:/^\.\/drive$/},()=>({path:'drive',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const downloadDriveFile=async(id,expected)=>{globalThis.previewCalls.push({id,expected});return {blob:new Blob([globalThis.previewSource]),name:"sample.html"};}',loader:'js'}));}}]});
const {loadMaterialHtml}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
test('preview loader uses the owned-file integrity check and rejects oversized or unrelated links before downloading',async()=>{
  globalThis.previewCalls=[];globalThis.previewSource='<!doctype html><html><h1>수학</h1></html>';
  const item={format:'HTML',fileUrl:'https://drive.google.com/file/d/original123/view',sourceFile:{name:'sample.html',size:100,sha256:'a'.repeat(64)}};
  assert.equal(await loadMaterialHtml(item),globalThis.previewSource);
  assert.deepEqual(globalThis.previewCalls,[{id:'original123',expected:{size:100,sha256:'a'.repeat(64),kind:'document'}}]);
  for(const overrides of [{fileUrl:''},{fileUrl:'https://unrelated.invalid/file/d/original123/view'},{fileUrl:'https://drive.google.com@unrelated.invalid/file/d/original123/view'},{sourceFile:undefined},{sourceFile:{...item.sourceFile,size:2*1024*1024+1}},{format:'PDF'}])await assert.rejects(loadMaterialHtml({...item,...overrides}));
  assert.equal(globalThis.previewCalls.length,1);
  globalThis.previewSource='not HTML';await assert.rejects(loadMaterialHtml(item),/HTML 원본/);
  delete globalThis.previewCalls;delete globalThis.previewSource;
});
