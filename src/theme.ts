export type ThemePreference = "light" | "dark" | "system";

const storageKey = "introduce-me-theme";
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function validPreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

function readPreference(): ThemePreference {
  try {
    return validPreference(localStorage.getItem(storageKey));
  } catch {
    return "system";
  }
}

let preference = readPreference();

function applyTheme() {
  const dark = preference === "dark" || (preference === "system" && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#141414" : "#f3f3f3");
}

export function getThemePreference() {
  return preference;
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    // Choosing a theme still works when browser storage is unavailable.
  }
  applyTheme();
  listeners.forEach(listener => listener());
}

systemTheme.addEventListener("change", () => {
  if (preference === "system") applyTheme();
});

window.addEventListener("storage", event => {
  if (event.key !== storageKey && event.key !== null) return;
  // sessionStorage changes must not overwrite this browser's theme preference.
  try {
    if (event.storageArea !== localStorage) return;
  } catch { return; }
  preference = validPreference(event.newValue);
  applyTheme();
  listeners.forEach(listener => listener());
});

// Resolve the saved preference before React renders the first screen.
applyTheme();
