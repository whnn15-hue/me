import { useRef, useState } from "react";
import { Download, FileJson, LoaderCircle, Upload } from "lucide-react";
import { api, saveBlob } from "../api";
import { Modal } from "../CareerEditor";
import type { WorkspaceArchive, WorkspaceImportResult } from "./types";
import { displayLabel } from "./WorkspaceUI";

type Preview = { archive: unknown; filename: string; careers: number; documents: number; items: number; links: number; labels: Record<string, string> };
function previewArchive(archive: unknown, filename: string): Preview {
  if (!archive || typeof archive !== "object" || Array.isArray(archive)) throw new Error("기록 목록이 담긴 JSON 파일을 선택해 주세요.");
  const record = archive as Record<string, unknown>;
  if (record.version !== 1 || !["introduce-me-workspace", "career-archive", "career-drive-snapshot"].includes(String(record.format)) || !Array.isArray(record.careers) || !Array.isArray(record.documents)) throw new Error("지원하는 Introduce Me JSON 백업 형식이 아닙니다.");
  let items = 0, links = 0;
  const labels: Record<string, string> = {};
  const addLabels = (entries: unknown[], prefix?: string) => entries.forEach(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const item = entry as Record<string, unknown>;
    const title = item.title ?? item.name;
    if (typeof item.id === "string" && typeof title === "string") labels[`${prefix || item.kind}:${item.id}`] = title;
  });
  addLabels(record.careers, "career"); addLabels(record.documents, "document");
  if (record.format === "introduce-me-workspace" && record.workspace === undefined) throw new Error("전체 기록 JSON에 프로젝트와 학습 기록 정보가 없습니다.");
  if (record.workspace !== undefined) {
    if (!record.workspace || typeof record.workspace !== "object" || Array.isArray(record.workspace)) throw new Error("프로젝트와 학습 기록의 형식을 확인해 주세요.");
    const workspace = record.workspace as Record<string, unknown>;
    if (workspace.schemaVersion !== 1 || !Array.isArray(workspace.items) || !Array.isArray(workspace.links)) throw new Error("프로젝트와 학습 기록의 형식을 확인해 주세요.");
    items = workspace.items.length; links = workspace.links.length;
    addLabels(workspace.items);
  }
  return { archive, filename, careers: record.careers.length, documents: record.documents.length, items, links, labels };
}
export default function WorkspaceBackup({ onImport, onError, onToast }: {
  onImport: (archive: unknown) => Promise<WorkspaceImportResult>;
  onError: (error: unknown) => void; onToast: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState<Preview | null>(null), [result, setResult] = useState<WorkspaceImportResult | null>(null);
  const [resultLabels, setResultLabels] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  async function exportJSON() {
    setBusy(true);
    try {
      const archive = await api<WorkspaceArchive>("/workspace/export");
      saveBlob(new Blob([JSON.stringify(archive)], { type: "application/json;charset=utf-8" }), `Introduce_Me_전체기록_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}.json`);
      onToast("전체 기록과 연결 정보를 JSON으로 저장했습니다.");
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  async function readFile(file?: File) {
    if (!file) return;
    setBusy(true); setResult(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("JSON 백업은 5 MB 이하의 파일을 선택해 주세요.");
      let archive: unknown;
      try { archive = JSON.parse(await file.text()); } catch { throw new Error("JSON 파일을 읽을 수 없습니다. 내보낸 원본 파일을 선택해 주세요."); }
      setPreview(previewArchive(archive, file.name));
    } catch (error) { onError(error); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function applyImport() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const saved = await onImport(preview.archive);
      setResultLabels({ ...preview.labels, ...Object.fromEntries(saved.workspace.items.map(item => [`${item.kind}:${item.id}`, item.title])) });
      setResult(saved); setPreview(null);
      onToast("JSON 기록을 현재 보관함에 추가했습니다.");
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  return <>
    <section className="panel settings-card workspace-json-panel" aria-labelledby="workspace-json-heading">
      <div className="settings-card-heading"><span className="integration-icon"><FileJson size={23} /></span><div><h2 id="workspace-json-heading">전체 기록 JSON 백업</h2><p>이력, 프로젝트, 강의 자료, 대학원 기록과 연결 정보를 함께 보관하세요.</p></div></div>
      <p>JSON에는 기록과 원본 파일의 위치가 담깁니다. 공문 원본 파일까지 내려받으려면 기존 백업 ZIP을 함께 보관해 주세요.</p>
      <div className="workspace-json-actions"><button className="button secondary" disabled={busy} onClick={() => void exportJSON()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}전체 기록 JSON 내보내기</button><button className="button secondary" disabled={busy} onClick={() => input.current?.click()}><Upload size={16} />JSON 가져오기</button><input ref={input} className="visually-hidden" type="file" accept=".json,application/json" aria-label="가져올 전체 기록 JSON" onChange={event => void readFile(event.target.files?.[0])} /></div>
      {result && <div className="workspace-import-result" role="status">이력 {result.added.careers}개, 공문 정보 {result.added.documents}개, 학습 기록 {result.added.items}개, 연결 {result.added.links}개를 추가했습니다.{result.conflicts.length > 0 && <details><summary>현재 기록을 유지한 항목 {result.conflicts.length}개</summary><ul>{result.conflicts.map((conflict, index) => <li key={`${conflict.ref}-${index}`}>{displayLabel(resultLabels[conflict.ref] || "기록 또는 연결 정보")}: {displayLabel(conflict.reason)}</li>)}</ul></details>}</div>}
    </section>
    {preview && <Modal title="JSON 기록을 가져올까요?" subtitle={displayLabel(preview.filename)} onClose={() => !busy && setPreview(null)}>
      <div className="modal-body"><div className="workspace-import-counts"><div><small>이력</small><strong>{preview.careers}</strong></div><div><small>공문 정보</small><strong>{preview.documents}</strong></div><div><small>학습 기록</small><strong>{preview.items}</strong></div></div><p className="workspace-import-review-note">파일에 담긴 연결은 {preview.links}개입니다. 이미 같은 ID로 저장된 기록은 현재 내용을 유지하며, 다른 기록을 추가합니다. 실제 추가 개수는 중복 확인 후 달라질 수 있어요.</p><p className="workspace-import-review-note">공문 원본은 JSON에 포함되지 않습니다. 보관함이나 연결한 드라이브에 남아 있는 본인 원본을 확인한 뒤 연결합니다. 원본 파일도 사라졌다면 원본이 포함된 ZIP 백업을 사용해 주세요.</p></div>
      <div className="modal-footer"><button className="button secondary" disabled={busy} onClick={() => setPreview(null)}>취소</button><button className="button primary" disabled={busy} onClick={() => void applyImport()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}현재 기록에 추가</button></div>
    </Modal>}
  </>;
}
