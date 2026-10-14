// Salida grabada de un paso de Aider, con xterm.js (colores y redibujados como en tu terminal).
// En la Fase 3 este mismo componente mostrará la terminal en vivo de los comandos lanzados desde la web.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { SquareTerminal } from "lucide-react";
import { THEME_EVENT, termBackground } from "../theme.ts";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Status } from "../../../shared/types.ts";
import { Card } from "./ui.tsx";

export interface TerminalHandle { write: (reset: boolean, bytes: Uint8Array) => void }

export function TerminalCard({ ref, step, status, following }: {
  ref: Ref<TerminalHandle>; step: number | null; status?: Status; following: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const empty = useRef(true);
  // useImperativeHandle se expone antes de que el efecto cree xterm: lo que llegue antes, en cola.
  const queue = useRef<{ reset: boolean; bytes: Uint8Array }[]>([]);

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const t = new XTerm({
      convertEol: true,            // los logs sin TTY (tee) solo traen \n
      disableStdin: true,          // Fase 0: solo lectura
      scrollback: 10000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: { background: css.getPropertyValue("--term").trim() || "#05080c" },
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(box.current!);
    fit.fit();
    const ro = new ResizeObserver(() => fit.fit());
    const onTheme = () => { t.options.theme = { ...t.options.theme, background: termBackground() }; };
    window.addEventListener(THEME_EVENT, onTheme);
    ro.observe(box.current!);
    term.current = t;
    for (const q of queue.current) write(t, q.reset, q.bytes);
    queue.current = [];
    return () => { ro.disconnect(); window.removeEventListener(THEME_EVENT, onTheme); t.dispose(); term.current = null; };
  }, []);

  const write = (t: XTerm, reset: boolean, bytes: Uint8Array) => {
    if (reset) { t.reset(); empty.current = true; }
    if (bytes.length) { t.write(bytes); empty.current = false; }
    else if (reset) t.write("\x1b[2mSin salida para este paso todavía.\x1b[0m");
  };

  useImperativeHandle(ref, () => ({
    write(reset, bytes) {
      if (term.current) write(term.current, reset, bytes);
      else {
        if (reset) queue.current = [];
        queue.current.push({ reset, bytes });
      }
    },
  }), []);

  return (
    <Card title={step ? `Salida del paso ${step}` : "Salida"} icon={<SquareTerminal className="size-4 text-muted" />} status={status}
      actions={<span className="text-xs text-muted">Aider · {following ? "sigue al paso actual" : "fijado"}</span>}
      bodyClassName="p-0">
      <div ref={box} className="h-[460px] overflow-hidden rounded-b-xl bg-term max-lg:h-[340px]" />
    </Card>
  );
}
