import { useEffect, useState } from "react";
import { readOneDriveOAuthError } from "../shared/onedrive-oauth-recovery.mjs";

/** A callback hint is UI-only. It never authorizes a connection or a retry. */
function errorFromURL() {
  const values = new URL(window.location.href).searchParams.getAll("onedriveError");
  return values.length === 1 ? readOneDriveOAuthError(values[0]) : null;
}

export function useOneDriveOAuthRecovery() {
  const [error] = useState(errorFromURL);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("onedriveError")) return;
    url.searchParams.delete("onedriveError");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return error;
}
