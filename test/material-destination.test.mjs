import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled=await build({entryPoints:['src/workspace/material-destination.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {placeUploadedMaterial,materialDestination,uploadedMaterialFocus}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const item=(id,extra={})=>({id,kind:'material',purpose:'lecture',title:id,format:'PDF',tags:[],...extra});

test('upload destination always keeps files in the open library without mutating inputs',()=>{
 const lesson=item('교육 영상',{format:'영상'}), audio=item('배경음악',{format:'오디오'}), template=item('편집 템플릿');
 const before=structuredClone([lesson,audio,template]);
 assert.equal(materialDestination(placeUploadedMaterial(lesson,'learning')),'materials');
 assert.equal(materialDestination(placeUploadedMaterial(audio,'learning')),'materials');
 assert.equal(materialDestination(placeUploadedMaterial(template,'learning')),'materials');
 assert.equal(materialDestination(placeUploadedMaterial(lesson,'video')),'video');
 assert.equal(materialDestination(placeUploadedMaterial({...audio,purpose:'classroom'},'learning')),'projects');
 assert.deepEqual([lesson,audio,template],before);
});

test('duplicate upload focus uses preserved live location and mixed uploads prefer a newly added item',()=>{
 const existing=item('same',{resourceType:'lecture'}), fresh=item('new',{resourceType:'template'});
 const live=[existing,fresh], before=structuredClone(live);
 assert.equal(materialDestination(uploadedMaterialFocus(live,['same'],['same'])),'materials');
 assert.equal(uploadedMaterialFocus(live,['same','new'],['same']).id,'new');
 assert.equal(uploadedMaterialFocus(live,['missing'],[]),undefined);
 assert.deepEqual(live,before);
});
