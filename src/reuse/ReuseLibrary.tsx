import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Download, FileText, Image, Plus, Search, Star, Trash2, X } from "lucide-react";
import { api, download, loadDocumentBlob, saveBlob } from "../api";
import { Modal } from "../CareerEditor";
import FileDropzone from "../FileDropzone";
import { displayLabel, linkedRefs, LinkPicker, TagsInput } from "../workspace/WorkspaceUI";
import type { DocumentRecord } from "../types";
import type { PhotoItem, SubmissionItem, WorkspaceData, WorkspaceSectionProps } from "../workspace/types";
import { buildPhotoPackage, extractBrief } from "./files";
import { newSubmission, photoUsage, rankPhotos, safeFilename, sceneGroups, slotsFromBrief, submissionStatus, suggestSceneTags } from "./model";
import "./ReuseLibrary.css";

interface Props extends WorkspaceSectionProps {
  documents: DocumentRecord[]; onRefresh: () => Promise<void>; mode: "photos" | "submissions";
}

export function PhotoThumbnail({ document }: { document?: DocumentRecord }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false), [url, setUrl] = useState(""), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "100px" });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !visible) return;
    let cancelled = false, objectUrl = "";
    setError(false);
    void (async () => {
      try {
        const original = await loadDocumentBlob(document);
        const bitmap = await createImageBitmap(original);
        try {
          const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
          const canvas = window.document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error()), "image/webp", 0.8));
          if (!cancelled) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
        } finally { bitmap.close(); }
      } catch { if (!cancelled) setError(true); }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [document?.id, visible, retry]);
  return <div className="reuse-thumbnail" ref={root}>{url ? <img src={url} alt={document?.name || "사진"}/> : <span><Image size={26}/>{!document ? "원본 없음" : error ? "사진을 열지 못했습니다" : "사진 불러오는 중"}{error && <button className="text-button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>}</span>}</div>;
}

export default function ReuseLibrary(props: Props) {
  const { workspace, documents, mode, onRefresh, onError, onOpen } = props;
  const photos = workspace.items.filter((item): item is PhotoItem => item.kind === "photo");
  const submissions = workspace.items.filter((item): item is SubmissionItem => item.kind === "submission");
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all"), [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [error, setError] = useState("");
  const [editing, setEditing] = useState<PhotoItem | SubmissionItem | null>(null), [bulkTag, setBulkTag] = useState("쓰기");
  const stop = useRef(false), active = useRef(false);
  useEffect(() => { if (props.focusId) setEditing(workspace.items.find(item => item.id === props.focusId && (item.kind === "photo" || item.kind === "submission")) as PhotoItem | SubmissionItem || null); }, [props.focusId]);
  async function uploadPhotos(files: File[]) {
    if (active.current) return;
    if (!files.length || files.length > 50 || files.some(file => !/\.(png|jpe?g|webp)$/i.test(file.name) || !file.size || file.size > 25 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) { setError("JPG, PNG, WEBP를 최대 50장, 파일당 25 MB, 합계 200 MB까지 넣을 수 있어요."); return; }
    active.current = true; stop.current = false; setBusy(true); setError("");
    let saved = 0, duplicates = 0, completed = 0;
    try {
      let current = await api<WorkspaceData>("/workspace");
      for (const file of files) {
        if (stop.current) break;
        setProgress(`${completed + 1}/${files.length} ${file.name.normalize("NFC")}`);
        // Verify the browser can decode the original before committing metadata.
        const bitmap = await createImageBitmap(file); bitmap.close();
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map(value => value.toString(16).padStart(2, "0")).join("");
        if (current.items.some(item => item.kind === "photo" && item.sha256 === hash)) { duplicates++; completed++; continue; }
        const form = new FormData(); form.append("files", file);
        const result = await api<{ documents: DocumentRecord[] }>("/documents", { method: "POST", body: form });
        const document = result.documents[0];
        if (!document) throw new Error("원본 파일을 저장하지 못했습니다.");
        // File upload may advance the shared production revision. Read it again.
        current = await api<WorkspaceData>("/workspace");
        if (current.items.some(item => item.kind === "photo" && item.sha256 === hash)) { duplicates++; completed++; continue; }
        current = await api<WorkspaceData>("/workspace/items", { method: "POST", body: JSON.stringify({ expectedRevision: current.revision, links: [], item: {
          id: `photo-${hash.slice(0, 32)}`, kind: "photo", title: file.name.normalize("NFC"), documentId: document.id, sha256: hash,
          caption: "", tags: suggestSceneTags(file.name), reviewed: false, star: 0,
        } }) });
        saved++; completed++;
      }
      setProgress(`${saved}장 추가, 동일 파일 ${duplicates}장 제외${stop.current ? ", 중단됨" : ""}`);
    } catch (reason) { setError(`${saved}장 저장됨. ${reason instanceof Error ? reason.message : "업로드에 실패했습니다."} 같은 파일을 다시 넣어도 저장된 사진은 중복 추가하지 않습니다.`); }
    finally { active.current = false; setBusy(false); await onRefresh().catch(onError); }
  }
  async function batch(reviewed: boolean) {
    if (active.current) return;
    active.current = true; setBusy(true); setError("");
    try {
      let current = await api<WorkspaceData>("/workspace");
      for (const id of selected) {
        const item = current.items.find((row): row is PhotoItem => row.kind === "photo" && row.id === id);
        if (!item) continue;
        current = await api<WorkspaceData>(`/workspace/items/${id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: current.revision, links: linkedRefs(current, `photo:${id}`), item: reviewed ? { ...item, reviewed: true } : { ...item, tags: [...new Set([...item.tags, bulkTag])] } }) });
      }
      setSelected([]); setProgress("선택한 사진을 정리했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다."); }
    finally { active.current = false; setBusy(false); await onRefresh().catch(onError); }
  }
  const visible = photos.filter(photo => `${photo.title} ${photo.caption} ${photo.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (filter === "all" || filter === "unreviewed" && !photo.reviewed || filter === "unused" && !photoUsage(photo.id, submissions).some(usage => usage.submission.status !== "preparing") || filter === "star" && photo.star > 0));
  return <section className="reuse-library" aria-label={mode === "photos" ? "사진 보관함" : "공모전 제출본"}>
    <header className="reuse-heading"><div><span className="eyebrow">{mode === "photos" ? "PHOTO LIBRARY" : "SUBMISSION ARCHIVE"}</span><h1>{mode === "photos" ? "사진 보관함" : "공모전 제출본"}<small>{mode === "photos" ? photos.length : submissions.length}</small></h1></div>{mode === "submissions" && <button className="button primary" onClick={() => setEditing(newSubmission())}><Plus size={17}/>제출본 추가</button>}</header>
    <div className="reuse-metrics">{mode === "photos" ? <><span>검토할 사진 <b>{photos.filter(photo => !photo.reviewed).length}</b></span><span>제출에 사용한 사진 <b>{photos.filter(photo => photoUsage(photo.id, submissions).some(usage => usage.submission.status !== "preparing")).length}</b></span></> : <><span>준비 중 <b>{submissions.filter(item => item.status === "preparing").length}</b></span><span>제출 완료 <b>{submissions.filter(item => item.status !== "preparing").length}</b></span></>}</div>
    {error && <p role="alert" className="alert error">{error}</p>}
    {mode === "photos" && <><FileDropzone onFiles={uploadPhotos} busy={busy} label="사진 끌어 놓기" accept=".jpg,.jpeg,.png,.webp" hint="최대 50장, JPG, PNG, WEBP, 파일당 25 MB"/>{progress && <div className="reuse-progress" role="status">{progress}{busy && <button className="text-button" onClick={() => { stop.current = true; }}>현재 파일까지 저장하고 중단</button>}</div>}</>}
    <div className="reuse-toolbar"><label className="search-box"><Search size={17}/><input aria-label={mode === "photos" ? "사진 검색" : "제출본 검색"} placeholder={mode === "photos" ? "장면, 태그, 파일명 검색" : "공모전, 제목, 결과 검색"} value={query} onChange={event => setQuery(event.target.value)}/></label>{mode === "photos" && <select aria-label="사진 필터" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">전체 사진</option><option value="unreviewed">검토 전</option><option value="unused">제출에 사용하지 않음</option><option value="star">별표 사진</option></select>}</div>
    {mode === "photos" && <><div className="reuse-bulk"><button className="button secondary" disabled={busy || !visible.length} onClick={() => setSelected(selected.length ? [] : visible.map(photo => photo.id))}>{selected.length ? "선택 해제" : "표시된 사진 선택"}</button><span>{selected.length}장 선택</span><select aria-label="일괄 적용 태그" value={bulkTag} onChange={event => setBulkTag(event.target.value)}>{Object.entries(sceneGroups).map(([group, tags]) => <optgroup label={group} key={group}>{tags.map(tag => <option key={tag}>{tag}</option>)}</optgroup>)}</select><button className="button secondary" disabled={busy || !selected.length} onClick={() => void batch(false)}>태그 추가</button><button className="button primary" disabled={busy || !selected.length} onClick={() => void batch(true)}><Check size={15}/>검토 완료</button></div>
      <div className="reuse-grid">{visible.map(photo => <article className="reuse-photo" key={photo.id}><PhotoThumbnail document={documents.find(document => document.id === photo.documentId)}/><label className="reuse-photo-check"><input type="checkbox" aria-label={`${photo.title} 선택`} checked={selected.includes(photo.id)} disabled={busy} onChange={event => setSelected(event.target.checked ? [...selected, photo.id] : selected.filter(id => id !== photo.id))}/></label><div className="reuse-photo-body"><button className="reuse-title" disabled={busy} onClick={() => setEditing(photo)}>{displayLabel(photo.title)}</button><span className={`reuse-badge ${photo.reviewed ? "confirmed" : ""}`}>{photo.reviewed ? "검토 완료" : "태그 검토 전"}</span>{photo.star > 0 && <span className="reuse-stars">{"★".repeat(photo.star)}</span>}<p>{displayLabel(photo.caption) || "설명 미입력"}</p><div className="tags">{photo.tags.map(tag => <span key={tag}>{displayLabel(tag)}</span>)}</div><div className="reuse-usage">{photoUsage(photo.id, submissions).map(({ submission, slot }) => <button key={`${submission.id}-${slot.id}`} onClick={() => onOpen(`submission:${submission.id}`)}><FileText size={12}/>{displayLabel(submission.competition || submission.title)} <small>{submissionStatus[submission.status]}</small></button>)}</div></div></article>)}</div>
      {!visible.length && <div className="reuse-empty"><Image size={35}/><h2>{photos.length ? "검색 결과가 없어요" : "사진부터 넣어 보세요"}</h2><p>수업 연결 없이 사진과 태그부터 모아둘 수 있어요.</p></div>}</>}
    {mode === "submissions" && <div className="submission-list">{submissions.filter(item => `${item.title} ${item.competition} ${item.result} ${item.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => <button className="submission-card" key={item.id} onClick={() => setEditing(item)}><span className="submission-icon"><FileText size={25}/></span><span><small>{displayLabel(item.competition) || "공모전 미지정"} {item.year}</small><strong>{displayLabel(item.title)}</strong><span>{item.documentIds.length}개 파일, {item.slots.filter(slot => slot.photoId).length}장 사진{item.result ? `, ${displayLabel(item.result)}` : ""}</span></span><span className={`reuse-badge ${item.status !== "preparing" ? "confirmed" : ""}`}>{submissionStatus[item.status]}</span></button>)}{!submissions.length && <div className="reuse-empty"><FileText size={35}/><h2>보고서와 사용한 사진을 한곳에</h2><p>공모전이나 연구대회 제출본을 추가해 주세요.</p><button className="button primary" onClick={() => setEditing(newSubmission())}>첫 제출본 추가</button></div>}</div>}
    {editing?.kind === "photo" && <PhotoEditor {...props} photo={editing} onClose={() => setEditing(null)}/>}
    {editing?.kind === "submission" && <SubmissionEditor {...props} submission={editing} onClose={() => setEditing(null)}/>}
  </section>;
}

function PhotoEditor({ photo, onClose, ...props }: Props & { photo: PhotoItem; onClose: () => void }) {
  const [draft, setDraft] = useState(photo), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [revision] = useState(props.workspace.revision);
  const uses = photoUsage(photo.id, props.workspace.items.filter((item): item is SubmissionItem => item.kind === "submission"));
  return <Modal title="사진 검토" onClose={() => !busy && onClose()} wide><form onSubmit={async event => { event.preventDefault(); setBusy(true); try { await props.onSave(draft, linkedRefs(props.workspace, `photo:${photo.id}`), revision); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); } finally { setBusy(false); } }}><div className="modal-body reuse-photo-editor"><PhotoThumbnail document={props.documents.find(document => document.id === photo.documentId)}/><fieldset disabled={busy}>{error && <p role="alert" className="alert error">{error}</p>}<label className="field"><span>사진 이름</span><input required maxLength={300} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label><label className="field"><span>장면 설명</span><textarea maxLength={2000} value={draft.caption} placeholder="사진에 보이는 장면을 기록하세요" onChange={event => setDraft({ ...draft, caption: event.target.value })}/></label><div className="reuse-tag-groups">{Object.entries(sceneGroups).map(([group, tags]) => <div key={group}><small>{group}</small><div>{tags.map(tag => <button type="button" className={draft.tags.includes(tag) ? "selected" : ""} aria-pressed={draft.tags.includes(tag)} key={tag} onClick={() => setDraft({ ...draft, tags: draft.tags.includes(tag) ? draft.tags.filter(value => value !== tag) : [...draft.tags, tag] })}>{tag}</button>)}</div></div>)}</div><TagsInput value={draft.tags} onChange={tags => setDraft({ ...draft, tags })}/><label className="field"><span>별표</span><select value={draft.star} onChange={event => setDraft({ ...draft, star: Number(event.target.value) })}>{[0,1,2,3].map(value => <option key={value} value={value}>{value ? "★".repeat(value) : "없음"}</option>)}</select></label><label className="reuse-check"><input type="checkbox" checked={draft.reviewed} onChange={event => setDraft({ ...draft, reviewed: event.target.checked })}/>태그와 설명 검토 완료</label>{uses.length > 0 && <p className="field-hint">사용한 제출본 {uses.length}개. 사진 설명을 바꿔도 제출본에 저장한 문구는 유지됩니다.</p>}</fieldset></div><div className="modal-footer"><button type="button" className="button secondary" disabled={busy || uses.length > 0} title={uses.length ? "제출본에서 사진 연결을 해제한 뒤 삭제할 수 있습니다" : "사진 기록만 삭제하며 원본은 보관합니다"} onClick={async () => { if (!confirm("사진 기록을 삭제할까요? 원본 파일은 공문 보관함에 남습니다.")) return; setBusy(true); try { await props.onDelete(photo.id, revision); onClose(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }}><Trash2 size={15}/>삭제</button><button className="button primary" disabled={busy} type="submit">사진 저장</button></div></form></Modal>;
}

function SubmissionEditor({ submission, onClose, ...props }: Props & { submission: SubmissionItem; onClose: () => void }) {
  const [draft, setDraft] = useState<SubmissionItem>(() => structuredClone(submission));
  const [revision, setRevision] = useState(props.workspace.revision), [links, setLinks] = useState(linkedRefs(props.workspace, `submission:${submission.id}`));
  const [tab, setTab] = useState<"files" | "match">("files"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const photos = props.workspace.items.filter((item): item is PhotoItem => item.kind === "photo");
  const submissions = props.workspace.items.filter((item): item is SubmissionItem => item.kind === "submission");
  const change = <K extends keyof SubmissionItem>(key: K, value: SubmissionItem[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  async function storeFiles(files: File[]) {
    if (busy) return;
    if (!files.length || files.length > 10) { setError("제출 파일은 한 번에 10개까지 넣어 주세요."); return; }
    setBusy(true); setError("");
    try {
      let current = await api<WorkspaceData>("/workspace");
      if (current.revision !== revision) throw new Error("다른 화면에서 기록이 변경되었습니다. 입력 내용을 복사한 뒤 다시 열어 주세요.");
      const added: DocumentRecord[] = [];
      for (const file of files) {
        const form = new FormData(); form.append("files", file);
        const result = await api<{ documents: DocumentRecord[] }>("/documents", { method: "POST", body: form });
        added.push(...result.documents);
      }
      current = await api<WorkspaceData>("/workspace");
      const live = current.items.find(item => item.id === submission.id);
      if (submission.id && JSON.stringify(live) !== JSON.stringify(submission)) throw new Error("업로드 중 제출본이 변경되었습니다. 원본은 보관함에 저장했으며, 제출본을 다시 열어 연결해 주세요.");
      setRevision(current.revision);
      setDraft(previous => ({ ...previous, documentIds: [...new Set([...previous.documentIds, ...added.map(document => document.id)])], title: previous.title || files[0].name.normalize("NFC").replace(/\.[^.]+$/, "") }));
      setNotice("원본을 보관했습니다. 아래 제출본 저장을 누르면 파일 연결도 저장됩니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "파일을 저장하지 못했습니다."); }
    finally { await props.onRefresh().catch(props.onError); setBusy(false); }
  }
  async function readNotice(files: File[]) {
    if (busy || !files[0]) return;
    setBusy(true); setError("");
    try {
      const text = await extractBrief(files[0]);
      if (!text.trim()) throw new Error("글자를 읽지 못했습니다. 스캔 PDF와 HWP는 내용을 복사해 아래에 붙여 넣어 주세요.");
      change("brief", text); setNotice("공고 문구를 가져왔습니다. 내용을 확인한 뒤 사진 자리 찾기를 눌러 주세요.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "공고를 읽지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!draft.title.trim()) { setError("제출본 제목을 입력해 주세요."); setTab("files"); return; }
    setBusy(true); setError("");
    try { await props.onSave(draft, links, revision); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "저장하지 못했습니다."); } finally { setBusy(false); }
  }
  return <Modal title={submission.id ? "공모전 제출본" : "새 공모전 제출본"} onClose={() => !busy && onClose()} wide>
    <div className="modal-body submission-editor">{error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="reuse-notice" role="status">{notice}</p>}<nav className="reuse-segments" aria-label="제출본 작업"><button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>제출 파일과 기록</button><button className={tab === "match" ? "active" : ""} onClick={() => setTab("match")}>공고로 사진 찾기</button></nav>
    <fieldset disabled={busy}>{tab === "files" ? <><div className="field-grid"><label className="field"><span>제출본 제목</span><input required maxLength={300} value={draft.title} placeholder="보고서 제목" onChange={event => change("title", event.target.value)}/></label><label className="field"><span>공모전 또는 연구대회</span><input maxLength={300} value={draft.competition} placeholder="대회 이름" onChange={event => change("competition", event.target.value)}/></label></div><div className="field-grid"><label className="field"><span>연도</span><input maxLength={4} inputMode="numeric" value={draft.year} onChange={event => change("year", event.target.value)}/></label><label className="field"><span>상태</span><select aria-label="상태" value={draft.status} onChange={event => change("status", event.target.value as SubmissionItem["status"])}>{Object.entries(submissionStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{draft.status !== "preparing" && <div className="field-grid"><label className="field"><span>제출일</span><input type="date" value={draft.submittedOn} onChange={event => change("submittedOn", event.target.value)}/></label><label className="field"><span>결과 또는 단계</span><input maxLength={2000} placeholder="예: 예선 통과, 본선 2등급" value={draft.result} onChange={event => change("result", event.target.value)}/></label></div>}
      <FileDropzone onFiles={storeFiles} busy={busy} label="보고서와 첨부 파일 넣기" accept=".pdf,.hwp,.hwpx,.docx,.txt,.png,.jpg,.jpeg,.webp" hint="원본은 그대로 보관, 최대 10개, 파일당 25 MB"/>
      <div className="submission-files">{draft.documentIds.map(id => { const document = props.documents.find(item => item.id === id); return <div key={id}><FileText size={17}/><span>{document ? displayLabel(document.name) : "원본 없음, 백업에서 복원 필요"}</span><button className="text-button" disabled={!document} onClick={() => document && void download(`/documents/${id}/file`, document.name).catch(cause => setError(String(cause)))}>원본</button><button className="icon-button" aria-label={`${document?.name || "파일"} 연결 해제`} onClick={() => change("documentIds", draft.documentIds.filter(value => value !== id))}><X size={15}/></button></div>; })}</div>
      <details><summary>보관 중인 파일 연결</summary><div className="submission-existing-files">{props.documents.map(document => <label key={document.id}><input type="checkbox" checked={draft.documentIds.includes(document.id)} onChange={event => change("documentIds", event.target.checked ? [...draft.documentIds, document.id] : draft.documentIds.filter(id => id !== document.id))}/>{displayLabel(document.name)}</label>)}</div></details>
      <TagsInput value={draft.tags} onChange={tags => change("tags", tags)}/><details><summary>관련 이력, 수업 연결 선택</summary><LinkPicker workspace={props.workspace} careers={props.careers} currentRef={submission.id ? `submission:${submission.id}` : undefined} value={links} onChange={setLinks}/></details>
      <div className="reuse-next"><span>연결한 사진 {draft.slots.filter(slot => slot.photoId).length}장</span><button className="button secondary" onClick={() => setTab("match")}>사진 고르기</button></div>
    </> : <><FileDropzone onFiles={readNotice} busy={busy} label="공고 또는 작성 양식 읽기" accept=".pdf,.hwpx,.docx,.txt" hint="PDF, HWPX, DOCX, TXT에서 글자를 읽습니다. 한 파일씩 선택해 주세요."/><label className="field"><span>공고 내용 또는 필요한 사진 장면</span><textarea rows={5} maxLength={30000} value={draft.brief} onChange={event => change("brief", event.target.value)} placeholder={"모둠 토의 사진\n활동지에 생각 쓰기 사진\n결과물 발표 사진"}/></label><div className="reuse-match-actions"><button className="button primary" disabled={!draft.brief.trim()} onClick={() => {
      if (draft.slots.length && !confirm("기존 사진 배치를 지우고 공고에서 다시 찾을까요?")) return;
      const slots = slotsFromBrief(draft.brief); change("slots", slots); setNotice(slots.length ? "문구에서 찾은 사진 자리입니다. 제목과 태그를 확인해 주세요." : "사진 자리를 찾지 못했습니다. 직접 추가해 주세요.");
    }}><Search size={16}/>사진 자리 찾기</button><button className="button secondary" disabled={draft.slots.length >= 30} onClick={() => change("slots", [...draft.slots, { id: crypto.randomUUID(), title: "", tags: [], quote: "", photoId: "", caption: "" }])}><Plus size={16}/>직접 추가</button><span className="field-hint">태그와 문구 기준 추천</span></div>
    {draft.slots.map((slot, index) => { const selected = photos.find(photo => photo.id === slot.photoId); const ranked = rankPhotos(photos, slot, draft.slots.filter(other => other.id !== slot.id).map(other => other.photoId)); const update = (patch: Partial<typeof slot>) => change("slots", draft.slots.map(value => value.id === slot.id ? { ...value, ...patch } : value)); return <section className="reuse-slot" key={slot.id} aria-label={`사진 자리 ${index + 1}`}><div className="reuse-slot-heading"><b>{String(index + 1).padStart(2, "0")}</b><input aria-label={`사진 자리 ${index + 1} 제목`} maxLength={300} placeholder="필요한 장면" value={slot.title} onChange={event => update({ title: event.target.value, tags: suggestSceneTags(event.target.value) })}/><button className="icon-button" aria-label={`사진 자리 ${index + 1} 위로`} disabled={index === 0} onClick={() => { const slots = [...draft.slots]; [slots[index - 1], slots[index]] = [slots[index], slots[index - 1]]; change("slots", slots); }}>↑</button><button className="icon-button" aria-label={`사진 자리 ${index + 1} 삭제`} onClick={() => change("slots", draft.slots.filter(value => value.id !== slot.id))}><X size={16}/></button></div>{slot.quote && <blockquote>공고 문구: {displayLabel(slot.quote)}</blockquote>}<TagsInput value={slot.tags} onChange={tags => update({ tags })}/>
    {selected ? <div className="reuse-selected-photo"><PhotoThumbnail document={props.documents.find(document => document.id === selected.documentId)}/><div><strong>{displayLabel(selected.title)}</strong><label className="field"><span>이 제출본의 사진 설명</span><textarea rows={2} maxLength={2000} value={slot.caption} onChange={event => update({ caption: event.target.value })}/></label><button className="text-button" onClick={() => update({ photoId: "", caption: "" })}>다른 사진 고르기</button></div></div> : <><div className="reuse-candidates">{ranked.map(({ photo, matched }) => <div className="reuse-candidate" key={photo.id}><PhotoThumbnail document={props.documents.find(document => document.id === photo.documentId)}/><strong>{displayLabel(photo.title)}</strong><p>{matched.join(", ")} 태그 일치{!photo.reviewed ? ", 검토 전" : ""}</p>{photoUsage(photo.id, submissions).map(({ submission: used, slot: oldSlot }) => <small key={`${used.id}-${oldSlot.id}`}>{displayLabel(used.competition || used.title)}: {submissionStatus[used.status]}</small>)}<button className="button secondary" onClick={() => update({ photoId: photo.id, caption: photo.caption })}>이 사진 선택</button></div>)}</div>{!ranked.length && <p className="workspace-inline-empty">일치하는 태그가 없어요. 태그를 바꾸거나 아래 목록에서 직접 고르세요.</p>}<label className="field"><span>사진 직접 선택</span><select aria-label={`사진 자리 ${index + 1} 직접 선택`} value="" onChange={event => { const photo = photos.find(value => value.id === event.target.value); if (photo) update({ photoId: photo.id, caption: photo.caption }); }}><option value="">사진 보관함에서 선택</option>{photos.filter(photo => !draft.slots.some(other => other.photoId === photo.id)).map(photo => <option key={photo.id} value={photo.id}>{displayLabel(photo.title)}</option>)}</select></label></>}
    </section>; })}<p className="field-hint">이전 제출 이력은 추천에서 제외하지 않습니다. 실제 제출 가능 여부는 공고의 재사용 기준을 확인해 주세요.</p></>}</fieldset></div>
    <div className="modal-footer reuse-editor-footer"><button className="button secondary" disabled={busy} onClick={onClose}><ArrowLeft size={15}/>닫기</button>{submission.id && <button className="button secondary" disabled={busy} onClick={async () => { if (!confirm("제출본 기록을 삭제할까요? 원본 파일과 사진은 보관됩니다.")) return; setBusy(true); try { await props.onDelete(submission.id, revision); onClose(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }}><Trash2 size={15}/>삭제</button>}<button className="button secondary" disabled={busy || !draft.slots.some(slot => slot.photoId)} onClick={async () => { setBusy(true); setError(""); try { const blob = await buildPhotoPackage(draft, photos, props.documents); saveBlob(blob, `${safeFilename(draft.title || "선택_사진")}.zip`); setNotice("현재 선택 사진을 내려받았습니다. 편집 내용은 제출본 저장을 눌러 보관해 주세요."); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }}><Download size={16}/>사진 ZIP</button><button className="button primary" disabled={busy} onClick={() => void save()}><Check size={16}/>{busy ? "처리 중" : "제출본 저장"}</button></div>
  </Modal>;
}
