import { FolderGit2, Sparkles } from "lucide-react";
import type { Project } from "../../../shared/types.ts";
import { ago, STATUS_LABEL } from "../format.ts";
import { cx, DOT } from "./ui.tsx";

const STAGE = { analysis: "análisis", exec: "ejecución", review: "revisión", agent: "agente", flow: "flujo" } as const;

export function Sidebar({ projects, project, run, onSelect }: {
  projects: Project[]; project: string; run: string;
  onSelect: (project: string, run: string) => void;
}) {
  return (
    <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto p-3" aria-label="Proyectos y sesiones">
      {projects.map((p) => (
        <div key={p.dir} className="mb-2">
          <button
            onClick={() => onSelect(p.dir, p.runs[0]?.name ?? "")}
            className={cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold",
              p.dir === project ? "text-fg" : "text-muted hover:text-fg")}
            title={p.dir}
          >
            <FolderGit2 className="size-4 shrink-0" />
            <span className="truncate">{p.name}</span>
            <span className="ml-auto text-[11px] font-normal text-muted">{p.runs.length}</span>
          </button>
          {p.dir === project && (
            <ul className="mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2 ml-3.5">
              {p.runs.length === 0 && <li className="px-2 py-1 text-xs text-muted">sin planes</li>}
              {p.runs.map((r) => (
                <li key={r.name}>
                  <button
                    onClick={() => onSelect(p.dir, r.name)}
                    className={cx("w-full rounded-md px-2 py-1.5 text-left",
                      r.name === run ? "bg-panel-2 outline outline-1 outline-accent/60" : "hover:bg-panel-2")}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cx("size-2 shrink-0 rounded-full", DOT[r.status], r.status === "running" && "pulse")} />
                      <span className="truncate text-[13px]">{r.title}</span>
                    </div>
                    <div className="mt-0.5 pl-4 text-[11px] text-muted">
                      {STAGE[r.stage]} · {STATUS_LABEL[r.status]} · {ago(r.updated)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </nav>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-[15px] font-semibold">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-white"><Sparkles className="size-4" /></span>
      AI Studio
    </div>
  );
}
