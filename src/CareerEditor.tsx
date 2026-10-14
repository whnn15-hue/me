import { displayText } from "./display";
import { careerCategoryChoices, recognitionDetails } from "../shared/career-organization.mjs";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  FileCheck2,
  FileText,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import {
  type Career,
  type Category,
  type DocumentRecord,
} from "./types";

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input,textarea,select,button")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
          ) || [],
        ).filter((x) => x.offsetParent !== null);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" aria-label="닫기" onClick={onClose}>
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CareerEditor({
  career,
  documents,
  busy,
  note,
  remaining,
  onClose,
  onSave,
  onFreeText,
  onSkip,
}: {
  career: Career;
  documents: DocumentRecord[];
  busy: boolean;
  note: string;
  remaining: number;
  onClose: () => void;
  onSave: (c: Career) => void;
  onFreeText: () => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState<Career>({ ...career }),
    [tagInput, setTagInput] = useState(""),
    [validation, setValidation] = useState("");
  useEffect(() => {
    setDraft({ ...career });
    setTagInput("");
    setValidation("");
  }, [career]);
  const change = <K extends keyof Career>(key: K, value: Career[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function addTag() {
    const tags = tagInput
      .split(/[,#\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
    change("tags", [...new Set([...draft.tags, ...tags])].slice(0, 20));
    setTagInput("");
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) {
      setValidation("활동명을 입력해 주세요.");
      return;
    }
    const pattern =
      draft.datePrecision === "year"
        ? /^\d{4}$/
        : draft.datePrecision === "month"
          ? /^\d{4}-(0[1-9]|1[0-2])$/
          : /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if ([draft.startDate, draft.endDate].some((d) => d && !pattern.test(d))) {
      setValidation("선택한 날짜 단위에 맞게 입력해 주세요.");
      return;
    }
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      setValidation("종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.");
      return;
    }
    const newTags = [
      ...new Set([
        ...draft.tags,
        ...tagInput
          .split(/[,#\n]/)
          .map((x) => x.trim())
          .filter(Boolean),
      ]),
    ];
    onSave({
      ...draft,
      title: draft.title.trim(),
      tags: newTags,
      evidenceStatus: draft.documentIds.length
        ? "attached"
        : draft.evidenceStatus === "attached"
          ? "later"
          : draft.evidenceStatus,
    });
  }
  const datePlaceholder =
    draft.datePrecision === "year"
      ? "예: 2025"
      : draft.datePrecision === "month"
        ? "예: 2025-03"
        : "예: 2025-03-15";
  return (
    <Modal
      title={career.id ? "경력 수정하기" : "새 경력 기록하기"}
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={submit}>
        <div className="modal-body editor-body">
          {!career.id && !note && (
            <button
              className="free-text-prompt"
              type="button"
              onClick={onFreeText}
            >
              <span>
                <Sparkles size={17} />
                자유롭게 적고, 항목으로 정리하기
              </span>
              <ArrowRight size={16} />
            </button>
          )}
          {note && (
            <div className="notice">
              <Sparkles size={17} />
              <span>
                {note}
                {remaining > 0 && <strong>, 다음 초안 {remaining}개</strong>}
              </span>
            </div>
          )}
          {validation && (
            <div role="alert" className="alert error">
              {validation}
            </div>
          )}
          <label className="field">
            <span>
              활동명 <b>*</b>
            </span>
            <input
              autoFocus
              required
              maxLength={300}
              placeholder="어떤 경험을 하셨나요?"
              value={draft.title}
              onChange={(e) => change("title", e.target.value)}
            />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>분류</span>
              <select
                value={draft.category}
                onChange={(e) => change("category", e.target.value as Category)}
              >
                {[...careerCategoryChoices, ...(!careerCategoryChoices.includes(draft.category) ? [draft.category] : [])].map((c) => (
                  <option key={c} value={c}>{displayText(c)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>역할</span>
              <input
                maxLength={200}
                placeholder="예: 강사, 위원, 집필진"
                value={draft.role}
                onChange={(e) => change("role", e.target.value)}
              />
            </label>
          </div>
          {draft.category === "연구·수상" && <div className="recognition-editor">
            <div className="field-grid">
              <label className="field"><span>대회 범위</span><input value={draft.awardLevel ?? recognitionDetails(draft).level} placeholder="전국, 시도, 지역" maxLength={100} onChange={e => change("awardLevel", e.target.value)} /></label>
              <label className="field"><span>등급 또는 수상 결과</span><input value={draft.awardGrade ?? recognitionDetails(draft).grade} placeholder="1등급, 최우수상 등" maxLength={100} onChange={e => change("awardGrade", e.target.value)} /></label>
            </div>
            <div className="field"><span>대회 단계</span><div className="stage-picker">{["예선", "본선", "최종"].map(stage => <label key={stage}><input type="checkbox" checked={(draft.awardStages ?? recognitionDetails(draft).stages).includes(stage)} onChange={e => { const values = draft.awardStages ?? recognitionDetails(draft).stages; change("awardStages", e.target.checked ? [...values, stage] : values.filter(value => value !== stage)); }} />{stage}</label>)}</div></div>
          </div>}
          <label className="field">
            <span>활동 기관</span>
            <input
              maxLength={200}
              placeholder="예: 대구광역시교육청"
              value={draft.organization}
              onChange={(e) => change("organization", e.target.value)}
            />
          </label>
          <div className="date-label">
            <span>활동 기간</span>
            <div className="precision-toggle">
              {(
                [
                  ["year", "연도"],
                  ["month", "월"],
                  ["day", "일"],
                ] as const
              ).map(([p, label]) => (
                <button
                  type="button"
                  key={p}
                  className={draft.datePrecision === p ? "active" : ""}
                  onClick={() => {
                    change("datePrecision", p);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field-grid">
            <label className="field">
              <span className="sub-label">시작</span>
              <input
                aria-label="활동 시작"
                placeholder={datePlaceholder}
                maxLength={10}
                value={draft.startDate}
                onChange={(e) => change("startDate", e.target.value)}
              />
            </label>
            <label className="field">
              <span className="sub-label">
                종료 <small>한 번의 활동이면 비워두세요</small>
              </span>
              <input
                aria-label="활동 종료"
                placeholder={datePlaceholder}
                maxLength={10}
                value={draft.endDate}
                onChange={(e) => change("endDate", e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span>활동 내용</span>
            <textarea
              rows={4}
              maxLength={10000}
              placeholder="주요 내용, 성과, 기억해 둘 일을 적어주세요."
              value={draft.description}
              onChange={(e) => change("description", e.target.value)}
            />
          </label>
          <div className="field">
            <span>
              태그 <small>추천 태그를 수정하거나 추가할 수 있어요</small>
            </span>
            <div className="tag-editor">
              {draft.tags.map((t) => (
                <span key={t}>
                  #{t}
                  <button
                    type="button"
                    aria-label={`${t} 태그 삭제`}
                    onClick={() =>
                      change(
                        "tags",
                        draft.tags.filter((x) => x !== t),
                      )
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                aria-label="태그 추가"
                maxLength={200}
                placeholder="태그 입력 후 Enter"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <button
                type="button"
                className="icon-button"
                onClick={addTag}
                aria-label="태그 추가하기"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <div className="field">
            <span>
              <FileCheck2 size={15} />
              증빙 공문 연결
            </span>
            {documents.length > 0 ? (
              <div className="document-checkbox-list">
                {documents.map((d) => (
                  <label key={d.id}>
                    <input
                      type="checkbox"
                      checked={draft.documentIds.includes(d.id)}
                      onChange={(e) =>
                        change(
                          "documentIds",
                          e.target.checked
                            ? [...draft.documentIds, d.id]
                            : draft.documentIds.filter((id) => id !== d.id),
                        )
                      }
                    />
                    <FileText size={15} />
                    <span>{d.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="field-hint">
                아직 보관 중인 공문이 없어요. 저장한 뒤에도 연결할 수 있습니다.
              </p>
            )}
            {!draft.documentIds.length && (
              <div className="evidence-choices">
                <label>
                  <input
                    type="radio"
                    name="evidence"
                    checked={draft.evidenceStatus !== "unneeded"}
                    onChange={() => change("evidenceStatus", "later")}
                  />
                  나중에 증빙 첨부
                </label>
                <label>
                  <input
                    type="radio"
                    name="evidence"
                    checked={draft.evidenceStatus === "unneeded"}
                    onChange={() => change("evidenceStatus", "unneeded")}
                  />
                  증빙 불필요
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          {note && (
            <button
              className="button text-button"
              type="button"
              onClick={onSkip}
              disabled={busy}
            >
              이 초안 건너뛰기
            </button>
          )}
          <div className="footer-buttons">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
              disabled={busy}
            >
              취소
            </button>
            <button className="button primary" type="submit" disabled={busy}>
              <Check size={17} />
              {remaining > 0 ? "저장하고 다음" : "확인하고 저장"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
