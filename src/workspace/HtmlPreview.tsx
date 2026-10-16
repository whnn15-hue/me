import { useEffect, useRef, useState } from "react";
import { Code2, LoaderCircle, X } from "lucide-react";
import { staticHtmlPreview } from "./html-preview";
import type { MaterialItem } from "./types";

export default function HtmlPreview({ item, load }: { item: MaterialItem; load: (item: MaterialItem) => Promise<string> }) {
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0), locked = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  async function open() {
    if (locked.current) return;
    const version = ++request.current;
    locked.current = true; setBusy(true); setError("");
    try {
      const source = await load(item);
      if (version === request.current) setHtml(staticHtmlPreview(source));
    } catch (cause) {
      if (version === request.current) setError(cause instanceof Error ? cause.message : "미리보기를 불러오지 못했습니다.");
    } finally { if (version === request.current) { locked.current = false; setBusy(false); } }
  }
  return <section className="html-preview">
    <div className="html-preview-toolbar"><button type="button" className="button secondary" disabled={busy} onClick={() => html ? setHtml("") : void open()}>
      {busy ? <LoaderCircle size={16} className="spin" /> : html ? <X size={16} /> : <Code2 size={16} />}{busy ? "원본 불러오는 중" : html ? "미리보기 닫기" : "HTML 미리보기"}
    </button><span>화면과 본문 미리보기, 실행 기능은 원본 파일에서 이용</span></div>
    {error && <p role="alert" className="alert error">{error}</p>}
    {html && <iframe title={`${item.title} HTML 미리보기`} sandbox="" referrerPolicy="no-referrer" srcDoc={html} />}
  </section>;
}
