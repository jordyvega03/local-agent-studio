// Piezas base de la interfaz (estilo shadcn, sin dependencias extra).
import { CheckCircle2, Circle, Loader2, Square, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { Status } from "../../../shared/types.ts";
import { STATUS_LABEL } from "../format.ts";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

const BADGE: Record<Status, string> = {
  pending: "bg-idle-bg text-idle",
  running: "bg-run-bg text-run",
  done: "bg-ok-bg text-ok",
  failed: "bg-fail-bg text-fail",
  aborted: "bg-fail-bg text-fail",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={cx("rounded-full px-2 py-px text-[11px] font-semibold whitespace-nowrap", BADGE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusIcon({ status, className = "size-4" }: { status: Status; className?: string }) {
  const label = STATUS_LABEL[status];
  switch (status) {
    case "done": return <CheckCircle2 className={cx(className, "text-ok")} aria-label={label} />;
    case "running": return <Loader2 className={cx(className, "text-run animate-spin motion-reduce:animate-none")} aria-label={label} />;
    case "failed": return <XCircle className={cx(className, "text-fail")} aria-label={label} />;
    case "aborted": return <Square className={cx(className, "text-fail")} aria-label={label} />;
    default: return <Circle className={cx(className, "text-idle")} aria-label={label} />;
  }
}

export const DOT: Record<Status, string> = {
  pending: "bg-idle", running: "bg-run", done: "bg-ok", failed: "bg-fail", aborted: "bg-fail",
};

export function Card({ title, icon, status, actions, children, className, bodyClassName }: {
  title: string; icon?: ReactNode; status?: Status; actions?: ReactNode;
  children: ReactNode; className?: string; bodyClassName?: string;
}) {
  return (
    <section className={cx("min-w-0 rounded-xl border border-line bg-panel", className)}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
          {icon}<span className="truncate">{title}</span>{status && <StatusBadge status={status} />}
        </h2>
        {actions}
      </header>
      <div className={cx("px-4 py-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-panel-2 px-1.5 py-px font-mono text-[12px]">{children}</code>;
}
