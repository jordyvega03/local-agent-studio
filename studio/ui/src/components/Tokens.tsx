// Vista "Tokens" (Fase 2): lo que mide el medidor entre Aider y Ollama. Medidor en vivo,
// velocidad y tamaño de cada petición, y comparación por modelo y por sesión.
import { Activity, Gauge, Hash, Layers, Radio, Timer, Zap } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { TokenRecord, TokensState } from "../../../shared/types.ts";
import { compact, duration, hhmmss, ms, tokS } from "../format.ts";
import { AXIS, GRID, Legend, timeFormatter, timeTicks } from "./charts.tsx";
import { Card, Code, cx, Empty } from "./ui.tsx";

const RANGES = [
  { key: "1h", label: "Última hora", ms: 3600_000 },
  { key: "24h", label: "24 h", ms: 86400_000 },
  { key: "7d", label: "7 días", ms: 7 * 86400_000 },
  { key: "all", label: "Todo", ms: Infinity },
] as const;

// Máximo 3 modelos con color propio (validados con todos los pares); el resto, "otros".
const MODEL_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const OTHER = "var(--idle)";

const base = (p?: string) => (p ? p.split("/").filter(Boolean).at(-1) ?? p : "");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (rs: TokenRecord[], k: keyof TokenRecord) => rs.reduce((a, r) => a + (Number(r[k]) || 0), 0);
/** Media del tiempo hasta el primer token, ignorando las peticiones que no lo tienen. */
const avgTtft = (rs: TokenRecord[]) => avg(rs.map((r) => r.ttft_ms).filter((v): v is number => v != null));
const speed = (rs: TokenRecord[]) => {
  const evalMs = sum(rs, "eval_ms");
  return evalMs ? sum(rs, "output_tokens") / (evalMs / 1000) : null;
};

function Stat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function LiveCard({ tokens }: { tokens: TokensState }) {
  const live = tokens.live;
  const ctx = live?.context;
  const where = ctx ? [base(ctx.project), ctx.step ? `paso ${ctx.step}` : ctx.agent].filter(Boolean).join(" · ") : "";
  if (!tokens.enabled) {
    return (
      <Card title="Medidor en vivo" icon={<Radio className="size-4 text-muted" />}>
        <Empty>El medidor está apagado. Arráncalo con <Code>ai up</Code> (necesita <Code>TOKEN_METER=1</Code> en config.env).</Empty>
      </Card>
    );
  }
  const active = live?.active;
  const last = live?.last;
  return (
    <Card title="Medidor en vivo" icon={<Radio className={cx("size-4", active ? "text-run" : "text-muted")} />}
      actions={<span className="flex items-center gap-1.5 text-xs text-muted">
        <span className={cx("size-2 rounded-full", active ? "bg-run pulse" : "bg-ok")} />{active ? "generando" : "en espera"}
      </span>}>
      {active ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><div className="text-xs text-muted">Tokens generados</div><div className="text-3xl font-semibold tabular-nums">{live?.tokens ?? 0}</div></div>
          <div><div className="text-xs text-muted">Velocidad</div><div className="text-3xl font-semibold tabular-nums">{live?.tok_s ?? "—"}<span className="text-sm font-normal text-muted"> tok/s</span></div></div>
          <div><div className="text-xs text-muted">Primer token</div><div className="text-xl font-semibold tabular-nums">{ms(live?.ttft_ms)}</div></div>
          <div className="min-w-0"><div className="text-xs text-muted">Modelo · dónde</div><div className="truncate font-mono text-sm">{live?.model}</div><div className="truncate text-xs text-muted">{where}</div></div>
        </div>
      ) : last ? (
        <p className="text-sm text-muted">
          Última respuesta a las {hhmmss(new Date(last.ts).getTime())}: <b className="text-fg">{last.output_tokens ?? 0} tokens</b> a{" "}
          <b className="text-fg">{tokS(last.tok_s)}</b> con {last.model}{last.step ? `, paso ${last.step}` : ""} ({base(last.project)}).
        </p>
      ) : <Empty>Esperando la primera petición del ejecutor. Lanza <Code>ai exec</Code> o <Code>ai chat</Code>.</Empty>}
    </Card>
  );
}

interface Point { t: number; tok_s: number; out: number; r: TokenRecord }

function SpeedChart({ records, colorOf, models }: { records: TokenRecord[]; colorOf: (m: string) => string; models: { name: string; color: string }[] }) {
  const groups = useMemo(() => {
    const g = new Map<string, Point[]>();
    for (const r of records) {
      if (r.tok_s == null) continue;
      const color = colorOf(r.model);
      (g.get(color) ?? g.set(color, []).get(color)!).push({ t: new Date(r.ts).getTime(), tok_s: r.tok_s, out: r.output_tokens ?? 0, r });
    }
    return [...g.entries()];
  }, [records, colorOf]);
  const all = groups.flatMap(([, ps]) => ps).sort((a, b) => a.t - b.t);
  return (
    <Card title="Velocidad de cada respuesta" icon={<Zap className="size-4 text-muted" />} actions={<Legend series={models.map((m) => ({ key: m.name, ...m }))} />}>
      {all.length === 0 ? <Empty>Sin peticiones en este rango.</Empty> : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} ticks={timeTicks(all)} tickFormatter={timeFormatter} {...AXIS} />
              <YAxis dataKey="tok_s" type="number" width={56} tickFormatter={(v) => `${v}`} {...AXIS} axisLine={false}
                label={{ value: "tok/s", angle: -90, position: "insideLeft", fill: "var(--muted)", fontSize: 11 }} />
              <ZAxis range={[64, 64]} />
              <Tooltip cursor={false} isAnimationActive={false} content={(p) => {
                const it = p as unknown as { active?: boolean; payload?: readonly { payload: Point }[] };
                if (!it.active || !it.payload?.length) return null;
                const { r } = it.payload[0].payload;
                return (
                  <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                    <div className="text-muted">{hhmmss(new Date(r.ts).getTime())} · {r.model}</div>
                    <div><b className="text-fg">{tokS(r.tok_s)}</b> <span className="text-muted">· {r.output_tokens} tokens de salida</span></div>
                    <div className="text-muted">primer token {ms(r.ttft_ms)}{r.step ? ` · paso ${r.step}` : ""}{r.project ? ` · ${base(r.project)}` : ""}</div>
                  </div>
                );
              }} />
              {groups.map(([color, pts]) => (
                <Scatter key={color} data={pts} fill={color} stroke="var(--panel)" strokeWidth={2} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function SizeChart({ records }: { records: TokenRecord[] }) {
  const data = records.slice(-40).map((r, i) => ({ i, prompt: r.prompt_tokens ?? 0, output: r.output_tokens ?? 0, r }));
  const series = [
    { key: "prompt", name: "Prompt (entrada)", color: "var(--series-1)" },
    { key: "output", name: "Salida", color: "var(--series-2)" },
  ];
  return (
    <Card title="Tokens por petición (últimas 40)" icon={<Layers className="size-4 text-muted" />} actions={<Legend series={series} />}>
      {data.length === 0 ? <Empty>Sin peticiones en este rango.</Empty> : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }} barCategoryGap={2} maxBarSize={28}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="i" {...AXIS} tick={false} />
              <YAxis width={56} tickFormatter={(v) => compact(v)} {...AXIS} axisLine={false} />
              <Tooltip cursor={{ fill: "var(--panel-2)" }} isAnimationActive={false} content={(p) => {
                const it = p as unknown as { active?: boolean; payload?: readonly { payload: (typeof data)[number] }[] };
                if (!it.active || !it.payload?.length) return null;
                const d = it.payload[0].payload;
                return (
                  <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
                    <div className="mb-1 text-muted">{hhmmss(new Date(d.r.ts).getTime())} · {d.r.model}</div>
                    {series.map((s) => (
                      <div key={s.key} className="flex items-center gap-2">
                        <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                        <b className="text-fg tabular-nums">{(d[s.key as "prompt" | "output"]).toLocaleString()}</b><span className="text-muted">{s.name}</span>
                      </div>
                    ))}
                    {d.r.cached_prompt_tokens ? <div className="text-muted">{d.r.cached_prompt_tokens.toLocaleString()} del prompt ya en caché</div> : null}
                  </div>
                );
              }} />
              {/* Apiladas con 2 px de separación (borde del color del panel) */}
              <Bar dataKey="prompt" stackId="t" fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} isAnimationActive={false} />
              <Bar dataKey="output" stackId="t" fill="var(--series-2)" stroke="var(--panel)" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-left text-muted">
          <tr>{head.map((h, i) => <th key={h} className={cx("pb-1 font-medium whitespace-nowrap", i > 0 && "text-right")}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => <td key={j} className={cx("py-1.5 whitespace-nowrap", j > 0 && "pl-3 text-right")}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TokensView({ tokens }: { tokens: TokensState | null }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("24h");
  const records = useMemo(() => {
    const r = RANGES.find((x) => x.key === range)!;
    const cutoff = Date.now() - r.ms;
    return (tokens?.recent ?? []).filter((x) => new Date(x.ts).getTime() >= cutoff);
  }, [tokens?.recent, range]);

  // Color por modelo: los 3 con más peticiones (en todo el registro, para que no cambie al filtrar).
  const ranking = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of tokens?.recent ?? []) c.set(r.model, (c.get(r.model) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  }, [tokens?.recent]);
  const colorOf = useMemo(() => (m: string) => MODEL_COLORS[ranking.indexOf(m)] ?? OTHER, [ranking]);
  const legend = useMemo(() => {
    const present = [...new Set(records.map((r) => r.model))];
    const named = ranking.slice(0, 3).filter((m) => present.includes(m)).map((m) => ({ name: m, color: colorOf(m) }));
    return present.some((m) => !ranking.slice(0, 3).includes(m)) ? [...named, { name: "otros", color: OTHER }] : named;
  }, [records, ranking, colorOf]);

  const byModel = useMemo(() => {
    const g = new Map<string, TokenRecord[]>();
    for (const r of records) (g.get(r.model) ?? g.set(r.model, []).get(r.model)!).push(r);
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [records]);
  const byRun = useMemo(() => {
    const g = new Map<string, TokenRecord[]>();
    for (const r of records) if (r.run) { const k = `${r.project}|${r.run}`; (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
    return [...g.entries()].sort((a, b) => (a[1].at(-1)!.ts < b[1].at(-1)!.ts ? 1 : -1));
  }, [records]);

  if (!tokens) return <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-muted">Cargando…</div>;
  const ttft = avgTtft(records);

  return (
    <div className="flex flex-col gap-4">
      <LiveCard tokens={tokens} />

      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Rango de tiempo">
        {RANGES.map((r) => (
          <button key={r.key} onClick={() => setRange(r.key)} aria-pressed={range === r.key}
            className={cx("rounded-md border px-2.5 py-1", range === r.key ? "border-accent bg-panel-2 font-semibold text-fg" : "border-line text-muted hover:text-fg")}>
            {r.label}
          </button>
        ))}
        <span className="text-muted">· {records.length} peticiones</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat icon={<Hash className="size-3.5" />} label="Peticiones" value={String(records.length)}
          sub={`${records.filter((r) => r.status !== "ok").length} cortadas o con error`} />
        <Stat icon={<Activity className="size-3.5" />} label="Tokens de salida" value={compact(sum(records, "output_tokens"))} sub="incluye razonamiento" />
        <Stat icon={<Layers className="size-3.5" />} label="Tokens de prompt" value={compact(sum(records, "prompt_tokens"))}
          sub={`${compact(sum(records, "cached_prompt_tokens"))} en caché`} />
        <Stat icon={<Gauge className="size-3.5" />} label="Velocidad media" value={tokS(speed(records))} sub="tokens de salida / tiempo generando" />
        <Stat icon={<Timer className="size-3.5" />} label="Primer token (media)" value={ms(ttft)} sub="desde que Aider pregunta" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SpeedChart records={records} colorOf={colorOf} models={legend} />
        <SizeChart records={records} />
      </div>

      <Card title="Por modelo" icon={<Gauge className="size-4 text-muted" />}>
        {byModel.length === 0 ? <Empty>Sin datos en este rango.</Empty> : (
          <Table head={["Modelo", "Peticiones", "Velocidad", "Primer token", "Prompt medio", "Salida media", "Salida total"]}
            rows={byModel.map(([m, rs]) => [
              <span className="flex items-center gap-2 font-mono"><span className="size-2 rounded-full" style={{ background: colorOf(m) }} />{m}</span>,
              rs.length, tokS(speed(rs)), ms(avgTtft(rs)),
              compact(sum(rs, "prompt_tokens") / rs.length), compact(sum(rs, "output_tokens") / rs.length), compact(sum(rs, "output_tokens")),
            ])} />
        )}
      </Card>

      <Card title="Por sesión (plan)" icon={<Layers className="size-4 text-muted" />}>
        {byRun.length === 0 ? <Empty>Las sesiones aparecen al ejecutar un plan con <Code>ai exec</Code>.</Empty> : (
          <Table head={["Proyecto · plan", "Modelo", "Pasos", "Peticiones", "Salida", "Velocidad", "Tiempo del modelo"]}
            rows={byRun.map(([k, rs]) => [
              <span className="block max-w-[320px] truncate" title={k.split("|")[1]}>{base(rs[0].project)} · <span className="text-muted">{rs[0].run}</span></span>,
              <span className="font-mono">{[...new Set(rs.map((r) => r.model))].join(", ")}</span>,
              new Set(rs.map((r) => r.step).filter((s) => s != null)).size || "—",
              rs.length, compact(sum(rs, "output_tokens")), tokS(speed(rs)), duration(sum(rs, "total_ms") / 1000),
            ])} />
        )}
      </Card>

      <Card title="Últimas peticiones" icon={<Activity className="size-4 text-muted" />}>
        {records.length === 0 ? <Empty>Sin datos en este rango.</Empty> : (
          <Table head={["Hora", "Dónde", "Modelo", "Prompt", "Salida", "Velocidad", "Primer token", "Estado"]}
            rows={records.slice(-25).reverse().map((r) => [
              hhmmss(new Date(r.ts).getTime()),
              <span className="text-muted">{[base(r.project), r.step ? `paso ${r.step}` : r.agent].filter(Boolean).join(" · ") || "—"}</span>,
              <span className="font-mono">{r.model}</span>,
              compact(r.prompt_tokens), compact(r.output_tokens), tokS(r.tok_s), ms(r.ttft_ms),
              r.status === "ok" ? "ok" : <span className="text-fail">{r.status}</span>,
            ])} />
        )}
      </Card>
    </div>
  );
}
