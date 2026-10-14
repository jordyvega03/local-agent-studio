// Métricas en tiempo real del Mac (Fase 1, docs/PLAN-STUDIO.md). Sin sudo ni dependencias:
//  - CPU: os.cpus() (diferencia de tiempos entre muestras)
//  - RAM/presión/swap: vm_stat + sysctl kern.memorystatus_level vm.swapusage
//  - GPU: ioreg (IOAccelerator: "Device Utilization %", "In use system memory")
//  - procesos: ps (agrupados por Ollama, Docker, Claude Code, AI Studio)
//  - contenedores del agente: docker stats
// Una sola lectura por segundo para todos los clientes; histórico en memoria.
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { cpus, totalmem } from "node:os";
import type { Config } from "./config.ts";
import type { ContainerStat, MetricSample, MetricsNow, ProcGroup } from "../shared/types.ts";

function run(cmd: string, args: string[], timeout = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// --- Parsers (exportados para los tests) ---------------------------------------
export function parseVmStat(text: string): number | null {
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const get = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1] ?? NaN);
  const pages = get("Pages active") + get("Pages wired down") + get("Pages occupied by compressor");
  return page && Number.isFinite(pages) ? pages * page : null;
}

/** "total = 7168.00M  used = 6676.62M  free = 491.38M" -> bytes */
export function parseSwap(text: string): { used: number; total: number } {
  const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 } as Record<string, number>;
  const val = (k: string) => {
    const m = new RegExp(`${k} = ([\\d.]+)([KMG])`).exec(text);
    return m ? Number(m[1]) * unit[m[2]] : 0;
  };
  return { used: val("used"), total: val("total") };
}

export function parseIoreg(text: string): { gpu: number | null; gpuMem: number | null } {
  const num = (k: string) => {
    const m = new RegExp(`"${k}"=(\\d+)`).exec(text);
    return m ? Number(m[1]) : null;
  };
  return { gpu: num("Device Utilization %"), gpuMem: num("In use system memory") };
}

const GROUPS: [string, RegExp][] = [
  ["Ollama", /ollama|llama-server/i],
  ["Docker (VM)", /com\.apple\.Virtualization\.VirtualMachine|com\.docker\.|Docker Desktop/i],
  ["Claude Code", /(^|\/)claude$/i],
];

export function parsePs(text: string, selfPid: number): ProcGroup[] {
  const groups = new Map<string, ProcGroup>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    const [pid, cpu, rssKb, comm] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
    const name = pid === selfPid ? "AI Studio" : GROUPS.find(([, re]) => re.test(comm))?.[0];
    if (!name) continue;
    const g = groups.get(name) ?? { name, cpu: 0, rss: 0, count: 0 };
    g.cpu += cpu; g.rss += rssKb * 1024; g.count++;
    groups.set(name, g);
  }
  return [...groups.values()].map((g) => ({ ...g, cpu: Math.round(g.cpu * 10) / 10 }))
    .sort((a, b) => b.rss - a.rss);
}

/** "512.3MiB / 2GiB" -> [bytes usados, límite] */
export function parseDockerMem(text: string): [number, number] {
  const unit: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, kB: 1e3, MB: 1e6, GB: 1e9 };
  const parts = text.split("/").map((p) => /([\d.]+)\s*([A-Za-z]+)/.exec(p.trim()));
  const b = (m: RegExpExecArray | null) => (m ? Number(m[1]) * (unit[m[2]] ?? 1) : 0);
  return [b(parts[0]), b(parts[1] ?? null)];
}

// --- Recolector ----------------------------------------------------------------
type CpuTimes = { idle: number; total: number }[];
const readCpu = (): CpuTimes => cpus().map((c) => {
  const t = c.times;
  return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
});

export class Metrics extends EventEmitter {
  private history: MetricSample[] = [];
  private prevCpu = readCpu();
  private procs: ProcGroup[] = [];
  private containers: ContainerStat[] = [];
  private ticks = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly maxSamples: number;
  private readonly cfg: Config;

  constructor(cfg: Config) {
    super();
    this.cfg = cfg;
    this.maxSamples = Math.ceil((cfg.metricsWindowMin * 60_000) / cfg.metricsIntervalMs);
    this.setMaxListeners(100);
  }

  start() {
    this.timer ??= setInterval(() => void this.tick(), this.cfg.metricsIntervalMs);
    void this.tick();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  snapshot(): MetricSample[] { return this.history.slice(); }

  private async tick() {
    if (this.busy) return;               // una lectura lenta no se solapa con la siguiente
    this.busy = true;
    try {
      const now = readCpu();
      const cores = now.map((c, i) => {
        const p = this.prevCpu[i];
        const total = c.total - (p?.total ?? 0);
        return total > 0 ? Math.round(1000 * (1 - (c.idle - (p?.idle ?? 0)) / total)) / 10 : 0;
      });
      this.prevCpu = now;
      const cpu = Math.round((10 * cores.reduce((a, b) => a + b, 0)) / Math.max(cores.length, 1)) / 10;

      // Procesos cada 2 lecturas y contenedores cada 3: son más caros y cambian menos.
      const slow: Promise<void>[] = [];
      if (this.ticks % 2 === 0) slow.push(this.readProcs());
      if (this.ticks % 3 === 0) slow.push(this.readContainers());
      this.ticks++;

      const [vm, sys, io] = await Promise.all([
        run("vm_stat", []),
        run("sysctl", ["-n", "kern.memorystatus_level", "vm.swapusage"]),
        run("ioreg", ["-r", "-c", "IOAccelerator", "-d", "1"]),
      ]);
      await Promise.all(slow);
      const [level = "", swapLine = ""] = (sys ?? "").split("\n");
      const swap = parseSwap(swapLine);
      const { gpu, gpuMem } = parseIoreg(io ?? "");
      const sample: MetricSample = {
        t: Date.now(), cpu, gpu,
        memUsed: parseVmStat(vm ?? "") ?? 0,
        memFreePct: level.trim() ? Number(level) : null,
        swapUsed: swap.used,
      };
      this.history.push(sample);
      if (this.history.length > this.maxSamples) this.history.splice(0, this.history.length - this.maxSamples);

      const data: MetricsNow = {
        sample, cores, memTotal: totalmem(), swapTotal: swap.total, gpuMem,
        procs: this.procs, containers: this.containers, windowMin: this.cfg.metricsWindowMin,
        alertMemFree: this.cfg.alertMemFree,
      };
      this.emit("sample", data);
    } finally {
      this.busy = false;
    }
  }

  private async readProcs() {
    const out = await run("ps", ["-A", "-o", "pid=,%cpu=,rss=,comm="]);
    if (out != null) this.procs = parsePs(out, process.pid);
  }

  private async readContainers() {
    const names = await run("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${this.cfg.composeProject}`]);
    const ids = (names ?? "").split("\n").filter(Boolean);
    if (!ids.length) { this.containers = []; return; }
    const out = await run("docker", ["stats", "--no-stream", "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}", ...ids], 5000);
    this.containers = (out ?? "").split("\n").filter(Boolean).map((l) => {
      const [name, cpu = "0", mem = ""] = l.split("\t");
      const [used, limit] = parseDockerMem(mem);
      return { name, cpu: Number.parseFloat(cpu) || 0, mem: used, limit };
    });
  }
}
