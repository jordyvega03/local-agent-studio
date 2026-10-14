import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { applyTheme, getTheme, type Theme } from "../theme.ts";
import { cx } from "./ui.tsx";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "auto", label: "Automático (como macOS)", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme);
  return (
    <div className="flex rounded-lg border border-line bg-panel-2 p-0.5" role="radiogroup" aria-label="Tema">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button key={value} role="radio" aria-checked={theme === value} title={label} aria-label={label}
          onClick={() => { applyTheme(value); setTheme(value); }}
          className={cx("rounded-md p-1", theme === value ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg")}>
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
