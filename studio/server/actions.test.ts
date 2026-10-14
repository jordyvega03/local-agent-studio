import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionError, buildAction, resolveProject } from "./actions.ts";
import type { Config } from "./config.ts";
import type { JobRequest } from "../shared/types.ts";

let tmp: string;
let cfg: Config;
let app: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "studio-actions-")));
  mkdirSync(join(tmp, "root/personal/app/.ai/plans"), { recursive: true });
  mkdirSync(join(tmp, "fuera"), { recursive: true });
  mkdirSync(join(tmp, "home/flows"), { recursive: true });
  writeFileSync(join(tmp, "home/flows/feature.env"), "FLOW_NAME='Feature'\nFLOW_STEPS='plan exec'\nFLOW_APPROVE_AFTER='plan'\n");
  writeFileSync(join(tmp, "root/personal/app/.ai/plans/20261014-x.md"), "# Plan: x\n");
  writeFileSync(join(tmp, "root/archivo.txt"), "no soy carpeta");
  symlinkSync(join(tmp, "fuera"), join(tmp, "root/escape"));
  cfg = { projectsRoot: join(tmp, "root"), aiHome: join(tmp, "home") } as Config;
  app = join(tmp, "root/personal/app");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const build = (req: Partial<JobRequest>, models: string[] = ["gpt-oss:20b"]) => buildAction(req as JobRequest, cfg, models);

describe("resolveProject", () => {
  it("acepta rutas relativas a PROJECTS_ROOT y absolutas dentro de ella", () => {
    expect(resolveProject("personal/app", cfg)).toBe(app);
    expect(resolveProject(app, cfg)).toBe(app);
  });

  it.each([
    ["la raíz misma", () => join(tmp, "root")],
    ["fuera de la raíz", () => join(tmp, "fuera")],
    ["subiendo con ..", () => "../fuera"],
    ["un enlace simbólico que sale de la raíz", () => "escape"],
    ["un archivo", () => "archivo.txt"],
    ["algo que no existe", () => "no-existe"],
    ["vacío", () => ""],
  ])("rechaza %s", (_, input) => {
    expect(() => resolveProject(input(), cfg)).toThrow(ActionError);
  });
});

describe("buildAction", () => {
  it("plan: la tarea va como un único argumento, sin shell", () => {
    const a = build({ action: "plan", project: "personal/app", task: "  añade login; rm -rf / && echo $(whoami)  " });
    expect(a.argv).toEqual(["plan", app, "añade login; rm -rf / && echo $(whoami)"]);
    expect(a.interactive).toBe(false);
  });

  it("exec: plan concreto, reanudar desde N o modo chat", () => {
    expect(build({ action: "exec", project: app, plan: "20261014-x", from: 3 }).argv)
      .toEqual(["exec", app, ".ai/plans/20261014-x.md", "--from", "3"]);
    const i = build({ action: "exec", project: app, interactive: true });
    expect(i.argv).toEqual(["exec", app, "-i"]);
    expect(i.interactive).toBe(true);
  });

  it("flow: argv fijo, --yes opcional; interactivo si tiene pausas", () => {
    const f = build({ action: "flow", flow: "feature", project: "personal/app", task: "login con email" });
    expect(f.argv).toEqual(["flow", "feature", app, "login con email"]);
    expect(f.interactive).toBe(true);
    const y = build({ action: "flow", flow: "feature", project: app, task: "login", autoApprove: true });
    expect(y.argv.at(-1)).toBe("--yes");
    expect(y.interactive).toBe(false);
    expect(() => build({ action: "flow", flow: "../x", project: app, task: "login" })).toThrow(/no existe/);
  });

  it("use: solo modelos ya descargados", () => {
    expect(build({ action: "use", model: "gpt-oss:20b" }).argv).toEqual(["use", "gpt-oss:20b"]);
    expect(() => build({ action: "use", model: "qwen3-coder:30b" })).toThrow(/no está descargado/);
  });

  it.each([
    ["acción down (apagaría el Studio)", { action: "down" }],
    ["acción inventada", { action: "rm" }],
    ["plan con ruta", { action: "exec", project: "personal/app", plan: "../../etc/passwd" }],
    ["plan inexistente", { action: "exec", project: "personal/app", plan: "otro" }],
    ["paso inicial no entero", { action: "exec", project: "personal/app", from: 1.5 }],
    ["tarea con caracteres de control", { action: "plan", project: "personal/app", task: "hola\u001b[31m" }],
    ["tarea demasiado larga", { action: "plan", project: "personal/app", task: "x".repeat(4001) }],
    ["tarea vacía", { action: "plan", project: "personal/app", task: " " }],
    ["proyecto fuera de la raíz", { action: "review", project: "/etc" }],
  ])("rechaza %s", (_, req) => {
    expect(() => build(req as Partial<JobRequest>)).toThrow(ActionError);
  });
});
