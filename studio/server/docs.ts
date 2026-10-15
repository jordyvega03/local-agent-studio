// Pestaña Proyecto: documentos Markdown del proyecto (README, docs/, planes). Solo se sirven
// rutas que esta lista ha encontrado (nada de rutas que lleguen de la web) y como texto: la
// UI los convierte a HTML y los limpia (DOMPurify) antes de mostrarlos.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { DocEntry } from "../shared/types.ts";

const MAX_DOC_BYTES = 512 * 1024;
const MAX_DOCS = 300;
const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv", "venv", "__pycache__", ".turbo", "coverage"]);

function walk(dir: string, depth: number, out: string[]) {
  if (depth < 0 || out.length >= MAX_DOCS) return;
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name) || (e.name.startsWith(".") && e.name !== ".ai")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, depth - 1, out);
    else if (e.isFile() && /\.(md|mdx)$/i.test(e.name)) out.push(p);
  }
}

/** Markdown del proyecto: raíz, docs/, apps/* y packages/* (2 niveles) y .ai/plans. */
export function listDocs(dir: string): DocEntry[] {
  const found: string[] = [];
  walk(dir, 0, found);                                       // README.md, CLAUDE.md… de la raíz
  for (const sub of ["docs", "doc", "apps", "packages"]) walk(join(dir, sub), 2, found);
  walk(join(dir, ".ai", "plans"), 0, found);
  if (existsSync(join(dir, ".ai", "context.md"))) found.unshift(join(dir, ".ai", "context.md"));
  const seen = new Set<string>();
  return found.filter((p) => !seen.has(p) && seen.add(p)).map((p) => {
    const rel = relative(dir, p).split(sep).join("/");
    const group: DocEntry["group"] = rel.startsWith(".ai/plans/") ? "plan" : rel === ".ai/context.md" || !rel.includes("/") ? "root" : "docs";
    return { path: rel, group, size: statSync(p).size };
  }).sort((a, b) => (a.group === b.group ? a.path.localeCompare(b.path) : ["root", "docs", "plan"].indexOf(a.group) - ["root", "docs", "plan"].indexOf(b.group)));
}

/** Contenido de un documento SOLO si está en listDocs (y sigue dentro del proyecto). */
export function readDoc(dir: string, path: string): string {
  const entry = listDocs(dir).find((d) => d.path === path);
  if (!entry) throw new Error("Ese documento no existe en el proyecto.");
  if (entry.size > MAX_DOC_BYTES) throw new Error("El documento es demasiado grande para mostrarlo.");
  const full = realpathSync(join(dir, path));
  if (!full.startsWith(realpathSync(dir) + sep)) throw new Error("Ese documento no está dentro del proyecto.");
  return readFileSync(full, "utf8");
}
