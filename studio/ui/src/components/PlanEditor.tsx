// Editor del plan (Fase 3) con CodeMirror: revisar y corregir el plan antes de ejecutarlo.
// Guarda con PUT /api/plan, que falla si el archivo cambió desde que lo abriste.
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { Loader2, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { savePlan } from "../api.ts";

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--panel-2)", color: "var(--fg)", fontSize: "12px", borderRadius: "8px" },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", caretColor: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "var(--panel-2)", color: "var(--muted)", border: "none" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)" },
  "&.cm-focused": { outline: "1px solid var(--accent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important" },
});

export function PlanEditor({ project, run, text, mtime, onClose }: {
  project: string; run: string; text: string; mtime: number; onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    const v = new EditorView({
      doc: text,
      parent: box.current!,
      extensions: [
        basicSetup, markdown(), theme, EditorView.lineWrapping,
        keymap.of([{ key: "Mod-s", run: () => { saveRef.current(); return true; } }]),
        EditorView.updateListener.of((u) => { if (u.docChanged) setDirty(true); }),
      ],
    });
    view.current = v;
    v.focus();
    return () => v.destroy();
    // Solo al abrir: los cambios externos no deben pisar lo que escribes.
  }, []);

  const save = async () => {
    if (!view.current || saving) return;
    setSaving(true);
    setError(null);
    try {
      await savePlan(project, run, view.current.state.doc.toString(), mtime);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = () => void save();

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="max-h-[60vh] overflow-auto" />
      {error && <p className="rounded-md border border-fail bg-fail-bg px-2.5 py-1.5 text-xs text-fail">{error} Cierra el editor y vuelve a abrirlo para ver la versión actual.</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">Mantén el formato "### Paso N" y "**Archivo(s):**": ai exec depende de él. ⌘S guarda.</span>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-fg">
            <X className="size-3.5" />Cancelar
          </button>
          <button onClick={() => void save()} disabled={!dirty || saving}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
