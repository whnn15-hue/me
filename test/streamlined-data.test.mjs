import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { build } from 'esbuild';
import JSZip from 'jszip';
import { careerCollections, careerCategoryLabel, matchesCareerCategory, recognitionDetails } from '../shared/career-organization.mjs';
import { materialDraft, materialClassification } from '../shared/material-classification.mjs';
import { normalizeWorkspaceItem } from '../shared/workspace.mjs';
import { normalizeCareer } from '../server/store.mjs';
import { extractHwpText } from '../server/hwp.mjs';
import { extractText } from '../server/extract.mjs';
import { readZipText } from '../shared/zip-text.mjs';

const root = new URL('..',import.meta.url).pathname;
const output = await build({stdin:{resolveDir:root,loader:'ts',contents:`export {prepareMaterialFiles} from './src/free/material-files';export {normalizeCareer} from './src/free/normalize';`},bundle:true,platform:'browser',format:'esm',write:false,
  plugins:[{name:'no-cloud-requests',setup(builder){builder.onResolve({filter:/^\.\.\/(api|cloud)$/},({path})=>({path,namespace:'offline'}));builder.onLoad({filter:/.*/,namespace:'offline'},({path})=>({loader:'js',contents:path.endsWith('api')?`export const api=()=>{throw Error('Unexpected network request')};`:`export const readyCloudUser=()=>{throw Error('Unexpected auth')};export const cloudUserError=()=>{throw Error('Unexpected auth')};`}));}}]});
const {prepareMaterialFiles,normalizeCareer:normalizeBrowserCareer}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString('base64')}`);
const fixtureCareer = fields => normalizeCareer({title:'가상 경력',category:'기타',...fields});

test('collections split legacy writing and content without changing records and distinguish dispatch from travel',()=>{
  const combined=fixtureCareer({category:'집필·콘텐츠',title:'합성 영상 콘텐츠',role:'집필, 촬영, 검토'}),before=structuredClone(combined);
  assert.deepEqual(careerCollections(combined),['writing','content']);
  assert.equal(matchesCareerCategory(combined,'집필'),true);assert.equal(matchesCareerCategory(combined,'콘텐츠 제작'),true);
  assert.equal(careerCategoryLabel(combined),'집필, 콘텐츠 제작');assert.deepEqual(combined,before);
  const work=fixtureCareer({category:'근무·파견',title:'합성학교 근무'});
  assert.deepEqual(careerCollections(work),[]);assert.equal(careerCategoryLabel(work),'근무');
  assert.equal(careerCollections(fixtureCareer({title:'회의 출장'})).includes('secondment'),false);
  assert.equal(careerCollections(fixtureCareer({title:'현장교사 파견'})).includes('secondment'),true);
  const linked=fixtureCareer({documentIds:['proof_one']});
  assert.equal(matchesCareerCategory(linked,'파견',[{id:'proof_one',name:'가상 현장교사 파견 요청.pdf'}]),true);
  assert.equal(careerCollections(fixtureCareer({category:'강의·연수',title:'영상 제작 강의',role:'강사'})).includes('content'),false);
  assert.equal(careerCollections(fixtureCareer({category:'위원회·지원단',title:'콘텐츠 개발 사업',role:'평가위원'})).includes('content'),false);
});

test('recognition keeps explicit overrides and preserves multiple stages and grades through both validators',()=>{
  const original=fixtureCareer({category:'연구·수상',title:'전국 가상 연구대회 1등급',description:'시도 예선, 전국 본선'});
  assert.deepEqual(recognitionDetails(original),{level:'전국',grade:'1등급',stages:['예선','본선']});
  assert.equal(Object.hasOwn(normalizeBrowserCareer(original),'awardStages'),false);
  const next=normalizeCareer({...original,awardLevel:'시도',awardGrade:'우수상',awardStages:['예선','본선']});
  assert.deepEqual(normalizeBrowserCareer(next),next);assert.deepEqual(recognitionDetails(next),{level:'시도',grade:'우수상',stages:['예선','본선']});
  assert.equal(recognitionDetails({...next,awardGrade:''}).grade,'');
  const tiers=recognitionDetails(fixtureCareer({category:'연구·수상',title:'가상 대회',description:'시도 예선 1등급, 전국 본선 3등급'}));
  assert.equal(tiers.grade,'시도 예선 1등급, 전국 본선 3등급');assert.deepEqual(tiers.stages,['예선','본선']);
  assert.equal(recognitionDetails(fixtureCareer({description:'예선 1등급, 본선 2등급'})).grade,'예선 1등급, 본선 2등급');
  assert.equal(recognitionDetails(fixtureCareer({description:'연구 대상: 학생'})).grade,'');
  assert.throws(()=>normalizeBrowserCareer({...next,awardStages:'본선'}),/단계/);
});

test('classification auto-fills facts and does not copy student roster names into summaries',()=>{
  const draft=materialDraft('2026-10-14_교원_속담.txt','작성자: 가상 제작자\n강의명: 어휘 지도\n대상: 교원\n속담 뜻을 알아보자','lecture');
  assert.deepEqual(draft.subjects,['국어']);assert.ok(draft.trainings.includes('어휘'));
  assert.equal(draft.author,'가상 제작자');assert.equal(draft.date,'2026-10-14');assert.equal(draft.eventName,'어휘 지도');assert.deepEqual(draft.audience,['교원']);
  assert.doesNotMatch(draft.summary,/학생별 활동/);assert.match(draft.summary,/속담/);
  assert.equal(materialDraft('자료.txt','제작일: 2026. 2. 30.').date,'');
  const roster=materialDraft('우리반 스피치.txt','가상민:꿈\n가상준:여행\n가상빈:환경','classroom');
  assert.ok(roster.subjects.includes('국어'));assert.ok(roster.trainings.includes('말하기'));assert.doesNotMatch(roster.summary,/가상민|가상준|가상빈/);
  const legacy=normalizeWorkspaceItem({kind:'material',title:'속담 학습지',format:'HWP'}),before=structuredClone(legacy);
  assert.ok(materialClassification(legacy).subjects.includes('국어'));assert.deepEqual(legacy,before);assert.equal(Object.hasOwn(legacy,'subjects'),false);
  assert.deepEqual(materialClassification({...legacy,subjects:[],trainings:[]}),{subjects:[],trainings:[]});
});

test('drag preparation accepts real TXT and PPTX bytes, deduplicates and uses stable IDs for reviewed classroom materials',async()=>{
  const txt=new File(['속담 뜻을 알아보는 어휘 활동'],'속담.txt',{type:'text/plain'});
  const input=await prepareMaterialFiles([txt,txt],'classroom');
  assert.equal(input.documents.length,1);assert.equal(input.materials.length,1);assert.equal(input.purpose,'classroom');
  const item=input.materials[0].item;
  assert.equal(item.id,`classroom-${input.documents[0].sha256.slice(0,24)}`);assert.deepEqual(item.subjects,['국어']);assert.equal(item.fileUrl,'');
  assert.deepEqual(Buffer.from(input.documents[0].bytes),Buffer.from(await txt.arrayBuffer()));
  const zip=new JSZip();zip.file('ppt/slides/slide1.xml','<p:sld><a:t>교원 디지털 연수</a:t><a:t>인공지능 활용</a:t></p:sld>');
  const slides=new File([await zip.generateAsync({type:'uint8array'})],'AI 강의.pptx');
  const ppt=await prepareMaterialFiles([slides],'lecture');
  assert.equal(ppt.materials[0].item.format,'PPT');assert.ok(ppt.materials[0].item.subjects.includes('정보'));assert.match(ppt.materials[0].item.summary,/교원 디지털/);
  await assert.rejects(prepareMaterialFiles([new File(['plain text'],'spoofed.pptx')],'lecture'),/확장자/);
  await assert.rejects(prepareMaterialFiles(Array(11).fill(txt),'classroom'),/10/);
});

// A tiny, entirely synthetic CFB document exercises mini streams and HWP5 compression.
function syntheticHwp({compressed=true,protectedFile=false}={}) {
  const text=Buffer.from('가상 속담과 뜻을 읽습니다.','utf16le');
  const record=Buffer.alloc(4);record.writeUInt32LE(67 | (text.length<<20));
  const section=compressed?deflateRawSync(Buffer.concat([record,text])):Buffer.concat([record,text]);
  const bytes=Buffer.alloc(512*5),header=bytes.subarray(0,512);Buffer.from('d0cf11e0a1b11ae1','hex').copy(header);
  header.writeUInt16LE(3,26);header.writeUInt16LE(0xfffe,28);header.writeUInt16LE(9,30);header.writeUInt16LE(6,32);header.writeUInt32LE(1,44);header.writeUInt32LE(1,48);header.writeUInt32LE(4096,56);header.writeUInt32LE(3,60);header.writeUInt32LE(1,64);header.writeUInt32LE(0xfffffffe,68);
  for(let i=76;i<512;i+=4)header.writeUInt32LE(0xffffffff,i);header.writeUInt32LE(0,76);
  const fat=bytes.subarray(512,1024);for(let i=0;i<512;i+=4)fat.writeUInt32LE(0xffffffff,i);fat.writeUInt32LE(0xfffffffd,0);for(let id=1;id<4;id++)fat.writeUInt32LE(0xfffffffe,id*4);
  const dir=bytes.subarray(1024,1536);
  const entry=(id,name,type,start,size,child=0xffffffff,right=0xffffffff)=>{const d=dir.subarray(id*128,(id+1)*128),n=Buffer.from(name+'\0','utf16le');n.copy(d);d.writeUInt16LE(n.length,64);d[66]=type;d.writeUInt32LE(0xffffffff,68);d.writeUInt32LE(right,72);d.writeUInt32LE(child,76);d.writeUInt32LE(start,116);d.writeUInt32LE(size,120);};
  entry(0,'Root Entry',5,2,512,1);entry(1,'FileHeader',2,0,40,0xffffffff,2);entry(2,'BodyText',1,0xfffffffe,0,3);entry(3,'Section0',2,1,section.length);
  const mini=bytes.subarray(1536,2048);Buffer.from('HWP Document File').copy(mini);mini.writeUInt32LE((compressed?1:0)|(protectedFile?2:0),36);section.copy(mini,64);
  const miniFat=bytes.subarray(2048,2560);for(let i=0;i<512;i+=4)miniFat.writeUInt32LE(0xffffffff,i);miniFat.writeUInt32LE(0xfffffffe,0);miniFat.writeUInt32LE(0xfffffffe,4);
  return bytes;
}

test('HWP5 text extraction reads compressed and plain mini streams and rejects protected or cyclic inputs',()=>{
  for(const compressed of [true,false])assert.equal(extractHwpText(syntheticHwp({compressed})),'가상 속담과 뜻을 읽습니다.');
  assert.throws(()=>extractHwpText(syntheticHwp({protectedFile:true})),/Protected/);
  const cyclic=syntheticHwp();cyclic.writeUInt32LE(1,512+4);assert.throws(()=>extractHwpText(cyclic),/chain/);
  assert.throws(()=>extractHwpText(Buffer.alloc(512)),/header/);
});

test('server extraction supports HWP and slide text in numeric order without altering originals',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'streamlined-extraction-'));
  try {
    const hwp=syntheticHwp(),hwpPath=join(directory,'synthetic.hwp');await writeFile(hwpPath,hwp);
    const extracted=await extractText(hwpPath,'synthetic.hwp');assert.equal(extracted.analysisStatus,'text-ready');assert.match(extracted.text,/속담/);assert.deepEqual(await readFile(hwpPath),hwp);
    const zip=new JSZip();zip.file('ppt/slides/slide10.xml','<a:t>열 번째</a:t>');zip.file('ppt/slides/slide2.xml','<a:t>두 번째 &amp; 실습</a:t>');
    const pptPath=join(directory,'synthetic.pptx');await writeFile(pptPath,await zip.generateAsync({type:'nodebuffer'}));
    const ppt=await extractText(pptPath,'synthetic.pptx');assert.equal(ppt.text,'두 번째 & 실습\n열 번째');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('compressed text rejects actual inflation beyond its bound even if declared size is forged',async()=>{
  const zip=new JSZip();zip.file('payload.xml','x'.repeat(128*1024));
  const loaded=await JSZip.loadAsync(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  const entry=loaded.file('payload.xml');entry._data.uncompressedSize=1;
  await assert.rejects(readZipText(entry,1024),/용량 제한/);
});
