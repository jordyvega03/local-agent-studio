import { describe, expect, it } from "vitest";
import type { Project, RunSummary } from "../../shared/types.ts";
import { buildPath, parseLocation, resolveRoute, shortIds } from "./route.ts";

const loc = (url: string) => { const u = new URL(url, "http://127.0.0.1:8766"); return { pathname: u.pathname, search: u.search } as Location; };
const run = (name: string): RunSummary => ({ name, title: name, stage: "exec", status: "done", updated: 0 });
const projects: Project[] = [
  { dir: "/u/Documents/personal/calorie-tracker", name: "calorie-tracker", slug: "calorie-tracker",
    runs: [run("20261015-0900-otro-plan"), run("20261014-1225-analiza-mi-proyecto"), run("20261014-144121-tester-x"), run("20261014-144121-flow-y")] },
  { dir: "/u/Documents/guate5/api", name: "api", slug: "guate5-api", runs: [] },
];

describe("URLs cortas", () => {
  it("lee rutas nuevas", () => {
    expect(parseLocation(loc("/"))).toEqual({ view: "session" });
    expect(parseLocation(loc("/calorie-tracker"))).toEqual({ slug: "calorie-tracker", run: undefined, view: "session" });
    expect(parseLocation(loc("/calorie-tracker/20261014-1225"))).toEqual({ slug: "calorie-tracker", run: "20261014-1225", view: "session" });
    expect(parseLocation(loc("/calorie-tracker/sistema"))).toEqual({ slug: "calorie-tracker", view: "system" });
    expect(parseLocation(loc("/acciones"))).toEqual({ view: "actions" });
  });

  it("sigue entendiendo los enlaces antiguos", () => {
    expect(parseLocation(loc("/?project=%2Fu%2FDocuments%2Fpersonal%2Fcalorie-tracker&run=20261014-1225-analiza-mi-proyecto&view=project")))
      .toEqual({ dir: "/u/Documents/personal/calorie-tracker", run: "20261014-1225-analiza-mi-proyecto", view: "project" });
  });

  it("id corto = fecha-hora; si se repite, el nombre completo", () => {
    const ids = shortIds(projects[0].runs);
    expect(ids.get("20261014-1225-analiza-mi-proyecto")).toBe("20261014-1225");
    expect(ids.get("20261014-144121-tester-x")).toBe("20261014-144121-tester-x");
  });

  it("resuelve contra los proyectos reales, con los más recientes si algo no existe", () => {
    expect(resolveRoute({ slug: "calorie-tracker", run: "20261014-1225", view: "session" }, projects))
      .toEqual({ project: projects[0].dir, run: "20261014-1225-analiza-mi-proyecto", view: "session" });
    expect(resolveRoute({ dir: projects[0].dir, run: "20261014-1225-analiza-mi-proyecto", view: "project" }, projects)!.view).toBe("project");
    expect(resolveRoute({ slug: "no-existe", run: "x", view: "session" }, projects))
      .toEqual({ project: projects[0].dir, run: "20261015-0900-otro-plan", view: "session" });
  });

  it("construye la URL más corta posible", () => {
    const d = projects[0].dir;
    expect(buildPath(projects, d, "20261015-0900-otro-plan", "session")).toBe("/calorie-tracker");
    expect(buildPath(projects, d, "20261014-1225-analiza-mi-proyecto", "session")).toBe("/calorie-tracker/20261014-1225");
    expect(buildPath(projects, d, "", "system")).toBe("/calorie-tracker/sistema");
    expect(buildPath(projects, projects[1].dir, "", "project")).toBe("/guate5-api/proyecto");
    expect(buildPath(null, "", "", "tokens")).toBe("/tokens");
  });
});
