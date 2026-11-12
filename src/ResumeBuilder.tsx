import { careerCategoryChoices, careerCategoryLabel, matchesCareerCategory } from "../shared/career-organization.mjs";
import { displayText } from "./display";
import { useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Copy,
  FileCheck2,
  FileText,
  FolderDown,
  LoaderCircle,
  Printer,
  Search,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api, download, saveBlob } from "./api";
import { type DocumentRecord, type Career, type HwpxField } from "./types";
import "./resume-intake.css";

const period = (c: Career) =>
  !c.startDate
    ? "날짜 미입력"
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

// Recommendations are based only on recorded facts and the user's request.
export function recommendResumeCareers(careers: Career[], request: string): string[] {
  const text = request.toLowerCase().normalize("NFC");
  const stop = new Set(["양식", "이력서", "경력", "제출", "신청", "작성", "이름", "성명", "연락처", "제목", "hwpx", "목록", "내용", "활동", "기관", "소속"]);
  const words = [...new Set(text.match(/[가-힣a-z0-9]{2,}/g) || [])].filter(word => !stop.has(word));
  const groups = [
    ["강사", "강의", "연수"], ["연구대회", "연구"], ["공모전", "공모"],
    ["집필", "저서", "책"], ["콘텐츠", "영상", "미디어"], ["자격증", "자격"],
    ["위원회", "지원단", "위원"],
  ];
  return careers.map(career => {
    const haystack = `${career.title} ${career.category} ${career.organization} ${career.tags.join(" ")}`.toLowerCase().normalize("NFC");
    const direct = words.reduce((score, word) => score + (haystack.includes(word) ? 2 : 0), 0);
    const related = groups.reduce((score, group) => score + (group.some(word => text.includes(word)) && group.some(word => haystack.includes(word)) ? 1 : 0), 0);
    return { career, score: direct + related };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.career.startDate.localeCompare(a.career.startDate)).map(item => item.career.id);
}

export function suggestResumeMappings(fields: HwpxField[], values: Record<string, string>): Record<string, string> {
  const mappings: Record<string, string> = {};
  for (const field of fields) {
    if (field.editable === false) continue;
    const replaced = field.text.replace(/\{\{\s*([^{}]+?)\s*\}\}|\[\[\s*([^\[\]]+?)\s*\]\]/g, (original, curly, square) => values[String(curly || square).trim()] || original);
    if (replaced !== field.text) mappings[field.id] = replaced;
  }
  return mappings;
}

function templateValues(chosen: Career[], name: string, contact: string, title: string) {
  const summary = chosen.map(c => `${period(c)} | ${c.title}${c.organization ? " | " + c.organization : ""}`).join("\n");
  const single = chosen.length === 1 ? chosen[0] : null;
  return { 이름: name, 성명: name, 연락처: contact, 제목: title, 경력: summary, 경력목록: summary, 주요경력: summary,
    활동명: single?.title || "", 기관: single?.organization || "", 기간: single ? period(single) : "" };
}
export default function ResumeBuilder({
  careers,
  initialSelectedIds = [],
  documents = [],
  onError,
  onToast,
}: {
  careers: Career[];
  initialSelectedIds?: string[];
  documents?: DocumentRecord[];
  onError: (e: unknown) => void;
  onToast: (s: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => initialSelectedIds.filter(id => careers.some(item => item.id === id))),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("전체"),
    [name, setName] = useState(""),
    [title, setTitle] = useState("경력 이력서"),
    [contact, setContact] = useState(""),
    [mode, setMode] = useState<"start" | "records" | "template">(() => initialSelectedIds.some(id => careers.some(c => c.id === id)) ? "records" : "start"),
    [request, setRequest] = useState(""),
    [dragging, setDragging] = useState(false),
    [manualOpen, setManualOpen] = useState(false),
    [activeFieldId, setActiveFieldId] = useState(""),
    [busy, setBusy] = useState(""),
    [template, setTemplate] = useState<File | null>(null),
    [fields, setFields] = useState<HwpxField[]>([]),
    [mappings, setMappings] = useState<Record<string, string>>({}),
    [warnings, setWarnings] = useState<string[]>([]);
  const templateRef = useRef<HTMLInputElement>(null);
  const recommended = recommendResumeCareers(careers, request || template?.name.replace(/\.hwpx$/i, "") || "");
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
        matchesCareerCategory(c, category, documents) &&
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
        `${period(c)}  ${c.title}\n${[c.organization, c.role].filter(Boolean).join(", ")}${c.description ? "\n" + c.description : ""}\n`,
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
        "증빙 서류",
      ],
      ...chosen.map((c) => [
        period(c),
        careerCategoryLabel(c, documents),
        c.title,
        c.organization,
        c.role,
        c.description,
        c.tags.join(", "),
        c.documentIds.some(id => documents.some(doc => doc.id === id)) ? "있음" : "없음",
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
    const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>${escape(title)}</title><style>body{font-family:"Noto Sans CJK KR",sans-serif;color:#26372f;margin:0;padding:38px}h1{font-size:26px;margin:0 0 18px}h2{font-size:15px;margin:0 0 8px}.profile{margin-bottom:30px;color:#59635e}table{border-collapse:collapse;width:100%;font-size:11px}th{background:#f0f3ef;text-align:left;padding:10px}td{padding:12px 10px;border-bottom:1px solid #e4e8e3;vertical-align:top}p{white-space:pre-wrap;margin:5px 0;color:#66716b}.title{font-weight:700}@page{size:A4;margin:15mm}@media print{body{padding:0}tr{break-inside:avoid}thead{display:table-header-group}}</style></head><body><h1>${escape(title)}</h1><div class="profile">${escape(name)}${contact ? "<p>" + escape(contact) + "</p>" : ""}</div><table><thead><tr><th>기간</th><th>활동 및 주요 내용</th><th>기관, 역할</th></tr></thead><tbody>${chosen.map((c) => `<tr><td style="width:18%">${escape(period(c))}</td><td><div class="title">${escape(c.title)}</div>${c.description ? "<p>" + escape(c.description) + "</p>" : ""}</td><td style="width:24%">${escape(c.organization)}${c.role ? "<p>" + escape(c.role) + "</p>" : ""}</td></tr>`).join("")}</tbody></table></body></html>`;
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
      setActiveFieldId((result.fields.find(field => field.editable !== false && !field.text.trim()) || result.fields.find(field => field.editable !== false))?.id || "");
      setWarnings(result.warnings);
      const suggestedIds = recommendResumeCareers(careers, request || file.name.replace(/\.hwpx$/i, ""));
      const selectedIds = selected.length ? selected : suggestedIds;
      const records = careers.filter(c => selectedIds.includes(c.id)).sort((a, b) => b.startDate.localeCompare(a.startDate));
      if (!selected.length && suggestedIds.length) setSelected(suggestedIds);
      const automatic = suggestResumeMappings(result.fields, templateValues(records, name, contact, title));
      setMappings(automatic);
      setManualOpen(Object.keys(automatic).length === 0);
      setMode("template");
      onToast("양식을 열었습니다. 담을 경력과 입력 내용을 조정할 수 있어요.");
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
        text = `${period(c)}\n${c.title}\n${[c.organization, c.role].filter(Boolean).join(", ")}`;
    }
    if (type) setMappings((m) => ({ ...m, [id]: text }));
  }
  function renderField(field: HwpxField, index: number) {
    return <div className={`template-field ${Object.hasOwn(mappings, field.id) ? "edited" : ""}`} key={field.id}>
      <div className="template-field-label">
        <strong>칸 {index + 1}</strong><span>{field.text || "빈 칸"}</span>
        {Object.hasOwn(mappings, field.id) && <button className="icon-button" aria-label={`칸 ${index + 1} 수정 취소`} onClick={() => setMappings(current => {
          const next = { ...current }; delete next[field.id]; return next;
        })}><X size={14} /></button>}
      </div>
      <select disabled={field.editable === false} aria-label={`칸 ${index + 1} 내용 선택`} value="" onChange={event => insertContent(field.id, event.target.value)}>
        <option value="">선택한 경력에서 내용 가져오기</option>
        <option value="name">이름</option><option value="contact">연락처, 소속</option>
        <option value="summary">선택한 경력 목록</option><option value="full">이력서 전체 내용</option>
        {chosen.map(c => <option key={c.id} value={`career:${c.id}`}>{c.title}</option>)}
      </select>
      <textarea disabled={field.editable === false} rows={3} aria-label={`칸 ${index + 1} 입력 내용`} placeholder={field.text || "이 칸에 입력할 내용"} value={mappings[field.id] ?? field.text} onChange={event => setMappings(current => ({ ...current, [field.id]: event.target.value }))} />
    </div>;
  }
  const mappedFields = fields.filter(field => Object.hasOwn(mappings, field.id));
  const activeField = fields.find(field => field.id === activeFieldId);
  const suggestedMappings = suggestResumeMappings(fields, templateValues(chosen, name, contact, title));
  const hasEvidence = chosen.some(c => c.documentIds.some(id => documents.some(doc => doc.id === id)));
  const profile = <div className="profile-form">
    <label className="field"><span>문서 제목</span><input aria-label="이력서 제목" value={title} onChange={e => setTitle(e.target.value)} /></label>
    <div className="field-grid">
      <label className="field"><span>이름</span><input placeholder="이름 입력" value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="field"><span>연락처, 소속 <small>선택</small></span><input placeholder="필요한 정보만 입력" value={contact} onChange={e => setContact(e.target.value)} /></label>
    </div>
  </div>;
  const upload = <button className={`resume-intake-drop ${dragging ? "dragging" : ""}`} disabled={!!busy} onClick={() => templateRef.current?.click()}
    onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) void inspect(event.dataTransfer.files[0]); }}>
    <span className="resume-intake-symbol"><Upload size={26} /></span>
    <strong>양식으로 작성</strong>
    <span>HWPX 파일을 끌어 놓거나 선택하세요</span>
    <span className="button primary">양식 선택 <ArrowRight size={16} /></span>
  </button>;
  return <div className="resume-intake">
    <input className="visually-hidden" ref={templateRef} type="file" accept=".hwpx,.hwp" aria-label="이력서 양식 선택" onChange={event => void inspect(event.target.files?.[0])} />
    {mode === "start" ? <section className="resume-intake-start">
      <div className="resume-intake-heading"><h2>어떤 서류를 만들까요?</h2><p>제출 양식을 올리거나, 필요한 이력을 골라 시작하세요.</p></div>
      {upload}
      <button className="resume-intake-alternative" onClick={() => setMode("records")}><FileText size={21} /><span><strong>이력으로 만들기</strong><small>이력서, 경력 목록, 증빙 모음</small></span><ArrowRight size={17} /></button>
      <p className="resume-intake-help">HWP 파일은 한글에서 HWPX로 저장해 주세요. PDF 공문은 필요한 내용을 아래 요청란에 붙여 넣어 경력을 추천받을 수 있어요.</p>
      <label className="field resume-request"><span>요청 내용 <small>선택</small></span><textarea rows={2} value={request} onChange={e => setRequest(e.target.value)} placeholder="예: 미디어교육 강사 경력, 연구대회 실적" /></label>
    </section> : <>
      <div className="resume-intake-toolbar">
        <button className="button secondary" onClick={() => setMode("start")}><ArrowLeft size={16} />처음으로</button>
        <span>{mode === "template" ? template?.name : "이력으로 만들기"}</span>
        {mode === "template" ? <button className="button secondary" disabled={!!busy} onClick={() => templateRef.current?.click()}><Upload size={15} />양식 변경</button> : <button className="button secondary" disabled={!!busy} onClick={() => templateRef.current?.click()}><Upload size={15} />양식에 넣기</button>}
      </div>
      <div className="resume-layout">
        <section className="resume-selection panel">
          <div className="panel-heading"><h2>담을 이력</h2><span className="selection-count">{chosen.length}개 선택</span></div>
          <div className="resume-request-inline">
            <label className="field"><span>필요한 경력</span><input aria-label="추천할 경력 요청" value={request} onChange={e => setRequest(e.target.value)} placeholder="예: 영상 제작 강사" /></label>
            <button className="button secondary" disabled={!recommended.length} onClick={() => { setSelected(recommended); setQuery(""); setCategory("전체"); onToast(`관련 경력 ${recommended.length}개를 선택했습니다. 목록에서 조정할 수 있어요.`); }}><Sparkles size={15} />관련 이력 선택{recommended.length ? ` (${recommended.length})` : ""}</button>
          </div>
          <details className="resume-selection-filters"><summary>직접 찾기</summary><div className="resume-filters">
            <label className="search-box compact"><Search size={16} /><input aria-label="이력서 경력 검색" placeholder="경력 검색" value={query} onChange={e => setQuery(e.target.value)} /></label>
            <select aria-label="이력서 분류 필터" value={category} onChange={e => setCategory(e.target.value)}><option>전체</option>{careerCategoryChoices.map(c => <option key={c} value={c}>{displayText(c)}</option>)}</select>
          </div></details>
          <div className="selection-tools"><label><input type="checkbox" checked={allVisible} onChange={() => setSelected(ids => allVisible ? ids.filter(id => !filtered.some(c => c.id === id)) : [...new Set([...ids, ...filtered.map(c => c.id)])])} />현재 목록 전체 선택</label><button onClick={() => setSelected([])}>선택 초기화</button></div>
          <div className="resume-career-list">{filtered.map(c => <label key={c.id} className={`resume-career ${selected.includes(c.id) ? "selected" : ""}`}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /><span><small>{period(c)}, {careerCategoryLabel(c, documents)}</small><strong>{c.title}</strong>{c.organization && <em>{c.organization}</em>}</span>
          </label>)}{!filtered.length && <p className="muted selection-empty">일치하는 경력이 없어요.</p>}</div>
          <div className="selection-bottom"><span>증빙 서류 <strong>{hasEvidence ? "있음" : "없음"}</strong></span><button className="button secondary" disabled={!chosen.length || !!busy} onClick={evidence}><FolderDown size={16} />증빙 ZIP 받기</button></div>
        </section>
        <section className="resume-output">
          {mode === "records" ? <>
            <details className="resume-profile-options"><summary>제목과 인적 사항</summary>{profile}</details>
            <div className="resume-paper"><h2>{title || "경력 이력서"}</h2>{(name || contact) && <div className="resume-profile">{name}{contact && <small>{contact}</small>}</div>}<div className="resume-paper-rule" />
              <h3>주요 경력 <span>{chosen.length}건</span></h3>
              {chosen.length ? <div className="resume-preview-records">{chosen.map(c => <article key={c.id}><time>{period(c)}</time><div><h4>{c.title}</h4>{c.organization && <span>{c.organization}</span>}{c.description && <p>{c.description}</p>}</div></article>)}</div> : <div className="paper-placeholder"><FileText size={33} /><p>담을 이력을 선택해 주세요.</p></div>}
            </div>
            <div className="resume-export-bar"><button className="button secondary" disabled={!chosen.length} onClick={copyText}><Copy size={15} />내용 복사</button><button className="button secondary" disabled={!chosen.length} onClick={exportCsv}><ArrowDownToLine size={15} />CSV</button><button className="button primary" disabled={!chosen.length} onClick={print}><Printer size={16} />인쇄 / PDF 저장</button></div>
          </> : <div className="template-panel panel">
            <div className="resume-template-heading"><FileCheck2 size={22} /><div><h2>양식에 담을 내용</h2><p>{mappedFields.length ? `${mappedFields.length}개 칸에 내용이 준비됐어요.` : "입력할 칸을 골라 선택한 경력을 넣으세요."}</p></div></div>
            <details className="resume-profile-options"><summary>제목과 인적 사항</summary>{profile}</details>
            <div className="resume-template-actions"><button className="button secondary" disabled={!Object.keys(suggestedMappings).length || !!busy} onClick={() => {
              setMappings(current => ({ ...current, ...suggestedMappings })); onToast("자리표시자가 있는 칸에 선택한 내용을 채웠습니다.");
            }}><Sparkles size={15} />선택 내용으로 채우기</button><small>이름, 경력 등 {'{{자리표시자}}'}가 있는 칸을 채웁니다.</small></div>
            {mappedFields.length > 0 && <div className="resume-filled-fields">{mappedFields.map(field => <article key={field.id}><div><strong>칸 {fields.indexOf(field) + 1}</strong><button onClick={() => { setActiveFieldId(field.id); setManualOpen(true); }} aria-label={`칸 ${fields.indexOf(field) + 1} 편집`}>편집</button></div><p>{mappings[field.id] || "내용 지우기"}</p></article>)}</div>}
            <details className="resume-manual-fields" open={manualOpen} onToggle={event => setManualOpen(event.currentTarget.open)}><summary>칸별 조정 <span>{fields.length}개 칸</span></summary>
              <p className="field-hint">내용을 넣을 칸에서 ‘선택한 경력 목록’을 고르세요. 빈칸의 위치는 추측하지 않습니다.</p>
              {fields.length > 0 && <label className="field resume-field-picker"><span>입력할 칸</span><select aria-label="입력할 양식 칸" value={activeFieldId} onChange={event => setActiveFieldId(event.target.value)}>{!activeFieldId && <option value="">편집할 수 있는 칸이 없습니다</option>}{fields.map((field, index) => <option key={field.id} value={field.id} disabled={field.editable === false}>칸 {index + 1}, {field.text.trim().slice(0, 60) || "빈 칸"}{field.editable === false ? " (편집 불가)" : ""}</option>)}</select></label>}
              <div className="template-fields">{activeField && renderField(activeField, fields.indexOf(activeField))}</div>
              {!fields.length && <p className="muted">편집할 표 칸이 없는 양식입니다. 이력으로 만든 내용을 복사해 사용해 주세요.</p>}
            </details>
            <button className="button primary template-download" disabled={!!busy || !Object.keys(mappings).length} onClick={fillTemplate}><ArrowDownToLine size={16} />작성한 HWPX 받기</button>
            <p className="export-note">내려받은 파일은 한글에서 서식과 줄바꿈을 확인해 주세요.</p>
            <details className="resume-template-notes"><summary>양식 지원 안내</summary>{warnings.map((warning, i) => <p key={i}>{warning}</p>)}<p>일반 양식의 항목 위치와 반복 행은 자동으로 판단하지 않습니다. 수정하지 않은 칸은 그대로 유지합니다.</p></details>
          </div>}
        </section>
      </div>
    </>}
    {busy && <div className="busy-indicator" role="status"><LoaderCircle className="spin" size={17} />{busy}</div>}
  </div>;
}
