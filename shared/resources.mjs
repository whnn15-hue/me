export const resourceTypes = [
  {id:'lecture',label:'강의 자료'}, {id:'sound',label:'효과음과 오디오'},
  {id:'music',label:'배경음악'}, {id:'template',label:'템플릿'},
  {id:'image',label:'이미지'}, {id:'video',label:'영상'}, {id:'other',label:'기타'},
];
export const extraFileTypes = {
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', flac:'audio/flac',
  potx:'application/vnd.openxmlformats-officedocument.presentationml.template',
  dotx:'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  xltx:'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
};
export const audioName = name => /\.(mp3|wav|ogg|m4a|flac)$/i.test(name || '');
export function validExtraFile(extension, bytes) {
  const starts=(text,offset=0)=>[...text].every((char,index)=>bytes[offset+index]===char.charCodeAt(0));
  if (['potx','dotx','xltx'].includes(extension)) return starts('PK');
  if (extension==='wav') return starts('RIFF') && starts('WAVE',8);
  if (extension==='ogg') return starts('OggS');
  if (extension==='flac') return starts('fLaC');
  if (extension==='m4a') return starts('ftyp',4) && new TextDecoder().decode(bytes.subarray(8,64)).includes('M4A ');
  if (extension==='mp3') return starts('ID3') || bytes.length>=4 && bytes[0]===255 && (bytes[1]&224)===224 && (bytes[1]&6)!==0 && (bytes[2]&240)!==240;
  return false;
}
export function resourceType(item) {
  if (resourceTypes.some(type=>type.id===item.resourceType)) return item.resourceType;
  const name=item.sourceFile?.name || '', text=[item.title,name].join(' ').normalize('NFC');
  if (/템플릿|양식|서식|template|\.(potx|dotx|xltx)\b/i.test(text)) return 'template';
  if (audioName(name) || item.format==='오디오') return /배경\s*음악|음악|bgm|music|soundtrack/i.test(text) ? 'music' : 'sound';
  if (item.format==='영상' || /\.(mp4|mov|webm)$/i.test(name)) return 'video';
  if (item.format==='이미지' || /\.(png|jpe?g|webp)$/i.test(name)) return 'image';
  return 'lecture';
}
export const resourceLabel = item => resourceTypes.find(type=>type.id===resourceType(item)).label;
export function libraryStorage(items) {
  const known=new Map(),unknown=new Set();
  for (const item of items) {
    if (!item.fileUrl) continue;
    if (Number.isSafeInteger(item.sourceFile?.size) && item.sourceFile.size>=0) known.set(item.fileUrl,item.sourceFile.size);
    else unknown.add(item.fileUrl);
  }
  return {bytes:[...known.values()].reduce((sum,value)=>sum+value,0),files:known.size,unknown:[...unknown].filter(url=>!known.has(url)).length};
}
export function driveQuota(value) {
  const bytes=value=> typeof value==='string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
  const used=bytes(value?.usage),limit=bytes(value?.limit);
  if (used===null) throw new Error('드라이브 사용량을 확인하지 못했습니다. Google 저장공간 페이지에서 확인해 주세요.');
  return {used,limit,remaining:limit===null?null:Math.max(0,limit-used)};
}
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes<0) return '확인 필요';
  if (bytes<1024) return `${bytes} B`;
  const unit=bytes>=1024**3 ? 'GB' : bytes>=1024**2 ? 'MB' : 'KB';
  const divisor=unit==='GB'?1024**3:unit==='MB'?1024**2:1024;
  return `${new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1}).format(bytes/divisor)} ${unit}`;
}
