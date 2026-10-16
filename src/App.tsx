import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Medal,
  Clapperboard,
  BriefcaseBusiness,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  CloudUpload,
  Download,
  File,
  FileCheck2,
  FileText,
  Folder,
  FolderOpen,
  GraduationCap,
  Layers3,
  LayoutGrid,
  List,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Trophy,
  Users,
  X,
} from "lucide-react";
import FileDropzone from "./FileDropzone";
import { careerSection, careerOrganization, careerCategoryChoices, careerCategoryLabel, matchesCareerCategory, recognitionDetails } from "../shared/career-organization.mjs";
import { materialDraft } from "../shared/material-classification.mjs";
import { api, download } from "./api";
import {
  cloudMode,
  freeMode,
  hasCloudSession,
  signedOutCloudStatus,
  signInCloud,
  signOutCloud,
  subscribeCloudAuth,
} from "./cloud";
import {
  categories,
  emptyCareer,
  type Career,
  type Category,
  type DocumentRecord,
  type Status,
  type View,
} from "./types";
import { CareerEditor, Modal } from "./CareerEditor";
import ResumeBuilder from "./ResumeBuilder";
import BackupSettings from "./BackupSettings";
import ProjectsView from "./workspace/ProjectsView";
import MaterialImport from "./workspace/MaterialImport";
import MaterialsView from "./workspace/MaterialsView";
import GraduateView from "./workspace/GraduateView";
import WorkspaceSearch from "./workspace/WorkspaceSearch";
import WorkspaceBackup from "./workspace/WorkspaceBackup";
import { displayLabel, RelatedLinks } from "./workspace/WorkspaceUI";
import type { WorkspaceData, WorkspaceItem, WorkspaceImportResult } from "./workspace/types";
const emptyWorkspace = (): WorkspaceData => ({ schemaVersion: 1, items: [], links: [], revision: 0 });

const categoryIcons = {
  "강의·연수": GraduationCap,
  "위원회·지원단": Users,
  "연구·수상": Trophy,
  연구대회: Trophy, 표창: Medal,
  "집필·콘텐츠": BookOpen,
  "근무·파견": BriefcaseBusiness,
  파견: BriefcaseBusiness, 근무: BriefcaseBusiness, 집필: BookOpen, "콘텐츠 제작": Clapperboard,
  자격증: FileCheck2,
  기타: Layers3,
};
const navItems: {
  view: View;
  label: string;
  icon: typeof Folder;
  description: string;
}[] = [
  {
    view: "careers",
    label: "이력",
    icon: Layers3,
    description: "나의 모든 경험",
  },
  { view: "projects", label: "수업", icon: Folder, description: "교실에서 만들어 낸 배움" },
  { view: "materials", label: "강의 자료", icon: BookOpen, description: "만들고 모아둔 자료" },
  { view: "graduate", label: "대학원", icon: GraduationCap, description: "" },
  {
    view: "documents",
    label: "공문 보관함",
    icon: FolderOpen,
    description: "경력과 연결된 증빙",
  },
  {
    view: "resume",
    label: "이력서, 증빙 만들기",
    icon: FileText,
    description: "필요한 기록만 골라서",
  },
  {
    view: "settings",
    label: "백업 및 설정",
    icon: Settings2,
    description: "안전하게 보관하기",
  },
];
export function CategoryIcon({
  category,
  small = false,
}: {
  category: Category;
  small?: boolean;
}) {
  const Icon = categoryIcons[category] || Layers3;
  return (
    <span
      className={`category-icon category-${categories.indexOf(category)} ${small ? "small" : ""}`}
    >
      <Icon size={small ? 16 : 21} strokeWidth={1.7} />
    </span>
  );
}
export function formatPeriod(c: Career) {
  if (!c.startDate) return "날짜 확인 필요";
  const f = (s: string) => s.replaceAll("-", ".");
  return c.endDate && c.endDate !== c.startDate
    ? `${f(c.startDate)} – ${f(c.endDate)}`
    : f(c.startDate);
}
export function fileSize(size: number) {
  return size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function Evidence({ career }: { career: Career }) {
  return career.documentIds.length ? (
    <span className="evidence attached">
      <FileCheck2 size={13} />
      증빙 {career.documentIds.length}
    </span>
  ) : career.evidenceStatus === "unneeded" ? (
    <span className="evidence">증빙 불필요</span>
  ) : (
    <span className="evidence">
      <File size={13} />
      증빙 미첨부
    </span>
  );
}

function Recognition({career}: {career:Career}) {
  if (careerSection(career) !== "연구대회") return null;
  const details=recognitionDetails(career);
  return <div className="recognition-badges" aria-label="연구대회 등급과 단계">{details.level && <span className="award-level">{details.level}</span>}{details.grade && <strong>{details.grade}</strong>}{details.stages.map(stage=><span className="award-stage" key={stage}>{stage}</span>)}{!details.grade && <span className="award-unknown">등급 미기재</span>}</div>;
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null),
    [careers, setCareers] = useState<Career[]>([]),
    [documents, setDocuments] = useState<DocumentRecord[]>([]),
    [workspace, setWorkspace] = useState<WorkspaceData>(emptyWorkspace),
    [workspaceFocus, setWorkspaceFocus] = useState<string | undefined>(),
    [workspaceFocusVersion, setWorkspaceFocusVersion] = useState(0),
    [globalSearch, setGlobalSearch] = useState(false);
  const materialUploading = useRef(false);
  const [view, setView] = useState<View>("careers"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState<Category | "전체">("전체"),
    [year, setYear] = useState("전체 연도"),
    [institution, setInstitution] = useState("전체 기관"),
    [groupBy, setGroupBy] = useState<"year" | "organization">("year"),
    [evidenceFilter, setEvidenceFilter] = useState("전체 증빙"),
    [reviewOnly, setReviewOnly] = useState(false),
    [layout, setLayout] = useState<"list" | "grid">("list");
  const [editor, setEditor] = useState<Career | null>(null),
    [queue, setQueue] = useState<Career[]>([]),
    [analysisNote, setAnalysisNote] = useState(""),
    [detail, setDetail] = useState<Career | null>(null),
    [manual, setManual] = useState(false),
    [manualText, setManualText] = useState("");
  const [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [mobileNav, setMobileNav] = useState(false),
    [deleteTarget, setDeleteTarget] = useState<{
      type: "career" | "document";
      id: string;
      title: string;
    } | null>(null),
    [linkDoc, setLinkDoc] = useState<DocumentRecord | null>(null),
    [linkId, setLinkId] = useState(""),
    [linkQuery, setLinkQuery] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null),
    searchRef = useRef<HTMLInputElement>(null),
    refreshVersion = useRef(0);
  async function refresh() {
    const version = ++refreshVersion.current;
    try {
      const s = await api<Status>("/status");
      if (version !== refreshVersion.current) return;
      setStatus(s);
      if (s.mode === "local" || s.user) {
        const [d, nextWorkspace] = await Promise.all([
          api<{ careers: Career[]; documents: DocumentRecord[] }>("/data"),
          api<WorkspaceData>("/workspace"),
        ]);
        if (version !== refreshVersion.current) return;
        setCareers(d.careers);
        setDocuments(d.documents);
        setWorkspace(nextWorkspace);
        setDetail((current) =>
          current ? d.careers.find((c) => c.id === current.id) || null : null,
        );
      } else {
        setCareers([]);
        setDocuments([]);
        setWorkspace(emptyWorkspace());
        setWorkspaceFocus(undefined);
        setGlobalSearch(false);
        setDetail(null);
      }
    } catch (e) {
      if (version !== refreshVersion.current) return;
      if (cloudMode) {
        setStatus(
          signedOutCloudStatus(
            e instanceof Error ? e.message : "서버 연결을 확인해 주세요.",
          ),
        );
        setCareers([]);
        setDocuments([]);
        setWorkspace(emptyWorkspace());
        setWorkspaceFocus(undefined);
        setGlobalSearch(false);
        setDetail(null);
      }
      throw e;
    }
  }
  useEffect(() => {
    let active = true;
    let authVersion = 0;
    const reload = () => {
      const version = ++authVersion;
      if (!active) return;
      setLoading(true);
      if (cloudMode) {
        setStatus(null);
        setCareers([]);
        setDocuments([]);
        setWorkspace(emptyWorkspace());
        setWorkspaceFocus(undefined);
        setGlobalSearch(false);
        setEditor(null);
        setQueue([]);
        setDetail(null);
        setManual(false);
        setManualText("");
        setDeleteTarget(null);
        setLinkDoc(null);
        setError("");
      }
      refresh()
        .catch((e) => active && version === authVersion && setError(e.message))
        .finally(() => active && version === authVersion && setLoading(false));
    };
    const unsubscribe = cloudMode ? subscribeCloudAuth(reload) : null;
    if (!cloudMode) reload();
    return () => {
      active = false;
      refreshVersion.current++;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (document.querySelector('[role="dialog"]')) return;
        setGlobalSearch(true);
        return;
      }
      if (
        e.key === "/" &&
        !document.querySelector('[role="dialog"]') &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const years = useMemo(
    () =>
      [
        ...new Set(
          careers.flatMap((c) => {
            const start = Number(c.startDate?.slice(0, 4)),
              end = Number(c.endDate?.slice(0, 4)) || start;
            if (!start || end < start) return [];
            return Array.from(
              { length: Math.min(150, end - start + 1) },
              (_, i) => String(start + i),
            );
          }),
        ),
      ]
        .sort()
        .reverse(),
    [careers],
  );
  const isCareerView = view === "careers";
  const careerViewLabel = category === "전체" ? "전체 기록" : displayLabel(category);
  const scopedCareers = useMemo(() => careers.filter(c => matchesCareerCategory(c, category, documents)), [careers, category, documents]);
  const institutions = useMemo(() => [...new Set(scopedCareers.map(c => careerOrganization(c, documents)))].sort((a,b) => a.localeCompare(b,"ko")), [scopedCareers, documents]);
  const collectionDocuments = category === "전체" ? [] : documents.filter(document =>
    scopedCareers.some(career => career.documentIds.includes(document.id)) || category === "파견" && document.name.includes("파견"));
  const filtered = useMemo(
    () =>
      careers
        .filter((c) => {
          const match =
            `${recognitionDetails(c).level} ${recognitionDetails(c).grade} ${recognitionDetails(c).stages.join(" ")} ${careerCategoryLabel(c, documents)} ${displayLabel(c.title)} ${careerOrganization(c, documents)} ${displayLabel(c.role)} ${c.description} ${c.tags.join(" ")} ${c.startDate} ${c.endDate}`
              .normalize("NFC").toLocaleLowerCase()
              .includes(query.normalize("NFC").trim().toLocaleLowerCase());
          return (
            match &&
            (!reviewOnly || !c.verified) &&
            matchesCareerCategory(c, category, documents) &&
            (institution === "전체 기관" || careerOrganization(c, documents) === institution) &&
            (year === "전체 연도" ||
              (c.startDate.slice(0, 4) <= year &&
                (c.endDate || c.startDate).slice(0, 4) >= year)) &&
            (evidenceFilter === "전체 증빙" ||
              (evidenceFilter === "증빙 있음"
                ? c.documentIds.length > 0
                : c.documentIds.length === 0 &&
                  c.evidenceStatus !== "unneeded"))
          );
        })
        .sort(
          (a, b) =>
            (b.startDate || "").localeCompare(a.startDate || "") ||
            a.title.localeCompare(b.title, "ko"),
        ),
    [careers, documents, query, category, year, institution, evidenceFilter, reviewOnly],
  );
  const groups = useMemo(() => Object.entries(Object.groupBy(filtered, c => groupBy === "organization"
    ? careerOrganization(c, documents) : c.startDate.slice(0, 4) || "확인 필요"))
    .sort(([a], [b]) => groupBy === "organization" ? a === "기관 미입력" ? 1 : b === "기관 미입력" ? -1 : a.localeCompare(b,"ko")
      : a === "확인 필요" ? 1 : b === "확인 필요" ? -1 : b.localeCompare(a)), [filtered, groupBy, documents]);
  const linkedCareers = careers.filter((c) => c.documentIds.length > 0).length;
  const missingEvidence = careers.filter((c) => !c.documentIds.length && c.evidenceStatus !== "unneeded").length;
  const unreviewed = careers.filter((c) => !c.verified).length;
  const evidenceRequired = careers.filter((c) => c.documentIds.length || c.evidenceStatus !== "unneeded").length;
  const coverage = evidenceRequired ? Math.round(linkedCareers / evidenceRequired * 100) : 0;
  const hasFilters = !!query || category !== "전체" || year !== "전체 연도" || institution !== "전체 기관" || evidenceFilter !== "전체 증빙" || reviewOnly;
  const clearFilters = () => {
    setQuery(""); setCategory("전체"); setYear("전체 연도"); setInstitution("전체 기관"); setGroupBy("year");
    setEvidenceFilter("전체 증빙"); setReviewOnly(false);
  };
  const chooseCategory = (next: Category | "전체") => {
    setCategory(next); setInstitution("전체 기관"); setQuery(""); setYear("전체 연도");
    setEvidenceFilter("전체 증빙"); setReviewOnly(false);
    setGroupBy(next === "강의·연수" ? "organization" : "year");
  };
  const focusArchive = (filter: "all" | "missing" | "review") => {
    clearFilters(); setView("careers");
    if (filter === "missing") setEvidenceFilter("증빙 미첨부");
    if (filter === "review") setReviewOnly(true);
    document.getElementById("career-records")?.scrollIntoView({ block: "start" });
  };
  const changeView = (v: View) => {
    if (v === "careers") clearFilters();
    window.scrollTo({ top: 0 });
    setView(v);
    setQuery("");
    setMobileNav(false);
    setDetail(null);
    setWorkspaceFocus(undefined);
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "처리 중 오류가 발생했습니다.");
  const openWorkspaceRef = (ref: string) => {
    const separator = ref.indexOf(":");
    if (separator < 1) return;
    const kind = ref.slice(0, separator), id = ref.slice(separator + 1);
    if (kind === "career") {
      const career = careers.find(item => item.id === id);
      if (!career) return;
      changeView("careers"); setDetail(career);
    } else if (kind === "document") {
      const document = documents.find(item => item.id === id);
      if (!document) return;
      changeView("documents"); setQuery(document.name);
    } else {
      const item = workspace.items.find(item => item.id === id && item.kind === kind);
      if (!item) return;
      changeView(item.kind === "project" || item.kind === "material" && item.purpose === "classroom" ? "projects" : item.kind === "material" ? "materials" : "graduate");
      setWorkspaceFocus(id);
      setWorkspaceFocusVersion(version => version + 1);
    }
  };
  async function saveWorkspaceItem(item: WorkspaceItem, links: string[], expectedRevision: number) {
    setBusy("기록 저장 중");
    setError("");
    try {
      const next = await api<WorkspaceData>(item.id ? `/workspace/items/${item.id}` : "/workspace/items", {
        method: item.id ? "PUT" : "POST", body: JSON.stringify({ item, links, expectedRevision }),
      });
      setWorkspace(next);
      setToast("기록과 연결 정보를 저장했습니다.");
    } catch (cause) { await refresh().catch(() => {}); throw cause; }
    finally { setBusy(""); }
  }
  async function deleteWorkspaceItem(id: string, expectedRevision: number) {
    setBusy("기록 삭제 중"); setError("");
    try {
      const next = await api<WorkspaceData>(`/workspace/items/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) });
      setWorkspace(next); setWorkspaceFocus(undefined);
      setToast("기록을 삭제했습니다.");
    } catch (cause) { await refresh().catch(() => {}); throw cause; }
    finally { setBusy(""); }
  }
  async function importWorkspaceArchive(archive: unknown) {
    const result = await api<WorkspaceImportResult>("/workspace/import", { method: "POST", body: JSON.stringify({ archive, expectedRevision: workspace.revision }) });
    setWorkspace(result.workspace);
    await refresh();
    return result;
  }
  async function login() {
    setBusy("구글 로그인 중");
    setError("");
    try {
      await signInCloud();
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function logout() {
    try {
      await signOutCloud();
      await refresh();
    } catch (e) {
      fail(e);
    }
  }
  async function retryConnection() {
    setLoading(true);
    setError("");
    try {
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }
  async function downloadDocument(document: DocumentRecord) {
    setBusy("공문 원본 내려받는 중");
    try {
      await download(`/documents/${document.id}/file`, document.name);
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function saveCareer(c: Career) {
    setBusy("경력 저장 중");
    try {
      const saved = await api<Career>(c.id ? `/careers/${c.id}` : "/careers", {
        method: c.id ? "PUT" : "POST",
        body: JSON.stringify({ ...c, verified: true }),
      });
      await refresh();
      setToast("경력을 저장했습니다.");
      setDetail((d) => (d?.id === saved.id ? saved : d));
      if (queue.length) {
        setEditor(queue[0]);
        setQueue(queue.slice(1));
      } else {
        setEditor(null);
        setAnalysisNote("");
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function analyzeText() {
    if (!manualText.trim()) return;
    setBusy("입력한 내용 정리 중");
    try {
      const result = await api<{
        careers: Partial<Career>[];
        method: string;
        warnings: string[];
      }>("/analyze", {
        method: "POST",
        body: JSON.stringify({ text: manualText }),
      });
      const drafts = result.careers.map((c) => ({
        ...emptyCareer(),
        ...c,
        id: "",
        verified: true,
      }));
      if (!drafts.length)
        throw new Error(
          "경력 정보를 찾지 못했습니다. 직접 입력으로 등록해 주세요.",
        );
      setEditor(drafts[0]);
      setQueue(drafts.slice(1));
      setAnalysisNote(
        `${result.method === "ai" ? "AI가 정리한 초안" : "키워드 규칙으로 정리한 초안, AI 미연결"}. ${result.warnings.join(" ")}`,
      );
      setManual(false);
      setManualText("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function analyzeDocuments(docs: DocumentRecord[]) {
    const drafts: Career[] = [];
    const notes: string[] = [];
    for (let i = 0; i < docs.length; i++) {
      setBusy(`공문 내용 확인 중 (${i + 1}/${docs.length})`);
      try {
        const result = await api<{
          careers: Partial<Career>[];
          method: string;
          warnings: string[];
        }>("/analyze", {
          method: "POST",
          body: JSON.stringify({ documentId: docs[i].id }),
        });
        drafts.push(
          ...result.careers.map((c) => ({
            ...emptyCareer(),
            ...c,
            id: "",
            verified: true,
            documentIds: [docs[i].id],
            evidenceStatus: "attached" as const,
          })),
        );
        notes.push(...result.warnings);
        if (result.method !== "ai")
          notes.push("AI 미연결: 문서 텍스트와 키워드 규칙으로 정리했습니다.");
      } catch (e) {
        notes.push(
          `${docs[i].name}: ${e instanceof Error ? e.message : "분석 실패"}`,
        );
      }
    }
    if (drafts.length) {
      setEditor(drafts[0]);
      setQueue(drafts.slice(1));
      setAnalysisNote([...new Set(notes)].join(" "));
    } else if (notes.length) setError(notes.join("\n"));
  }
  async function uploadMaterials(files: File[], purpose: "lecture" | "classroom") {
    if (materialUploading.current || busy) return;
    if (!status?.driveConnected) { setError("백업 및 설정에서 구글 드라이브를 먼저 연결해 주세요."); return; }
    materialUploading.current = true; setBusy("자료 자동 정리 중"); setError("");
    const warnings: string[] = [];
    try {
      const { prepareMaterialFiles } = await import("./free/material-files");
      const { applyMaterialImport } = await import("./free/material-import");
      const prepared = await prepareMaterialFiles(files, purpose);
      const result = await applyMaterialImport(prepared, {
        approvedMaterialIds: prepared.materials.map(entry => entry.item.id),
        onProgress: progress => setBusy(progress.phase === "saving" ? "자료 저장 중" : `자료 자동 정리 (${progress.completed}/${progress.total})`),
        enrich: async (item, file, driveFileId, digest) => {
          if (/\.html?$/i.test(file.name)) return item;
          if (/\.(txt|pptx|docx|hwpx)$/i.test(file.name) && item.summary.trim()) return item;
          try {
            const extraction = await api<{text?:string}>("/documents/extract", {method:"POST",body:JSON.stringify({driveFileId,name:file.name,size:file.size,sha256:digest})});
            return extraction.text?.trim() ? { ...item, ...materialDraft(file.name, extraction.text, purpose) } : item;
          } catch { warnings.push(file.name); return item; }
        },
      });
      await refresh();
      changeView(purpose === "classroom" ? "projects" : "materials");
      setWorkspaceFocus(prepared.materials[0]?.item.id); setWorkspaceFocusVersion(version=>version+1);
      setToast(`자료 ${result.added}개 자동 정리, 중복 ${result.duplicates}개${warnings.length ? ", 일부 파일은 파일명으로 분류했습니다" : ""}`);
    } catch (cause) { fail(cause); await refresh().catch(()=>{}); }
    finally { materialUploading.current = false; setBusy(""); }
  }
  async function uploadFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    if (files.length > 10) {
      setError("한 번에 최대 10개의 파일을 올려주세요.");
      return;
    }
    if (Array.from(files).some((f) => f.size > 25 * 1024 * 1024)) {
      setError("공문은 파일당 최대 25 MB까지 보관할 수 있습니다.");
      return;
    }
    setBusy("공문 업로드 중");
    setError("");
    const knownIds = new Set(documents.map((d) => d.id));
    try {
      type Uploaded = {
        documents: DocumentRecord[];
        duplicates: string[];
      };
      let result: Uploaded;
      const uploadWarnings: string[] = [];
      if (cloudMode) {
        result = { documents: [], duplicates: [] };
        // Functions의 요청 크기 제한을 지키도록 파일당 한 번씩 전송합니다.
        const selected = Array.from(files);
        for (let i = 0; i < selected.length; i++) {
          setBusy(`공문 업로드 중 (${i + 1}/${selected.length})`);
          const form = new FormData();
          form.append("files", selected[i]);
          try {
            const uploaded = await api<Uploaded>("/documents", {
              method: "POST",
              body: form,
            });
            result.documents.push(...uploaded.documents);
            result.duplicates.push(...uploaded.duplicates);
          } catch (e) {
            uploadWarnings.push(
              `${selected[i].name}: ${e instanceof Error ? e.message : "업로드 실패"} 이미 보관한 파일은 유지했습니다. 남은 파일은 다시 선택해 주세요.`,
            );
            break;
          }
        }
      } else {
        const form = new FormData();
        Array.from(files).forEach((f) => form.append("files", f));
        result = await api<Uploaded>("/documents", { method: "POST", body: form });
      }
      const added = [
        ...new Map(
          result.documents
            .filter((d) => !knownIds.has(d.id))
            .map((d) => [d.id, d]),
        ).values(),
      ];
      await refresh();
      changeView("documents");
      if (result.duplicates.length)
        setToast(
          `중복 파일 ${result.duplicates.length}개는 추가하지 않았습니다.`,
        );
      else setToast(`공문 ${added.length}개를 보관했습니다.`);
      if (added.length) await analyzeDocuments(added);
      if (uploadWarnings.length) setError(uploadWarnings.join("\n"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }
  async function remove() {
    if (!deleteTarget) return;
    setBusy("삭제 중");
    try {
      const result = await api<{ warning?: string }>(
        `/${deleteTarget.type === "career" ? "careers" : "documents"}/${deleteTarget.id}`,
        { method: "DELETE" },
      );
      if (deleteTarget.type === "career") setDetail(null);
      setDeleteTarget(null);
      await refresh();
      setToast(result.warning || "삭제했습니다.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function connectDoc() {
    if (!linkDoc || !linkId) return;
    setBusy("경력 연결 중");
    try {
      await api(`/documents/${linkDoc.id}/link`, {
        method: "POST",
        body: JSON.stringify({ careerId: linkId }),
      });
      await refresh();
      setLinkDoc(null);
      setLinkId("");
      setToast("공문을 경력에 연결했습니다.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  const authorized = status && (status.mode === "local" || !!status.user);
  return (
    <div className="app-shell" onDragOver={event=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();}} onDrop={event=>{
      if (!event.dataTransfer.files.length) return;
      event.preventDefault(); if(busy || document.querySelector("[role=dialog] form"))return;
      const files=Array.from(event.dataTransfer.files);
      if(view==="materials")void uploadMaterials(files,"lecture");
      else if(view==="projects")void uploadMaterials(files,"classroom");
      else if(isCareerView || view==="documents")void uploadFiles(files);
    }}>
      <aside className={`sidebar ${mobileNav ? "is-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changeView("careers");
          }}
        >
          <span className="brand-icon">
            <Layers3 size={23} />
          </span>
          <span>
            Introduce Me<small>MY PROFESSIONAL WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-dot" />
          나만의 아카이브
          <LockKeyhole size={12} />
        </div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav aria-label="주 메뉴">
          {navItems.map((n) => (
            <div key={n.view}>
            {n.view === "documents" && <div className="workspace-nav-break">ARCHIVE TOOLS</div>}
            <button
              aria-label={n.view === "careers" ? "경력 아카이브" : undefined}
              aria-current={view === n.view ? "page" : undefined}
              className={`nav-item ${view === n.view ? "active" : ""}`}
              onClick={() => changeView(n.view)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.view === "careers" && (
                <span className="nav-count">{careers.length}</span>
              )}
            </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="account-button"
            onClick={() => changeView("settings")}
          >
            <span className="avatar">
              {status?.user?.name?.slice(0, 1) || "나"}
            </span>
            <span>
              <strong>{status?.user?.name || "나의 워크스페이스"}</strong>
              <small>
                {status?.mode === "local"
                  ? "로컬 개발 모드"
                  : status?.user?.email || "로그인이 필요해요"}
              </small>
            </span>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="메뉴 열기"
            aria-expanded={mobileNav}
            onClick={() => setMobileNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>내 워크스페이스</span>
            <ChevronRight size={13} />
            <strong>{navItems.find((n) => n.view === view)?.label}</strong>
          </div>
          <div className="topbar-end">
            {authorized && <button className="global-search-trigger" aria-label="모든 기록 검색 열기" onClick={() => setGlobalSearch(true)}><Search size={15} /><span>통합 검색</span><kbd>Ctrl K</kbd></button>}
            {authorized && <button className={`sync-status ${status.driveConnected ? "connected" : ""}`} onClick={() => changeView("settings")}>
              <Cloud size={15} />{status.driveConnected ? "드라이브 연결됨" : "백업 설정"}
            </button>}
            <span className="privacy-label">
              <LockKeyhole size={13} />
              비공개
            </span>
            <span className="top-avatar">
              {status?.user?.name?.slice(0, 1) || "나"}
            </span>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div role="alert" className="alert error">
              <span>{displayLabel(error)}</span>
              <button aria-label="오류 닫기" onClick={() => setError("")}>
                <X size={17} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={28} />
              <p>나의 기록을 불러오는 중이에요.</p>
            </div>
          ) : !authorized ? (
            <div className="login-state">
              <span className="brand-icon large">
                <LockKeyhole size={32} />
              </span>
              <h1>나만의 기록을 여는 문</h1>
              <p>
                본인 구글 계정으로 로그인해
                <br />
                경력과 증빙을 안전하게 관리하세요.
              </p>
              {cloudMode && status?.firebaseConfigured ? (
                <button
                  className="button primary"
                  onClick={login}
                  disabled={!!busy}
                >
                  {hasCloudSession()
                    ? "다른 구글 계정으로 로그인"
                    : "구글 계정으로 로그인"}
                  <ArrowRight size={16} />
                </button>
              ) : status?.googleConfigured && status.ownerConfigured ? (
                <a className="button primary" href="/api/auth/google">
                  구글 계정으로 로그인
                  <ArrowRight size={16} />
                </a>
              ) : (
                <div className="notice">
                  {status?.configurationError ||
                    "구글 로그인 설정이 필요합니다. 환경 설정에서 로그인 클라이언트와 본인 계정을 등록해 주세요."}
                </div>
              )}
              {status?.authenticationError && (
                <p className="configuration-note" role="alert">
                  {status.authenticationError}
                </p>
              )}
              {cloudMode && hasCloudSession() && (
                <div className="settings-actions">
                  <button
                    className="button secondary"
                    onClick={retryConnection}
                    disabled={!!busy}
                  >
                    연결 다시 확인
                  </button>
                  <button className="text-button" onClick={logout} disabled={!!busy}>
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {["careers", "projects", "materials", "graduate"].includes(view) && <nav className="workspace-main-tabs" aria-label="기록 종류">{navItems.slice(0, 4).map(item => <button key={item.view} className={view === item.view ? "active" : ""} aria-current={view === item.view ? "page" : undefined} onClick={() => changeView(item.view)}><item.icon size={17} />{item.label}</button>)}</nav>}
              {!["projects", "materials", "graduate"].includes(view) && <div className="page-heading">
                <div className="page-heading-text">
                  <div className="eyebrow">
                    {view === "careers"
                      ? "MY CAREER"
                      : view === "projects" ? "TEACHING PORTFOLIO"
                      : view === "materials" ? "MY LEARNING LIBRARY"
                      : view === "graduate" ? "STUDY & RESEARCH"
                      : view === "documents"
                        ? "DOCUMENT LIBRARY"
                        : view === "resume"
                          ? "MAKE IT YOURS"
                          : "SAFE & CONNECTED"}
                  </div>
                  <h1>
                    {isCareerView
                      ? "이력"
                      : view === "projects" ? "수업"
                      : view === "materials" ? "강의 자료"
                      : view === "graduate" ? "대학원"
                      : view === "documents"
                        ? "공문 보관함"
                        : view === "resume"
                          ? "이력서, 증빙 만들기"
                          : "백업 및 설정"}
                    <span className="heading-dot">.</span>
                  </h1>

                </div>
                <div className="page-actions">
                  {(isCareerView || view === "documents") && (
                    <>
                      <button
                        className="button secondary"
                        onClick={() => uploadRef.current?.click()}
                        disabled={!!busy}
                      >
                        <CloudUpload size={17} />
                        공문 업로드
                      </button>
                      <button
                        className="button primary"
                        onClick={() => {
                          setEditor({ ...emptyCareer(), ...(category !== "전체" ? { category } : {}) });
                          setQueue([]);
                          setAnalysisNote("");
                        }}
                        disabled={!!busy}
                      >
                        <Plus size={18} />
                        경력 추가
                      </button>
                    </>
                  )}
                </div>
              </div>}
              {isCareerView && (
                <>
                  <nav className="category-tabs career-collections" aria-label="이력 분류">
                    {(["전체", ...careerCategoryChoices] as const).map(c => {
                      const count = c === "전체" ? careers.length : careers.filter(item => matchesCareerCategory(item,c,documents)).length;
                      const Icon = c === "전체" ? Layers3 : categoryIcons[c];
                      return <button key={c} className={category === c ? "active" : ""} aria-pressed={category === c} onClick={()=>chooseCategory(c)}>
                        <Icon size={17}/><strong>{displayLabel(c)}</strong><span>{count}</span>
                      </button>;
                    })}
                  </nav>
                  <section className="stats-grid" aria-label="경력 요약">
                    <Stat label="전체 경력" value={careers.length} unit="건" icon={<BriefcaseBusiness size={19} />} foot="나의 모든 경험 모아보기" onClick={() => focusArchive("all")} />
                    <Stat label="보관 중인 공문" value={documents.length} unit="개" icon={<FolderOpen size={19} />} foot={`${linkedCareers}개 경력에 원본 연결`} onClick={() => changeView("documents")} />
                    <Stat label="증빙 보완할 경력" value={missingEvidence} unit="건" icon={<FileCheck2 size={19} />} foot="경력에 맞는 원본 연결하기" accent onClick={() => focusArchive("missing")} />
                    <Stat label="확인 전 경력" value={unreviewed} unit="건" icon={<CircleHelp size={19} />} foot={unreviewed ? "날짜와 역할을 확인해 주세요" : "모든 경력을 확인했어요"} onClick={() => focusArchive("review")} />
                  </section>
                  {category !== "전체" && collectionDocuments.length > 0 && <details className="collection-evidence"><summary><FileText size={16}/>{careerViewLabel} 관련 공문 {collectionDocuments.length}개</summary><div>{collectionDocuments.map(document => <div key={document.id}><span>{displayLabel(document.name)}</span><button className="button secondary" onClick={()=>void download(`/documents/${document.id}/file`,document.name).catch(fail)}><Download size={14}/>원본</button><button className="text-button" onClick={()=>{setLinkDoc(document);setLinkId("");setLinkQuery("");}}>이력 연결</button></div>)}</div></details>}
                  <FileDropzone onFiles={uploadFiles} busy={!!busy} label="공문 끌어 놓기" />
                  <section className="career-section" id="career-records">
                    <div className="section-heading">
                      <h2>
                        {careerViewLabel} <span>{filtered.length}</span>
                      </h2>
                      <button
                        className="text-button"
                        onClick={() => changeView("resume")}
                      >
                        이력서로 만들기
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="filter-toolbar">
                      <label className="search-box">
                        <Search size={18} />
                        <input
                          ref={searchRef}
                          aria-label="경력 검색"
                          placeholder="활동명, 기관, 태그 검색"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        {query ? (
                          <button
                            aria-label="검색 지우기"
                            onClick={() => setQuery("")}
                          >
                            <X size={14} />
                          </button>
                        ) : (
                          <kbd>/</kbd>
                        )}
                      </label>
                      <div className="filter-selects">
                        <label className="select-wrap institution-select"><Building2 size={15}/><select aria-label="기관 필터" value={institution} onChange={e=>setInstitution(e.target.value)}><option>전체 기관</option>{institutions.map(name=><option key={name}>{name}</option>)}</select><ChevronDown size={13}/></label>
                        <label className="select-wrap">
                          <CalendarDays size={15} />
                          <select
                            aria-label="연도 필터"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                          >
                            <option>전체 연도</option>
                            {years.map((y) => (
                              <option key={y}>{y}</option>
                            ))}
                          </select>
                          <ChevronDown size={13} />
                        </label>
                        <label className="select-wrap">
                          <select
                            aria-label="증빙 필터"
                            value={evidenceFilter}
                            onChange={(e) => setEvidenceFilter(e.target.value)}
                          >
                            <option>전체 증빙</option>
                            <option>증빙 있음</option>
                            <option>증빙 미첨부</option>
                          </select>
                          <ChevronDown size={13} />
                        </label>
                        <div className="view-switch">
                          <button
                            aria-label="목록 보기"
                            className={layout === "list" ? "active" : ""}
                            aria-pressed={layout === "list"}
                            onClick={() => setLayout("list")}
                          >
                            <List size={17} />
                          </button>
                          <button
                            aria-label="카드 보기"
                            className={layout === "grid" ? "active" : ""}
                            aria-pressed={layout === "grid"}
                            onClick={() => setLayout("grid")}
                          >
                            <LayoutGrid size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="archive-result-bar">
                      <span aria-live="polite">{filtered.length}건{groupBy === "organization" ? `, ${groups.length}개 기관` : ", 최근 활동순"}</span>
                      <div>
                        <label className="group-select"><select aria-label="이력 묶어보기" value={groupBy} onChange={e=>setGroupBy(e.target.value as "year" | "organization")}><option value="year">연도별 보기</option><option value="organization">기관별 보기</option></select><ChevronDown size={12}/></label>
                        <button className={`review-filter ${reviewOnly ? "active" : ""}`} aria-pressed={reviewOnly} onClick={() => setReviewOnly(!reviewOnly)}><CircleHelp size={14} />확인 전만 보기</button>
                        {hasFilters && <button className="reset-filters" onClick={clearFilters}><X size={13} />필터 초기화</button>}
                      </div>
                    </div>
                    {!filtered.length ? (
                      <EmptyState
                        icon={<Search size={29} />}
                        title={
                          careers.length
                            ? "일치하는 경력이 없어요"
                            : "첫 번째 경력을 남겨보세요"
                        }
                        text={
                          careers.length
                            ? "검색어나 필터를 바꿔서 다시 찾아보세요."
                            : "공문을 올리거나 직접 입력해 시작할 수 있어요."
                        }
                      />
                    ) : (
                      groups.map(([y, records]) => (
                        <div className={`year-group ${groupBy === "organization" ? "institution-group" : ""}`} key={y}>
                          <div className="year-heading">
                            {groupBy === "organization" ? <Building2 className="institution-marker" size={19}/> : <span className="year-marker" />}
                            <h3>
                              {y}
                              {groupBy === "year" && y !== "확인 필요" && <span>년</span>}
                            </h3>
                            <span className="year-count">
                              {records?.length}개의 기록
                            </span>
                            <div className="year-line" />
                          </div>
                          <div
                            className={
                              layout === "grid" ? "career-grid" : "career-list"
                            }
                          >
                            {records?.map((c) => (
                              <button
                                className={`career-row ${layout === "grid" ? "as-card" : ""}`}
                                key={c.id}
                                onClick={() => setDetail(c)}
                              >
                                <CategoryIcon category={careerSection(c, documents)} />
                                <div className="career-info">
                                  <div className="career-category">
                                    {careerCategoryLabel(c, documents)}
                                    {!c.verified && (
                                      <span className="unverified-label">
                                        확인 전
                                      </span>
                                    )}
                                  </div>
                                  {careerSection(c, documents) === "강의·연수" && <div className="lecture-institution"><Building2 size={14}/><span>{careerOrganization(c, documents)}</span></div>}
                                  <h4>{displayLabel(c.title)}</h4><Recognition career={c} />
                                  <div className="career-meta">
                                    {careerSection(c, documents) !== "강의·연수" && <span>{careerOrganization(c, documents)}</span>}
                                    {c.role && (
                                      <>
                                        {careerSection(c, documents) !== "강의·연수" && <i />}
                                        {displayLabel(c.role)}
                                      </>
                                    )}
                                  </div>
                                  <div className="row-tags">
                                    {c.tags.slice(0, 3).map((t) => (
                                      <span key={t}>#{displayLabel(t)}</span>
                                    ))}
                                  </div>
                                </div>
                                <div className="career-row-date">
                                  {formatPeriod(c)}
                                </div>
                                <div className="career-row-evidence">
                                  <Evidence career={c} />
                                </div>
                                <ChevronRight
                                  className="career-row-arrow"
                                  size={17}
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                    <div className="list-footer">
                      <LockKeyhole size={12} />이 기록은 본인만 볼 수 있어요.
                      <span>Introduce Me, 개인 경력 아카이브</span>
                    </div>
                  </section>
                </>
              )}
              {view === "projects" && <ProjectsView key={`${workspaceFocus || "list"}-${workspaceFocusVersion}`} workspace={workspace} careers={careers} onSave={saveWorkspaceItem} onDelete={deleteWorkspaceItem} onOpen={openWorkspaceRef} focusId={workspaceFocus} onError={fail} loadHtmlPreview={freeMode ? async item => (await import("./free/material-preview")).loadMaterialHtml(item) : undefined} onFiles={freeMode ? uploadMaterials : undefined} uploading={!!busy} classroomImport={freeMode ? <MaterialImport driveConnected={Boolean(status?.driveConnected)} disabled={Boolean(busy)} onBusyChange={active => setBusy(active ? "학급 자료 가져오는 중" : "")} onRefresh={refresh} onToast={setToast} /> : undefined} />}
              {view === "materials" && <MaterialsView key={`${workspaceFocus || "list"}-${workspaceFocusVersion}`} workspace={workspace} careers={careers} onSave={saveWorkspaceItem} onDelete={deleteWorkspaceItem} onOpen={openWorkspaceRef} focusId={workspaceFocus} onError={fail} loadHtmlPreview={freeMode ? async item => (await import("./free/material-preview")).loadMaterialHtml(item) : undefined} onFiles={freeMode ? uploadMaterials : undefined} uploading={!!busy} />}
              {view === "graduate" && <GraduateView key={`${workspaceFocus || "list"}-${workspaceFocusVersion}`} workspace={workspace} careers={careers} onSave={saveWorkspaceItem} onDelete={deleteWorkspaceItem} onOpen={openWorkspaceRef} focusId={workspaceFocus} onError={fail} />}
              {view === "documents" && (
                <DocumentsView
                  documents={documents}
                  careers={careers}
                  query={query}
                  setQuery={setQuery}
                  busy={!!busy}
                  onUpload={() => uploadRef.current?.click()}
                  onDrop={uploadFiles}
                  onAnalyze={async (d) => {
                    try {
                      await analyzeDocuments([d]);
                    } catch (e) {
                      fail(e);
                    } finally {
                      setBusy("");
                    }
                  }}
                  onDownload={downloadDocument}
                  onLink={(d) => {
                    setLinkDoc(d);
                    setLinkId("");
                    setLinkQuery("");
                  }}
                  onDelete={(d) =>
                    setDeleteTarget({
                      type: "document",
                      id: d.id,
                      title: d.name,
                    })
                  }
                  onOpenCareer={(c) => setDetail(c)}
                />
              )}
              {view === "resume" && (
                <ResumeBuilder
                  careers={careers}
                  documents={documents}
                  onError={fail}
                  onToast={setToast}
                />
              )}
              {view === "settings" && status && (
                <BackupSettings
                  status={status}
                  onRefresh={refresh}
                  onError={fail}
                  onToast={setToast}
                  careers={careers.length}
                  documents={documents.length}
                />
              )}
              {view === "settings" && status && <WorkspaceBackup onImport={importWorkspaceArchive} onError={fail} onToast={setToast} />}
            </>
          )}
        </main>
      </div>
      <input
        ref={uploadRef}
        type="file"
        multiple
        accept=".pdf,.ppt,.pptx,.hwp,.hwpx,.docx,.html,.htm,.txt,.xlsx,.cell,.jpg,.jpeg,.png,.webp"
        aria-label="공문 파일 선택"
        className="visually-hidden"
        onChange={(e) => uploadFiles(e.target.files)}
      />
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spin" size={17} />
          {busy}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={18} />
          {toast}
          <button aria-label="알림 닫기" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {authorized && globalSearch && <WorkspaceSearch workspace={workspace} careers={careers} documents={documents} onOpen={openWorkspaceRef} onClose={() => setGlobalSearch(false)} />}
      {editor && (
        <CareerEditor
          career={editor}
          documents={documents}
          busy={!!busy}
          note={analysisNote}
          remaining={queue.length}
          onClose={() => {
            setEditor(null);
            setQueue([]);
            setAnalysisNote("");
          }}
          onSave={saveCareer}
          onFreeText={() => {
            setEditor(null);
            setManual(true);
          }}
          onSkip={() => {
            if (queue.length) {
              setEditor(queue[0]);
              setQueue(queue.slice(1));
            } else {
              setEditor(null);
              setAnalysisNote("");
            }
          }}
        />
      )}
      {manual && (
        <Modal
          title="한 문장으로 경력 기록하기"

          onClose={() => !busy && setManual(false)}
        >
          <div className="modal-body">
            <div className="notice">
              <Sparkles size={16} />
              {status?.aiConfigured
                ? "AI가 경력 정보와 분류를 제안합니다. 저장 전 내용을 확인해 주세요."
                : "AI 연결 전에는 키워드 규칙으로 분류합니다. 결과를 확인하고 수정해 주세요."}
            </div>
            <label className="field">
              <span>나의 활동 이야기</span>
              <textarea
                rows={7}
                placeholder="예: 2024년 대구광역시교육청 미디어리터러시 연구회 회장으로 활동했어. 교사들과 수업 자료를 만들고 사례 나눔을 진행했어."
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
              />
            </label>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setManual(false)}
              disabled={!!busy}
            >
              취소
            </button>
            <button
              className="button primary"
              onClick={analyzeText}
              disabled={!manualText.trim() || !!busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}
              내용 정리하기
            </button>
          </div>
        </Modal>
      )}
      {detail && (
        <div className="drawer-backdrop" onClick={() => setDetail(null)}>
          <aside
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="경력 상세"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-top">
              <span>CAREER DETAIL</span>
              <button
                className="icon-button"
                aria-label="상세 닫기"
                onClick={() => setDetail(null)}
              >
                <X size={21} />
              </button>
            </div>
            <CategoryIcon category={careerSection(detail, documents)} />
            <div className="detail-category">{careerCategoryLabel(detail, documents)}</div>
            <h2>{displayLabel(detail.title)}</h2><Recognition career={detail} />
            <Evidence career={detail} />
            {!detail.verified && (
              <div className="notice detail-notice">
                아직 확인하지 않은 기록입니다. 증빙의 날짜와 역할을 확인한 뒤 저장해 주세요.
              </div>
            )}
            <dl className="detail-fields">
              <div>
                <dt>
                  <CalendarDays size={15} />
                  활동 기간
                </dt>
                <dd>{formatPeriod(detail)}</dd>
              </div>
              <div>
                <dt>
                  <BriefcaseBusiness size={15} />
                  기관
                </dt>
                <dd>{careerOrganization(detail, documents)}</dd>
              </div>
              <div>
                <dt>
                  <Users size={15} />
                  역할
                </dt>
                <dd>{displayLabel(detail.role || "미입력")}</dd>
              </div>
            </dl>
            <section className="detail-section">
              <h3>활동 내용</h3>
              <p>
                {displayLabel(detail.description || "아직 활동 내용을 작성하지 않았어요.")}
              </p>
            </section>
            <section className="detail-section">
              <h3>
                <Tag size={15} />
                태그
              </h3>
              <div className="tags">
                {detail.tags.length ? (
                  detail.tags.map((t) => <span key={t}>#{displayLabel(t)}</span>)
                ) : (
                  <p>등록된 태그가 없어요.</p>
                )}
              </div>
            </section>
            <section className="detail-section">
              <h3>
                <FileText size={15} />
                연결된 공문 <span>{detail.documentIds.length}</span>
              </h3>
              {documents
                .filter((d) => detail.documentIds.includes(d.id))
                .map((d) => (
                  cloudMode ? (
                    <button
                      key={d.id}
                      className="attached-document"
                      onClick={() => downloadDocument(d)}
                      disabled={!!busy}
                    >
                      <FileText size={18} />
                      <span>{displayLabel(d.name)}<small>{fileSize(d.size)}</small></span>
                      <Download size={16} />
                    </button>
                  ) : (
                  <a
                    key={d.id}
                    className="attached-document"
                    href={`/api/documents/${d.id}/file`}
                    download
                  >
                    <FileText size={18} />
                    <span>
                      {displayLabel(d.name)}
                      <small>{fileSize(d.size)}</small>
                    </span>
                    <Download size={16} />
                  </a>
                  )
                ))}
              {!detail.documentIds.length && (
                <div className="detail-empty">
                  <FolderOpen size={24} />
                  <p>
                    {detail.evidenceStatus === "unneeded"
                      ? "증빙이 필요하지 않은 경력이에요."
                      : "공문을 연결하면 증빙을 쉽게 찾을 수 있어요."}
                  </p>
                </div>
              )}
            </section>
            <RelatedLinks workspace={workspace} careers={careers} currentRef={`career:${detail.id}`} onOpen={openWorkspaceRef} />
            {detail.source && (
              <p className="source-note">출처: {displayLabel(detail.source)}</p>
            )}
            <div className="drawer-actions">
              <button
                className="button text-danger"
                onClick={() =>
                  setDeleteTarget({
                    type: "career",
                    id: detail.id,
                    title: detail.title,
                  })
                }
              >
                삭제
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setEditor(detail);
                  setQueue([]);
                  setAnalysisNote("");
                }}
              >
                경력 수정하기
              </button>
            </div>
          </aside>
        </div>
      )}
      {deleteTarget && (
        <Modal title="기록을 삭제할까요?" onClose={() => setDeleteTarget(null)}>
          <div className="modal-body">
            <p className="confirm-description">
              ‘{displayLabel(deleteTarget.title)}’
              {deleteTarget.type === "career"
                ? " 경력을 삭제합니다. 연결된 공문 원본은 보관함에 남습니다."
                : freeMode
                  ? " 파일과 경력의 연결을 앱에서 삭제합니다. 이전 백업을 복원할 수 있도록 드라이브 원본은 보관합니다."
                  : " 파일과 경력의 연결을 삭제합니다. 원본 파일도 앱에서 삭제됩니다."}
            </p>
            <p className="muted">
              삭제한 내용은 백업이 있어야 복원할 수 있습니다.
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={!!busy}
            >
              취소
            </button>
            <button
              className="button danger"
              onClick={remove}
              disabled={!!busy}
            >
              삭제하기
            </button>
          </div>
        </Modal>
      )}
      {linkDoc && (
        <Modal
          title="기존 경력에 공문 연결"
          subtitle={displayLabel(linkDoc.name)}
          onClose={() => setLinkDoc(null)}
        >
          <div className="modal-body">
            <label className="field">
              <span>경력 찾기</span>
              <input type="search" value={linkQuery} onChange={(e) => { setLinkQuery(e.target.value); setLinkId(""); }} placeholder="활동명, 기관, 연도로 검색" aria-label="연결할 경력 검색" />
            </label>
            <label className="field">
              <span>연결할 경력</span>
              <select
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
              >
                <option value="">경력을 선택해 주세요</option>
                {careers.filter((c) => `${recognitionDetails(c).level} ${recognitionDetails(c).grade} ${recognitionDetails(c).stages.join(" ")} ${careerCategoryLabel(c, documents)} ${displayLabel(c.title)} ${careerOrganization(c, documents)} ${c.startDate}`.normalize("NFC").toLocaleLowerCase().includes(linkQuery.normalize("NFC").trim().toLocaleLowerCase())).map((c) => (
                  <option key={c.id} value={c.id} disabled={c.documentIds.includes(linkDoc.id)}>
                    {c.startDate}, {displayLabel(c.title)}{c.documentIds.includes(linkDoc.id) ? " (연결됨)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setLinkDoc(null)}
            >
              취소
            </button>
            <button
              className="button primary"
              onClick={connectDoc}
              disabled={!linkId || !!busy}
            >
              연결하기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  icon,
  foot,
  accent = false,
  onClick,
}: {
  label: string;
  value: number;
  unit: string;
  icon: ReactNode;
  foot: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`stat-card ${accent ? "accent" : ""}`} onClick={onClick}>
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>

    </button>
  );
}
export function EmptyState({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function DocumentsView({
  documents,
  careers,
  query,
  setQuery,
  busy,
  onUpload,
  onDrop,
  onAnalyze,
  onDownload,
  onLink,
  onDelete,
  onOpenCareer,
}: {
  documents: DocumentRecord[];
  careers: Career[];
  query: string;
  setQuery: (s: string) => void;
  busy: boolean;
  onUpload: () => void;
  onDrop: (files: FileList) => void;
  onAnalyze: (d: DocumentRecord) => void;
  onDownload: (d: DocumentRecord) => void;
  onLink: (d: DocumentRecord) => void;
  onDelete: (d: DocumentRecord) => void;
  onOpenCareer: (c: Career) => void;
}) {
  const [drag, setDrag] = useState(false),
    [filter, setFilter] = useState("전체 파일");
  const linkedByDocument = new Map(documents.map((d) => [d.id, careers.filter((c) => c.documentIds.includes(d.id))]));
  const linkedCount = documents.filter((d) => linkedByDocument.get(d.id)?.length).length;
  const items = documents.filter((d) => {
    const linked = linkedByDocument.get(d.id) || [];
    return `${displayLabel(d.name)} ${d.text || ""} ${linked.map((c) => `${recognitionDetails(c).level} ${recognitionDetails(c).grade} ${recognitionDetails(c).stages.join(" ")} ${careerCategoryLabel(c, documents)} ${displayLabel(c.title)} ${careerOrganization(c, documents)} ${c.tags.join(" ")}`).join(" ")}`
      .normalize("NFC").toLocaleLowerCase().includes(query.normalize("NFC").trim().toLocaleLowerCase()) &&
      (filter === "전체 파일" || (filter === "연결된 파일" ? linked.length > 0 : linked.length === 0));
  });
  return (
    <>
      <div className="document-summary">
        <span><FolderOpen size={17} /><strong>{documents.length}</strong>개 원본 보관</span>
        <span><FileCheck2 size={16} /><strong>{linkedCount}</strong>개 원본 연결됨</span>
        <button onClick={() => setFilter(filter === "미연결 파일" ? "전체 파일" : "미연결 파일")} aria-pressed={filter === "미연결 파일"} className={filter === "미연결 파일" ? "active" : ""}>미연결 {documents.length - linkedCount}개 살펴보기<ArrowRight size={14} /></button>
      </div>
      <div
        className={`upload-dropzone ${drag ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrag(false);
          if (!busy) onDrop(e.dataTransfer.files);
        }}
      >
        <span className="upload-icon">
          <CloudUpload size={30} />
        </span>
        <h2>공문 업로드</h2>

        <button className="button primary" onClick={onUpload} disabled={busy}>
          <Plus size={17} />
          파일 선택하기
        </button>
        <small>
          PDF, PPTX, HWP, HWPX, DOCX, XLSX, CELL, TXT, 이미지, 파일당 최대 25 MB, 한 번에
          10개

        </small>
      </div>
      <div className="section-heading document-section-heading">
        <h2>
          보관 중인 공문 <span>{documents.length}</span>
        </h2>
        <span className="muted">동일한 파일은 중복 없이 보관해요</span>
      </div>
      <div className="filter-toolbar">
        <label className="search-box">
          <Search size={18} />
          <input
            aria-label="공문 검색"
            placeholder="파일명, 문서 내용, 연결된 경력으로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="select-wrap">
          <select
            aria-label="파일 연결 필터"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option>전체 파일</option>
            <option>연결된 파일</option>
            <option>미연결 파일</option>
          </select>
          <ChevronDown size={13} />
        </label>
      </div>
      {(query || filter !== "전체 파일") && <div className="document-result-bar"><span aria-live="polite">검색 결과 {items.length}개</span><button className="reset-filters" onClick={() => { setQuery(""); setFilter("전체 파일"); }}><X size={13} />필터 초기화</button></div>}
      {!items.length ? (
        <EmptyState
          icon={<FolderOpen size={30} />}
          title={
            documents.length
              ? "일치하는 파일이 없어요"
              : "아직 보관 중인 공문이 없어요"
          }
          text={
            documents.length
              ? "검색어나 필터를 바꿔보세요."
              : "컴퓨터에 모아둔 공문을 올려 경력과 연결해 보세요."
          }
        />
      ) : (
        <div className="document-list">
          {items.map((d) => {
            const linked = linkedByDocument.get(d.id) || [];
            return (
              <article className="document-row" key={d.id}>
                <span className="document-file-icon">
                  <FileText size={24} />
                  <small>{d.name.split(".").at(-1)?.toUpperCase()}</small>
                </span>
                <div className="document-info">
                  {cloudMode ? (
                    <button className="document-download-link" onClick={() => onDownload(d)} disabled={busy}>{displayLabel(d.name)}</button>
                  ) : (
                  <a href={`/api/documents/${d.id}/file`} download>
                    {displayLabel(d.name)}
                  </a>
                  )}
                  <p>
                    {fileSize(d.size)}
                    <span>,</span>
                    {new Date(d.createdAt).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </p>
                  <div className="document-links">
                    {linked.length ? (
                      linked.map((c) => (
                        <button key={c.id} onClick={() => onOpenCareer(c)}>
                          <Layers3 size={12} />
                          {displayLabel(c.title)}
                          <ChevronRight size={12} />
                        </button>
                      ))
                    ) : (
                      <span className="muted">경력 미연결</span>
                    )}
                  </div>
                </div>
                <div className="document-actions">
                  <button
                    className="icon-button"
                    title="경력 초안 만들기"
                    aria-label={`${displayLabel(d.name)} 경력 초안 만들기`}
                    onClick={() => onAnalyze(d)}
                    disabled={busy}
                  >
                    <Sparkles size={17} />
                  </button>
                  <button
                    className="icon-button"
                    title="기존 경력에 연결"
                    aria-label={`${displayLabel(d.name)} 기존 경력에 연결`}
                    onClick={() => onLink(d)}
                    disabled={busy}
                  >
                    <Plus size={18} />
                  </button>
                  {cloudMode ? (
                    <button
                      className="icon-button"
                      title="원본 다운로드"
                      aria-label={`${displayLabel(d.name)} 다운로드`}
                      onClick={() => onDownload(d)}
                      disabled={busy}
                    >
                      <ArrowDownToLine size={17} />
                    </button>
                  ) : (
                    <a
                    className="icon-button"
                    title="원본 다운로드"
                    href={`/api/documents/${d.id}/file`}
                    download
                    aria-label={`${displayLabel(d.name)} 다운로드`}
                  >
                    <ArrowDownToLine size={17} />
                  </a>
                  )}
                  <button
                    className="icon-button delete-file"
                    title="파일 삭제"
                    aria-label={`${displayLabel(d.name)} 삭제`}
                    onClick={() => onDelete(d)}
                    disabled={busy}
                  >
                    <X size={17} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
