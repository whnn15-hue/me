import {useEffect, useRef, useState} from "react";
import {Headphones, LoaderCircle, X} from "lucide-react";
import type {MaterialItem} from "./types";

export default function AudioPreview({item,load}:{item:MaterialItem;load:(item:MaterialItem)=>Promise<Blob>}) {
  const [url,setUrl]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const version=useRef(0),objectUrl=useRef(""),locked=useRef(false);
  const release=()=>{if(objectUrl.current) URL.revokeObjectURL(objectUrl.current);objectUrl.current="";};
  useEffect(()=>()=>{version.current++;release();},[]);
  async function open() {
    if(locked.current) return;
    if(url){release();setUrl("");return;}
    const current=++version.current;locked.current=true;setBusy(true);setError("");
    try {const blob=await load(item);if(version.current===current){release();objectUrl.current=URL.createObjectURL(blob);setUrl(objectUrl.current);}}
    catch(cause){if(version.current===current)setError(cause instanceof Error?cause.message:"오디오를 불러오지 못했습니다.");}
    finally{if(version.current===current){locked.current=false;setBusy(false);}}
  }
  return <section className="audio-preview"><button type="button" className="button secondary" disabled={busy} onClick={()=>void open()}>{busy?<LoaderCircle size={16} className="spin"/>:url?<X size={16}/>:<Headphones size={16}/>} {busy?"오디오 불러오는 중":url?"오디오 닫기":"오디오 들어보기"}</button>{url && <audio controls preload="metadata" src={url} aria-label={`${item.title} 오디오`} onError={()=>setError("브라우저에서 재생할 수 없는 형식입니다. 드라이브에서 원본을 열어 주세요.")}/>} {error && <p role="alert">{error}</p>}</section>;
}
