// Pestaña Proyecto: ramas del agente (ai/*), sus commits y el diff frente a la rama base.
// Solo lectura. git se ejecuta sin shell (execFile) y solo con ramas y commits que existen en
// el repo: nada de lo que llega de la web se pasa a git sin comprobarlo antes.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RUN_NAME } from "./runs.ts";
import type { BranchInfo, CommitInfo, DiffFile, DiffHunk, DiffLine, ProjectGit } from "../shared/types.ts";

const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_FILE_LINES = 3000;      // más líneas por archivo: se recorta (y se avisa)
const MAX_TOTAL_LINES = 20000;

export class GitError extends Error {}

function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", dir, ...args], { maxBuffer: MAX_BUFFER, timeout: 15000, env: { ...process.env, GIT_PAGER: "cat", LC_ALL: "C" } },
      (err, stdout) => (err ? reject(new GitError(String(err.message).split("\n")[0])) : resolve(stdout)));
  });
}

async function branchNames(dir: string): Promise<string[]> {
  const out = await git(dir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
  return out.split("\n").filter(Boolean);
}

/** Rama base: main, master, o la primera que no sea del agente. */
function pickBase(names: string[]): string | null {
  return names.find((n) => n === "main") ?? names.find((n) => n === "master") ?? names.find((n) => !n.startsWith("ai/")) ?? null;
}

/** Sesión del Studio que corresponde a una rama ai/<nombre> (plan o agente). */
function runFor(dir: string, branch: string): string | undefined {
  const name = branch.slice(3);
  if (!RUN_NAME.test(name)) return undefined;
  return existsSync(join(dir, ".ai", "plans", `${name}.md`)) || existsSync(join(dir, ".ai", "logs", `${name}.jsonl`)) ? name : undefined;
}

export async function projectGit(dir: string): Promise<ProjectGit> {
  try { await git(dir, ["rev-parse", "--git-dir"]); } catch { return { isRepo: false, current: null, base: null, branches: [] }; }
  const names = await branchNames(dir);
  const base = pickBase(names);
  const current = (await git(dir, ["branch", "--show-current"]).catch(() => "")).trim() || null;
  const branches: BranchInfo[] = [];
  for (const name of names.filter((n) => n.startsWith("ai/"))) {
    const [counts, last] = await Promise.all([
      base ? git(dir, ["rev-list", "--left-right", "--count", `${base}...${name}`]).catch(() => "0\t0") : Promise.resolve("0\t0"),
      git(dir, ["log", "-1", "--format=%h%x00%cI%x00%s", name]),
    ]);
    const [behind, ahead] = counts.trim().split(/\s+/).map(Number);
    const [hash, date, subject] = last.trim().split("\0");
    branches.push({ name, ahead: ahead || 0, behind: behind || 0, last: { hash, date, subject }, run: runFor(dir, name) });
  }
  branches.sort((a, b) => (a.last.date < b.last.date ? 1 : -1));
  return { isRepo: true, current, base, branches };
}

/** Comprueba que la rama existe (y es del agente o la base): nada más llega a git. */
async function checkBranch(dir: string, branch: string): Promise<{ base: string }> {
  const names = await branchNames(dir);
  const base = pickBase(names);
  if (!base) throw new GitError("El repo no tiene rama base.");
  if (!names.includes(branch) || branch === base) throw new GitError("Rama no válida.");
  return { base };
}

export async function branchCommits(dir: string, branch: string): Promise<CommitInfo[]> {
  const { base } = await checkBranch(dir, branch);
  const out = await git(dir, ["log", "--format=%H%x00%h%x00%cI%x00%an%x00%s", `${base}..${branch}`]);
  return out.split("\n").filter(Boolean).map((l) => {
    const [full, hash, date, author, subject] = l.split("\0");
    return { full, hash, date, author, subject };
  });
}

export async function branchDiff(dir: string, branch: string, commit?: string): Promise<{ files: DiffFile[]; truncated: boolean; base: string }> {
  const { base } = await checkBranch(dir, branch);
  let args: string[];
  if (commit) {
    // Solo commits de esa rama (base..rama), por su hash completo.
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new GitError("Commit no válido.");
    const own = (await git(dir, ["rev-list", `${base}..${branch}`])).split("\n");
    if (!own.includes(commit)) throw new GitError("Ese commit no es de la rama.");
    args = ["show", "--format=", "--no-color", "--find-renames", "--no-ext-diff", commit];
  } else {
    args = ["diff", "--no-color", "--find-renames", "--no-ext-diff", `${base}...${branch}`];
  }
  const { files, truncated } = parseDiff(await git(dir, args));
  return { files, truncated, base };
}

// --- Parser de diff unificado (exportado para los tests) --------------------------
export function parseDiff(text: string): { files: DiffFile[]; truncated: boolean } {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0, newNo = 0, total = 0, truncated = false;

  const unquote = (p: string) => p.replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git (".*?"|\S+) (".*?"|\S+)$/.exec(line);
      file = { path: m ? unquote(m[2]) : line.slice(11), status: "modified", additions: 0, deletions: 0, binary: false, truncated: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) { file.status = "renamed"; file.oldPath = line.slice(12); }
    else if (line.startsWith("rename to ")) file.path = line.slice(10);
    else if (line.startsWith("Binary files ")) file.binary = true;
    else if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
      oldNo = m ? Number(m[1]) : 0;
      newNo = m ? Number(m[2]) : 0;
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    } else if (hunk) {
      // Las cabeceras ---/+++ van antes del primer @@ (hunk aún vacío): aquí todo es contenido,
      // también una línea borrada que empiece por "-- " (p. ej. un comentario SQL).
      const kind = line[0];
      if (kind !== "+" && kind !== "-" && kind !== " ") continue;   // "\ No newline at end of file", vacías
      if (kind === "+") file.additions++;
      if (kind === "-") file.deletions++;
      const fileLines = file.hunks.reduce((n, h) => n + h.lines.length, 0);
      if (fileLines >= MAX_FILE_LINES || total >= MAX_TOTAL_LINES) { file.truncated = truncated = true; continue; }
      const l: DiffLine = kind === "+" ? { type: "add", new: newNo++, text: line.slice(1) }
        : kind === "-" ? { type: "del", old: oldNo++, text: line.slice(1) }
        : { type: "ctx", old: oldNo++, new: newNo++, text: line.slice(1) };
      hunk.lines.push(l);
      total++;
    }
  }
  return { files, truncated };
}
