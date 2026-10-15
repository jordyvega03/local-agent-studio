// URLs cortas del Studio:
//   /                                 → el proyecto más reciente
//   /calorie-tracker                  → su sesión más reciente
//   /calorie-tracker/20261014-1225    → una sesión (fecha-hora; el nombre completo si se repite)
//   /calorie-tracker/proyecto         → pestaña Proyecto (igual: acciones, agentes, tokens, sistema)
// Los enlaces antiguos (?project=<ruta>&run=<sesión>&view=…) se siguen entendiendo.
import type { Project, RunSummary } from "../../shared/types.ts";

export type View = "session" | "project" | "actions" | "agents" | "system" | "tokens";

const SEGMENT: Record<Exclude<View, "session">, string> = {
  project: "proyecto", actions: "acciones", agents: "agentes", tokens: "tokens", system: "sistema",
};
const VIEW_OF = Object.fromEntries(Object.entries(SEGMENT).map(([v, s]) => [s, v])) as Record<string, View>;
const OLD_VIEWS = ["project", "actions", "agents", "tokens", "system"];

/** Lo que pide la URL, antes de saber qué proyectos existen. */
export interface WantedRoute {
  slug?: string;      // /<slug>/…
  dir?: string;       // enlace antiguo: ?project=<ruta completa>
  run?: string;       // id corto o nombre completo
  view: View;
}

export function parseLocation(loc: Location = location): WantedRoute {
  const q = new URLSearchParams(loc.search);
  if (q.has("project") || q.has("run") || q.has("view")) {
    const v = q.get("view") ?? "";
    return { dir: q.get("project") ?? undefined, run: q.get("run") ?? undefined, view: (OLD_VIEWS.includes(v) ? v : "session") as View };
  }
  const [a, b] = loc.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!a) return { view: "session" };
  if (VIEW_OF[a] && !b) return { view: VIEW_OF[a] };              // /sistema sin proyecto
  if (b && VIEW_OF[b]) return { slug: a, view: VIEW_OF[b] };
  return { slug: a, run: b, view: "session" };
}

/** Id corto de cada sesión: su fecha-hora (20261014-1225 o 20261014-144121), si no se repite. */
export function shortIds(runs: RunSummary[]): Map<string, string> {
  const shortOf = (name: string) => /^(\d{8}-\d{4,6})(?=-|$)/.exec(name)?.[1] ?? name;
  const count = new Map<string, number>();
  for (const r of runs) count.set(shortOf(r.name), (count.get(shortOf(r.name)) ?? 0) + 1);
  return new Map(runs.map((r) => [r.name, count.get(shortOf(r.name))! > 1 ? r.name : shortOf(r.name)]));
}

/** Resuelve lo que pide la URL con los proyectos reales (o elige los más recientes). */
export function resolveRoute(wanted: WantedRoute, projects: Project[]): { project: string; run: string; view: View } | null {
  if (!projects.length) return null;
  const proj = projects.find((p) => p.slug === wanted.slug) ?? projects.find((p) => p.dir === wanted.dir) ?? projects[0];
  const ids = shortIds(proj.runs);
  const run = proj.runs.find((r) => r.name === wanted.run)?.name
    ?? proj.runs.find((r) => ids.get(r.name) === wanted.run)?.name
    ?? proj.runs[0]?.name ?? "";
  return { project: proj.dir, run, view: wanted.view };
}

export function buildPath(projects: Project[] | null, project: string, run: string, view: View): string {
  const proj = projects?.find((p) => p.dir === project);
  if (!proj) return view === "session" ? "/" : `/${SEGMENT[view]}`;
  const base = `/${encodeURIComponent(proj.slug)}`;
  if (view !== "session") return `${base}/${SEGMENT[view]}`;
  // La sesión más reciente no necesita id: /calorie-tracker ya la abre.
  if (!run || run === proj.runs[0]?.name) return base;
  return `${base}/${encodeURIComponent(shortIds(proj.runs).get(run) ?? run)}`;
}
