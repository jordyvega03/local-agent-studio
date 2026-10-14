// Piezas comunes de las gráficas (guía dataviz): líneas de 2 px, rejilla discreta, cursor
// vertical con tooltip que lista todas las series (valor primero, nombre después), etiqueta
// directa al final de cada línea y una vista de tabla para no depender del hover.
import type { ReactNode } from "react";
import type { MetricSample } from "../../../shared/types.ts";
import { hhmm, hhmmss } from "../format.ts";

export interface Series {
  key: string;
  name: string;
  color: string;                         // var(--series-N)
  value: (s: MetricSample) => number | null;
  format: (v: number) => string;
}

export const AXIS = { stroke: "var(--line)", tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false };
export const GRID = { stroke: "var(--grid)", strokeDasharray: "0", vertical: false };

/** Ticks de tiempo redondos, entre 3 y 6 según lo que abarquen los datos (no la ventana pedida). */
export function timeTicks(data: { t: number }[]): number[] {
  if (data.length < 2) return [];
  const [a, b] = [data[0].t, data[data.length - 1].t];
  const steps = [10, 15, 30, 60, 120, 300, 600].map((s) => s * 1000);
  const step = steps.find((s) => (b - a) / s <= 6) ?? steps[steps.length - 1];
  const out: number[] = [];
  for (let t = Math.ceil(a / step) * step; t <= b; t += step) out.push(t);
  return out;
}

/** hh:mm, o hh:mm:ss si los ticks van por segundos. */
export const timeFormatter = (t: number) => (t % 60_000 === 0 ? hhmm(t) : hhmmss(t));

interface TooltipProps {
  active?: boolean;
  label?: number;
  payload?: { dataKey?: string | number; value?: number | null }[];
  series: Series[];
}

export function ChartTooltip({ active, label, payload, series }: TooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 text-muted tabular-nums">{hhmmss(label)}</div>
      {series.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
            <b className="font-semibold text-fg tabular-nums">{v == null ? "—" : s.format(v)}</b>
            <span className="text-muted">{s.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Etiqueta directa en el último punto de una línea (texto en tinta normal, no del color de la serie).
 *  above=false la pone debajo: con dos series, la de valor más bajo va debajo y no se pisan. */
export function endLabel(name: string, lastIndex: number, color: string, above = true) {
  return function EndLabel(props: { x?: number | string; y?: number | string; index?: number }) {
    if (props.index !== lastIndex || props.x == null || props.y == null) return null;
    const x = Number(props.x), y = Number(props.y);
    return (
      <g>
        <circle cx={x} cy={y} r={4} fill={color} stroke="var(--panel)" strokeWidth={2} />
        <text x={x - 8} y={above ? y - 9 : y + 16} textAnchor="end" fontSize={11} fill="var(--muted)">{name}</text>
      </g>
    );
  };
}

export function Legend({ series }: { series: Pick<Series, "key" | "name" | "color">[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />{s.name}
        </span>
      ))}
    </div>
  );
}

/** Media por minuto de cada serie: la vista accesible de una gráfica temporal. */
export function SeriesTable({ data, series }: { data: MetricSample[]; series: Series[] }) {
  const buckets = new Map<number, MetricSample[]>();
  for (const s of data) {
    const k = Math.floor(s.t / 60_000) * 60_000;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(s);
  }
  const rows = [...buckets.entries()].sort((a, b) => b[0] - a[0]);
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0 bg-panel text-left text-muted">
          <tr><th className="py-1 font-medium">Minuto</th>{series.map((s) => <th key={s.key} className="py-1 text-right font-medium">{s.name} (media)</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(([t, ss]) => (
            <tr key={t} className="border-t border-line">
              <td className="py-1">{hhmm(t)}</td>
              {series.map((s) => {
                const vals = ss.map(s.value).filter((v): v is number => v != null);
                return <td key={s.key} className="py-1 text-right">{vals.length ? s.format(vals.reduce((a, b) => a + b, 0) / vals.length) : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): ReactNode {
  return (
    <button onClick={() => onChange(!on)} className="text-xs text-accent hover:underline" aria-pressed={on}>
      {on ? "ver gráfica" : "ver tabla"}
    </button>
  );
}
