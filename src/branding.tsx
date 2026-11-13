export const APP_NAME = "C아카이브";

/** Decorative mark; the adjoining wordmark supplies the accessible name. */
export function ArchiveMark({ className = "" }: { className?: string }) {
  return <img className={`archive-mark ${className}`} src="/icons/c-archive.svg?v=right-20261113-v2" alt="" width="64" height="64" draggable={false} />;
}

/** Visual spacing is independent from the compact, unchanged application name. */
export function ArchiveWordmark() {
  return <strong className="archive-wordmark" aria-label={APP_NAME}><span aria-hidden="true">C</span><span aria-hidden="true">아카이브</span></strong>;
}
