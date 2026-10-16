import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { getThemePreference, setThemePreference, subscribeTheme, type ThemePreference } from "./theme";

const options = [
  { value: "light", label: "라이트", icon: Sun, hint: "항상 밝은 화면" },
  { value: "dark", label: "다크", icon: Moon, hint: "항상 어두운 화면" },
  { value: "system", label: "시스템", icon: Monitor, hint: "PC의 화면 모드에 맞춰 자동 전환" },
] satisfies { value: ThemePreference; label: string; icon: typeof Sun; hint: string }[];

export default function ThemeControl({ label = "화면 모드" }: { label?: string }) {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference);

  return <div className="theme-control" role="group" aria-label={label}>
    {options.map(({ value, label, icon: Icon, hint }) => <button
      key={value}
      type="button"
      aria-pressed={preference === value}
      title={hint}
      onClick={() => setThemePreference(value)}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>)}
  </div>;
}
