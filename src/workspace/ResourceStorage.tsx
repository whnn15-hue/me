import {useState} from "react";
import {HardDrive, ExternalLink, LoaderCircle} from "lucide-react";
import {formatBytes, libraryStorage, type DriveQuota} from "../../shared/resources.mjs";
import type {MaterialItem,WorkspaceData} from "./types";

export default function ResourceStorage({items,workspace,readStorage}:{items:MaterialItem[];workspace:WorkspaceData;readStorage?:()=>Promise<DriveQuota>}) {
  const summary=libraryStorage(items),[quota,setQuota]=useState<DriveQuota|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function check() {
    if (!readStorage || busy) return;
    setBusy(true);setError("");
    try {setQuota(await readStorage());}catch {setQuota(null);setError("계정 용량을 불러오지 못했습니다. Google 저장공간에서 확인해 주세요.");}
    finally {setBusy(false);}
  }
  return <details className="resource-storage"><summary><HardDrive size={16}/><span>자료실 원본 <strong>{formatBytes(summary.bytes)}</strong></span><span>{summary.files}개 파일{summary.unknown>0?`, 용량 미확인 링크 ${summary.unknown}개`:""}</span><span className="storage-expand">저장공간 보기</span></summary>
    <div className="resource-storage-body">
      <p>목록은 앱에, 원본은 구글 드라이브에 보관합니다. 위 용량은 이 자료실에 등록되어 크기를 확인할 수 있는 원본만 합산한 값입니다.</p>
      <div className="resource-storage-actions">{readStorage && <button type="button" className="button secondary" disabled={busy} onClick={()=>void check()}>{busy?<LoaderCircle size={15} className="spin"/>:<HardDrive size={15}/>}드라이브 용량 확인</button>}<a href="https://one.google.com/storage" target="_blank" rel="noopener noreferrer" className="button ghost">Google 저장공간<ExternalLink size={14}/></a></div>
      {quota && <div className="drive-quota" aria-live="polite"><strong>{formatBytes(quota.used)} 사용{quota.limit!==null?` / ${formatBytes(quota.limit)}`:""}</strong>{quota.limit!==null && quota.limit>0 && <progress aria-label="Google 계정 저장공간 사용량" max={quota.limit} value={Math.min(quota.used,quota.limit)}/>}<span>{quota.remaining!==null?`${formatBytes(quota.remaining)} 남음`:"총 용량은 Google 저장공간에서 확인하세요."} Gmail, Google 포토와 함께 사용하는 계정 용량입니다.</span>{quota.limit!==null && quota.used>=quota.limit*0.9 && <p role="status">저장공간이 거의 찼습니다. 큰 원본과 휴지통을 확인해 주세요.</p>}</div>}
      {error && <p role="alert">{error}</p>}
      <p>수업, 자료, 사진, 제출본 등의 목록 {workspace.items.length.toLocaleString()} / 5,000개, {formatBytes(new TextEncoder().encode(JSON.stringify(workspace)).byteLength)} / 5 MB. 파일 원본 용량은 이 목록 한도에 포함되지 않습니다.</p>
      <p>직접 업로드는 파일당 25 MB, 한 번에 10개와 합계 200 MB까지입니다. 큰 파일과 영상은 드라이브 링크로 등록하세요. 자료실 원본은 드라이브에 남고, 앱 백업에는 자료 목록과 원본 링크가 포함됩니다.</p>
    </div>
  </details>;
}
