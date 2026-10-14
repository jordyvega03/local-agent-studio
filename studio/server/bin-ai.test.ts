// Guardas sobre bin/ai (bash 3.2 de macOS, ver CLAUDE.md).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = join(import.meta.dirname, "../../bin/ai");

describe("bin/ai", () => {
  it("pasa bash -n con el bash 3.2 del sistema", () => {
    expect(() => execFileSync("/bin/bash", ["-n", BIN])).not.toThrow();
  });

  it("ninguna variable va pegada a un carácter no ASCII (bash 3.2 lo toma como parte del nombre)", () => {
    // "$fix…" en bash 3.2 con UTF-8 = variable "fix…" → con set -u el script muere. Usa "${fix}…".
    const bad = readFileSync(BIN, "utf8").split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/.test(line));
    expect(bad).toEqual([]);
  });
});
