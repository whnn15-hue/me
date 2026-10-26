import { useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Cloud,
  ExternalLink,
  HardDrive,
  Info,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { api, download } from "./api";
import { backupFileFromImportCode } from "./backup-code";
import { cloudMode, cloudRefreshToken, freeMode, signInCloud, signOutCloud } from "./cloud";
import { Modal } from "./CareerEditor";
import EvidenceImport from "./EvidenceImport";
import AiConnection from "./AiConnection";
import ThemeControl from "./ThemeControl";
import { type Status } from "./types";

function GoogleMark() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H3.08v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.42 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.32-1.92V7.49H3.08A10 10 0 0 0 2 12c0 1.62.39 3.15 1.08 4.51l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5L18.7 4.6A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.92 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
      />
    </svg>
  );
}
export default function BackupSettings({
  status,
  onRefresh,
  onError,
  onToast,
  careers,
  documents,
}: {
  status: Status;
  onRefresh: () => Promise<void>;
  onError: (e: unknown) => void;
  onToast: (s: string) => void;
  careers: number;
  documents: number;
}) {
  const [busy, setBusy] = useState(""),
    [restore, setRestore] = useState<File | null>(null),
    [disconnect, setDisconnect] = useState(false),
    [backupCode, setBackupCode] = useState(""),
    [backupCodeError, setBackupCodeError] = useState("");
  const restoreRef = useRef<HTMLInputElement>(null);
  async function localBackup() {
    setBusy("전체 백업 만드는 중");
    try {
      await download(
        "/backup/export",
        `Introduce_Me_백업_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })}.zip`,
      );
      onToast("경력 데이터와 원본 파일을 함께 백업했습니다.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function driveBackup() {
    setBusy("드라이브에 백업 중");
    try {
      await api("/backup/drive", { method: "POST" });
      await onRefresh();
      onToast("구글 드라이브에 날짜별 백업을 저장했습니다.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function restoreBackup() {
    if (!restore) return;
    setBusy("백업 복원 중");
    try {
      if (cloudMode && !freeMode) {
        const upload = await api<{ uploadUrl: string; uploadId: string }>(
          "/backup/upload-url",
          {
          method: "POST",
          body: JSON.stringify({ name: restore.name, size: restore.size }),
          },
        );
        if (new URL(upload.uploadUrl).protocol !== "https:")
          throw new Error("백업 업로드 주소를 확인하지 못했습니다.");
        const response = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/zip" },
          body: restore,
          credentials: "omit",
        });
        if (!response.ok)
          throw new Error(
            `백업 파일을 올리지 못했습니다 (${response.status}). 다시 시도해 주세요.`,
          );
        await api("/backup/restore", {
          method: "POST",
          body: JSON.stringify({ uploadId: upload.uploadId }),
        });
      } else {
        const form = new FormData();
        form.append("file", restore);
        await api("/backup/restore", { method: "POST", body: form });
      }
      await onRefresh();
      setRestore(null);
      onToast("백업에서 경력과 공문을 복원했습니다.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function restoreFromCode() {
    if (busy) return;
    setBusy("백업 코드 확인 중");
    setBackupCodeError("");
    try {
      const file = await backupFileFromImportCode(backupCode);
      setBackupCode("");
      setBackupCodeError("");
      setRestore(file);
    } catch (error) {
      setBackupCodeError(
        error instanceof Error ? error.message : "백업 코드를 확인해 주세요.",
      );
    } finally {
      setBusy("");
    }
  }
  async function disconnectDrive() {
    setBusy("백업 연결 해제 중");
    try {
      await api("/auth/drive/disconnect", { method: "POST" });
      await onRefresh();
      setDisconnect(false);
      onToast("드라이브 백업 연결을 해제했습니다. 기존 백업은 남아 있습니다.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function logout() {
    setBusy("로그아웃 중");
    try {
      if (cloudMode) await signOutCloud();
      else await api("/auth/logout", { method: "POST" });
      await onRefresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function login() {
    setBusy("구글 로그인 중");
    try {
      await signInCloud();
      await onRefresh();
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function connectDrive() {
    setBusy("드라이브 연결 준비 중");
    try {
      const result = await api<{ url: string }>("/auth/drive/start", {
        method: "POST",
        ...(freeMode ? {
          body: JSON.stringify({ firebaseRefreshToken: await cloudRefreshToken() }),
        } : {}),
      });
      if (new URL(result.url).protocol !== "https:")
        throw new Error("드라이브 연결 주소를 확인하지 못했습니다.");
      window.location.assign(result.url);
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  const configured = cloudMode
    ? status.firebaseConfigured
    : status.googleConfigured && status.ownerConfigured;
  const driveConfigured = cloudMode
    ? status.driveConfigured && status.ownerConfigured
    : configured;
  return (
    <div className="settings-layout">
      <div className="settings-main">
        <section className="panel settings-card theme-settings" aria-label="화면 설정">
          <h2>화면 설정</h2>
          <ThemeControl label="설정 화면 모드"/>
          <p className="app-build">화면 버전 {__APP_VERSION__}</p>
        </section>
        {freeMode && (
          <div className="notice">
            <HardDrive size={17} />
            <span>경력 정보는 계정에 저장하고 공문 원본은 구글 드라이브에 보관합니다. 공문을 올리기 전에 드라이브를 연결해 주세요.</span>
          </div>
        )}
        {freeMode && status.user && (
          <EvidenceImport
            driveConnected={status.driveConnected}
            disabled={!!busy}
            onBusyChange={(active) => setBusy(active ? "증빙 묶음 처리 중" : "")}
            onRefresh={onRefresh}
            onToast={onToast}
            onBackup={driveBackup}
          />
        )}
        <section className="panel settings-card">
          <div className="settings-card-heading">
            <span className="integration-icon">
              <GoogleMark />
            </span>
            <div>
              <h2>구글 계정 로그인</h2>
            </div>
            <span
              className={`connection-badge ${status.user ? "connected" : ""}`}
            >
              {status.user
                ? "연결됨"
                : status.mode === "local"
                  ? "로컬 사용 중"
                  : "미연결"}
            </span>
          </div>
          {status.user ? (
            <div className="account-details">
              <span>
                <strong>{status.user.name}</strong>
                <small>{status.user.email}</small>
              </span>
              <button
                className="button secondary"
                onClick={logout}
                disabled={!!busy}
              >
                <LogOut size={15} />
                로그아웃
              </button>
            </div>
          ) : (
            <>
              <div className="notice">
                <LockKeyhole size={16} />
                <span>
                  {status.mode === "local"
                    ? "현재는 이 환경의 로컬 개발 모드입니다. 다른 컴퓨터에서 사용하려면 구글 로그인과 HTTPS 배포가 필요합니다."
                    : "본인 계정으로 로그인해 주세요."}
                </span>
              </div>
              {configured ? (
                cloudMode ? (
                  <button className="button secondary" onClick={login} disabled={!!busy}>
                    <GoogleMark />
                    구글 계정으로 로그인
                  </button>
                ) : (
                <a className="button secondary" href="/api/auth/google">
                  <GoogleMark />
                  구글 계정으로 로그인
                </a>
                )
              ) : (
                <p className="configuration-note">
                  {status.configurationError || "구글 로그인 연결 설정이 필요합니다. 배포 주소와 본인 계정에 대한 설정 방법은 저장소 안내에 정리되어 있어요."}
                </p>
              )}
            </>
          )}
        </section>
        <section className="panel settings-card">
          <div className="settings-card-heading">
            <span className="integration-icon drive-icon">
              <Cloud size={27} />
            </span>
            <div>
              <h2>구글 드라이브 백업</h2>
            </div>
            <span
              className={`connection-badge ${status.driveConnected ? "connected" : ""}`}
            >
              {status.driveConnected ? "연결됨" : "미연결"}
            </span>
          </div>
          <div className="backup-state">
            <div>
              <span>마지막 백업</span>
              <strong>
                {status.lastBackup
                  ? new Date(status.lastBackup).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })
                  : "아직 백업하지 않았어요"}
              </strong>
            </div>
            <div>
              <span>백업 대상</span>
              <strong>
                경력 {careers}건, 공문 {documents}개
              </strong>
            </div>
          </div>
          {status.backupError && (
            <div className="alert error" role="alert">
              최근 백업 오류: {status.backupError}
            </div>
          )}
          <div className="backup-features">
            <p>
              <Check size={15} />
              {freeMode
                ? "연결 후 하루 한 번 자동 백업, 앱을 닫아도 실행"
                : cloudMode
                  ? "연결 후 하루 한 번 자동 백업, Firebase 예약 실행"
                  : "연결 후 하루 한 번 자동 백업, 앱 서버 실행 중"}
            </p>
            <p>
              <Check size={15} />
              {freeMode
                ? "이전 백업을 덮어쓰지 않는 날짜별 경력, 원본 연결 정보 보관"
                : "이전 백업을 덮어쓰지 않는 날짜별 ZIP 보관"}
            </p>
            <p>
              <Check size={15} />
              {freeMode
                ? "공문 원본은 드라이브에 유지, 복원할 때 원본 무결성 확인"
                : "파일 원본과 경력 연결 관계까지 함께 저장"}
            </p>
          </div>
          <div className="settings-actions">
            {status.driveConnected ? (
              <>
                <button
                  className="button primary"
                  onClick={driveBackup}
                  disabled={!!busy}
                >
                  <RefreshCw size={16} />
                  지금 백업하기
                </button>
                <button
                  className="text-button"
                  onClick={() => setDisconnect(true)}
                  disabled={!!busy}
                >
                  연결 해제
                </button>
              </>
            ) : driveConfigured && status.user ? (
              cloudMode ? (
                <button className="button primary" onClick={connectDrive} disabled={!!busy}>
                  <Cloud size={17} />
                  드라이브 백업 연결
                </button>
              ) : (
              <a className="button primary" href="/api/auth/drive">
                <Cloud size={17} />
                드라이브 백업 연결
              </a>
              )
            ) : (
              <>
                <button className="button primary" disabled>
                  <Cloud size={17} />
                  드라이브 백업 연결
                </button>
                <span className="muted">
                  {cloudMode && status.user
                    ? "드라이브 백업 연결 설정이 필요합니다. 서버 설정 후 연결할 수 있어요."
                    : "구글 로그인 연결 후 사용할 수 있어요."}
                </span>
              </>
            )}
          </div>
        </section>
        <section className="panel settings-card">
          <div className="settings-card-heading">
            <span className="integration-icon local-icon">
              <HardDrive size={26} />
            </span>
            <div>
              <h2>파일로 백업, 복원</h2>
            </div>
          </div>
          <div className="local-backup-options">
            <div>
              <h3>전체 백업 내려받기</h3>
              <p>
                경력 정보와 첨부 원본이 포함된 ZIP입니다.
                <br />
                안전한 폴더에 보관해 주세요.
              </p>
              <button
                className="button secondary"
                onClick={localBackup}
                disabled={!!busy}
              >
                <ArrowDownToLine size={16} />
                백업 ZIP 받기
              </button>
            </div>
            <div>
              <h3>백업에서 복원하기</h3>
              <p>
                {freeMode ? "전체 백업 ZIP 또는 드라이브 자동 백업 JSON을 올려" : "이 앱에서 만든 백업 ZIP을 올려"}
                <br />
                경력과 공문을 복원합니다.
              </p>
              <button
                className="button secondary"
                onClick={() => restoreRef.current?.click()}
                disabled={!!busy}
              >
                <Upload size={16} />
                백업 파일 선택
              </button>
              <input
                className="visually-hidden"
                ref={restoreRef}
                type="file"
                accept={freeMode ? ".zip,.json" : ".zip"}
                aria-label="복원할 백업 선택"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file) {
                    setBackupCode("");
                    setBackupCodeError("");
                  }
                  setRestore(file);
                  e.target.value = "";
                }}
              />
              <div className="backup-code-restore">
                <p>파일을 받기 어려우면 전달받은 백업 코드를 붙여넣으세요.</p>
                <label className="field">
                  <span>백업 코드</span>
                  <textarea
                    aria-label="백업 코드"
                    rows={4}
                    value={backupCode}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!!busy}
                    onChange={(e) => {
                      setBackupCode(e.target.value);
                      setBackupCodeError("");
                    }}
                  />
                </label>
                {backupCodeError && (
                  <div className="alert error" role="alert">{backupCodeError}</div>
                )}
                <button
                  className="button secondary"
                  disabled={!!busy || !backupCode.trim()}
                  onClick={restoreFromCode}
                >
                  <Upload size={16} />
                  백업 코드로 복원
                </button>
              </div>
            </div>
          </div>
        </section>
        {freeMode ? <AiConnection onRefresh={onRefresh}/> : <>
        <section className="panel settings-card">
          <div className="settings-card-heading">
            <span className="integration-icon ai-icon">
              <Sparkles size={25} />
            </span>
            <div>
              <h2>경력 자동 정리</h2>
            </div>
            <span
              className={`connection-badge ${status.aiConfigured ? "connected" : ""}`}
            >
              {status.aiConfigured ? "AI 연결됨" : "규칙 기반"}
            </span>
          </div>
          <div className="notice">
            <Info size={16} />
            <span>
              {status.aiConfigured
                ? "AI 분석은 외부 AI 서비스로 문서 내용을 전송합니다. 추출 결과는 저장 전 직접 확인해 주세요."
                : "현재 AI 서비스 키가 없어 문서 텍스트와 키워드 규칙으로 분류합니다. AI를 연결하면 기관, 역할, 태그 추출을 함께 제안합니다."}
            </span>
          </div>
          <ul className="supported-list">
            <li>
              <strong>PDF, HWPX, DOCX, TXT</strong>
              <span>텍스트 추출 후 초안 생성</span>
            </li>
            <li>
              <strong>스캔 PDF, 이미지</strong>
              <span>AI 연결 시 이미지 분석, 미연결 시 직접 입력</span>
            </li>
            <li>
              <strong>PPTX, HWP</strong>
              <span>본문 읽기, 원본 보관</span>
            </li>
          </ul>
        </section>
        </>}
      </div>
      <aside className="settings-aside">
        <div className="settings-help">
          <ShieldCheck size={28} />
          <h3>백업은 기록의 두 번째 집</h3>
          <p>
            공문만 저장하면 경력 정보와 연결 관계가 사라질 수 있어요. 이 앱의
            백업은 데이터를 함께 담아 복원할 수 있게 합니다.
          </p>
          <div className="help-divider" />
          <h4>다른 컴퓨터에서 사용하려면</h4>
          <p>
            {freeMode
              ? "경력 정보는 계정에, 공문 원본은 구글 드라이브에 저장됩니다. 이 웹주소에서 같은 구글 계정으로 로그인하면 다른 컴퓨터에서도 이어서 사용할 수 있어요."
              : cloudMode
              ? "경력과 공문은 Firebase에 저장됩니다. 이 웹주소에서 같은 구글 계정으로 로그인하면 다른 컴퓨터에서도 이어서 사용할 수 있어요."
              : "앱을 HTTPS 주소로 배포하고 본인 구글 계정으로 로그인하세요. 로컬 개발 화면과 공개 배포는 별개의 단계예요."}
          </p>
          <h4>노션은요?</h4>
          <p>
            첫 버전은 구글 드라이브 백업을 지원합니다. 노션으로 경력을 열람하는
            기능은 추후 확장할 수 있어요.
          </p>
        </div>
      </aside>
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spin" size={17} />
          {busy}
        </div>
      )}
      {restore && (
        <Modal
          title="백업으로 전체 기록을 복원할까요?"
          subtitle={restore.name}
          onClose={() => !busy && setRestore(null)}
        >
          <div className="modal-body">
            <p className="confirm-description">
              현재 경력과 공문을 선택한 백업의 내용으로 교체합니다. 현재 기록을
              보관하려면 먼저 백업 ZIP을 내려받으세요.
            </p>
            <div className="notice">
              <ShieldCheck size={16} />
              {freeMode && restore.name.toLowerCase().endsWith(".json")
                ? "백업 정보와 드라이브 원본을 모두 확인한 뒤 복원합니다. 백업에 연결된 드라이브를 먼저 연결해 주세요."
                : "백업 파일 구조와 첨부 원본의 무결성을 검사한 뒤 복원합니다."}
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => setRestore(null)}
            >
              취소
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={restoreBackup}
            >
              전체 기록 복원
            </button>
          </div>
        </Modal>
      )}
      {disconnect && (
        <Modal
          title="드라이브 백업 연결을 해제할까요?"
          onClose={() => setDisconnect(false)}
        >
          <div className="modal-body">
            <p className="confirm-description">
              자동 백업을 중지합니다. 구글 드라이브에 이미 저장한 백업은
              삭제하지 않습니다.
            </p>
          </div>
          <div className="modal-footer">
            <button
              className="button secondary"
              onClick={() => setDisconnect(false)}
            >
              취소
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={disconnectDrive}
            >
              연결 해제
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
