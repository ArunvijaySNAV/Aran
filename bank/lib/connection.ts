// The bank's connection to Aran Cloud: stored encrypted, tested with cheap real calls, resolved in one place (lib/aran.ts).
// Rules: a key never leaves this module except inside an Aran request header; every error text is scrubbed before it is returned or logged;
// nothing here writes a key, or any part of one, to a log line, an audit record or a response.
// No `server-only` import on purpose so the unit tests can use it (tests alias it away anyway).
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as t from "@/db/schema";
import type { ConnectionCheck } from "@/db/schema";
import { decryptSecret, encryptSecret, parseEncKey } from "./connection-crypto";
import { BadInput, Forbidden, type Actor } from "./domain";

export type ConnectionStatus = "connected" | "not_connected" | "unreachable" | "key_rejected";
export interface ResolvedConnection { baseUrl: string; appKey: string; complianceKey: string; source: "saved" | "env" }
export interface ConnectionView {
  /** true when CONNECTION_ENC_KEY is set and valid: the page can save and disconnect. */
  editable: boolean;
  source: "saved" | "env" | "none";
  status: ConnectionStatus;
  baseUrl: string | null;
  workspaceName: string | null;
  appKeyLast4: string | null;
  complianceKeyLast4: string | null;
  lastCheckedAt: string | null;
  updatedBy: string | null;
  checks: ConnectionCheck[];
}

type Env = Record<string, string | undefined>;
const SECRET_SHAPE = /aran_[a-z]+_[0-9a-zA-Z]{8,}/g;

/** Removes every known key and anything shaped like one from a text before it can be returned or logged. */
export function scrub(text: string, secrets: (string | undefined | null)[] = []): string {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[key]");
  return out.replace(SECRET_SHAPE, "[key]");
}

export function normalizeUrl(raw: string): string {
  const v = raw.trim().replace(/\/+$/, "");
  let u: URL;
  try { u = new URL(v); } catch { throw new BadInput({ baseUrl: "Enter a full address such as https://aran.example.com." }); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new BadInput({ baseUrl: "The address must start with https:// or http://." });
  if (u.username || u.password) throw new BadInput({ baseUrl: "Do not put a user name or password in the address." });
  if (v.length > 200) throw new BadInput({ baseUrl: "That address is too long." });
  return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname.replace(/\/+$/, "")}`;
}

const last4 = (k: string) => k.slice(-4);

// ------------------------------------------------------------------ reading
async function savedRow(db: Db) {
  const [row] = await db.select().from(t.aranConnection).where(eq(t.aranConnection.id, 1));
  return row ?? null;
}

/** The saved connection with both keys decrypted, or null if there is none or it cannot be decrypted (then the caller falls back to env). */
export async function loadSaved(db: Db, env: Env = process.env): Promise<ResolvedConnection | null> {
  const key = parseEncKey(env.CONNECTION_ENC_KEY);
  if (!key) return null;
  const row = await savedRow(db);
  if (!row) return null;
  const appKey = decryptSecret(row.appKeyEnc, "app_key", key);
  const complianceKey = decryptSecret(row.complianceKeyEnc, "compliance_key", key);
  if (!appKey || !complianceKey) return null;
  return { baseUrl: row.baseUrl, appKey, complianceKey, source: "saved" };
}

export function fromEnv(env: Env = process.env): ResolvedConnection | null {
  const baseUrl = env.ARAN_BASE_URL, appKey = env.ARAN_APP_KEY, complianceKey = env.ARAN_COMPLIANCE_KEY;
  return baseUrl && appKey && complianceKey ? { baseUrl, appKey, complianceKey, source: "env" } : null;
}

/** Saved connection if it exists and decrypts, otherwise the environment variables, otherwise null (callers fail closed). */
export async function resolveConnection(db: Db, env: Env = process.env): Promise<ResolvedConnection | null> {
  return (await loadSaved(db, env)) ?? fromEnv(env);
}

/** Everything the page may show. Never includes a key. */
export async function getView(db: Db, env: Env = process.env): Promise<ConnectionView> {
  const editable = parseEncKey(env.CONNECTION_ENC_KEY) !== null;
  const row = await savedRow(db);
  if (row) {
    const usable = (await loadSaved(db, env)) !== null;
    return {
      editable, source: usable ? "saved" : (fromEnv(env) ? "env" : "none"),
      status: usable ? row.status : "not_connected", baseUrl: row.baseUrl, workspaceName: row.workspaceName,
      appKeyLast4: row.appKeyLast4, complianceKeyLast4: row.complianceKeyLast4, lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      updatedBy: row.updatedBy, checks: usable ? row.checks ?? [] : [{ id: "decrypt", group: "reach", label: "Saved keys", ok: false, detail: "The saved keys cannot be read with this CONNECTION_ENC_KEY. Save the connection again." }],
    };
  }
  const e = fromEnv(env);
  return { editable, source: e ? "env" : "none", status: "not_connected", baseUrl: e?.baseUrl ?? null, workspaceName: null, appKeyLast4: null, complianceKeyLast4: null, lastCheckedAt: null, updatedBy: null, checks: [] };
}

// ------------------------------------------------------------------ testing
type Probe = { method: "GET" | "POST"; path: string; body?: unknown; ok: number[] };
const PROBES = {
  app: [
    { id: "protect", label: "Protect (tokenise values)", probe: { method: "POST", path: "/v1/protect", body: {}, ok: [422, 200] } },
    { id: "gateway", label: "Gateway (AI prompts)", probe: { method: "POST", path: "/v1/gateway", body: { prompt: [] }, ok: [422, 200] } },
    { id: "trace", label: "Trace (leak tracing)", probe: { method: "POST", path: "/v1/trace", body: {}, ok: [422, 200] } },
  ],
  compliance: [
    { id: "detokenise", label: "Reveal (detokenise)", probe: { method: "POST", path: "/v1/detokenise", body: { token: "aran-connection-test" }, ok: [200] } },
    { id: "erase", label: "Erase (destroy keys)", probe: { method: "POST", path: "/v1/erase", body: {}, ok: [422, 200] } },
    { id: "verify", label: "Verify receipts", probe: { method: "POST", path: "/v1/receipts/verify", body: {}, ok: [200, 422] } },
    { id: "dashboard", label: "Workspace dashboard", probe: { method: "GET", path: "/v1/dashboard", ok: [200] } },
  ],
} as const satisfies Record<string, readonly { id: string; label: string; probe: Probe }[]>;

export interface TestResult { status: ConnectionStatus; workspaceName: string | null; checks: ConnectionCheck[] }

/** Cheapest real calls that prove: the address answers, each key is accepted, each key has the scopes the bank uses.
 *  Probes use empty or invalid request bodies where the API checks the scope before the body, so nothing is created; the one exception is
 *  the reveal check, which asks Aran to detokenise the fixed text "aran-connection-test" (Aran answers "unknown" and logs one audit line). No customer data is sent. */
export async function runChecks(conn: ResolvedConnection, fetchImpl: typeof fetch = fetch): Promise<TestResult> {
  const secrets = [conn.appKey, conn.complianceKey];
  const base = conn.baseUrl.replace(/\/+$/, "");
  const checks: ConnectionCheck[] = [];
  const call = async (key: string | null, p: Probe) => {
    try {
      const r = await fetchImpl(base + p.path, {
        method: p.method, headers: { ...(key ? { "X-API-Key": key } : {}), ...(p.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: p.body !== undefined ? JSON.stringify(p.body) : undefined, signal: AbortSignal.timeout(5000), cache: "no-store",
      });
      const text = await r.text().catch(() => "");
      return { status: r.status, text };
    } catch (e) { return { status: 0, text: scrub((e as Error)?.name === "TimeoutError" ? "no answer within 5 seconds" : (e as Error)?.message ?? "no answer", secrets) }; }
  };

  const host = (() => { try { return new URL(base).host; } catch { return base; } })();
  const health = await call(null, { method: "GET", path: "/v1/health", ok: [200] });
  let healthy = false;
  if (health.status === 200) { try { healthy = JSON.parse(health.text)?.status === "ok"; } catch { healthy = false; } }
  checks.push({ id: "reach", group: "reach", label: `Aran Cloud answers at ${host}`, ok: healthy,
    detail: healthy ? "It answered and reports itself healthy." : health.status === 0 ? `No answer (${health.text}).` : `It answered with HTTP ${health.status}, not "ok".` });
  if (!healthy) {
    for (const g of ["app", "compliance"] as const) checks.push({ id: `${g}-accepted`, group: g, label: g === "app" ? "App key is accepted" : "Compliance key is accepted", ok: false, detail: "Not tested because Aran Cloud did not answer." });
    return { status: "unreachable", workspaceName: null, checks };
  }

  let workspaceName: string | null = null;
  let anyRejected = false, anyMissing = false, anyOther = false;
  for (const g of ["app", "compliance"] as const) {
    const key = g === "app" ? conn.appKey : conn.complianceKey;
    const results = await Promise.all(PROBES[g].map(async (p) => ({ p, r: await call(key, p.probe) })));
    const rejected = results.some(({ r }) => r.status === 401);
    checks.push({ id: `${g}-accepted`, group: g, label: g === "app" ? "App key is accepted" : "Compliance key is accepted", ok: !rejected,
      detail: rejected ? "Aran says this key is invalid, missing or revoked." : "Aran accepted the key." });
    if (rejected) { anyRejected = true; continue; }
    for (const { p, r } of results) {
      const ok = (p.probe.ok as readonly number[]).includes(r.status);
      if (!ok && r.status === 403) anyMissing = true;
      else if (!ok) anyOther = true;
      if (g === "compliance" && p.id === "dashboard" && ok) { try { workspaceName = String(JSON.parse(r.text)?.tenant?.name ?? "") || null; } catch { workspaceName = null; } }
      checks.push({ id: `${g}-${p.id}`, group: g, label: `${g === "app" ? "App key" : "Compliance key"} can use ${p.label}`, ok,
        detail: ok ? "Allowed." : r.status === 403 ? "This key does not have that permission." : r.status === 0 ? `No answer (${r.text}).` : `Aran answered with HTTP ${r.status}.` });
    }
  }
  const status: ConnectionStatus = anyRejected || anyMissing ? "key_rejected" : anyOther ? "unreachable" : "connected";
  return { status, workspaceName, checks };
}

// ------------------------------------------------------------------ writing (admin only)
/** The view for the page: administrators only, enforced here as well as by the route. */
export async function readView(db: Db, actor: Actor, env: Env = process.env): Promise<ConnectionView> {
  requireAdmin(actor);
  return getView(db, env);
}
function requireAdmin(actor: Actor) {
  if (actor.role !== "admin") throw new Forbidden("Only an administrator can use the Aran connection page.");
}
async function audit(db: Db, actor: Actor, action: string, line: string) {
  await db.insert(t.appLogs).values({ actor: actor.email, action, line: scrub(line) });
}
const OUTCOME: Record<ConnectionStatus, string> = { connected: "connected", unreachable: "Aran Cloud unreachable", key_rejected: "a key was rejected or lacks permissions", not_connected: "not connected" };

export interface SaveInput { baseUrl: string; appKey: string; complianceKey: string }

/** Save (or update) the connection, then test it. Blank key fields keep the saved key. */
export async function saveConnection(db: Db, actor: Actor, input: SaveInput, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<ConnectionView> {
  requireAdmin(actor);
  const encKey = parseEncKey(env.CONNECTION_ENC_KEY);
  if (!encKey) throw new Forbidden("The bank is configured by environment variables. Set CONNECTION_ENC_KEY to connect Aran from this page.");
  const baseUrl = normalizeUrl(input.baseUrl);
  const existing = await loadSaved(db, env);
  const appKey = input.appKey.trim() || existing?.appKey || "";
  const complianceKey = input.complianceKey.trim() || existing?.complianceKey || "";
  const missing: Record<string, string> = {};
  if (!appKey) missing.appKey = "Enter the app key.";
  if (!complianceKey) missing.complianceKey = "Enter the compliance key.";
  if (Object.keys(missing).length) throw new BadInput(missing);
  if (appKey === complianceKey) throw new BadInput({ complianceKey: "The compliance key must be a different key from the app key." });

  const result = await runChecks({ baseUrl, appKey, complianceKey, source: "saved" }, fetchImpl);
  const values = {
    baseUrl, appKeyEnc: encryptSecret(appKey, "app_key", encKey), complianceKeyEnc: encryptSecret(complianceKey, "compliance_key", encKey),
    appKeyLast4: last4(appKey), complianceKeyLast4: last4(complianceKey), workspaceName: result.workspaceName, status: result.status,
    checks: result.checks, lastCheckedAt: new Date(), updatedBy: actor.email, updatedAt: new Date(),
  };
  await db.insert(t.aranConnection).values({ id: 1, ...values }).onConflictDoUpdate({ target: t.aranConnection.id, set: values });
  await audit(db, actor, "aran.connect", `saved connection to ${new URL(baseUrl).host}: ${OUTCOME[result.status]}`);
  invalidateCache();
  return getView(db, env);
}

/** Test the effective connection (saved, otherwise environment). Stores the result on the saved row when there is one. */
export async function testConnection(db: Db, actor: Actor, env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<ConnectionView> {
  requireAdmin(actor);
  const conn = await resolveConnection(db, env);
  if (!conn) {
    await audit(db, actor, "aran.test", "connection test: nothing configured");
    return { ...(await getView(db, env)), checks: [{ id: "none", group: "reach", label: "Aran connection", ok: false, detail: "No connection is saved and no environment variables are set." }] };
  }
  const result = await runChecks(conn, fetchImpl);
  if (conn.source === "saved") {
    await db.update(t.aranConnection).set({ status: result.status, workspaceName: result.workspaceName, checks: result.checks, lastCheckedAt: new Date() }).where(eq(t.aranConnection.id, 1));
  }
  await audit(db, actor, "aran.test", `connection test (${conn.source === "saved" ? "saved connection" : "environment variables"}): ${OUTCOME[result.status]}`);
  invalidateCache();
  const view = await getView(db, env);
  if (conn.source === "env") return { ...view, status: result.status, workspaceName: result.workspaceName, checks: result.checks, lastCheckedAt: new Date().toISOString() };
  return view;
}

export async function disconnect(db: Db, actor: Actor, env: Env = process.env): Promise<ConnectionView> {
  requireAdmin(actor);
  if (!parseEncKey(env.CONNECTION_ENC_KEY)) throw new Forbidden("The bank is configured by environment variables. There is no saved connection to remove.");
  await db.delete(t.aranConnection).where(eq(t.aranConnection.id, 1));
  await audit(db, actor, "aran.disconnect", "removed the saved connection; the bank falls back to its environment variables");
  invalidateCache();
  return getView(db, env);
}

// ------------------------------------------------------------------ short in-process cache used by lib/aran.ts
let cache: { at: number; value: ResolvedConnection | null } | null = null;
export function invalidateCache() { cache = null; }
export async function resolveCached(db: Db, env: Env = process.env, ttlMs = 5000): Promise<ResolvedConnection | null> {
  if (cache && Date.now() - cache.at < ttlMs) return cache.value;
  const value = await resolveConnection(db, env);
  cache = { at: Date.now(), value };
  return value;
}
