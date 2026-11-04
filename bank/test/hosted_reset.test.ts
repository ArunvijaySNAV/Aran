import { describe, expect, it } from "vitest";
import { checkRef, projectRefFromUrl } from "../../scripts/hosted_ref";

const REF = "abcdefghijklmnopqrst";            // a made-up 20-character ref
const direct = `postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`;
const pooler = `postgresql://postgres.${REF}:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;

describe("hosted reset guard", () => {
  it("reads the ref from a direct and a pooler URL", () => {
    expect(projectRefFromUrl(direct)).toBe(REF);
    expect(projectRefFromUrl(pooler)).toBe(REF);
  });
  it("accepts only when HOSTED_PROJECT_REF equals the URL's ref", () => {
    expect(checkRef(direct, REF)).toEqual({ ok: true, ref: REF });
    expect(checkRef(pooler, REF)).toEqual({ ok: true, ref: REF });
  });
  it("refuses a different ref, a missing ref, a missing URL", () => {
    expect(checkRef(direct, "zzzzzzzzzzzzzzzzzzzz").ok).toBe(false);
    expect(checkRef(direct, undefined).ok).toBe(false);
    expect(checkRef(undefined, REF).ok).toBe(false);
  });
  it("refuses local databases and unrecognised hosts", () => {
    expect(checkRef("postgresql://postgres:postgres@127.0.0.1:54322/postgres", REF).ok).toBe(false);
    expect(checkRef("postgresql://postgres:postgres@localhost:5432/postgres", REF).ok).toBe(false);
    expect(checkRef("postgresql://u:p@example.com:5432/db", REF).ok).toBe(false);
    expect(checkRef("not a url", REF).ok).toBe(false);
  });
  it("does not echo the connection string in a refusal", () => {
    const r = checkRef(direct, "zzzzzzzzzzzzzzzzzzzz");
    expect(JSON.stringify(r)).not.toContain("pw");
  });
});
