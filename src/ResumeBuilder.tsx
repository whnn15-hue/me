import { useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Copy,
  FileCheck2,
  FileText,
  FolderDown,
  LoaderCircle,
  Printer,
  Search,
  Upload,
  X,
} from "lucide-react";
import { api, download, saveBlob } from "./api";
import { categories, type Career, type HwpxField } from "./types";

const period = (c: Career) =>
  !c.startDate
    ? "날짜 확인 필요"
    : c.endDate && c.endDate !== c.startDate
      ? `${c.startDate} ~ ${c.endDate}`
      : c.startDate;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const csvCell = (s: string) =>
  `"${(s.match(/^[=+@-]/) ? "'" + s : s).replaceAll('"', '""')}"`;
export default function ResumeBuilder({
  careers,
  onError,
  onToast,
}: {
  careers: Career[];
  onError: (e: unknown) => void;
  onToast: (s: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("전체"),
    [name, setName] = useState(""),
    [title, setTitle] = useState("경력 이력서"),
    [contact, setContact] = useState(""),
    [tab, setTab] = useState<"preview" | "template">("preview"),
    [busy, setBusy] = useState(""),
    [template, setTemplate] = useState<File | null>(null),
    [fields, setFields] = useState<HwpxField[]>([]),
    [mappings, setMappings] = useState<Record<string, string>>({}),
    [warnings, setWarnings] = useState<string[]>([]);
  const templateRef = useRef<HTMLInputElement>(null);
  const chosen = useMemo(
    () =>
      careers
        .filter((c) => selected.includes(c.id))
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [careers, selected],
  );
  const filtered = careers
    .filter(
      (c) =>
        (category === "전체" || c.category === category) &&
        `${c.title} ${c.organization} ${c.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const summary = chosen
    .map(
      (c) =>
        `${period(c)} | ${c.title} | ${c.organization}${c.role ? " | " + c.role : ""}`,
    )
    .join("\n");
  const fullText = [
    title,
    name,
    contact,
    "",
    ...chosen.map(
      (c) =>
        `${period(c)}  ${c.title}\n${[c.organization, c.role].filter(Boolean).join(" · ")}${c.description ? "\n" + c.description : ""}\n`,
    ),
  ]
    .filter((x) => x !== undefined)
    .join("\n");
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const allVisible =
    filtered.length > 0 && filtered.every((c) => selected.includes(c.id));
  function exportCsv() {
    const rows = [
      [
        "기간",
        "분류",
        "활동명",
        "기관",
        "역할",
        "활동내용",
        "태그",
        "증빙 개수",
        "확인 상태",
      ],
      ...chosen.map((c) => [
        period(c),
        c.category,
        c.title,
        c.organization,
        c.role,
        c.description,
        c.tags.join(", "),
        String(c.documentIds.length),
        c.verified ? "확인함" : "확인 전",
      ]),
    ];
    saveBlob(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
      "나의_경력.csv",
    );
  }
  async function copyText() {
    try {
      await navigator.clipboard.writeText(fullText);
      onToast("이력서 내용을 복사했습니다. 한글 양식에 붙여 넣을 수 있어요.");
    } catch {
      saveBlob(
        new Blob([fullText], { type: "text/plain;charset=utf-8" }),
        "나의_경력.txt",
      );
      onToast("클립보드 사용이 어려워 텍스트 파일로 내려받았습니다.");
    }
  }
  function print() {
    const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>${escape(title)}</title><style>body{font-family:"Noto Sans CJK KR",sans-serif;color:#26372f;margin:0;padding:38px}h1{font-size:26px;margin:0 0 18px}h2{font-size:15px;margin:0 0 8px}.profile{margin-bottom:30px;color:#59635e}table{border-collapse:collapse;width:100%;font-size:11px}th{background:#f0f3ef;text-align:left;padding:10px}td{padding:12px 10px;border-bottom:1px solid #e4e8e3;vertical-align:top}p{white-space:pre-wrap;margin:5px 0;color:#66716b}.title{font-weight:700}@page{size:A4;margin:15mm}@media print{body{padding:0}tr{break-inside:avoid}thead{display:table-header-group}}</style></head><body><h1>${escape(title)}</h1><div class="profile">${escape(name)}${contact ? "<p>" + escape(contact) + "</p>" : ""}</div><table><thead><tr><th>기간</th><th>활동 및 주요 내용</th><th>기관 · 역할</th></tr></thead><tbody>${chosen.map((c) => `<tr><td style="width:18%">${escape(period(c))}</td><td><div class="title">${escape(c.title)}</div>${c.description ? "<p>" + escape(c.description) + "</p>" : ""}${!c.verified ? "<p>확인 전 기록</p>" : ""}</td><td style="width:24%">${escape(c.organization)}${c.role ? "<p>" + escape(c.role) + "</p>" : ""}</td></tr>`).join("")}</tbody></table></body></html>`;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0";
    frame.title = "이력서 인쇄";
    frame.srcdoc = html;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60000);
    };
    document.body.appendChild(frame);
  }
  async function evidence() {
    setBusy("증빙 모으는 중");
    try {
      await download("/resume/evidence", "경력_증빙_모음.zip", {
        method: "POST",
        body: JSON.stringify({ careerIds: selected }),
      });
      onToast("선택한 경력과 연결된 증빙을 내려받았습니다.");
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  async function inspect(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".hwpx")) {
      onError(
        new Error(
          "HWP는 한글에서 HWPX로 저장한 뒤 올려주세요. 현재 양식 입력은 HWPX를 지원합니다.",
        ),
      );
      if (templateRef.current) templateRef.current.value = "";
      return;
    }
    setBusy("양식 확인 중");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api<{ fields: HwpxField[]; warnings: string[] }>(
        "/resume/hwpx/inspect",
        { method: "POST", body: form },
      );
      setTemplate(file);
      setFields(result.fields);
      setWarnings(result.warnings);
      setMappings({});
      onToast(`양식에서 표 셀 ${result.fields.length}개를 찾았습니다.`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
      if (templateRef.current) templateRef.current.value = "";
    }
  }
  async function fillTemplate() {
    if (!template) return;
    setBusy("HWPX 양식에 입력 중");
    try {
      const form = new FormData();
      form.append("file", template);
      form.append("mappings", JSON.stringify(mappings));
      await download(
        "/resume/hwpx/fill",
        template.name.replace(/\.hwpx$/i, "_작성.hwpx"),
        { method: "POST", body: form },
      );
      onToast(
        "입력한 HWPX를 내려받았습니다. 한글에서 서식과 내용을 최종 확인해 주세요.",
      );
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  }
  function insertContent(id: string, type: string) {
    let text = "";
    if (type === "name") text = name;
    else if (type === "contact") text = contact;
    else if (type === "summary") text = summary;
    else if (type === "full") text = fullText;
    else if (type.startsWith("career:")) {
      const c = chosen.find((c) => c.id === type.slice(7));
      if (c)
        text = `${period(c)}\n${c.title}\n${[c.organization, c.role].filter(Boolean).join(" · ")}`;
    }
    if (type) setMappings((m) => ({ ...m, [id]: text }));
  }
  return (
    <>
      <div className="resume-info-strip">
        <FileCheck2 size={20} />
        <span>
          <strong>경력 선택 → 내용 확인 → 이력서와 증빙 다운로드</strong>
          <small>
            다양한 제출 양식에 맞춰 필요한 기록만 골라 사용할 수 있어요.
          </small>
        </span>
        <span className="step-number">01 — 03</span>
      </div>
      <div className="resume-layout">
        <section className="resume-selection panel">
          <div className="panel-heading">
            <h2>담을 경력 선택</h2>
            <span className="selection-count">{chosen.length}개 선택</span>
          </div>
          <div className="resume-filters">
            <label className="search-box compact">
              <Search size={16} />
              <input
                aria-label="이력서 경력 검색"
                placeholder="경력 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="이력서 분류 필터"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option>전체</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="selection-tools">
            <label>
              <input
                type="checkbox"
                checked={allVisible}
                onChange={() =>
                  setSelected((ids) =>
                    allVisible
                      ? ids.filter((id) => !filtered.some((c) => c.id === id))
                      : [...new Set([...ids, ...filtered.map((c) => c.id)])],
                  )
                }
              />
              현재 목록 전체 선택
            </label>
            <button onClick={() => setSelected([])}>선택 초기화</button>
          </div>
          <div className="resume-career-list">
            {filtered.map((c) => (
              <label
                key={c.id}
                className={`resume-career ${selected.includes(c.id) ? "selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span>
                  <small>
                    {period(c)} · {c.category}
                  </small>
                  <strong>{c.title}</strong>
                  <em>
                    {c.organization || "기관 미입력"}
                    {!c.verified && <i>확인 전</i>}
                  </em>
                </span>
              </label>
            ))}
            {!filtered.length && (
              <p className="muted selection-empty">일치하는 경력이 없어요.</p>
            )}
          </div>
          <div className="selection-bottom">
            <span>
              연결된 증빙{" "}
              <strong>
                {new Set(chosen.flatMap((c) => c.documentIds)).size}개
              </strong>
            </span>
            <button
              className="button secondary"
              disabled={!chosen.length || !!busy}
              onClick={evidence}
            >
              <FolderDown size={16} />
              증빙 ZIP 받기
            </button>
          </div>
        </section>
        <section className="resume-output">
          <div className="output-tabs">
            <button
              className={tab === "preview" ? "active" : ""}
              onClick={() => setTab("preview")}
            >
              <FileText size={16} />
              이력서 미리보기
            </button>
            <button
              className={tab === "template" ? "active" : ""}
              onClick={() => setTab("template")}
            >
              <Upload size={16} />내 양식에 입력
            </button>
          </div>
          {tab === "preview" ? (
            <>
              <div className="profile-form">
                <label className="field">
                  <span>이력서 제목</span>
                  <input
                    aria-label="이력서 제목"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <div className="field-grid">
                  <label className="field">
                    <span>이름</span>
                    <input
                      placeholder="이름 입력"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>
                      연락처·소속 <small>선택</small>
                    </span>
                    <input
                      placeholder="필요한 정보만 입력"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="resume-paper">
                <div className="paper-eyebrow">CURRICULUM VITAE</div>
                <h2>{title || "경력 이력서"}</h2>
                <div className="resume-profile">
                  {name || "이름을 입력해 주세요"}
                  {contact && <small>{contact}</small>}
                </div>
                <div className="resume-paper-rule" />
                <h3>
                  주요 경력 <span>{chosen.length}건</span>
                </h3>
                {chosen.length ? (
                  <div className="resume-preview-records">
                    {chosen.map((c) => (
                      <article key={c.id}>
                        <time>{period(c)}</time>
                        <div>
                          <h4>{c.title}</h4>
                          <span>
                            {[c.organization, c.role]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {c.description && <p>{c.description}</p>}
                          {!c.verified && (
                            <small className="unverified-label">
                              내용 확인 필요
                            </small>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="paper-placeholder">
                    <FileText size={33} />
                    <p>
                      왼쪽에서 경력을 선택하면
                      <br />
                      이력서가 여기에 정리돼요.
                    </p>
                  </div>
                )}
              </div>
              <div className="resume-export-bar">
                <button
                  className="button secondary"
                  disabled={!chosen.length}
                  onClick={copyText}
                >
                  <Copy size={15} />
                  내용 복사
                </button>
                <button
                  className="button secondary"
                  disabled={!chosen.length}
                  onClick={exportCsv}
                >
                  <ArrowDownToLine size={15} />
                  CSV
                </button>
                <button
                  className="button primary"
                  disabled={!chosen.length}
                  onClick={print}
                >
                  <Printer size={16} />
                  인쇄 / PDF 저장
                </button>
              </div>
              <p className="export-note">
                PDF는 인쇄 창에서 ‘PDF로 저장’을 선택하세요. CSV·복사한 내용은
                한글 양식에 옮겨 사용할 수 있어요.
              </p>
            </>
          ) : (
            <div className="template-panel panel">
              <div className="template-intro">
                <span className="template-icon">
                  <FileText size={29} />
                </span>
                <h2>제출할 HWPX 양식을 올려주세요.</h2>
                <p>
                  표의 입력할 칸을 골라 내용을 넣습니다.
                  <br />
                  원본 서식을 유지하며, 지정한 칸만 수정해요.
                </p>
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => templateRef.current?.click()}
                >
                  <Upload size={16} />
                  {template ? "다른 양식 선택" : "HWPX 양식 선택"}
                </button>
                <input
                  className="visually-hidden"
                  ref={templateRef}
                  type="file"
                  accept=".hwpx,.hwp"
                  aria-label="이력서 양식 선택"
                  onChange={(e) => inspect(e.target.files?.[0])}
                />
                <small>
                  HWP는 한글에서 HWPX로 저장한 뒤 올려주세요.
                  <br />
                  모든 양식의 완전 자동 입력은 지원하지 않습니다.
                </small>
              </div>
              {template && (
                <>
                  <div className="template-file">
                    <FileText size={17} />
                    <strong>{template.name}</strong>
                    <span>{fields.length}개 표 셀</span>
                  </div>
                  {warnings.map((w, i) => (
                    <div key={i} className="notice">
                      {w}
                    </div>
                  ))}
                  <p className="field-hint">
                    입력할 칸만 편집하세요. 수정하지 않은 칸은 원본 내용을
                    유지합니다.
                  </p>
                  <div className="template-fields">
                    {fields.map((f, i) => (
                      <div
                        className={`template-field ${Object.hasOwn(mappings, f.id) ? "edited" : ""}`}
                        key={f.id}
                      >
                        <div className="template-field-label">
                          <strong>칸 {i + 1}</strong>
                          <span>{f.text || "빈 칸"}</span>
                          {Object.hasOwn(mappings, f.id) && (
                            <button
                              className="icon-button"
                              aria-label={`칸 ${i + 1} 수정 취소`}
                              onClick={() =>
                                setMappings((m) => {
                                  const next = { ...m };
                                  delete next[f.id];
                                  return next;
                                })
                              }
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                        <select
                          disabled={f.editable === false}
                          aria-label={`칸 ${i + 1} 내용 선택`}
                          value=""
                          onChange={(e) => insertContent(f.id, e.target.value)}
                        >
                          <option value="">
                            선택한 경력에서 내용 가져오기
                          </option>
                          <option value="name">이름</option>
                          <option value="contact">연락처·소속</option>
                          <option value="summary">선택한 경력 목록</option>
                          <option value="full">이력서 전체 내용</option>
                          {chosen.map((c) => (
                            <option key={c.id} value={`career:${c.id}`}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                        <textarea
                          disabled={f.editable === false}
                          rows={3}
                          aria-label={`칸 ${i + 1} 입력 내용`}
                          placeholder={f.text || "이 칸에 입력할 내용"}
                          value={mappings[f.id] ?? f.text}
                          onChange={(e) =>
                            setMappings((m) => ({
                              ...m,
                              [f.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    className="button primary template-download"
                    disabled={!!busy || !Object.keys(mappings).length}
                    onClick={fillTemplate}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <ArrowDownToLine size={16} />
                    )}
                    작성한 HWPX 받기
                  </button>
                  <p className="export-note">
                    한글에서 내려받은 파일을 열고 셀 높이·줄바꿈·내용을 최종
                    확인해 주세요.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spin" size={17} />
          {busy}
        </div>
      )}
    </>
  );
}
