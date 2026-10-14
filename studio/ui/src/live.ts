// Cliente del canal en vivo (/ws): reconexión automática y suscripción al plan elegido.
import { useEffect, useRef, useState } from "react";
import type { MetricSample, MetricsNow, Project, RunState, ServerMessage, SystemState } from "../../shared/types.ts";

export type LogHandler = (step: number, reset: boolean, bytes: Uint8Array) => void;

export interface LiveState {
  connected: boolean;
  projects: Project[] | null;
  system: SystemState | null;
  run: RunState | null;
  error: string | null;
  metrics: MetricsNow | null;
  history: MetricSample[];       // histórico de métricas (ventana del servidor)
}

interface Selection { project: string; run: string; step: number | null }

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function useLive(sel: Selection, onLog: LogHandler) {
  const [state, setState] = useState<LiveState>({
    connected: false, projects: null, system: null, run: null, error: null, metrics: null, history: [],
  });
  const ws = useRef<WebSocket | null>(null);
  const selRef = useRef(sel);
  const logRef = useRef(onLog);
  selRef.current = sel;
  logRef.current = onLog;

  const subscribe = () => {
    const s = selRef.current;
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "subscribe", project: s.project, run: s.run, step: s.step }));
    }
  };

  useEffect(() => {
    let closed = false;
    let retry = 500;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.current = sock;
      sock.onopen = () => {
        retry = 500;
        setState((st) => ({ ...st, connected: true, error: null }));
        subscribe();
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data) as ServerMessage;
        if (m.type === "log") logRef.current(m.step, m.reset, decode(m.chunk));
        else if (m.type === "projects") setState((st) => ({ ...st, projects: m.data }));
        else if (m.type === "system") setState((st) => ({ ...st, system: m.data }));
        else if (m.type === "run") setState((st) => ({ ...st, run: m.data }));
        else if (m.type === "error") setState((st) => ({ ...st, error: m.message }));
        else if (m.type === "metrics_history") setState((st) => ({ ...st, history: m.data }));
        else if (m.type === "metrics") {
          setState((st) => {
            const cutoff = m.data.sample.t - m.data.windowMin * 60_000;
            const history = st.history.filter((s) => s.t > cutoff);
            history.push(m.data.sample);
            return { ...st, metrics: m.data, history };
          });
        }
      };
      sock.onclose = () => {
        setState((st) => ({ ...st, connected: false }));
        if (!closed) timer = setTimeout(connect, (retry = Math.min(retry * 2, 8000)));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, []);

  // Al cambiar de proyecto, plan o paso: nueva suscripción y se descarta el estado anterior.
  useEffect(() => {
    setState((st) => (st.run?.name === sel.run ? st : { ...st, run: null }));
    subscribe();
  }, [sel.project, sel.run, sel.step]);

  return state;
}
