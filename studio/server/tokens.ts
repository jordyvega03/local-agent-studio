// Medidor de tokens (Fase 2): lee lo que escribe `aiwatch.py meter` (logs/tokens.jsonl y
// run/meter-live.json). El Studio solo lee; el medidor lo arranca `ai up`.
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { MeterLive, TokenRecord, TokensState } from "../shared/types.ts";

const TAIL_BYTES = 2 * 1024 * 1024;   // últimas peticiones a mostrar (~miles)
const MAX_RECORDS = 2000;

function tail(path: string): string {
  let fd: number | null = null;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fd = openSync(path, "r");
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;   // descarta la línea cortada
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

let cache: { key: string; recent: TokenRecord[] } | null = null;

export function readTokens(cfg: Config): TokensState {
  const log = join(cfg.aiHome, "logs", "tokens.jsonl");
  let recent: TokenRecord[] = [];
  try {
    const st = statSync(log);
    const key = `${st.size}:${st.mtimeMs}`;
    if (cache?.key === key) recent = cache.recent;
    else {
      recent = tail(log).split("\n").filter(Boolean).flatMap((l) => {
        try { return [JSON.parse(l) as TokenRecord]; } catch { return []; }
      }).slice(-MAX_RECORDS);
      cache = { key, recent };
    }
  } catch { /* sin registro todavía */ }

  let live: MeterLive | null = null;
  try { live = JSON.parse(readFileSync(join(cfg.aiHome, "run", "meter-live.json"), "utf8")); } catch { /* medidor apagado */ }
  const pid = join(cfg.aiHome, "run", "meter.pid");
  let enabled = false;
  if (existsSync(pid)) {
    try { process.kill(Number(readFileSync(pid, "utf8")), 0); enabled = true; } catch { /* pid muerto */ }
  }
  return { enabled, live: enabled ? live : null, recent };
}
