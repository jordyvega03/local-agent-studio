// Contexto del proyecto (proyecto/.ai/context.md, ver `ai context` en bin/ai): leerlo,
// guardarlo desde el editor del Studio (sin pisar cambios: mtime) o crearlo desde la plantilla.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProjectContext } from "../shared/types.ts";

export const CONTEXT_REL = ".ai/context.md";
export const MAX_CONTEXT_BYTES = 64 * 1024;

export class ContextError extends Error {}

const pathOf = (dir: string) => join(dir, ".ai", "context.md");

export function readContext(dir: string): ProjectContext {
  const p = pathOf(dir);
  if (!existsSync(p)) return { exists: false, text: "", mtime: null };
  return { exists: true, text: readFileSync(p, "utf8"), mtime: statSync(p).mtimeMs };
}

function writeAtomic(p: string, text: string) {
  mkdirSync(join(p, ".."), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, text.endsWith("\n") ? text : text + "\n");
  renameSync(tmp, p);
}

/** Guarda: si existe, mtime debe coincidir (nadie lo cambió mientras editabas). */
export function saveContext(dir: string, text: string, mtime: number | null): { mtime: number } {
  if (Buffer.byteLength(text) > MAX_CONTEXT_BYTES) throw new ContextError("El contexto es demasiado grande (máx. 64 KB).");
  const p = pathOf(dir);
  if (existsSync(p)) {
    if (mtime == null || Math.abs(statSync(p).mtimeMs - mtime) > 1) throw new ContextError("El contexto cambió desde que lo abriste.");
  } else if (mtime != null) {
    throw new ContextError("El contexto ya no existe.");
  }
  writeAtomic(p, text);
  return { mtime: statSync(p).mtimeMs };
}

/** Crea la plantilla vacía (prompts/context-template.md), solo si no existe. */
export function createContextTemplate(aiHome: string, dir: string): ProjectContext {
  if (existsSync(pathOf(dir))) throw new ContextError("Ya existe un contexto.");
  const tpl = readFileSync(join(aiHome, "prompts", "context-template.md"), "utf8").replaceAll("<nombre>", basename(dir));
  writeAtomic(pathOf(dir), tpl);
  return readContext(dir);
}
