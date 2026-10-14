import type { Status } from "../../shared/types.ts";

export const STATUS_LABEL: Record<Status, string> = {
  pending: "pendiente", running: "en curso", done: "hecho", failed: "falló", aborted: "interrumpido",
};

export function duration(secs: number | null | undefined): string {
  if (secs == null || Number.isNaN(secs)) return "";
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const secondsSince = (iso?: string) => (iso ? (Date.now() - new Date(iso).getTime()) / 1000 : null);

export function ago(epochSecs: number): string {
  if (!epochSecs) return "";
  const s = Date.now() / 1000 - epochSecs;
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(epochSecs * 1000).toLocaleDateString();
}

export const clock = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

export const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/** Bytes en GB binarios, como los muestra macOS (24 GB = 24 × 1024³). */
export function bytes(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  const gib = n / 1024 ** 3;
  return gib >= 1 ? `${gib.toFixed(digits)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);

export const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const hhmmss = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
