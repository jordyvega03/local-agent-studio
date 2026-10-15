import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContextError, createContextTemplate, readContext, saveContext } from "./context.ts";
import { listDocs } from "./docs.ts";

let home: string, dir: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "studio-ctx-"));
  dir = join(home, "mi-app");
  mkdirSync(join(home, "prompts"), { recursive: true });
  mkdirSync(dir);
  writeFileSync(join(home, "prompts/context-template.md"), "# Contexto del proyecto: <nombre>\n");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("contexto del proyecto", () => {
  it("plantilla, lectura y guardado con control de conflictos", () => {
    expect(readContext(dir)).toEqual({ exists: false, text: "", mtime: null });
    const c = createContextTemplate(home, dir);
    expect(c.text).toBe("# Contexto del proyecto: mi-app\n");
    expect(() => createContextTemplate(home, dir)).toThrow(ContextError);
    const { mtime } = saveContext(dir, "# nuevo", c.mtime);
    expect(readContext(dir).text).toBe("# nuevo\n");
    // Alguien lo cambió (otro mtime): no se pisa
    utimesSync(join(dir, ".ai/context.md"), new Date(), new Date(Date.now() + 5000));
    expect(() => saveContext(dir, "x", mtime)).toThrow(/cambió/);
    expect(() => saveContext(dir, "x".repeat(70 * 1024), readContext(dir).mtime)).toThrow(/grande/);
  });

  it("aparece el primero en Documentos", () => {
    writeFileSync(join(dir, "README.md"), "# r\n");
    createContextTemplate(home, dir);
    expect(listDocs(dir).slice(0, 2).map((d) => d.path)).toEqual([".ai/context.md", "README.md"]);
  });
});
