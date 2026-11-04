import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, like, sql } from "drizzle-orm";
import { makeDb, type Db } from "@/db";
import * as t from "@/db/schema";
import { decryptSecret, encryptSecret, parseEncKey } from "@/lib/connection-crypto";
import { disconnect, fromEnv, getView, invalidateCache, loadSaved, normalizeUrl, readView, resolveConnection, runChecks, saveConnection, scrub, testConnection } from "@/lib/connection";
import { Forbidden, ServiceUnavailable, type Actor } from "@/lib/domain";
import { findKeys, scanPlaintext } from "@/lib/scan";
import { APP_KEY, COMPLIANCE_KEY, MockAran } from "./mockAran";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ENC = "a".repeat(64);                    // 32 bytes as hex; a test value, not a real secret
const OTHER_ENC = "b".repeat(64);
let db: Db; let mock: MockAran;
const admin: Actor = { id: crypto.randomUUID(), email: "test-admin@tessera.test", role: "admin" };
const others: Actor[] = (["kyc_officer", "support_agent", "compliance_officer"] as const).map((role) => ({ id: crypto.randomUUID(), email: `test-${role}@tessera.test`, role }));
const env = (over: Record<string, string | undefined> = {}) => ({ CONNECTION_ENC_KEY: ENC, ...over });
const input = () => ({ baseUrl: mock.url, appKey: APP_KEY, complianceKey: COMPLIANCE_KEY });
const everything = async () => JSON.stringify([
  await db.$client.unsafe(`select * from core_banking.aran_connection`),
  await db.$client.unsafe(`select actor, action, line from log_platform.app_logs where actor like 'test-%'`),
]);

beforeAll(async () => { db = makeDb(DB_URL); mock = await new MockAran().start(); });
beforeEach(async () => { mock.reset(); invalidateCache(); await db.delete(t.aranConnection); await db.execute(sql`delete from log_platform.app_logs where actor like 'test-%'`); });
afterAll(async () => { await db.delete(t.aranConnection); await db.execute(sql`delete from log_platform.app_logs where actor like 'test-%'`); await mock.stop(); await db.$client.end(); });

describe("encryption", () => {
  const key = parseEncKey(ENC)!;
  it("round-trips, with a fresh IV each time", () => {
    const a = encryptSecret(APP_KEY, "app_key", key), b = encryptSecret(APP_KEY, "app_key", key);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain(APP_KEY);
    expect(decryptSecret(a, "app_key", key)).toBe(APP_KEY);
  });
  it("a wrong secret, a wrong field, a tampered or malformed value fail safely (null, no throw, no echo)", () => {
    const enc = encryptSecret(APP_KEY, "app_key", key);
    expect(decryptSecret(enc, "app_key", parseEncKey(OTHER_ENC)!)).toBeNull();
    expect(decryptSecret(enc, "compliance_key", key)).toBeNull();
    const parts = enc.split("."); parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("AA") ? "BB" : "AA");
    expect(decryptSecret(parts.join("."), "app_key", key)).toBeNull();
    for (const junk of ["", "v1", "v2.a.b.c", "v1.a.b.c", "not encrypted"]) expect(decryptSecret(junk, "app_key", key)).toBeNull();
  });
  it("CONNECTION_ENC_KEY accepts 32 bytes as hex or base64 and nothing else", () => {
    expect(parseEncKey(ENC)?.length).toBe(32);
    expect(parseEncKey(Buffer.alloc(32, 7).toString("base64"))?.length).toBe(32);
    for (const bad of [undefined, "", "short", "z".repeat(64), "a".repeat(63), Buffer.alloc(16).toString("base64")]) expect(parseEncKey(bad)).toBeNull();
  });
  it("scrub removes known keys and anything shaped like a key", () => {
    expect(scrub(`bad ${APP_KEY} and aran_live_0123456789abcdef0123`, [APP_KEY])).toBe("bad [key] and [key]");
  });
  it("address check", () => {
    expect(normalizeUrl(" https://aran.example.com/ ")).toBe("https://aran.example.com");
    for (const bad of ["", "aran.example.com", "ftp://x.y", "https://user:pw@aran.example.com"]) expect(() => normalizeUrl(bad)).toThrow();
  });
});

describe("only an administrator can read or change the connection", () => {
  it("every other role is refused for read, save, test and disconnect, and nothing is written", async () => {
    for (const a of others) {
      await expect(readView(db, a, env())).rejects.toBeInstanceOf(Forbidden);
      await expect(saveConnection(db, a, input(), env())).rejects.toBeInstanceOf(Forbidden);
      await expect(testConnection(db, a, env())).rejects.toBeInstanceOf(Forbidden);
      await expect(disconnect(db, a, env())).rejects.toBeInstanceOf(Forbidden);
    }
    expect((await db.select().from(t.aranConnection)).length).toBe(0);
    expect(mock.calls.length).toBe(0);
  });
  it("an actor without a role is refused too", async () => {
    await expect(saveConnection(db, { id: null, email: "test-anon@tessera.test" }, input(), env())).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("save, test, disconnect", () => {
  it("save encrypts both keys, tests the connection and shows only the public view", async () => {
    const view = await saveConnection(db, admin, input(), env());
    expect(view).toMatchObject({ status: "connected", source: "saved", workspaceName: "Mock Bank", baseUrl: mock.url, appKeyLast4: APP_KEY.slice(-4), complianceKeyLast4: COMPLIANCE_KEY.slice(-4), updatedBy: admin.email, editable: true });
    const checks = view.checks.map((c) => c.id);
    expect(checks).toEqual(expect.arrayContaining(["reach", "app-accepted", "app-protect", "app-gateway", "app-trace", "compliance-accepted", "compliance-detokenise", "compliance-erase", "compliance-verify", "compliance-dashboard"]));
    expect(view.checks.every((c) => c.ok)).toBe(true);
    const [row] = await db.select().from(t.aranConnection);
    expect(row!.appKeyEnc.startsWith("v1.") && row!.complianceKeyEnc.startsWith("v1.")).toBe(true);
    expect((await loadSaved(db, env()))).toMatchObject({ appKey: APP_KEY, complianceKey: COMPLIANCE_KEY, source: "saved" });
  });
  it("a second save with blank key fields keeps the saved keys; a first save needs both", async () => {
    await expect(saveConnection(db, admin, { ...input(), appKey: "" }, env())).rejects.toMatchObject({ fields: { appKey: expect.any(String) } });
    await saveConnection(db, admin, input(), env());
    const v = await saveConnection(db, admin, { baseUrl: mock.url + "/", appKey: "", complianceKey: "" }, env());
    expect(v.status).toBe("connected");
    expect((await loadSaved(db, env()))?.appKey).toBe(APP_KEY);
  });
  it("the same key cannot be both the app key and the compliance key", async () => {
    await expect(saveConnection(db, admin, { ...input(), complianceKey: APP_KEY }, env())).rejects.toMatchObject({ fields: { complianceKey: expect.any(String) } });
  });
  it("disconnect removes the row and the bank falls back to its environment variables", async () => {
    await saveConnection(db, admin, input(), env());
    const e = env({ ARAN_BASE_URL: "http://env.example", ARAN_APP_KEY: "env-app-key-value", ARAN_COMPLIANCE_KEY: "env-comp-key-value" });
    expect(await resolveConnection(db, e)).toMatchObject({ source: "saved" });
    const v = await disconnect(db, admin, e);
    expect((await db.select().from(t.aranConnection)).length).toBe(0);
    expect(v).toMatchObject({ source: "env", status: "not_connected", baseUrl: "http://env.example", appKeyLast4: null });
    expect(await resolveConnection(db, e)).toMatchObject({ source: "env", appKey: "env-app-key-value" });
  });
  it("connect, test and disconnect are audited with who and outcome, and never with key material", async () => {
    await saveConnection(db, admin, input(), env());
    await testConnection(db, admin, env());
    await disconnect(db, admin, env());
    const logs = await db.select().from(t.appLogs).where(like(t.appLogs.actor, "test-%"));
    expect(logs.map((l) => l.action).sort()).toEqual(["aran.connect", "aran.disconnect", "aran.test"]);
    expect(logs.every((l) => l.actor === admin.email)).toBe(true);
    expect(logs.find((l) => l.action === "aran.connect")!.line).toContain("connected");
    for (const l of logs) for (const k of [APP_KEY, COMPLIANCE_KEY, APP_KEY.slice(-4), COMPLIANCE_KEY.slice(-4)]) expect(l.line).not.toContain(k);
  });
});

describe("resolution order and fail-closed", () => {
  const E = { ARAN_BASE_URL: "http://env.example", ARAN_APP_KEY: "env-app-key-value", ARAN_COMPLIANCE_KEY: "env-comp-key-value" };
  it("with nothing saved the environment variables are used exactly as before", async () => {
    expect(await resolveConnection(db, E)).toEqual({ baseUrl: "http://env.example", appKey: "env-app-key-value", complianceKey: "env-comp-key-value", source: "env" });
    expect(fromEnv({})).toBeNull();
    expect(fromEnv({ ARAN_BASE_URL: "x", ARAN_APP_KEY: "y" })).toBeNull();
  });
  it("the saved connection wins when it exists and decrypts", async () => {
    await saveConnection(db, admin, input(), env(E));
    expect(await resolveConnection(db, env(E))).toMatchObject({ source: "saved", baseUrl: mock.url });
  });
  it("a saved connection that cannot be decrypted (wrong secret) is ignored and the environment variables are used", async () => {
    await saveConnection(db, admin, input(), env(E));
    const wrong = { ...E, CONNECTION_ENC_KEY: OTHER_ENC };
    expect(await loadSaved(db, wrong)).toBeNull();
    expect(await resolveConnection(db, wrong)).toMatchObject({ source: "env" });
    const v = await getView(db, wrong);
    expect(v.source).toBe("env");
    expect(v.checks[0]!.detail).toContain("cannot be read");
    expect(JSON.stringify(v)).not.toContain(APP_KEY);
  });
  it("without CONNECTION_ENC_KEY the page is read-only: saving and disconnecting are refused, the environment is used", async () => {
    await expect(saveConnection(db, admin, input(), E)).rejects.toThrow(/configured by environment variables/);
    await expect(disconnect(db, admin, E)).rejects.toThrow(/environment variables/);
    expect((await getView(db, E)).editable).toBe(false);
    expect(await resolveConnection(db, E)).toMatchObject({ source: "env" });
  });
  it("with nothing configured the lookup finds nothing and the Aran client fails closed with the 503 message", async () => {
    expect(await resolveConnection(db, {})).toBeNull();
    const saved = { ...process.env };
    for (const k of ["ARAN_BASE_URL", "ARAN_APP_KEY", "ARAN_COMPLIANCE_KEY", "CONNECTION_ENC_KEY"]) delete process.env[k];
    process.env.DATABASE_URL = DB_URL;
    try {
      invalidateCache();
      const { appAran, complianceAran } = await import("@/lib/aran");
      const err = await appAran().protect({ text: "hello", sink: "crm", purpose: "KYC" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailable);
      expect((err as Error).message).toBe("Data protection service unavailable. Nothing was saved.");
      expect((await complianceAran().detokenise({ token: "x" }).catch((e: unknown) => e))).toBeInstanceOf(ServiceUnavailable);
    } finally { Object.assign(process.env, saved); invalidateCache(); }
  });
});

describe("test connection", () => {
  const conn = () => ({ baseUrl: mock.url, appKey: APP_KEY, complianceKey: COMPLIANCE_KEY, source: "saved" as const });
  it("all checks pass against a healthy Aran and no probe carries customer data", async () => {
    const r = await runChecks(conn());
    expect(r.status).toBe("connected");
    expect(r.workspaceName).toBe("Mock Bank");
    expect(mock.calls.map((c) => c.path).sort()).toEqual(["/v1/dashboard", "/v1/detokenise", "/v1/erase", "/v1/gateway", "/v1/health", "/v1/protect", "/v1/receipts/verify", "/v1/trace"]);
    expect(mock.vault.size).toBe(0);   // nothing was tokenised
    expect(mock.erased.size).toBe(0);  // nothing was erased
  });
  it("a key in the wrong slot is reported as missing permissions, per check, in plain language", async () => {
    const r = await runChecks({ ...conn(), appKey: COMPLIANCE_KEY, complianceKey: APP_KEY });
    expect(r.status).toBe("key_rejected");
    const bad = r.checks.filter((c) => !c.ok);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((c) => c.detail === "This key does not have that permission.")).toBe(true);
  });
  it("a rejected key is reported on its own", async () => {
    const r = await runChecks({ ...conn(), appKey: "aran_live_wrongwrongwrongwrong" });
    expect(r.status).toBe("key_rejected");
    expect(r.checks.find((c) => c.id === "app-accepted")).toMatchObject({ ok: false, detail: "Aran says this key is invalid, missing or revoked." });
    expect(r.checks.find((c) => c.id === "compliance-accepted")!.ok).toBe(true);
  });
  it("Aran down or an unreachable address is Unreachable, and no key appears in the result", async () => {
    mock.down = true;
    const down = await runChecks(conn());
    expect(down.status).toBe("unreachable");
    mock.down = false;
    const gone = await runChecks({ ...conn(), baseUrl: "http://127.0.0.1:9" });
    expect(gone.status).toBe("unreachable");
    expect(JSON.stringify([down, gone])).not.toMatch(/aran_live_mock/);
  });
  it("testing with nothing configured says so instead of failing", async () => {
    const v = await testConnection(db, admin, {});
    expect(v.checks[0]!.detail).toContain("No connection is saved");
  });
  it("testing the environment connection does not store anything", async () => {
    const v = await testConnection(db, admin, env({ ARAN_BASE_URL: mock.url, ARAN_APP_KEY: APP_KEY, ARAN_COMPLIANCE_KEY: COMPLIANCE_KEY }));
    expect(v).toMatchObject({ source: "env", status: "connected", workspaceName: "Mock Bank" });
    expect((await db.select().from(t.aranConnection)).length).toBe(0);
  });
});

describe("no key is ever stored in clear or returned", () => {
  it("not in the table, the audit lines, any returned view, any log line or any error", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const outputs: unknown[] = [];
    outputs.push(await saveConnection(db, admin, input(), env()));
    outputs.push(await testConnection(db, admin, env()));
    outputs.push(await readView(db, admin, env()));
    outputs.push(await saveConnection(db, admin, { ...input(), appKey: "aran_live_wrongwrongwrongwrong" }, env()));
    outputs.push(await saveConnection(db, admin, { ...input(), baseUrl: "http://127.0.0.1:9" }, env()));
    for (const bad of [{ ...input(), baseUrl: "nope" }, { ...input(), complianceKey: APP_KEY }]) outputs.push(await saveConnection(db, admin, bad, env()).catch((e: Error & { fields?: unknown }) => ({ message: e.message, fields: e.fields })));
    outputs.push(await saveConnection(db, others[0]!, input(), env()).catch((e: Error) => e.message));
    outputs.push(await disconnect(db, admin, env()));
    const blob = JSON.stringify(outputs) + (await everything()) + spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
    spies.forEach((s) => s.mockRestore());
    for (const secret of [APP_KEY, COMPLIANCE_KEY, "aran_live_wrongwrongwrongwrong"]) expect(blob).not.toContain(secret);
    expect(blob).not.toMatch(/aran_live_[0-9a-zA-Z]{8,}/);
  });
  it("the plaintext scan flags a stored Aran key and ignores the encrypted columns", async () => {
    await saveConnection(db, admin, input(), env());
    const clean = await scanPlaintext(db.$client, { secrets: [APP_KEY, COMPLIANCE_KEY] });
    expect(clean.findings.filter((f) => f.kind === "aran-key")).toEqual([]);
    expect(findKeys("x aran_live_0123456789abcdef0123456789abcdef y")).toEqual([{ kind: "aran-key", masked: "aran_…" }]);
    expect(findKeys(`token ${APP_KEY} here`, [APP_KEY])).toHaveLength(1);
    expect(findKeys("no key here")).toEqual([]);
    // plant a raw key in a text column: the scan must catch it, and must not echo it
    await db.insert(t.appLogs).values({ actor: "test-scan@tessera.test", action: "test.plant", line: "oops aran_live_0123456789abcdef0123456789abcdef" });
    const dirty = await scanPlaintext(db.$client, { secrets: [] });
    const hit = dirty.findings.find((f) => f.kind === "aran-key");
    expect(hit).toBeTruthy();
    expect(JSON.stringify(hit)).not.toContain("0123456789abcdef");
    await db.delete(t.appLogs).where(eq(t.appLogs.actor, "test-scan@tessera.test"));
  });
});
