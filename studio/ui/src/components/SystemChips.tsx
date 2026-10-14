import { Boxes, Cpu, MemoryStick, Wifi, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { SystemState } from "../../../shared/types.ts";
import { gb } from "../format.ts";
import { cx } from "./ui.tsx";

function Chip({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-0.5 text-xs whitespace-nowrap text-muted">
      {icon}{label}
      <b className={cx("font-semibold", tone === "bad" ? "text-fail" : tone === "warn" ? "text-run" : "text-fg")}>{value}</b>
    </span>
  );
}

export function SystemChips({ system, connected }: { system: SystemState | null; connected: boolean }) {
  const chips: ReactNode[] = [
    <Chip key="ws" icon={connected ? <Wifi className="size-3.5 text-ok" /> : <WifiOff className="size-3.5 text-fail" />}
      label="" value={connected ? "en vivo" : "sin conexión"} tone={connected ? undefined : "bad"} />,
  ];
  if (system) {
    const m = system.models.find((x) => x.name === system.executor || x.name === `${system.executor}:latest`) ?? system.models[0];
    chips.push(system.ollama !== "up"
      ? <Chip key="m" icon={<Cpu className="size-3.5" />} label="Ollama" value="detenido" tone="bad" />
      : m ? <Chip key="m" icon={<Cpu className="size-3.5" />} label={m.name} value={`${m.gpu}% GPU · ${gb(m.size)}`} tone={m.gpu < 100 ? "warn" : undefined} />
      : <Chip key="m" icon={<Cpu className="size-3.5" />} label={system.executor} value="no cargado" />);
    if (system.mem_free != null) {
      chips.push(<Chip key="r" icon={<MemoryStick className="size-3.5" />} label="RAM libre" value={`${system.mem_free}%`}
        tone={system.mem_free < 15 ? "bad" : system.mem_free < 25 ? "warn" : undefined} />);
    }
    chips.push(<Chip key="d" icon={<Boxes className="size-3.5" />} label={system.docker === "up" ? "Contenedores" : "Docker"}
      value={system.docker === "up" ? String(system.containers.length) : "detenido"} />);
  }
  return <div className="flex flex-wrap gap-1.5">{chips}</div>;
}
