import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "./config.ts";
import { Jobs } from "./jobs.ts";
import type { BuiltAction } from "./actions.ts";

// bin/ai falso: "eco" imprime sus argumentos; "pregunta" espera una respuesta; "lento" duerme.
const FAKE_AI = `#!/bin/bash
case "$1" in
  eco) echo "args:$*"; tty >/dev/null && echo "con-tty" ;;
  pregunta) read -r -p "¿Continuar? [s/N] " r; echo "respuesta:$r" ;;
  lento) trap 'echo interrumpido; exit 130' INT; echo listo; sleep 30 & wait ;;
  falla) exit 3 ;;
esac
`;

let home: string;
let jobs: Jobs;

const action = (argv: string[], interactive = false): BuiltAction => ({ action: "plan", argv, label: argv[0], interactive });
const until = async (cond: () => boolean, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};
const output = (id: string) => jobs.replay(id)?.toString("utf8") ?? "";
const status = (id: string) => jobs.list().find((j) => j.id === id)?.status;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "studio-jobs-"));
  mkdirSync(join(home, "bin"));
  mkdirSync(join(home, "logs"));
  writeFileSync(join(home, "bin/ai"), FAKE_AI);
  chmodSync(join(home, "bin/ai"), 0o755);
  jobs = new Jobs({ aiHome: home, jobHistory: 5, jobBufferKb: 64 } as Config);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("Jobs", () => {
  it("ejecuta bin/ai en una terminal real y guarda la salida", async () => {
    const j = jobs.enqueue(action(["eco", "a b", "$(rm -rf x)"]));
    await until(() => status(j.id) === "done");
    expect(output(j.id)).toContain("args:eco a b $(rm -rf x)");   // argv literal, sin shell
    expect(output(j.id)).toContain("con-tty");
  });

  it("de uno en uno: el segundo espera en cola", async () => {
    const a = jobs.enqueue(action(["lento"]));
    const b = jobs.enqueue(action(["eco", "b"]));
    await until(() => output(a.id).includes("listo"));
    expect(status(b.id)).toBe("queued");
    jobs.cancel(a.id);
    await until(() => status(b.id) === "done");
    expect(status(a.id)).toBe("cancelled");
    expect(output(a.id)).toContain("interrumpido");
    expect(jobs.list().find((j) => j.id === a.id)?.cancelling).toBeUndefined();               // Ctrl+C llega como SIGINT
  });

  it("se puede responder a una pregunta [s/N]", async () => {
    const j = jobs.enqueue(action(["pregunta"], true));
    await until(() => output(j.id).includes("Continuar?"));
    jobs.input(j.id, "s\r");
    await until(() => status(j.id) === "done");
    expect(output(j.id)).toContain("respuesta:s");
  });

  it("código de salida distinto de 0 = falló; cancelar uno en cola no lo ejecuta", async () => {
    const a = jobs.enqueue(action(["lento"]));
    const b = jobs.enqueue(action(["eco"]));
    jobs.cancel(b.id);
    expect(status(b.id)).toBe("cancelled");
    await until(() => output(a.id).includes("listo"));
    jobs.cancel(a.id);
    const c = jobs.enqueue(action(["falla"]));
    await until(() => status(c.id) === "failed");
    expect(jobs.list().find((x) => x.id === c.id)?.exitCode).toBe(3);
    expect(output(b.id)).toBe("");
  });

  it("deja auditoría de cada trabajo", async () => {
    const j = jobs.enqueue(action(["eco"]));
    await until(() => status(j.id) === "done");
    const events = readFileSync(join(home, "logs/studio-audit.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).event);
    expect(events).toEqual(["job_queued", "job_started", "job_finished"]);
  });
});
