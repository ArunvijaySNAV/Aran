"use client";
import { useActionState } from "react";
import { Banner, Button, Table } from "@/components/ui";
import { scanAction } from "./actions";
import type { ScanReport } from "@/lib/scan";

export function Scan() {
  const [s, action, pending] = useActionState<{ ok: boolean; message?: string; data?: ScanReport }, FormData>(async () => scanAction(), { ok: false });
  const r = s.data;
  return (
    <form action={action} className="space-y-3"><Button variant="primary" disabled={pending}>{pending ? "Scanning every table…" : "Scan for plaintext"}</Button>
      {s.message ? <Banner tone="bad" role="alert">{s.message}</Banner> : null}
      {r ? (
        <div aria-live="polite" className="space-y-3">
          {r.clean ? <Banner tone="ok" role="status"><strong>Clean.</strong> Scanned {r.tables} tables, {r.rows} rows, {r.cells} text cells: no Verhoeff-valid 12-digit number, no Luhn-valid 16-digit number, no Indian mobile number. Aran tokens are built to fail those checks.</Banner>
            : <Banner tone="bad" role="alert"><strong>{r.findings.length} plaintext candidate(s) found.</strong></Banner>}
          {!r.clean ? <Table label="Findings" head={["Where", "Kind", "Value"]}>{r.findings.map((f, i) => <tr key={i}><td>{f.schema}.{f.table}.{f.column}</td><td>{f.kind}</td><td className="font-mono">{f.masked}</td></tr>)}</Table> : null}
          <p className="text-xs text-muted">Scanned at {new Date(r.scannedAt).toLocaleTimeString("en-IN")}</p>
        </div>
      ) : null}
    </form>
  );
}
