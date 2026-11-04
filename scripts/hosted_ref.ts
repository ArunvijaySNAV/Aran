// Pure helpers for reset_hosted_demo.ts (kept separate so they are unit-tested without a database).
export type RefCheck = { ok: true; ref: string } | { ok: false; why: string };

/** Supabase project ref from a connection string: direct host db.<ref>.supabase.co, or pooler user postgres.<ref>. */
export function projectRefFromUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  if (direct) return direct[1]!;
  if (/\.pooler\.supabase\.com$/.test(u.hostname)) {
    const m = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username));
    if (m) return m[1]!;
  }
  return null;
}

export const isLocalUrl = (url: string) => { try { return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url).hostname); } catch { return false; } };

/** The guard: refuse unless HOSTED_PROJECT_REF is set and equals the ref in DATABASE_URL. */
export function checkRef(databaseUrl: string | undefined, expected: string | undefined): RefCheck {
  if (!databaseUrl) return { ok: false, why: "DATABASE_URL is not set." };
  if (!expected) return { ok: false, why: "HOSTED_PROJECT_REF is not set. Set it to the project ref you intend to reset." };
  if (isLocalUrl(databaseUrl)) return { ok: false, why: "DATABASE_URL points at a local database; this script is for hosted projects only." };
  const ref = projectRefFromUrl(databaseUrl);
  if (!ref) return { ok: false, why: "Cannot read a Supabase project ref from DATABASE_URL (expected db.<ref>.supabase.co or a pooler user postgres.<ref>)." };
  if (ref !== expected) return { ok: false, why: "HOSTED_PROJECT_REF does not match the project in DATABASE_URL. Nothing was changed." };
  return { ok: true, ref };
}
