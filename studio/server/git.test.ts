import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDocs, readDoc } from "./docs.ts";
import { branchCommits, branchDiff, GitError, parseDiff, projectGit } from "./git.ts";

let dir: string;
const g = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "studio-git-")));
  g("init", "-q", "-b", "main");
  writeFileSync(join(dir, "app.py"), "def main():\n    print('hola')\n");
  writeFileSync(join(dir, "schema.sql"), "-- tabla de usuarios\ncreate table u (id int);\n");
  writeFileSync(join(dir, "README.md"), "# Demo\n");
  g("add", "-A"); g("commit", "-qm", "init");
  g("switch", "-q", "-c", "ai/20261014-1200-saludo");
  writeFileSync(join(dir, "app.py"), "def saludar(n):\n    return f'Hola, {n}!'\n\ndef main():\n    print(saludar('Ana'))\n");
  writeFileSync(join(dir, "schema.sql"), "create table u (id int);\n");   // borra una línea que empieza por "--"
  g("add", "-A"); g("commit", "-qm", "feat: saludar");
  g("mv", "README.md", "LEEME.md"); g("commit", "-qm", "docs: renombrar");
  mkdirSync(join(dir, ".ai/plans"), { recursive: true });
  writeFileSync(join(dir, ".ai/plans/20261014-1200-saludo.md"), "# Plan: saludo\n");
  g("switch", "-q", "main");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ramas del agente", () => {
  it("lista las ramas ai/* con commits por delante y la sesión que las creó", async () => {
    const p = await projectGit(dir);
    expect(p).toMatchObject({ isRepo: true, current: "main", base: "main" });
    expect(p.branches).toHaveLength(1);
    expect(p.branches[0]).toMatchObject({ name: "ai/20261014-1200-saludo", ahead: 2, behind: 0, run: "20261014-1200-saludo" });
    expect(p.branches[0].last.subject).toBe("docs: renombrar");
  });

  it("commits y diff de la rama frente a la base", async () => {
    const commits = await branchCommits(dir, "ai/20261014-1200-saludo");
    expect(commits.map((c) => c.subject)).toEqual(["docs: renombrar", "feat: saludar"]);
    const { files } = await branchDiff(dir, "ai/20261014-1200-saludo");
    const app = files.find((f) => f.path === "app.py")!;
    expect(app).toMatchObject({ status: "modified", additions: 4, deletions: 1 });
    const sql = files.find((f) => f.path === "schema.sql")!;
    expect(sql.hunks[0].lines.find((l) => l.type === "del")?.text).toBe("-- tabla de usuarios");
    expect(files.find((f) => f.path === "LEEME.md")).toMatchObject({ status: "renamed", oldPath: "README.md" });
    // diff de un solo commit
    const one = await branchDiff(dir, "ai/20261014-1200-saludo", commits[1].full);
    expect(one.files.map((f) => f.path).sort()).toEqual(["app.py", "schema.sql"]);
  });

  it.each([
    ["una opción de git disfrazada de rama", { branch: "--output=/tmp/x" }],
    ["una rama que no existe", { branch: "ai/no-existe" }],
    ["la propia rama base", { branch: "main" }],
    ["un commit que no es de la rama", { branch: "ai/20261014-1200-saludo", commit: "0".repeat(40) }],
    ["un commit con formato raro", { branch: "ai/20261014-1200-saludo", commit: "HEAD~1" }],
  ])("rechaza %s", async (_, q) => {
    await expect(branchDiff(dir, q.branch, (q as { commit?: string }).commit)).rejects.toThrow(GitError);
  });

  it("una carpeta sin git no rompe nada", async () => {
    const plain = mkdtempSync(join(tmpdir(), "studio-nogit-"));
    expect(await projectGit(plain)).toMatchObject({ isRepo: false, branches: [] });
    rmSync(plain, { recursive: true, force: true });
  });
});

describe("parseDiff", () => {
  it("binarios y numeración de líneas", () => {
    const { files } = parseDiff([
      "diff --git a/x.png b/x.png", "new file mode 100644", "Binary files /dev/null and b/x.png differ",
      "diff --git a/a.txt b/a.txt", "--- a/a.txt", "+++ b/a.txt", "@@ -10,2 +10,2 @@ f()", " igual", "-viejo", "+nuevo", "\\ No newline at end of file",
    ].join("\n"));
    expect(files[0]).toMatchObject({ path: "x.png", status: "added", binary: true });
    expect(files[1].hunks[0].lines).toEqual([
      { type: "ctx", old: 10, new: 10, text: "igual" }, { type: "del", old: 11, text: "viejo" }, { type: "add", new: 11, text: "nuevo" },
    ]);
  });
});

describe("documentos", () => {
  it("lista README, docs y planes, y solo sirve lo listado", () => {
    mkdirSync(join(dir, "docs/api"), { recursive: true });
    writeFileSync(join(dir, "docs/api/endpoints.md"), "# API\n");
    mkdirSync(join(dir, "node_modules/x"), { recursive: true });
    writeFileSync(join(dir, "node_modules/x/README.md"), "no\n");
    symlinkSync("/etc/hosts", join(dir, "docs/fuera.md"));
    const paths = listDocs(dir).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["README.md", "docs/api/endpoints.md", ".ai/plans/20261014-1200-saludo.md"]));
    expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(readDoc(dir, "docs/api/endpoints.md")).toBe("# API\n");
    expect(() => readDoc(dir, "../../etc/hosts")).toThrow(/no existe/);
    expect(() => readDoc(dir, "docs/fuera.md")).toThrow();   // enlace que sale del proyecto
  });
});
