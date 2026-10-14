// Vista "Sistema" (Fase 1): CPU, GPU, memoria y swap del Mac en tiempo real, procesos del
// agente, contenedores y modelo cargado. Datos: metrics.ts en el servidor, 1 muestra/s.
import { AlertTriangle, Boxes, Cpu, Gauge, HardDrive, MemoryStick, MonitorCog } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis } from "recharts";
import type { MetricSample, MetricsNow, SystemState } from "../../../shared/types.ts";
import { bytes, pct } from "../format.ts";
import { AXIS, ChartTooltip, endLabel, GRID, Legend, SeriesTable, TableToggle, timeFormatter, timeTicks,
  type Series } from "./charts.tsx";
import { Card, cx, Empty } from "./ui.tsx";

const RANGES = [1, 5, 15] as const;

// --- Avisos --------------------------------------------------------------------
function alerts(m: MetricsNow, system: SystemState | null): { level: "warn" | "bad"; text: string }[] {
  const out: { level: "warn" | "bad"; text: string }[] = [];
  const free = m.sample.memFreePct;
  if (free != null && free < m.alertMemFree) {
    out.push({ level: "bad", text: `Memoria libre al ${free}% (aviso por debajo del ${m.alertMemFree}%). Cierra apps o baja OLLAMA_CONTEXT_LENGTH.` });
  }
  if (m.swapTotal > 0 && m.sample.swapUsed / m.swapTotal > 0.8) {
    out.push({ level: "warn", text: `Swap al ${pct((100 * m.sample.swapUsed) / m.swapTotal)} (${bytes(m.sample.swapUsed)} de ${bytes(m.swapTotal)}): el Mac está moviendo memoria a disco y todo irá más lento.` });
  }
  for (const c of m.containers) {
    if (c.limit && c.mem / c.limit > 0.9) out.push({ level: "warn", text: `El contenedor ${c.name} usa ${bytes(c.mem)} de ${bytes(c.limit)}.` });
  }
  const model = system?.models[0];
  if (model && model.gpu < 100) out.push({ level: "warn", text: `${model.name} solo está al ${model.gpu}% en GPU: parte corre en CPU y va más lento.` });
  return out;
}

function Alerts({ items }: { items: ReturnType<typeof alerts> }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2" role="status">
      {items.map((a) => (
        <p key={a.text} className={cx("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
          a.level === "bad" ? "border-fail bg-fail-bg" : "border-run bg-run-bg")}>
          <AlertTriangle className={cx("mt-0.5 size-4 shrink-0", a.level === "bad" ? "text-fail" : "text-run")} aria-label="aviso" />
          <span className="text-fg">{a.text}</span>
        </p>
      ))}
    </div>
  );
}

// --- Tarjetas de cifra con mini-gráfica ---------------------------------------
function Sparkline({ data, value, color, max }: { data: MetricSample[]; value: (s: MetricSample) => number | null; color: string; max?: number }) {
  const points = data.map((s) => ({ t: s.t, v: value(s) }));
  return (
    <div className="h-10" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={[0, max ?? "auto"]} />
          <Line dataKey="v" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatTile({ icon, label, value, sub, children }: { icon: ReactNode; label: string; value: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
      {children}
    </div>
  );
}

// --- Gráficas grandes ----------------------------------------------------------
function TimeChart({ title, icon, data, series, yDomain, yFormat, reference, area }: {
  title: string; icon: ReactNode; data: MetricSample[]; series: Series[];
  yDomain: [number, number | "auto"]; yFormat: (v: number) => string;
  reference?: { y: number; label: string }; area?: boolean;
}) {
  const [table, setTable] = useState(false);
  const rows = useMemo(() => data.map((s) => {
    const r: Record<string, number | null> = { t: s.t };
    for (const ser of series) r[ser.key] = ser.value(s);
    return r;
  }), [data, series]);
  const last = rows.length - 1;
  const ticks = timeTicks(data);
  // La serie con el último valor más alto lleva la etiqueta encima; el resto, debajo.
  const lastVals = series.map((s) => (last >= 0 ? (rows[last][s.key] ?? -1) : -1));
  const top = lastVals.indexOf(Math.max(...lastVals));
  const tooltip = <Tooltip cursor={{ stroke: "var(--muted)", strokeWidth: 1 }} isAnimationActive={false}
    content={(p) => <ChartTooltip {...(p as object)} series={series} />} />;
  const common = (
    <>
      <CartesianGrid {...GRID} />
      <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} ticks={ticks} tickFormatter={timeFormatter} {...AXIS} />
      <YAxis domain={yDomain} tickFormatter={yFormat} width={52} {...AXIS} axisLine={false} />
      {tooltip}
      {reference && <ReferenceLine y={reference.y} stroke="var(--muted)" strokeDasharray="4 4"
        label={{ value: reference.label, position: "insideTopLeft", fill: "var(--muted)", fontSize: 11 }} />}
    </>
  );

  return (
    <Card title={title} icon={icon} actions={<div className="flex items-center gap-4">{series.length > 1 && <Legend series={series} />}<TableToggle on={table} onChange={setTable} /></div>}>
      {table ? <SeriesTable data={data} series={series} /> : data.length < 2 ? <Empty>Recogiendo datos…</Empty> : (
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            {area ? (
              <AreaChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
                {common}
                {series.map((s) => (
                  <Area key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.12}
                    isAnimationActive={false} connectNulls dot={false} activeDot={{ r: 4, stroke: "var(--panel)", strokeWidth: 2 }} />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
                {common}
                {series.map((s) => (
                  <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false}
                    label={series.length > 1 ? endLabel(s.name, last, s.color, series.indexOf(s) === top) : undefined}
                    isAnimationActive={false} connectNulls activeDot={{ r: 4, stroke: "var(--panel)", strokeWidth: 2 }} />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function CoresChart({ cores }: { cores: number[] }) {
  const data = cores.map((v, i) => ({ core: `${i + 1}`, v }));
  return (
    <Card title={`Núcleos de CPU (${cores.length})`} icon={<Cpu className="size-4 text-muted" />}>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="core" {...AXIS} interval={0} />
            <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} width={40} {...AXIS} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--panel-2)" }} isAnimationActive={false}
              content={(p) => {
                const it = p as unknown as { active?: boolean; payload?: readonly { payload: { core: string; v: number } }[] };
                if (!it.active || !it.payload?.length) return null;
                const d = it.payload[0].payload;
                return <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg"><b className="text-fg">{pct(d.v)}</b> <span className="text-muted">núcleo {d.core}</span></div>;
              }} />
            <Bar dataKey="v" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Meter({ value, max, tone }: { value: number; max: number; tone?: "warn" | "bad" }) {
  const w = max > 0 ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={cx("h-full rounded-full", tone === "bad" ? "bg-fail" : tone === "warn" ? "bg-run" : "bg-series-1")} style={{ width: `${w}%` }} />
    </div>
  );
}

function ProcessesCard({ m }: { m: MetricsNow }) {
  return (
    <Card title="Procesos del agente" icon={<MonitorCog className="size-4 text-muted" />}>
      {m.procs.length === 0 ? <Empty>No se ven procesos de Ollama, Docker ni Claude Code.</Empty> : (
        <table className="w-full text-xs tabular-nums">
          <thead className="text-left text-muted">
            <tr><th className="pb-1 font-medium">Proceso</th><th className="pb-1 text-right font-medium">CPU</th><th className="pb-1 pl-4 font-medium">RAM</th></tr>
          </thead>
          <tbody>
            {m.procs.map((p) => (
              <tr key={p.name} className="border-t border-line">
                <td className="py-1.5">{p.name}{p.count > 1 && <span className="text-muted"> ×{p.count}</span>}</td>
                <td className="py-1.5 text-right">{p.cpu.toFixed(1)}%</td>
                <td className="py-1.5 pl-4">
                  <div className="flex items-center gap-2"><span className="w-16 shrink-0">{bytes(p.rss)}</span><Meter value={p.rss} max={m.memTotal} /></div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-[11px] text-muted">CPU en % de un núcleo, como el Monitor de Actividad. La memoria del modelo en GPU cuenta como "wired" y no siempre aparece en el proceso.</p>
    </Card>
  );
}

function ContainersCard({ m }: { m: MetricsNow }) {
  return (
    <Card title="Contenedores del agente" icon={<Boxes className="size-4 text-muted" />}>
      {m.containers.length === 0 ? <Empty>Ningún contenedor de Aider en marcha. Aparecen mientras corre ai exec.</Empty> : (
        <ul className="flex flex-col gap-3">
          {m.containers.map((c) => {
            const ratio = c.limit ? c.mem / c.limit : 0;
            return (
              <li key={c.name} className="text-xs">
                <div className="mb-1 flex justify-between gap-2"><span className="truncate font-mono">{c.name}</span><span className="text-muted tabular-nums">CPU {c.cpu.toFixed(1)}%</span></div>
                <Meter value={c.mem} max={c.limit} tone={ratio > 0.9 ? "bad" : ratio > 0.75 ? "warn" : undefined} />
                <div className="mt-0.5 text-muted tabular-nums">{bytes(c.mem)} de {bytes(c.limit)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ModelCard({ system, m }: { system: SystemState | null; m: MetricsNow }) {
  const model = system?.models[0];
  return (
    <Card title="Modelo en Ollama" icon={<Gauge className="size-4 text-muted" />}>
      {!system ? <Empty>Cargando…</Empty> : system.ollama !== "up" ? <Empty>Ollama está detenido. Arráncalo con ai up.</Empty>
        : !model ? <Empty>{system.executor} no está cargado en memoria (se carga al primer uso).</Empty> : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Modelo</dt><dd className="font-mono">{model.name}</dd>
            <dt className="text-muted">Memoria</dt><dd>{bytes(model.size)} · {model.gpu}% en GPU</dd>
            {model.context && <><dt className="text-muted">Contexto</dt><dd>{model.context.toLocaleString()} tokens</dd></>}
            {m.gpuMem != null && <><dt className="text-muted">GPU (sistema)</dt><dd>{bytes(m.gpuMem)} en uso</dd></>}
            {model.until && <><dt className="text-muted">Se descarga</dt><dd>{new Date(model.until).toLocaleTimeString()}</dd></>}
          </dl>
        )}
    </Card>
  );
}

// --- Vista ----------------------------------------------------------------------
export function SystemView({ metrics: m, history, system }: { metrics: MetricsNow | null; history: MetricSample[]; system: SystemState | null }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(5);
  const data = useMemo(() => {
    const cutoff = (history.at(-1)?.t ?? 0) - range * 60_000;
    return history.filter((s) => s.t >= cutoff);
  }, [history, range]);

  const cpuGpu: Series[] = useMemo(() => [
    { key: "cpu", name: "CPU", color: "var(--series-1)", value: (s) => s.cpu, format: (v) => `${v.toFixed(0)}%` },
    { key: "gpu", name: "GPU", color: "var(--series-2)", value: (s) => s.gpu, format: (v) => `${v.toFixed(0)}%` },
  ], []);
  const mem: Series[] = useMemo(() => [
    { key: "mem", name: "Memoria en uso", color: "var(--series-1)", value: (s) => s.memUsed / 1024 ** 3, format: (v) => `${v.toFixed(1)} GB` },
  ], []);

  if (!m) return <div className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-muted">Esperando la primera medición…</div>;
  const s = m.sample;
  const swapPct = m.swapTotal ? (100 * s.swapUsed) / m.swapTotal : 0;

  return (
    <div className="flex flex-col gap-4">
      <Alerts items={alerts(m, system)} />

      {/* Filtro de rango: una fila, encima de todo lo que afecta */}
      <div className="flex items-center gap-2 text-xs" role="group" aria-label="Rango de tiempo">
        <span className="text-muted">Últimos</span>
        {RANGES.filter((r) => r <= m.windowMin).map((r) => (
          <button key={r} onClick={() => setRange(r)} aria-pressed={range === r}
            className={cx("rounded-md border px-2.5 py-1", range === r ? "border-accent bg-panel-2 font-semibold text-fg" : "border-line text-muted hover:text-fg")}>
            {r} min
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<Cpu className="size-3.5" />} label="CPU" value={pct(s.cpu)} sub={`${m.cores.length} núcleos`}>
          <Sparkline data={data} value={(x) => x.cpu} color="var(--series-1)" max={100} />
        </StatTile>
        <StatTile icon={<Gauge className="size-3.5" />} label="GPU" value={pct(s.gpu)} sub={m.gpuMem != null ? `${bytes(m.gpuMem)} en uso` : undefined}>
          <Sparkline data={data} value={(x) => x.gpu} color="var(--series-2)" max={100} />
        </StatTile>
        <StatTile icon={<MemoryStick className="size-3.5" />} label="Memoria" value={bytes(s.memUsed)}
          sub={<>de {bytes(m.memTotal, 0)} · <span className={cx(s.memFreePct != null && s.memFreePct < m.alertMemFree && "font-semibold text-fail")}>{pct(s.memFreePct)} libre</span></>}>
          <Sparkline data={data} value={(x) => x.memUsed} color="var(--series-1)" max={m.memTotal} />
        </StatTile>
        <StatTile icon={<HardDrive className="size-3.5" />} label="Swap" value={bytes(s.swapUsed)}
          sub={m.swapTotal ? `de ${bytes(m.swapTotal)} (${pct(swapPct)})` : "sin swap"}>
          <Sparkline data={data} value={(x) => x.swapUsed} color="var(--series-1)" max={m.swapTotal || undefined} />
        </StatTile>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TimeChart title="CPU y GPU" icon={<Cpu className="size-4 text-muted" />} data={data} series={cpuGpu}
          yDomain={[0, 100]} yFormat={(v) => `${v}%`} />
        <TimeChart title="Memoria en uso" icon={<MemoryStick className="size-4 text-muted" />} data={data} series={mem}
          yDomain={[0, Math.ceil(m.memTotal / 1024 ** 3)]} yFormat={(v) => `${v} GB`} area
          reference={{ y: m.memTotal / 1024 ** 3, label: `total ${bytes(m.memTotal, 0)}` }} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <div className="lg:col-span-2"><CoresChart cores={m.cores} /></div>
        <ModelCard system={system} m={m} />
        <ContainersCard m={m} />
      </div>
      <ProcessesCard m={m} />
    </div>
  );
}
