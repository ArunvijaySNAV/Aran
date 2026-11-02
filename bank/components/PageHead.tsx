import type { ReactNode } from "react";
export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{title}</h1>{sub ? <p className="mt-1 max-w-2xl text-sm text-muted">{sub}</p> : null}</div>
      {actions}
    </header>
  );
}
