import "server-only";
import { Aran } from "@aran/sdk";
import { getDb } from "@/db";
import { fromEnv, resolveCached } from "./connection";
import { ServiceUnavailable } from "./domain";

// The one place the bank builds its Aran clients.
// Order: the connection saved from the admin "Aran connection" page (if it exists and decrypts), otherwise the environment variables
// ARAN_BASE_URL / ARAN_APP_KEY / ARAN_COMPLIANCE_KEY exactly as before. If neither is available every call fails closed with a 503
// (ServiceUnavailable: "Data protection service unavailable. Nothing was saved.").
// Callers still get a synchronous object (deps() is synchronous); each method resolves the connection when it is called.

const clients = new Map<string, { app: Aran; compliance: Aran }>();

async function current(): Promise<{ app: Aran; compliance: Aran }> {
  const c = await resolveCached(getDb()).catch(() => fromEnv());   // database unreachable: environment variables, as before
  if (!c) throw new ServiceUnavailable(new Error("no Aran connection is configured"));
  const id = `${c.source}|${c.baseUrl}|${c.appKey.slice(-6)}|${c.complianceKey.slice(-6)}`;
  let pair = clients.get(id);
  if (!pair) {
    clients.clear();   // at most one live pair: a changed connection replaces the old clients
    pair = { app: new Aran({ apiKey: c.appKey, baseUrl: c.baseUrl, timeoutMs: 5000 }), compliance: new Aran({ apiKey: c.complianceKey, baseUrl: c.baseUrl, timeoutMs: 5000 }) };
    clients.set(id, pair);
  }
  return pair;
}

function lazy(which: "app" | "compliance"): Aran {
  return new Proxy({} as Aran, {
    get(_t, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return async (...args: unknown[]) => {
        const target = (await current())[which] as unknown as Record<string, (...a: unknown[]) => unknown>;
        return target[prop as string]!.apply(target, args);
      };
    },
  });
}

/** App-server key (protect, gateway, trace). Server-side only: never NEXT_PUBLIC_*. */
export function appAran(): Aran { return lazy("app"); }
/** Compliance key (detokenise, erase, verify, dashboard). Used only by compliance server actions. */
export function complianceAran(): Aran { return lazy("compliance"); }
