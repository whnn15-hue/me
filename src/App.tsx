import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Check,
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
  HardDrive,
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

const categoryIcons = {
  "강의·연수": GraduationCap,
  "위원회·지원단": Users,
  "연구·수상": Trophy,
  "집필·콘텐츠": BookOpen,
  "근무·파견": BriefcaseBusiness,
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
    label: "경력 아카이브",
    icon: Layers3,
    description: "나의 모든 경험",
  },
  {
    view: "documents",
    label: "공문 보관함",
    icon: FolderOpen,
    description: "경력과 연결된 증빙",
  },
  {
    view: "resume",
    label: "이력서·증빙 만들기",
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

export default function App() {
  const [status, setStatus] = useState<Status | null>(null),
    [careers, setCareers] = useState<Career[]>([]),
    [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [view, setView] = useState<View>("careers"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState<Category | "전체">("전체"),
    [year, setYear] = useState("전체 연도"),
    [evidenceFilter, setEvidenceFilter] = useState("전체 증빙"),
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
    [linkId, setLinkId] = useState("");
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
        const d = await api<{ careers: Career[]; documents: DocumentRecord[] }>(
          "/data",
        );
        if (version !== refreshVersion.current) return;
        setCareers(d.careers);
        setDocuments(d.documents);
        setDetail((current) =>
          current ? d.careers.find((c) => c.id === current.id) || null : null,
        );
      } else {
        setCareers([]);
        setDocuments([]);
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
      if (
        e.key === "/" &&
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
  const filtered = useMemo(
    () =>
      careers
        .filter((c) => {
          const match =
            `${c.title} ${c.organization} ${c.role} ${c.description} ${c.tags.join(" ")} ${c.startDate} ${c.endDate}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase());
          return (
            match &&
            (category === "전체" || category === c.category) &&
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
    [careers, query, category, year, evidenceFilter],
  );
  const groups = useMemo(
    () =>
      Object.entries(
        Object.groupBy(filtered, (c) => c.startDate.slice(0, 4) || "확인 필요"),
      ).sort(([a], [b]) =>
        a === "확인 필요" ? 1 : b === "확인 필요" ? -1 : b.localeCompare(a),
      ),
    [filtered],
  );
  const changeView = (v: View) => {
    setView(v);
    setQuery("");
    setMobileNav(false);
    setDetail(null);
  };
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "처리 중 오류가 발생했습니다.");
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
        `${result.method === "ai" ? "AI가 정리한 초안" : "키워드 규칙으로 정리한 초안 · AI 미연결"}. ${result.warnings.join(" ")}`,
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
    <div className="app-shell">
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
            나의 기록<small>PERSONAL CAREER ARCHIVE</small>
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
            <button
              key={n.view}
              className={`nav-item ${view === n.view ? "active" : ""}`}
              onClick={() => changeView(n.view)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.view === "careers" && (
                <span className="nav-count">{careers.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-section-label">MY COLLECTIONS</div>
        <div className="collection-links">
          {categories.slice(0, 6).map((c, i) => (
            <button
              key={c}
              onClick={() => {
                changeView("careers");
                setCategory(c);
              }}
              className={view === "careers" && category === c ? "selected" : ""}
            >
              <span className={`collection-dot dot-${i}`} />
              {c}
              <span>{careers.filter((x) => x.category === c).length}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>소중한 기록, 안전하게</strong>
            <p>
              경력 정보와 원본 공문을
              <br />
              함께 백업해 두세요.
            </p>
            <button onClick={() => changeView("settings")}>
              {status?.driveConnected ? "백업 상태 확인" : "백업 설정하기"}
              <ArrowUpRight size={14} />
            </button>
          </div>
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
              <span>{error}</span>
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
              <div className="page-heading">
                <div className="page-heading-text">
                  <div className="eyebrow">
                    {view === "careers"
                      ? "MY CAREER"
                      : view === "documents"
                        ? "DOCUMENT LIBRARY"
                        : view === "resume"
                          ? "MAKE IT YOURS"
                          : "SAFE & CONNECTED"}
                  </div>
                  <h1>
                    {view === "careers"
                      ? "나의 경력"
                      : view === "documents"
                        ? "공문 보관함"
                        : view === "resume"
                          ? "이력서·증빙 만들기"
                          : "백업 및 설정"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {view === "careers"
                      ? "하나씩 쌓아온 경험을, 한눈에 정리하세요."
                      : view === "documents"
                        ? "경력을 증명하는 원본 파일을 한곳에 모아두세요."
                        : view === "resume"
                          ? "필요한 경력을 골라, 다음 기회를 준비하세요."
                          : "어디서든 이어지는 기록, 안심할 수 있는 백업."}
                  </p>
                </div>
                <div className="page-actions">
                  {(view === "careers" || view === "documents") && (
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
                          setEditor(emptyCareer());
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
              </div>
              {view === "careers" && (
                <>
                  <section className="welcome-banner">
                    <div>
                      <span className="banner-eyebrow">
                        <span />
                        EVERY EXPERIENCE MATTERS
                      </span>
                      <h2>
                        쌓아온 경험이
                        <br />
                        나의 다음을 만듭니다.
                      </h2>
                      <p>기록하고, 연결하고, 필요할 때 꺼내 쓰세요.</p>
                      <button
                        onClick={() => {
                          setManual(true);
                          setManualText("");
                        }}
                        className="banner-link"
                      >
                        한 문장으로 경력 기록하기
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="archive-illustration" aria-hidden="true">
                      <div className="illustration-halo" />
                      <span className="floating-star star-one">✳</span>
                      <span className="floating-star star-two">✦</span>
                      <div className="paper paper-back" />
                      <div className="paper paper-front">
                        <span className="paper-small-icon">
                          <GraduationCap size={20} />
                        </span>
                        <span className="paper-line long" />
                        <span className="paper-line" />
                        <span className="paper-line short" />
                        <div className="paper-tags">
                          <i />
                          <i />
                        </div>
                        <span className="paper-stamp">
                          <Check size={22} />
                        </span>
                      </div>
                      <div className="illustration-caption">
                        <span />
                        <span>My career, connected.</span>
                      </div>
                    </div>
                  </section>
                  <section className="stats-grid" aria-label="경력 요약">
                    <Stat
                      label="전체 경력"
                      value={careers.length}
                      unit="건"
                      icon={<BriefcaseBusiness size={19} />}
                      foot="나의 경험이 차곡차곡"
                    />
                    <Stat
                      label="보관 중인 공문"
                      value={documents.length}
                      unit="개"
                      icon={<FolderOpen size={19} />}
                      foot={`${careers.filter((c) => c.documentIds.length).length}개 경력과 연결되어 있어요`}
                    />
                    <Stat
                      label="기록한 활동 연도"
                      value={years.length}
                      unit="년"
                      icon={<CalendarDays size={19} />}
                      foot={
                        years.length
                          ? `${years.at(-1)} – ${years[0]}`
                          : "첫 기록을 남겨보세요"
                      }
                    />
                    <Stat
                      label="증빙 보완할 경력"
                      value={
                        careers.filter(
                          (c) =>
                            !c.documentIds.length &&
                            c.evidenceStatus === "later",
                        ).length
                      }
                      unit="건"
                      icon={<FileCheck2 size={19} />}
                      foot="공문은 나중에 연결해도 괜찮아요"
                      accent
                    />
                  </section>
                  <section className="career-section">
                    <div className="section-heading">
                      <h2>
                        경력 모아보기 <span>{filtered.length}</span>
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
                          placeholder="경력, 기관, 태그로 검색해 보세요"
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
                            onClick={() => setLayout("list")}
                          >
                            <List size={17} />
                          </button>
                          <button
                            aria-label="카드 보기"
                            className={layout === "grid" ? "active" : ""}
                            onClick={() => setLayout("grid")}
                          >
                            <LayoutGrid size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="category-tabs" aria-label="분류 필터">
                      {(["전체", ...categories] as const).map((c) => (
                        <button
                          key={c}
                          className={category === c ? "active" : ""}
                          onClick={() => setCategory(c)}
                        >
                          {c}
                          <span>
                            {c === "전체"
                              ? careers.length
                              : careers.filter((x) => x.category === c).length}
                          </span>
                        </button>
                      ))}
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
                        <div className="year-group" key={y}>
                          <div className="year-heading">
                            <span className="year-marker" />
                            <h3>
                              {y}
                              {y !== "확인 필요" && <span>년</span>}
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
                                <CategoryIcon category={c.category} />
                                <div className="career-info">
                                  <div className="career-category">
                                    {c.category}
                                    {!c.verified && (
                                      <span className="unverified-label">
                                        확인 전
                                      </span>
                                    )}
                                  </div>
                                  <h4>{c.title}</h4>
                                  <div className="career-meta">
                                    <span>
                                      {c.organization || "기관 확인 필요"}
                                    </span>
                                    {c.role && (
                                      <>
                                        <i />
                                        {c.role}
                                      </>
                                    )}
                                  </div>
                                  <div className="row-tags">
                                    {c.tags.slice(0, 3).map((t) => (
                                      <span key={t}>#{t}</span>
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
                      <span>나의 기록 · 개인 경력 아카이브</span>
                    </div>
                  </section>
                </>
              )}
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
            </>
          )}
        </main>
      </div>
      <input
        ref={uploadRef}
        type="file"
        multiple
        accept=".pdf,.hwp,.hwpx,.docx,.txt,.xlsx,.jpg,.jpeg,.png,.webp"
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
          subtitle="기억나는 만큼 적어주세요. 항목과 태그를 정리해 드려요."
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
            <CategoryIcon category={detail.category} />
            <div className="detail-category">{detail.category}</div>
            <h2>{detail.title}</h2>
            <Evidence career={detail} />
            {!detail.verified && (
              <div className="notice detail-notice">
                PDF에서 가져온 확인 전 기록입니다. 날짜와 역할을 확인한 뒤
                저장해 주세요.
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
                <dd>{detail.organization || "미입력"}</dd>
              </div>
              <div>
                <dt>
                  <Users size={15} />
                  역할
                </dt>
                <dd>{detail.role || "미입력"}</dd>
              </div>
            </dl>
            <section className="detail-section">
              <h3>활동 내용</h3>
              <p>
                {detail.description || "아직 활동 내용을 작성하지 않았어요."}
              </p>
            </section>
            <section className="detail-section">
              <h3>
                <Tag size={15} />
                태그
              </h3>
              <div className="tags">
                {detail.tags.length ? (
                  detail.tags.map((t) => <span key={t}>#{t}</span>)
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
                      <span>{d.name}<small>{fileSize(d.size)}</small></span>
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
                      {d.name}
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
            {detail.source && (
              <p className="source-note">출처: {detail.source}</p>
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
              ‘{deleteTarget.title}’
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
          subtitle={linkDoc.name}
          onClose={() => setLinkDoc(null)}
        >
          <div className="modal-body">
            <label className="field">
              <span>연결할 경력</span>
              <select
                value={linkId}
                onChange={(e) => setLinkId(e.target.value)}
              >
                <option value="">경력을 선택해 주세요</option>
                {careers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.startDate} · {c.title}
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
}: {
  label: string;
  value: number;
  unit: string;
  icon: ReactNode;
  foot: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>{foot}</p>
    </div>
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
  const items = documents.filter(
    (d) =>
      d.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "전체 파일" ||
        (filter === "연결된 파일"
          ? d.recordIds?.length
          : !d.recordIds?.length)),
  );
  return (
    <>
      <div
        className={`upload-dropzone ${drag ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (!busy) onDrop(e.dataTransfer.files);
        }}
      >
        <span className="upload-icon">
          <CloudUpload size={30} />
        </span>
        <h2>공문을 올리면, 경력 정리가 시작돼요.</h2>
        <p>
          파일을 여기에 끌어놓거나 선택해 주세요. 여러 개를 한 번에 올릴 수
          있어요.
        </p>
        <button className="button primary" onClick={onUpload} disabled={busy}>
          <Plus size={17} />
          파일 선택하기
        </button>
        <small>
          PDF, HWP, HWPX, DOCX, XLSX, TXT, 이미지 · 파일당 최대 25 MB · 한 번에
          10개
          <br />
          HWP·이미지 원본은 보관 가능하며 내용 추출 지원 범위는 설정에서 확인할
          수 있어요.
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
            placeholder="파일명으로 검색"
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
              : "PDF에 적힌 파일명은 원본 첨부가 아닙니다. 컴퓨터에 모은 공문을 올려 주세요."
          }
        />
      ) : (
        <div className="document-list">
          {items.map((d) => {
            const linked = careers.filter((c) => c.documentIds.includes(d.id));
            return (
              <article className="document-row" key={d.id}>
                <span className="document-file-icon">
                  <FileText size={24} />
                  <small>{d.name.split(".").at(-1)?.toUpperCase()}</small>
                </span>
                <div className="document-info">
                  {cloudMode ? (
                    <button className="document-download-link" onClick={() => onDownload(d)} disabled={busy}>{d.name}</button>
                  ) : (
                  <a href={`/api/documents/${d.id}/file`} download>
                    {d.name}
                  </a>
                  )}
                  <p>
                    {fileSize(d.size)}
                    <span>·</span>
                    {new Date(d.createdAt).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </p>
                  <div className="document-links">
                    {linked.length ? (
                      linked.map((c) => (
                        <button key={c.id} onClick={() => onOpenCareer(c)}>
                          <Layers3 size={12} />
                          {c.title}
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
                    aria-label={`${d.name} 경력 초안 만들기`}
                    onClick={() => onAnalyze(d)}
                    disabled={busy}
                  >
                    <Sparkles size={17} />
                  </button>
                  <button
                    className="icon-button"
                    title="기존 경력에 연결"
                    aria-label={`${d.name} 기존 경력에 연결`}
                    onClick={() => onLink(d)}
                    disabled={busy}
                  >
                    <Plus size={18} />
                  </button>
                  {cloudMode ? (
                    <button
                      className="icon-button"
                      title="원본 다운로드"
                      aria-label={`${d.name} 다운로드`}
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
                    aria-label={`${d.name} 다운로드`}
                  >
                    <ArrowDownToLine size={17} />
                  </a>
                  )}
                  <button
                    className="icon-button delete-file"
                    title="파일 삭제"
                    aria-label={`${d.name} 삭제`}
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
