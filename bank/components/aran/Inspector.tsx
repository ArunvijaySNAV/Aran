import type { ReactNode } from "react";

export interface InspectorCall { id: string; endpoint: string; sink?: string; payload: ReactNode; latencyMs?: number }

/** Aran Inspector: a 420px Night drawer listing recent Aran calls. Presentational only: it renders what it is given.
 *  Not mounted anywhere yet because the bank keeps no record of its Aran calls (docs/FUNCTIONALITY_GAPS.md #1). */
export function Inspector({ calls, open }: { calls: InspectorCall[]; open: boolean }) {
  return (
    <aside aria-label="Aran Inspector" hidden={!open} className="night fixed inset-y-0 right-0 z-40 w-[min(420px,100vw)] overflow-y-auto border-l border-nightline p-5 shadow-2xl">
      <h2 className="mb-4 text-lg font-bold">Aran Inspector</h2>
      {calls.length === 0 ? <p className="text-sm text-nightdim">No Aran calls to show yet.</p> : calls.map((c) => (
        <div key={c.id} className="mb-4 border-t border-nightline pt-3">
          <div className="flex items-center justify-between gap-2"><code className="font-mono text-[12px] text-nighttoken">{c.endpoint}</code>{c.latencyMs != null ? <span className="text-[12px] text-nightdim">{c.latencyMs.toFixed(1)} ms</span> : null}</div>
          {c.sink ? <div className="mt-1 text-[13px] text-nightdim">{c.sink}</div> : null}
          <div className="mt-2 text-[13px]">{c.payload}</div>
        </div>
      ))}
    </aside>
  );
}
