import { useRef, useState } from "react";
import { CloudUpload, LoaderCircle } from "lucide-react";

export default function FileDropzone({ onFiles, busy = false, label = "파일을 끌어 놓거나 선택", accept = ".pdf,.ppt,.pptx,.hwp,.hwpx,.docx,.html,.htm,.txt,.xlsx,.cell,.png,.jpg,.jpeg,.webp", hint = "PDF, PPT, HTML, HWP 등, 최대 10개, 파일당 25 MB" }: {
  onFiles: (files: File[]) => void | Promise<void>; busy?: boolean; label?: string; accept?: string; hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  return <div className={`file-dropzone ${dragging ? "dragging" : ""} ${busy ? "busy" : ""}`}
    onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); depth.current++; if (!busy) setDragging(true); } }}
    onDragLeave={event => { event.preventDefault(); event.stopPropagation(); if (--depth.current <= 0) { depth.current = 0; setDragging(false); } }}
    onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; } }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); depth.current = 0; setDragging(false); if (!busy && event.dataTransfer.files.length) void onFiles(Array.from(event.dataTransfer.files)); }}>
    <button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? <LoaderCircle size={22} className="spin" /> : <CloudUpload size={23} />}<strong>{busy ? "파일 정리 중" : label}</strong><span>{hint}</span></button>
    <input ref={input} type="file" multiple accept={accept} disabled={busy} className="visually-hidden" aria-label={label} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void onFiles(files); }} />
  </div>;
}
