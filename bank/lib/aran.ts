import "server-only";
import { Aran } from "@aran/sdk";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let app: Aran | undefined;
let compliance: Aran | undefined;

/** App-server key (protect, gateway, trace). Server-side only: never NEXT_PUBLIC_*. */
export function appAran(): Aran {
  return (app ??= new Aran({ apiKey: required("ARAN_APP_KEY"), baseUrl: required("ARAN_BASE_URL"), timeoutMs: 5000 }));
}
/** Compliance key (detokenise, erase, verify, dashboard). Used only by compliance server actions. */
export function complianceAran(): Aran {
  return (compliance ??= new Aran({ apiKey: required("ARAN_COMPLIANCE_KEY"), baseUrl: required("ARAN_BASE_URL"), timeoutMs: 5000 }));
}
