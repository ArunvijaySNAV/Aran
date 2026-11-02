"use client";
import { useActionState } from "react";
import { Banner, Button, Table } from "@/components/ui";
import { breachAction } from "./actions";
import type { TraceResult } from "@aran/sdk";

export function Breach({ batchId }: { batchId: string }) {
  const [s, action, pending] = useActionState<{ ok: boolean; message?: string; data?: TraceResult }, FormData>(breachAction, { ok: false });
  return (
    <form action={action} className="space-y-3"><input type="hidden" name="batchId" value={batchId} />
      <Button variant="danger" size="sm" disabled={pending}>{pending ? "Tracing…" : "Simulate vendor breach"}</Button>
      {s.message ? <Banner tone="bad" role="alert">{s.message}</Banner> : null}
      {s.data ? (
        <div className="space-y-2" aria-live="polite">
          {s.data.top ? <Banner tone="ok"><strong>Leak traced to the “{s.data.top.sink}” destination.</strong> {s.data.matched} of {s.data.candidates} values in the leaked file are tokens Aran issued to that destination.</Banner> : <Banner>No Aran tokens recognised in this file.</Banner>}
          {s.data.raw_identifiers_in_dump ? <Banner tone="bad">{s.data.raw_identifiers_in_dump} raw identifier(s) were exposed.</Banner> : <Banner tone="ok">No raw Aadhaar or card numbers in the leaked file: only tokens.</Banner>}
          <Table label="Trace result" head={["Value", "Source sink", "How"]}>{s.data.items.slice(0, 12).map((i, k) => <tr key={k}><td className="break-all font-mono text-xs">{i.value}</td><td>{i.sink ?? "not ours"}</td><td>{i.how ?? "–"}</td></tr>)}</Table>
        </div>
      ) : null}
    </form>
  );
}
