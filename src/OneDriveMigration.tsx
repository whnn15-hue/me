import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, Check, Cloud, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "./api";
import { cloudRefreshToken, previewMode } from "./cloud";

type Counts = { total: number; onOneDrive: number; copied: number; pending: number; failed: number };
type Failure = { documentId: string; name: string; message: string };
type Mapping = Record<string, { id: string; sha256: string; size?: number }>;
type MigrationState = {
  switched: boolean; available: boolean; connected?: boolean; storageAccount?: string;
  counts?: Counts; mapping?: Mapping; failures?: Failure[]; done?: boolean;
};

/** Google Drive → OneDrive one-time copy. Shown only while Google Drive is active. */
export default function OneDriveMigration({ onBackup, onRefresh, onToast, onError, disabled }: {
  onBackup: () => Promise<void>; onRefresh: () => Promise<void>;
  onToast: (message: string) => void; onError: (error: unknown) => void; disabled: boolean;
}) {
  const [state, setState] = useState<MigrationState | null>(null);
  const [busy, setBusy] = useState(""), [progress, setProgress] = useState<Counts | null>(null);
  const stopped = useRef(false);

  async function load() {
    const next = await api<MigrationState>("/migration/onedrive/status");
    setState(next); return next;
  }
  useEffect(() => { if (!previewMode) void load().catch(onError); return () => { stopped.current = true; }; }, []);

  // Swap verified IDs in Firestore with the revision-checked transaction.
  async function applyMapping(mapping: Mapping | undefined) {
    if (!mapping || !Object.keys(mapping).length) return 0;
    const { applyFreeStorageMigration } = await import("./free/store");
    return (await applyFreeStorageMigration(mapping)).updated;
  }
  async function connect() {
    setBusy("OneDrive 연결 준비 중");
    try {
      const result = await api<{ url?: string; switched?: boolean }>("/migration/onedrive/start", {
        method: "POST", body: JSON.stringify({ firebaseRefreshToken: await cloudRefreshToken() }),
      });
      if (!result.url || new URL(result.url).protocol !== "https:") throw new Error("OneDrive 연결 주소를 확인하지 못했습니다.");
      window.location.assign(result.url);
    } catch (error) { onError(error); setBusy(""); }
  }
  async function run(retryFailed = false) {
    stopped.current = false; setBusy("원본 옮기는 중");
    try {
      let updated = await applyMapping(state?.mapping);
      for (let round = 0; round < 500 && !stopped.current; round++) {
        const step = await api<MigrationState & { counts: Counts; processed: number; stoppedForTime: boolean }>("/migration/onedrive/step", {
          method: "POST", body: JSON.stringify({ retryFailed: retryFailed && round === 0 }),
        });
        if (step.switched) break;
        setProgress(step.counts);
        updated += await applyMapping(step.mapping);
        if (!step.processed && !step.stoppedForTime) break;
      }
      const latest = await load(); await onRefresh();
      setProgress(latest.counts || null);
      if (latest.counts && !latest.counts.pending && !latest.counts.failed && !latest.counts.copied) onToast(`원본 ${latest.counts.onOneDrive}개를 모두 OneDrive로 옮겼습니다.`);
      else if (updated) onToast(`원본 ${updated}개의 저장 위치를 OneDrive로 바꿨습니다.`);
    } catch (error) { onError(error); }
    finally { setBusy(""); }
  }

  if (previewMode || !state?.available) return null;
  const counts = progress || state.counts;
  const moved = counts ? counts.onOneDrive : 0, total = counts?.total || 0;
  const finished = Boolean(counts && total && !counts.pending && !counts.failed && !counts.copied);
  return (
    <section className="panel settings-card" aria-label="OneDrive로 옮기기">
      <div className="settings-card-heading">
        <span className="integration-icon drive-icon"><ArrowRightLeft size={25} /></span>
        <div><h2>OneDrive로 옮기기</h2>{state.storageAccount && <p className="muted">{state.storageAccount}</p>}</div>
        <span className={`connection-badge ${state.connected ? "connected" : ""}`}>{state.connected ? "OneDrive 연결됨" : "미연결"}</span>
      </div>
      <p className="muted">구글 드라이브의 공문, 사진, 자료 원본을 OneDrive 앱 폴더로 복사합니다. 원본마다 크기와 SHA-256을 확인한 뒤에만 저장 위치를 바꾸고, 구글 드라이브 원본은 지우지 않습니다.</p>
      <div className="notice"><ArrowDownToLine size={16} /><span>시작하기 전에 전체 백업 ZIP을 내려받아 두세요.</span></div>
      <div className="settings-actions">
        <button className="button secondary" onClick={() => void onBackup()} disabled={disabled || !!busy}><ArrowDownToLine size={15} />전체 백업 ZIP 받기</button>
      </div>
      {counts && (
        <div className="material-import-progress" role="status">
          <span>OneDrive {moved} / 전체 {total} · 남은 원본 {counts.pending + counts.copied}{counts.failed ? ` · 실패 ${counts.failed}` : ""}</span>
          <progress aria-label="OneDrive 이전 진행률" max={Math.max(1, total)} value={moved} />
        </div>
      )}
      {!!state.failures?.length && (
        <div className="notice"><TriangleAlert size={16} /><span>옮기지 못한 원본: {state.failures.slice(0, 5).map(item => `${item.name || item.documentId} (${item.message})`).join(", ")}{state.failures.length > 5 ? ` 외 ${state.failures.length - 5}개` : ""}</span></div>
      )}
      {finished ? (
        <div className="notice"><Check size={16} /><span>모든 원본을 옮겼습니다. 다음 단계: Vercel 환경 변수 <code>APP_STORAGE_PROVIDER</code>를 <code>onedrive</code>로 바꾸고 다시 배포한 뒤, 설정에서 OneDrive를 연결해 주세요.</span></div>
      ) : !state.connected ? (
        <button className="button secondary" onClick={() => void connect()} disabled={disabled || !!busy}><Cloud size={15} />OneDrive 연결</button>
      ) : (
        <div className="settings-actions">
          <button className="button primary" onClick={() => void run(false)} disabled={disabled || !!busy}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <ArrowRightLeft size={15} />}{busy || "옮기기 시작"}
          </button>
          {!!counts?.failed && <button className="button secondary" onClick={() => void run(true)} disabled={disabled || !!busy}><RefreshCw size={15} />실패한 원본 다시 시도</button>}
        </div>
      )}
    </section>
  );
}
