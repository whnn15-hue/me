/** Stop inflation at the actual byte limit, including forged ZIP size metadata. */
export function readZipText(entry, limit) {
  return new Promise((resolve,reject)=>{
    const stream=entry.internalStream('uint8array');let chunks=[],size=0,ended=false;
    const fail=error=>{if(ended)return;ended=true;chunks=[];stream.pause();reject(error instanceof Error?error:new Error('압축 문서를 읽지 못했습니다.'));};
    stream.on('data',chunk=>{
      if(ended)return;size+=chunk.byteLength;
      if(size>limit)return fail(new Error('압축 문서의 텍스트 용량 제한을 초과했습니다.'));
      chunks.push(chunk);
    });
    stream.on('error',fail);
    stream.on('end',()=>{
      if(ended)return;ended=true;
      const bytes=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      chunks=[];resolve({text:new TextDecoder().decode(bytes),byteLength:size});
    });
    stream.resume();
  });
}
