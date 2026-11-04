"use client";
import { useActionState } from "react";
import { Banner, Button, Table } from "@/components/ui";
import { SinkPill, TokenChip } from "@/components/aran";
import { breachAction } from "./actions";
import type { TraceResult } from "@aran/sdk";

export function Breach({ batchId }: { batchId: string }) {
  const [s, action, pending] = useActionState<{ ok: boolean; message?: string; data?: TraceResult }, FormData>(breachAction, { ok: false });
  return (
    <form action={action} className="space-y-3"><input type="hidden" name="batchId" value={batchId} />
      <Button variant="danger" size="sm" disabled={pending}>{pending ? "Tracing…" : <>Simulate vendor breach<span className="sr-only"> for this batch</span></>}</Button>
      {s.message ? <Banner tone="bad" role="alert">{s.message}</Banner> : null}
      <div aria-live="polite">{s.data ? (
        <div className="night space-y-3 rounded-[14px] p-4 sm:p-5">
          {s.data.top ? <Banner tone="ok"><strong className="text-[17px]">Leak traced to the “{s.data.top.sink}” destination.</strong><br />{s.data.matched} of {s.data.candidates} values in the leaked file are tokens Aran issued to that destination.</Banner> : <Banner>No Aran tokens recognised in this file.</Banner>}
          {s.data.ranking.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Destinations ranked by matching tokens">{s.data.ranking.map((r) => (
              <li key={r.sink} className={`flex min-h-11 items-center gap-2 rounded-full px-4 py-1 text-[14px] font-semibold ${s.data!.top?.sink === r.sink ? "bg-rawbg text-raw shadow-[inset_0_0_0_2px_var(--raw)]" : "text-ink shadow-[inset_0_0_0_1.5px_var(--rule)]"}`}>
                {r.sink}<span className="tabular font-normal">{r.tokens} {r.tokens === 1 ? "token" : "tokens"} · {Math.round(r.share * 100)}% match</span></li>
            ))}</ul>
          ) : null}
          {s.data.raw_identifiers_in_dump ? <Banner tone="bad">{s.data.raw_identifiers_in_dump} raw identifier(s) were exposed.</Banner> : <Banner tone="ok">No raw Aadhaar or card numbers in the leaked file: only tokens.</Banner>}
          <Table label="Trace result" head={["Value", "Source sink", "How"]}>{s.data.items.slice(0, 12).map((i, k) => <tr key={k}><td>{i.sink ? <TokenChip>{i.value}</TokenChip> : <span className="break-all font-mono text-[12px]">{i.value}</span>}</td><td>{i.sink ? <SinkPill className={s.data!.top?.sink === i.sink ? "bg-rawbg !text-raw shadow-[inset_0_0_0_2px_var(--raw)]" : ""}>{i.sink}</SinkPill> : "not ours"}</td><td>{i.how ?? "–"}</td></tr>)}</Table>
        </div>
      ) : null}</div>
    </form>
  );
}
