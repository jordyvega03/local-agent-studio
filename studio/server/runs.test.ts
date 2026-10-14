import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultStep } from "./live.ts";
import { listRuns, parsePlan, runState } from "./runs.ts";

const PLAN = `# Plan: Demo

## Pasos
### Paso 1: Crear función
- **Archivo(s):** \`app.py\`, \`lib/x.py\`
- **Cambio:** \`con espacios\` no es archivo
### Paso 2: Tests
- **Archivo(s):** \`test_app.py\`

## Criterios de aceptación
### Paso 9: esto no es un paso (fuera de "Pasos" sigue contando, como split_steps)
`;

let dir: string;
const name = "20261014-1200-demo";
const ev = (type: string, extra: object = {}) => JSON.stringify({ ts: "2026-10-14T12:00:00-06:00", type, ...extra });
function write(events: string[]) {
  writeFileSync(join(dir, ".ai/logs", name + ".jsonl"), events.join("\n") + "\n");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "studio-test-"));
  mkdirSync(join(dir, ".ai/plans"), { recursive: true });
  mkdirSync(join(dir, ".ai/logs"), { recursive: true });
  writeFileSync(join(dir, ".ai/plans", name + ".md"), PLAN);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parsePlan", () => {
  it("extrae título, pasos y archivos como split_steps", () => {
    const p = parsePlan(PLAN);
    expect(p.title).toBe("Demo");
    expect(p.steps.map((s) => s.n)).toEqual([1, 2, 9]);
    expect(p.steps[0].files).toEqual(["app.py", "lib/x.py"]);
    expect(p.steps[1].title).toBe("Tests");
  });
});

describe("runState", () => {
  it("plan sin registro: análisis hecho, resto pendiente", () => {
    const st = runState(dir, name);
    expect(st.analysis.status).toBe("done");
    expect(st.exec.status).toBe("pending");
    expect(st.review.status).toBe("pending");
  });

  it("sigue el ciclo completo de eventos", () => {
    write([
      ev("plan_started", { task: "t", model: "opus" }),
      ev("plan_tool", { tool: "Read", target: "app.py" }),
      ev("plan_done", { turns: 3, duration_ms: 4200 }),
      ev("exec_started", { model: "gpt-oss:20b", branch: "ai/x", total: 2, from: 1 }),
      ev("step_started", { n: 1 }),
      ev("step_done", { n: 1, secs: 42, commits: "abc feat\ndef fix" }),
      ev("step_started", { n: 2 }),
    ]);
    writeFileSync(join(dir, ".ai/logs", name + ".step-001.log"), "hola");
    const st = runState(dir, name);
    expect(st.analysis).toMatchObject({ status: "done", turns: 3, tools: [{ tool: "Read", target: "app.py" }] });
    expect(st.exec).toMatchObject({ status: "running", current: 2, branch: "ai/x", logs: [1] });
    expect(st.exec.steps[0]).toMatchObject({ status: "done", secs: 42, commits: ["abc feat", "def fix"] });
    expect(defaultStep(st)).toBe(2);
  });

  it("interrumpido: el paso en curso queda abortado", () => {
    write([ev("exec_started", { from: 1 }), ev("step_started", { n: 1 }), ev("exec_aborted")]);
    const st = runState(dir, name);
    expect(st.exec.status).toBe("aborted");
    expect(st.exec.steps[0].status).toBe("aborted");
  });

  it("reanudar con --from N reinicia solo los pasos >= N", () => {
    write([
      ev("exec_started", { from: 1 }), ev("step_started", { n: 1 }), ev("step_done", { n: 1 }),
      ev("step_started", { n: 2 }), ev("step_failed", { n: 2 }), ev("exec_failed"),
      ev("exec_started", { from: 2 }),
    ]);
    const st = runState(dir, name);
    expect(st.exec.steps[0].status).toBe("done");
    expect(st.exec.steps[1].status).toBe("pending");
  });

  it("ignora líneas corruptas", () => {
    write(["{roto", ev("review_started"), ev("review_done")]);
    writeFileSync(join(dir, ".ai/logs", name + ".review.md"), "todo bien");
    expect(runState(dir, name).review).toMatchObject({ status: "done", text: "todo bien" });
  });
});

describe("listRuns", () => {
  it("lista planes y registros, y descarta nombres con caracteres raros", () => {
    writeFileSync(join(dir, ".ai/logs", "otro.jsonl"), ev("exec_started") + "\n");
    writeFileSync(join(dir, ".ai/plans", "mal nombre.md"), "# x");
    const runs = listRuns(dir).map((r) => r.name).sort();
    expect(runs).toEqual([name, "otro"].sort());
  });
});
