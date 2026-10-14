// Vista de una sesión (un plan): etapas, análisis de Opus, pasos del ejecutor y revisión.
import { ArrowRight, Brain, Coins, FileSearch, FileText, FolderSearch, GitBranch, GitCommitHorizontal, Hammer,
  MessageSquare, ScanSearch, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RunState, Status } from "../../../shared/types.ts";
import { clock, compact, duration, secondsSince, tokS } from "../format.ts";
import { Card, Code, cx, Empty, StatusBadge, StatusIcon } from "./ui.tsx";

const NODE_RING: Record<Status, string> = {
  pending: "border-line", running: "border-run", done: "border-line", failed: "border-fail", aborted: "border-fail",
};
const NODE_ICON: Record<Status, string> = {
  pending: "bg-idle-bg text-idle", running: "bg-run-bg text-run pulse", done: "bg-ok-bg text-ok",
  failed: "bg-fail-bg text-fail", aborted: "bg-fail-bg text-fail",
};

function StageNode({ name, icon, status, sub }: { name: string; icon: ReactNode; status: Status; sub: string }) {
  return (
    <div className={cx("flex min-w-0 items-center gap-3 rounded-xl border bg-panel px-3 py-2.5", NODE_RING[status])}>
      <div className={cx("grid size-9 shrink-0 place-items-center rounded-full", NODE_ICON[status])}>{icon}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-semibold">{name} <StatusBadge status={status} /></div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
    </div>
  );
}

export function Pipeline({ run }: { run: RunState }) {
  const { analysis: a, exec: x, review: r } = run;
  const done = x.steps.filter((s) => s.status === "done").length;
  const aSub = a.status === "running" ? `${a.tools.length} lecturas…`
    : a.tools.length ? `${a.tools.length} lecturas · ${duration((a.duration_ms ?? 0) / 1000)}` : "plan escrito";
  const xSub = x.current ? `paso ${x.current} de ${x.steps.length}` : x.steps.length ? `${done}/${x.steps.length} pasos` : "sin pasos";
  const arrow = <ArrowRight className="size-4 shrink-0 justify-self-center text-muted max-lg:rotate-90" aria-hidden />;
  return (
    <div className="grid grid-cols-1 items-center gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
      <StageNode name="Análisis" icon={<Brain className="size-4" />} status={a.status} sub={[a.model, aSub].filter(Boolean).join(" · ")} />
      {arrow}
      <StageNode name="Ejecución" icon={<Hammer className="size-4" />} status={x.status} sub={[x.model, xSub].filter(Boolean).join(" · ")} />
      {arrow}
      <StageNode name="Revisión" icon={<ScanSearch className="size-4" />} status={r.status} sub={r.status === "pending" ? "ai review" : "Opus"} />
    </div>
  );
}

const TOOL_ICON: Record<string, ReactNode> = {
  Read: <FileText className="size-3.5" />, Glob: <FolderSearch className="size-3.5" />, Grep: <FileSearch className="size-3.5" />,
};

export function AnalysisCard({ run }: { run: RunState }) {
  const a = run.analysis;
  const [showPlan, setShowPlan] = useState(false);
  const items = [
    ...a.tools.map((t) => ({ ts: t.ts, icon: TOOL_ICON[t.tool] ?? <Wrench className="size-3.5" />, label: t.tool, text: t.target, note: false })),
    ...a.notes.map((n) => ({ ts: n.ts, icon: <MessageSquare className="size-3.5" />, label: "", text: n.text, note: true })),
  ].sort((p, q) => (p.ts < q.ts ? -1 : 1));

  return (
    <Card title="Análisis (Opus)" icon={<Brain className="size-4 text-muted" />} status={a.status}
      actions={run.plan.text && (
        <button onClick={() => setShowPlan(!showPlan)} className="text-xs text-accent hover:underline">
          {showPlan ? "ocultar plan" : "ver plan"}
        </button>
      )}>
      <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {a.task && <><dt className="text-muted">Tarea</dt><dd className="break-words">{a.task}</dd></>}
        {a.status === "running" && <><dt className="text-muted">Tiempo</dt><dd>{duration(secondsSince(a.started))}</dd></>}
        {a.duration_ms != null && <><dt className="text-muted">Duración</dt><dd>{duration(a.duration_ms / 1000)}{a.turns ? ` · ${a.turns} turnos` : ""}</dd></>}
      </dl>
      {a.error && <p className="mb-2 text-xs break-words text-fail">{a.error}</p>}
      {showPlan && <pre className="mb-3 max-h-96 overflow-auto rounded-lg bg-panel-2 p-3 font-mono text-xs whitespace-pre-wrap">{run.plan.text}</pre>}
      {items.length ? (
        <ul className="max-h-80 overflow-auto">
          {items.map((i, k) => (
            <li key={k} className="grid grid-cols-[18px_1fr_auto] items-baseline gap-2 border-b border-dashed border-line py-1 text-xs last:border-0">
              <span className="self-center text-muted">{i.icon}</span>
              <span className={cx("break-all", i.note ? "italic text-muted" : "font-mono")}>
                {i.label && <span className="text-muted">{i.label} </span>}{i.text}
              </span>
              <span className="text-muted tabular-nums">{clock(i.ts)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{a.status === "done" ? "Plan creado antes de que existiera el registro: no hay detalle de lecturas." : "Sin actividad todavía."}</Empty>
      )}
    </Card>
  );
}

export function ExecutionCard({ run, selected, onSelect }: { run: RunState; selected: number | null; onSelect: (n: number) => void }) {
  const x = run.exec;
  const total = x.steps.length;
  const done = x.steps.filter((s) => s.status === "done").length;
  return (
    <Card title={`Ejecución (${x.model ?? "modelo local"})`} icon={<Hammer className="size-4 text-muted" />} status={x.status}
      actions={x.branch && <span className="flex items-center gap-1 truncate text-xs text-muted"><GitBranch className="size-3.5" />{x.branch}</span>}>
      {total > 0 ? (
        <>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
            <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${(100 * done) / total}%` }} />
          </div>
          <ul className="flex flex-col gap-1">
            {x.steps.map((s) => (
              <li key={s.n}>
                <button onClick={() => onSelect(s.n)}
                  className={cx("grid w-full grid-cols-[20px_1fr_auto] items-start gap-2 rounded-lg p-2 text-left",
                    s.n === selected ? "bg-panel-2 outline outline-1 outline-accent/70" : "hover:bg-panel-2")}>
                  <StatusIcon status={s.status} className="mt-0.5 size-4" />
                  <div className="min-w-0">
                    <div className="font-medium">{s.n}. {s.title || `Paso ${s.n}`}</div>
                    {s.files.length > 0 && <div className="font-mono text-[11px] break-all text-muted">{s.files.join("  ")}</div>}
                    {s.tokens && (
                      <div className="text-[11px] text-muted tabular-nums">
                        {compact(s.tokens.output)} tokens de salida · {tokS(s.tokens.tok_s)} · {s.tokens.requests} {s.tokens.requests === 1 ? "petición" : "peticiones"}
                      </div>
                    )}
                    {s.commits?.map((c) => (
                      <div key={c} className="flex items-center gap-1 font-mono text-[11px] break-all text-muted">
                        <GitCommitHorizontal className="size-3 shrink-0" />{c}
                      </div>
                    ))}
                  </div>
                  <span className="text-xs whitespace-nowrap text-muted tabular-nums">
                    {s.secs != null ? duration(s.secs) : s.status === "running" ? duration(secondsSince(s.started)) : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : <Empty>El plan no tiene pasos "### Paso N" todavía.</Empty>}
    </Card>
  );
}

export function ReviewCard({ run }: { run: RunState }) {
  const r = run.review;
  return (
    <Card title="Revisión (Opus)" icon={<ScanSearch className="size-4 text-muted" />} status={r.status}>
      {r.text ? <pre className="max-h-96 overflow-auto rounded-lg bg-panel-2 p-3 font-mono text-xs whitespace-pre-wrap">{r.text}</pre>
        : r.status === "running" ? <Empty>Opus está revisando el diff…</Empty>
        : <Empty>Ejecuta <Code>ai review &lt;proyecto&gt;</Code> cuando termine la ejecución.</Empty>}
    </Card>
  );
}

/** Resumen de tokens de la sesión: ejecutor (medidor) y Opus (plan + revisión). */
export function SessionTokensCard({ run }: { run: RunState }) {
  const { executor: x, opus: o } = run.tokens;
  const row = (label: string, value: string) => <><dt className="text-muted">{label}</dt><dd className="text-right tabular-nums">{value}</dd></>;
  return (
    <Card title="Tokens de la sesión" icon={<Coins className="size-4 text-muted" />}>
      {!x && !o ? <Empty>Sin datos de tokens: los planes y ejecuciones anteriores al medidor no los registraron.</Empty> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold">Ejecutor ({run.exec.model ?? "local"})</div>
            {x ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                {row("Peticiones", String(x.requests))}
                {row("Prompt", compact(x.prompt))}
                {row("Salida", compact(x.output))}
                {row("Velocidad", tokS(x.tok_s))}
                {row("Tiempo del modelo", duration(x.total_ms / 1000))}
              </dl>
            ) : <Empty>Sin peticiones medidas.</Empty>}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold">Opus (plan + revisión)</div>
            {o ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                {row("Entrada", compact(o.input_tokens))}
                {row("Salida", compact(o.output_tokens))}
                {row("Caché leída", compact(o.cache_read_tokens))}
                {row("Caché creada", compact(o.cache_creation_tokens))}
                {o.cost_usd != null && row("Coste equivalente API", `$${o.cost_usd.toFixed(2)}`)}
              </dl>
            ) : <Empty>Sin datos de Opus en esta sesión.</Empty>}
          </div>
        </div>
      )}
      {o?.cost_usd != null && <p className="mt-2 text-[11px] text-muted">El coste es lo que costaría por API; con tu suscripción de Claude no se cobra aparte.</p>}
    </Card>
  );
}
