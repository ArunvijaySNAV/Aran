"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Banner, Button } from "@/components/ui";
import { exportAction } from "./actions";

export function ExportButton({ disabled }: { disabled: boolean }) {
  const [s, action, pending] = useActionState(async () => exportAction(), { ok: false });
  const router = useRouter();
  useEffect(() => { if (s.ok) router.refresh(); }, [s, router]);
  return <form action={action} className="space-y-2">{s.message ? <Banner tone={s.ok ? "ok" : "bad"} role="status">{s.message}</Banner> : null}<Button variant="primary" disabled={disabled || pending}>{pending ? "Building…" : "Build CSV export"}</Button></form>;
}
