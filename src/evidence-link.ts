import { useEffect, useState } from "react";

/** The decryption code stays in the URL fragment, never in a server request. */
export function evidenceCodeFromHash(hash: string): string | null {
  if (hash.length > 512 || !hash.startsWith("#settings?")) return null;
  const params = new URLSearchParams(hash.slice("#settings?".length));
  const codes = params.getAll("evidence");
  if (codes.length !== 1 || [...params.keys()].some(key => key !== "evidence")) return null;
  return /^IMEV1:[0-9a-f]{16}\.[A-Za-z0-9_-]{43}$/.test(codes[0]) ? codes[0] : null;
}

/** Retain the handoff in memory while the owner signs in, then discard it. */
export function useEvidenceLink() {
  const [code, setCode] = useState<string | null>(() => evidenceCodeFromHash(window.location.hash));
  useEffect(() => {
    const receive = () => {
      const incoming = evidenceCodeFromHash(window.location.hash);
      if (!incoming) return;
      setCode(incoming);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#settings`);
    };
    receive();
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  return [code, () => setCode(null)] as const;
}
