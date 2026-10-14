// Vista "Agentes" (Fase 4): los agentes de agents/*.env. Verlos, crearlos, editarlos y usarlos.
import { Bot, Cloud, Container, Eye, Loader2, Pencil, Play, Plus, Save, ShieldCheck, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AgentDef } from "../../../shared/types.ts";
import { createAgent, getAgents, getModels, updateAgent } from "../api.ts";
import { Card, Code, cx, Empty } from "./ui.tsx";

const inputCls = "w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50";
const field = (label: string, child: ReactNode, hint?: ReactNode) => (
  <label className="flex flex-col gap-1 text-xs">
    <span className="font-medium text-muted">{label}</span>{child}{hint && <span className="text-[11px] text-muted">{hint}</span>}
  </label>
);

function Badge({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-px text-[11px]",
    tone === "warn" ? "border-run text-run" : "border-line text-muted")}>{children}</span>;
}

const EMPTY: AgentDef = { id: "", name: "", description: "", engine: "aider", model: "", access: "write", verify: "auto", input: "", prompt: "" };

function AgentEditor({ initial, isNew, onClose, onSaved }: { initial: AgentDef; isNew: boolean; onClose: () => void; onSaved: () => void }) {
  const [a, setA] = useState<AgentDef>(initial);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getModels().then((m) => setModels(m.installed)).catch(() => {}); }, []);
  const set = <K extends keyof AgentDef>(k: K, v: AgentDef[K]) => setA((x) => ({ ...x, [k]: v }));
  // Reglas del motor: claude = Opus en tu Mac, solo lectura y sin verificación.
  const setEngine = (engine: AgentDef["engine"]) =>
    setA((x) => engine === "claude" ? { ...x, engine, access: "read", verify: "", model: "" } : { ...x, engine, input: "", model: "" });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (isNew ? createAgent(a) : updateAgent(a));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={isNew ? "Nuevo agente" : `Editar ${initial.name}`} icon={<Pencil className="size-4 text-muted" />}
      actions={<button onClick={onClose} className="text-muted hover:text-fg" aria-label="Cerrar"><X className="size-4" /></button>}>
      <form onSubmit={save} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {field("Id", <input className={inputCls} value={a.id} onChange={(e) => set("id", e.target.value.toLowerCase())} disabled={!isNew}
          placeholder="seguridad" required pattern="[a-z][a-z0-9-]{1,30}" />, "Minúsculas, números y guiones. Es el nombre de archivo: agents/<id>.env")}
        {field("Nombre", <input className={inputCls} value={a.name} onChange={(e) => set("name", e.target.value)} maxLength={40} required />)}
        <div className="md:col-span-2">{field("Descripción", <input className={inputCls} value={a.description} onChange={(e) => set("description", e.target.value)} maxLength={200} />)}</div>
        {field("Motor", (
          <select className={inputCls} value={a.engine} onChange={(e) => setEngine(e.target.value as AgentDef["engine"])}>
            <option value="aider">aider · modelo local en el contenedor</option>
            <option value="claude">claude · Opus en tu Mac (solo lectura)</option>
          </select>
        ))}
        {field("Modelo", a.engine === "aider" ? (
          <select className={inputCls} value={a.model} onChange={(e) => set("model", e.target.value)}>
            <option value="">El ejecutor actual (EXECUTOR_MODEL)</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <select className={inputCls} value={a.model} onChange={(e) => set("model", e.target.value)}>
            <option value="">El planificador (PLANNER_MODEL)</option>
            {["opus", "sonnet", "haiku"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ))}
        {field("Acceso", (
          <select className={inputCls} value={a.access} onChange={(e) => set("access", e.target.value as AgentDef["access"])} disabled={a.engine === "claude"}>
            <option value="write">write · edita y hace commits en su rama</option>
            <option value="read">read · solo propone (dry-run)</option>
          </select>
        ), a.engine === "claude" ? "Claude corre fuera del contenedor: siempre de solo lectura." : undefined)}
        {a.engine === "aider" ? field("Verificación", (
          <input className={inputCls} value={a.verify} onChange={(e) => set("verify", e.target.value)} placeholder="auto, npm test… o vacío" maxLength={300} />
        ), <>auto = tests del proyecto (o typecheck), o <Code>VERIFY_CMD</Code> de <Code>.ai/project.env</Code>. Corre en el contenedor.</>)
          : field("Entrada", (
            <select className={inputCls} value={a.input} onChange={(e) => set("input", e.target.value as AgentDef["input"])}>
              <option value="">Nada (solo la tarea)</option>
              <option value="diff">El diff de la rama del agente</option>
            </select>
          ))}
        <div className="md:col-span-2">{field("Instrucciones", (
          <textarea className={cx(inputCls, "min-h-48 resize-y font-mono text-xs")} value={a.prompt} onChange={(e) => set("prompt", e.target.value)} required
            placeholder={"Eres el agente …\n\nReglas:\n- …"} />
        ), "Se guardan en prompts/agents/<id>.md. La tarea que escribas al lanzarlo se añade al final.")}</div>
        {error && <p className="rounded-md border border-fail bg-fail-bg px-2.5 py-1.5 text-xs text-fail md:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 md:col-span-2">
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:text-fg">Cancelar</button>
          <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}{isNew ? "Crear agente" : "Guardar"}
          </button>
        </div>
      </form>
    </Card>
  );
}

export function AgentsView({ onUse }: { onUse: (agentId: string) => void }) {
  const [agents, setAgents] = useState<AgentDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ def: AgentDef; isNew: boolean } | null>(null);
  const load = () => getAgents().then(setAgents).catch((e) => setError(String(e.message)));
  useEffect(() => { void load(); }, []);

  return (
    <div className="flex flex-col gap-4">
      {editing && <AgentEditor key={editing.def.id || "nuevo"} initial={editing.def} isNew={editing.isNew}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {error && <p className="rounded-lg border border-fail bg-fail-bg px-3 py-2 text-sm text-fail">{error}</p>}
      {!agents ? <Empty>Cargando agentes…</Empty> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <section key={a.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line bg-panel p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold"><Bot className="size-4 text-muted" />{a.name}</div>
                  <div className="font-mono text-[11px] text-muted">agents/{a.id}.env</div>
                </div>
                <button onClick={() => setEditing({ def: a, isNew: false })} className="text-muted hover:text-fg" aria-label={`Editar ${a.name}`}>
                  <Pencil className="size-4" />
                </button>
              </div>
              <p className="text-sm text-muted">{a.description || "Sin descripción."}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{a.engine === "claude" ? <Cloud className="size-3" /> : <Container className="size-3" />}{a.engine === "claude" ? "Opus · tu Mac" : "local · contenedor"}</Badge>
                <Badge>{a.access === "read" ? <Eye className="size-3" /> : <Pencil className="size-3" />}{a.access === "read" ? "solo lectura" : "escribe"}</Badge>
                {a.model && <Badge>{a.model}</Badge>}
                {a.verify && <Badge><ShieldCheck className="size-3" />verifica: {a.verify}</Badge>}
                {a.input === "diff" && <Badge>recibe el diff</Badge>}
              </div>
              <button onClick={() => onUse(a.id)}
                className="mt-auto flex items-center justify-center gap-1.5 rounded-md border border-accent px-3 py-1.5 text-xs font-semibold text-fg hover:bg-panel-2">
                <Play className="size-3.5" />Usar
              </button>
            </section>
          ))}
          <button onClick={() => setEditing({ def: { ...EMPTY }, isNew: true })}
            className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-muted hover:border-accent hover:text-fg">
            <Plus className="size-5" />Nuevo agente
          </button>
        </div>
      )}
      <p className="text-xs text-muted">
        También desde la terminal: <Code>ai agent list</Code> y <Code>ai agent &lt;id&gt; &lt;proyecto&gt; "tarea"</Code>. Los agentes que escriben
        trabajan en el contenedor, en una rama <Code>ai/…</Code>; los de Opus solo leen.
      </p>
    </div>
  );
}
