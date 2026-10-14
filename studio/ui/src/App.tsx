import { useCallback, useEffect, useRef, useState } from "react";
import type { RunState } from "../../shared/types.ts";
import { STATUS_LABEL } from "./format.ts";
import { useLive } from "./live.ts";
import { AnalysisCard, ExecutionCard, Pipeline, ReviewCard, SessionTokensCard } from "./components/Session.tsx";
import { TokensView } from "./components/Tokens.tsx";
import { Brand, Sidebar } from "./components/Sidebar.tsx";
import { SystemChips } from "./components/SystemChips.tsx";
import { SystemView } from "./components/System.tsx";
import { TerminalCard, type TerminalHandle } from "./components/Terminal.tsx";
import { Code, cx } from "./components/ui.tsx";

type View = "session" | "system" | "tokens";

/** Mismo criterio que defaultStep() del servidor: el paso actual o el último con salida. */
const followStep = (r: RunState | null) => r ? r.exec.current ?? r.exec.logs.at(-1) ?? r.exec.steps[0]?.n ?? null : null;

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { project: p.get("project") ?? "", run: p.get("run") ?? "", view: (["system", "tokens"].includes(p.get("view") ?? "") ? p.get("view") : "session") as View };
}

export function App() {
  const [sel, setSel] = useState(() => {
    const { view: _v, ...rest } = readUrl();
    return { ...rest, step: null as number | null };
  });
  const [view, setView] = useState<View>(() => readUrl().view);
  const [logStep, setLogStep] = useState<number | null>(null);
  const term = useRef<TerminalHandle>(null);
  const onLog = useCallback((step: number, reset: boolean, bytes: Uint8Array) => {
    setLogStep(step);
    term.current?.write(reset, bytes);
  }, []);
  const live = useLive(sel, onLog);
  const { projects, run } = live;

  // Si el proyecto o el plan de la URL no existen, elige el más reciente.
  useEffect(() => {
    if (!projects?.length) return;
    const proj = projects.find((p) => p.dir === sel.project) ?? projects[0];
    const runName = proj.runs.some((r) => r.name === sel.run) ? sel.run : proj.runs[0]?.name ?? "";
    if (proj.dir !== sel.project || runName !== sel.run) setSel({ project: proj.dir, run: runName, step: null });
  }, [projects, sel.project, sel.run]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (sel.project) p.set("project", sel.project);
    if (sel.run) p.set("run", sel.run);
    if (view !== "session") p.set("view", view);
    history.replaceState(null, "", `?${p}`);
  }, [sel.project, sel.run, view]);

  // Refresco de 1 s para los cronómetros de lo que está en curso.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // Fijar el paso que está en curso = volver a seguir al actual.
  const selectStep = (n: number) => setSel((s) => ({ ...s, step: n === run?.exec.current ? null : n }));
  const selected = sel.step ?? followStep(run);
  const select = (project: string, runName: string) => { setSel({ project, run: runName, step: null }); setView("session"); };
  const current = projects?.find((p) => p.dir === sel.project);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[272px_1fr]">
      <aside className="hidden min-h-0 flex-col border-r border-line bg-panel lg:flex">
        <Brand />
        {projects && <Sidebar projects={projects} project={sel.project} run={sel.run} onSelect={select} />}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel/95 px-4 py-2.5 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">
              {view === "system" ? "Sistema" : view === "tokens" ? "Tokens" : run?.plan.title || run?.name || "AI Studio"}
            </div>
            <div className="truncate text-xs text-muted">
              {view === "system" ? "CPU, GPU y memoria del Mac en tiempo real"
                : view === "tokens" ? "Lo que genera el ejecutor, petición a petición"
                : current ? `${current.name} · ${sel.run}` : "Sin proyecto"}
            </div>
          </div>
          <div className="flex rounded-lg border border-line bg-panel-2 p-0.5 text-xs" role="tablist" aria-label="Vista">
            {([["session", "Sesión"], ["tokens", "Tokens"], ["system", "Sistema"]] as const).map(([v, label]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={cx("rounded-md px-3 py-1", view === v ? "bg-panel font-semibold text-fg shadow-sm" : "text-muted hover:text-fg")}>
                {label}
              </button>
            ))}
          </div>
          <SystemChips system={live.system} connected={live.connected} />
          {/* Móvil: selectores en lugar de la barra lateral */}
          {projects && projects.length > 0 && (
            <div className="flex w-full gap-2 lg:hidden">
              <select className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1" value={sel.project}
                onChange={(e) => select(e.target.value, projects.find((p) => p.dir === e.target.value)?.runs[0]?.name ?? "")}>
                {projects.map((p) => <option key={p.dir} value={p.dir}>{p.name}</option>)}
              </select>
              <select className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1" value={sel.run}
                onChange={(e) => select(sel.project, e.target.value)}>
                {current?.runs.map((r) => <option key={r.name} value={r.name}>{r.title} · {STATUS_LABEL[r.status]}</option>)}
              </select>
            </div>
          )}
        </header>

        <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4">
          {view === "system" && <SystemView metrics={live.metrics} history={live.history} system={live.system} />}
          {view === "tokens" && <TokensView tokens={live.tokens} />}
          {/* Oculta (no desmontada): la terminal conserva lo recibido al volver de "Sistema" */}
          <div className={cx("flex flex-col gap-4", view !== "session" && "hidden")}>
          {live.error && <p className="rounded-lg border border-fail bg-fail-bg px-3 py-2 text-sm text-fail">{live.error}</p>}
          {projects && projects.length === 0 && (
            <Welcome>Todavía no hay proyectos. Empieza con <Code>ai plan mi-app "tu tarea"</Code> o abre <Code>ai studio mi-app</Code>.</Welcome>
          )}
          {current && current.runs.length === 0 && (
            <Welcome>Este proyecto no tiene planes todavía: <Code>ai plan {current.name} "tarea"</Code></Welcome>
          )}
          {run && (
            <>
              <Pipeline run={run} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                <div className="flex min-w-0 flex-col gap-4">
                  <AnalysisCard run={run} />
                  <SessionTokensCard run={run} />
                  <ReviewCard run={run} />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                  <ExecutionCard run={run} selected={selected} onSelect={selectStep} />
                  <TerminalCard ref={term} step={logStep} following={sel.step === null}
                    status={run.exec.steps.find((s) => s.n === logStep)?.status} />
                </div>
              </div>
            </>
          )}
          {!run && sel.run && live.connected && <Welcome>Cargando sesión…</Welcome>}
          </div>
        </main>
      </div>
    </div>
  );
}

function Welcome({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-muted">{children}</div>;
}
