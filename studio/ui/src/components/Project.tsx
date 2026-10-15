// Pestaña "Proyecto": las ramas que crearon los agentes, qué cambió en cada una (diff visual
// unificado o lado a lado, por rama o por commit) y la documentación del proyecto. Solo
// lectura: para fusionar o borrar una rama, comandos para copiar.
import DOMPurify from "dompurify";
import { marked } from "marked";
import { BookOpen, Brain, Check, FileText, Pencil, Sparkles, ChevronDown, ChevronRight, Columns2, Copy, FileMinus, FilePen, FilePlus, FileSymlink, GitBranch,
  GitCommitHorizontal, GitMerge, Loader2, Rows3 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { lazy, Suspense } from "react";
import type { BranchInfo, CommitInfo, DiffFile, DiffLine, DocEntry, JobRequest, ProjectContext, ProjectGit } from "../../../shared/types.ts";
import { createContextTemplate, getCommits, getContext, getDiff, getDoc, getDocs, getProjectGit, saveContext } from "../api.ts";

const PlanEditor = lazy(() => import("./PlanEditor.tsx").then((m) => ({ default: m.PlanEditor })));
import { Card, Code, cx, Empty } from "./ui.tsx";

type Selection = { kind: "branch"; name: string } | { kind: "doc"; path: string } | { kind: "context-edit" } | null;

/** Contexto del proyecto (.ai/context.md): lo leen Opus y los agentes en cada tarea. */
function ContextCard({ ctx, busy, onView, onEdit, onTemplate, onGenerate }: {
  ctx: ProjectContext | null; busy: boolean;
  onView: () => void; onEdit: () => void; onTemplate: () => void; onGenerate: (force: boolean) => void;
}) {
  const btn = "flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent disabled:opacity-50";
  return (
    <Card title="Contexto del proyecto" icon={<Brain className="size-4 text-muted" />}>
      {!ctx ? <Empty>Cargando…</Empty> : ctx.writable === false ? (
        <p className="text-xs text-muted">
          {ctx.exists ? <><button className="text-accent hover:underline" onClick={onView}>Ver .ai/context.md</button>. </> : "Sin contexto. "}
          Este proyecto está fuera de PROJECTS_ROOT (config.env): desde la web es solo lectura. Usa <Code>ai context</Code> en la terminal.
        </p>
      ) : ctx.exists ? (
        <>
          <p className="mb-2 text-xs text-muted">
            <Code>.ai/context.md</Code>: lo leen Opus (plan, revisión) y los agentes locales en cada tarea. Conviene commitearlo.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button className={btn} onClick={onView}><FileText className="size-3.5" />Ver</button>
            <button className={btn} onClick={onEdit}><Pencil className="size-3.5" />Editar</button>
            <button className={btn} onClick={() => onGenerate(true)} disabled={busy} title="Opus lo reescribe desde cero (1 llamada)">
              <Sparkles className="size-3.5" />Regenerar con Opus
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            Sin contexto todavía. Con él, los agentes siguen tus convenciones en vez de adivinarlas.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button className={cx(btn, "border-accent font-semibold")} onClick={() => onGenerate(false)} disabled={busy}>
              <Sparkles className="size-3.5" />Generar con Opus
            </button>
            <button className={btn} onClick={onTemplate} disabled={busy}><FileText className="size-3.5" />Plantilla vacía</button>
          </div>
        </>
      )}
    </Card>
  );
}

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString();
};

// --- Comandos para copiar ---------------------------------------------------------
function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="rounded-lg bg-panel-2 p-3 pr-10 font-mono text-xs break-all whitespace-pre-wrap">{text}</pre>
      <button className="absolute top-2 right-2 rounded-md p-1 text-muted hover:text-fg" aria-label="Copiar"
        onClick={() => { void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
        {done ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

// --- Diff ------------------------------------------------------------------------------
const STATUS_ICON: Record<DiffFile["status"], ReactNode> = {
  added: <FilePlus className="size-4 text-ok" aria-label="añadido" />,
  deleted: <FileMinus className="size-4 text-fail" aria-label="borrado" />,
  modified: <FilePen className="size-4 text-run" aria-label="modificado" />,
  renamed: <FileSymlink className="size-4 text-accent" aria-label="renombrado" />,
};

const ROW: Record<DiffLine["type"], string> = { add: "bg-ok-bg", del: "bg-fail-bg", ctx: "" };
const SIGN: Record<DiffLine["type"], string> = { add: "+", del: "−", ctx: " " };
const num = "w-12 shrink-0 select-none px-2 text-right text-muted tabular-nums";

function UnifiedHunk({ lines }: { lines: DiffLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={cx("flex min-w-max", ROW[l.type])}>
          <span className={num}>{l.old ?? ""}</span>
          <span className={num}>{l.new ?? ""}</span>
          <span className={cx("w-4 shrink-0 select-none", l.type === "add" ? "text-ok" : l.type === "del" ? "text-fail" : "text-muted")}>{SIGN[l.type]}</span>
          <span className="pr-4 whitespace-pre">{l.text || " "}</span>
        </div>
      ))}
    </>
  );
}

/** Lado a lado: las líneas borradas a la izquierda y las añadidas a la derecha, emparejadas. */
function SplitHunk({ lines }: { lines: DiffLine[] }) {
  const rows: [DiffLine | null, DiffLine | null][] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i].type === "ctx") { rows.push([lines[i], lines[i]]); i++; continue; }
    const dels: DiffLine[] = [], adds: DiffLine[] = [];
    while (i < lines.length && lines[i].type === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].type === "add") adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push([dels[k] ?? null, adds[k] ?? null]);
  }
  const side = (l: DiffLine | null, which: "old" | "new") => (
    <div className={cx("flex min-w-0", l ? ROW[l.type === "ctx" ? "ctx" : l.type] : "bg-panel-2/60")}>
      <span className={num}>{l ? l[which] ?? "" : ""}</span>
      <span className="min-w-0 pr-3 break-all whitespace-pre-wrap">{l ? l.text || " " : ""}</span>
    </div>
  );
  return (
    <>
      {rows.map(([a, b], i) => (
        <div key={i} className="grid grid-cols-2 divide-x divide-line">{side(a, "old")}{side(b, "new")}</div>
      ))}
    </>
  );
}

function FileDiff({ file, split, open, onToggle }: { file: DiffFile; split: boolean; open: boolean; onToggle: () => void }) {
  return (
    <section id={`f-${file.path}`} className="overflow-hidden rounded-xl border border-line bg-panel">
      <button onClick={onToggle} className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-[13px] hover:bg-panel-2">
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
        {STATUS_ICON[file.status]}
        <span className="min-w-0 truncate font-mono">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
        <span className="ml-auto shrink-0 font-mono text-xs"><span className="text-ok">+{file.additions}</span> <span className="text-fail">−{file.deletions}</span></span>
      </button>
      {open && (
        file.binary ? <p className="px-3 py-2 text-xs text-muted">Archivo binario: no se muestra el contenido.</p>
          : file.hunks.length === 0 ? <p className="px-3 py-2 text-xs text-muted">Sin cambios de contenido (solo renombrado o permisos).</p>
          : (
            <div className="overflow-x-auto font-mono text-xs leading-5">
              {file.hunks.map((h, i) => (
                <div key={i}>
                  <div className="bg-panel-2 px-3 py-0.5 text-muted">{h.header}</div>
                  {split ? <SplitHunk lines={h.lines} /> : <UnifiedHunk lines={h.lines} />}
                </div>
              ))}
              {file.truncated && <p className="px-3 py-2 text-muted">… diff recortado (archivo muy grande). Míralo entero con git.</p>}
            </div>
          )
      )}
    </section>
  );
}

function BranchView({ project, git, branch, onOpenRun }: { project: string; git: ProjectGit; branch: BranchInfo; onOpenRun: (run: string) => void }) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [commit, setCommit] = useState<string | undefined>(undefined);
  const [diff, setDiff] = useState<{ files: DiffFile[]; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [split, setSplit] = useState(() => { try { return localStorage.getItem("studio-diff-split") === "1"; } catch { return false; } });
  const [closed, setClosed] = useState<Set<string>>(new Set());

  useEffect(() => { setCommit(undefined); setCommits(null); getCommits(project, branch.name).then(setCommits).catch((e) => setError(e.message)); }, [project, branch.name]);
  useEffect(() => {
    setDiff(null); setError(null);
    getDiff(project, branch.name, commit).then((d) => {
      setDiff(d);
      // Con muchos archivos, se abren solo los 8 primeros (el resto, con un clic).
      setClosed(new Set(d.files.slice(8).map((f) => f.path)));
    }).catch((e) => setError(e.message));
  }, [project, branch.name, commit]);
  const toggleSplit = (v: boolean) => { setSplit(v); try { localStorage.setItem("studio-diff-split", v ? "1" : "0"); } catch { /* sin almacenamiento */ } };

  const totals = useMemo(() => diff ? diff.files.reduce((t, f) => ({ add: t.add + f.additions, del: t.del + f.deletions }), { add: 0, del: 0 }) : null, [diff]);
  const base = git.base ?? "main";
  const cd = `cd "${project}"`;
  const merge = `${cd}\ngit switch ${base}\ngit merge ${branch.name}`;
  const drop = `${cd}\ngit branch -D ${branch.name}`;
  const selected = commits?.find((c) => c.full === commit);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card title={branch.name} icon={<GitBranch className="size-4 text-muted" />}
        actions={branch.run && <button onClick={() => onOpenRun(branch.run!)} className="text-xs text-accent hover:underline">ver la sesión que la creó</button>}>
        <p className="mb-3 text-sm text-muted">
          {branch.ahead} commit{branch.ahead === 1 ? "" : "s"} sobre <Code>{base}</Code>
          {branch.behind > 0 && <> · {base} tiene {branch.behind} commit{branch.behind === 1 ? "" : "s"} nuevos que esta rama no tiene</>}
          {totals && !commit && <> · <span className="font-mono text-ok">+{totals.add}</span> <span className="font-mono text-fail">−{totals.del}</span> en {diff!.files.length} archivo{diff!.files.length === 1 ? "" : "s"}</>}
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><GitMerge className="size-3.5" />Si te gusta: fusionar en {base}</div><CopyBlock text={merge} /></div>
          <div><div className="mb-1 text-xs font-semibold">Si no: descartar la rama</div><CopyBlock text={drop} /></div>
        </div>
      </Card>

      <Card title="Commits" icon={<GitCommitHorizontal className="size-4 text-muted" />}
        actions={commit && <button onClick={() => setCommit(undefined)} className="text-xs text-accent hover:underline">ver toda la rama</button>}>
        {!commits ? <Empty>Cargando…</Empty> : commits.length === 0 ? <Empty>Sin commits propios.</Empty> : (
          <ul className="flex flex-col gap-0.5">
            {commits.map((c) => (
              <li key={c.full}>
                <button onClick={() => setCommit(c.full === commit ? undefined : c.full)}
                  className={cx("grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-3 rounded-md px-2 py-1 text-left text-xs",
                    c.full === commit ? "bg-panel-2 outline outline-1 outline-accent/70" : "hover:bg-panel-2")}>
                  <span className="font-mono text-muted">{c.hash}</span>
                  <span className="truncate">{c.subject}</span>
                  <span className="text-muted">{ago(c.date)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{selected ? <>Cambios del commit <span className="font-mono">{selected.hash}</span></> : `Cambios de la rama frente a ${base}`}</span>
        <div className="ml-auto flex rounded-lg border border-line bg-panel-2 p-0.5 text-xs" role="radiogroup" aria-label="Vista del diff">
          <button role="radio" aria-checked={!split} onClick={() => toggleSplit(false)} className={cx("flex items-center gap-1 rounded-md px-2 py-1", !split ? "bg-panel font-semibold shadow-sm" : "text-muted")}><Rows3 className="size-3.5" />Unificado</button>
          <button role="radio" aria-checked={split} onClick={() => toggleSplit(true)} className={cx("flex items-center gap-1 rounded-md px-2 py-1", split ? "bg-panel font-semibold shadow-sm" : "text-muted")}><Columns2 className="size-3.5" />Lado a lado</button>
        </div>
      </div>
      {error && <p className="rounded-lg border border-fail bg-fail-bg px-3 py-2 text-sm text-fail">{error}</p>}
      {!diff && !error && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />Calculando el diff…</div>}
      {diff && diff.files.length === 0 && <Empty>Sin cambios.</Empty>}
      {diff && diff.files.length > 1 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {diff.files.map((f) => (
            <a key={f.path} href={`#f-${f.path}`} onClick={() => setClosed((s) => { const n = new Set(s); n.delete(f.path); return n; })}
              className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-0.5 font-mono hover:border-accent">
              {STATUS_ICON[f.status]}{f.path.split("/").at(-1)}<span className="text-ok">+{f.additions}</span><span className="text-fail">−{f.deletions}</span>
            </a>
          ))}
        </div>
      )}
      {diff?.files.map((f) => (
        <FileDiff key={f.path} file={f} split={split} open={!closed.has(f.path)}
          onToggle={() => setClosed((s) => { const n = new Set(s); if (n.has(f.path)) n.delete(f.path); else n.add(f.path); return n; })} />
      ))}
      {diff?.truncated && <p className="text-xs text-muted">El diff es muy grande y se ha recortado. Para verlo entero: <Code>git diff {base}...{branch.name}</Code></p>}
    </div>
  );
}

// --- Documentos ---------------------------------------------------------------------------
/** Markdown → HTML limpio. El contenido viene del proyecto (no es de fiar): DOMPurify siempre. */
function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true }) as string;
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "img"] });
  // Las casillas de las listas de tareas ([x]) se quedan, pero siempre desactivadas.
  return clean.replace(/<input /g, '<input disabled ');
}

function DocView({ project, path, docs, onOpen }: { project: string; path: string; docs: DocEntry[]; onOpen: (p: string) => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setHtml(null); setError(null);
    getDoc(project, path).then((d) => setHtml(renderMarkdown(d.text))).catch((e) => setError(e.message));
  }, [project, path]);
  // Enlaces: otro .md del proyecto se abre aquí; http(s) en otra pestaña; el resto, nada.
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//.test(href)) { e.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); return; }
    e.preventDefault();
    const target = new URL(href.split("#")[0], `file:///${path}`).pathname.slice(1);
    if (docs.some((d) => d.path === target)) onOpen(target);
  };
  return (
    <Card title={path} icon={<BookOpen className="size-4 text-muted" />}>
      {error ? <p className="text-sm text-fail">{error}</p> : html == null ? <Empty>Cargando…</Empty>
        : <article className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />}
    </Card>
  );
}

// --- Vista ---------------------------------------------------------------------------------
export function ProjectView({ project, onOpenRun, onLaunch }: {
  project: string; onOpenRun: (run: string) => void; onLaunch: (req: JobRequest) => Promise<void>;
}) {
  const [git, setGit] = useState<ProjectGit | null>(null);
  const [ctx, setCtx] = useState<ProjectContext | null>(null);
  const [ctxBusy, setCtxBusy] = useState(false);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const loadContext = () => getContext(project).then(setCtx).catch(() => setCtx({ exists: false, text: "", mtime: null }));
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [error, setError] = useState<string | null>(null);

  // Al abrir: la rama más reciente del agente; si no hay ramas, el primer documento.
  // (Se espera a tener las dos listas para no depender de cuál llega antes.)
  const load = () => {
    if (!project) return;
    void Promise.all([
      getProjectGit(project).catch((e) => { setError(e.message); return null; }),
      getDocs(project).catch(() => [] as DocEntry[]),
    ]).then(([g, d]) => {
      setGit(g); setDocs(d);
      setSel((s) => s ?? (g?.branches[0] ? { kind: "branch", name: g.branches[0].name } : d[0] ? { kind: "doc", path: d[0].path } : null));
    });
  };
  useEffect(() => { setSel(null); setGit(null); setDocs(null); setCtx(null); load(); void loadContext(); }, [project]);
  const runCtx = async (fn: () => Promise<unknown>) => {
    setCtxBusy(true); setCtxError(null);
    try { await fn(); } catch (e) { setCtxError((e as Error).message); } finally { setCtxBusy(false); }
  };

  if (!project) return <Empty>Elige un proyecto en la barra lateral.</Empty>;
  const branch = sel?.kind === "branch" ? git?.branches.find((b) => b.name === sel.name) : undefined;
  const GROUP = { root: "Raíz", docs: "Documentación", plan: "Planes" } as const;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <ContextCard ctx={ctx} busy={ctxBusy}
          onView={() => setSel({ kind: "doc", path: ".ai/context.md" })}
          onEdit={() => setSel({ kind: "context-edit" })}
          onTemplate={() => void runCtx(async () => { await createContextTemplate(project); await loadContext(); load(); setSel({ kind: "context-edit" }); })}
          onGenerate={(force) => void runCtx(() => onLaunch({ action: "context", project, force }))} />
        {ctxError && <p className="rounded-lg border border-fail bg-fail-bg px-3 py-2 text-xs text-fail">{ctxError}</p>}
        <Card title="Ramas del agente" icon={<GitBranch className="size-4 text-muted" />}
          actions={<button onClick={load} className="text-xs text-accent hover:underline">actualizar</button>}>
          {error ? <p className="text-xs text-fail">{error}</p> : !git ? <Empty>Cargando…</Empty>
            : !git.isRepo ? <Empty>Este proyecto no es un repo git.</Empty>
            : git.branches.length === 0 ? <Empty>No hay ramas ai/… Aparecen al ejecutar un plan, un agente o un flujo.</Empty> : (
              <ul className="flex flex-col gap-1">
                {git.branches.map((b) => (
                  <li key={b.name}>
                    <button onClick={() => setSel({ kind: "branch", name: b.name })}
                      className={cx("w-full rounded-lg px-2 py-1.5 text-left", sel?.kind === "branch" && sel.name === b.name ? "bg-panel-2 outline outline-1 outline-accent/70" : "hover:bg-panel-2")}>
                      <div className="truncate font-mono text-xs">{b.name.slice(3)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted">
                        {b.ahead} commit{b.ahead === 1 ? "" : "s"}{b.name === git.current ? " · actual" : ""} · {ago(b.last.date)} · {b.last.subject}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </Card>
        <Card title="Documentos" icon={<BookOpen className="size-4 text-muted" />}>
          {!docs ? <Empty>Cargando…</Empty> : docs.length === 0 ? <Empty>Sin archivos Markdown.</Empty> : (
            <div className="flex flex-col gap-2">
              {(["root", "docs", "plan"] as const).filter((gk) => docs.some((d) => d.group === gk)).map((gk) => (
                <div key={gk}>
                  <div className="mb-0.5 text-[11px] font-semibold text-muted uppercase">{GROUP[gk]}</div>
                  <ul>
                    {docs.filter((d) => d.group === gk).map((d) => (
                      <li key={d.path}>
                        <button onClick={() => setSel({ kind: "doc", path: d.path })} title={d.path}
                          className={cx("w-full truncate rounded-md px-2 py-1 text-left font-mono text-xs", sel?.kind === "doc" && sel.path === d.path ? "bg-panel-2 outline outline-1 outline-accent/70" : "hover:bg-panel-2")}>
                          {gk === "plan" ? d.path.split("/").at(-1) : d.path === ".ai/context.md" ? "contexto (.ai/context.md)" : d.path}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="min-w-0">
        {sel?.kind === "context-edit" && ctx?.exists ? (
          <Card title=".ai/context.md" icon={<Pencil className="size-4 text-muted" />}>
            <Suspense fallback={<Empty>Cargando editor…</Empty>}>
              <PlanEditor key={ctx.mtime ?? 0} project={project} run="" text={ctx.text} mtime={ctx.mtime}
                hint="Breve y concreto: cada línea debería evitar un error del agente."
                save={async (text, mtime) => { await saveContext(project, text, mtime); }}
                onClose={() => { void loadContext(); setSel({ kind: "doc", path: ".ai/context.md" }); }} />
            </Suspense>
          </Card>
        ) : branch && git ? <BranchView project={project} git={git} branch={branch} onOpenRun={onOpenRun} />
          : sel?.kind === "doc" && docs ? <DocView project={project} path={sel.path} docs={docs} onOpen={(p) => setSel({ kind: "doc", path: p })} />
          : <Empty>Elige una rama o un documento.</Empty>}
      </div>
    </div>
  );
}
