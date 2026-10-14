// Tema del Studio: automático (sigue a macOS), claro u oscuro. Se guarda en el navegador
// (preferencia de quien mira, no un dato del proyecto) y se aplica antes de pintar.
export type Theme = "auto" | "light" | "dark";
const KEY = "studio-theme";
export const THEME_EVENT = "studio-theme-change";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try { localStorage.setItem(KEY, t); } catch { /* sin almacenamiento: solo esta sesión */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

// En modo automático, avisar también cuando macOS cambia de claro a oscuro.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getTheme() === "auto") window.dispatchEvent(new Event(THEME_EVENT));
});

/** Color de fondo de la terminal según el tema actual (las variables CSS ya cambiaron). */
export const termBackground = () => getComputedStyle(document.documentElement).getPropertyValue("--term").trim() || "#05080c";
