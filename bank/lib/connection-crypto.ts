// AES-256-GCM for the saved Aran keys. No `server-only` import so unit tests can use it.
// Format: v1.<iv>.<tag>.<ciphertext>, base64url. The field name is bound as additional authenticated data, so a ciphertext
// cannot be moved from one column to the other, and a wrong secret fails the tag check instead of returning garbage.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AAD = (field: string) => Buffer.from(`tessera-aran-connection:v1:${field}`);
const b64 = (b: Buffer) => b.toString("base64url");

/** CONNECTION_ENC_KEY: 32 random bytes as 64 hex characters or base64. Anything else is treated as "not configured". */
export function parseEncKey(raw: string | undefined | null): Buffer | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) { const b = Buffer.from(v, "base64"); return b.length === 32 ? b : null; }
  return null;
}

export function encryptSecret(plain: string, field: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(AAD(field));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", b64(iv), b64(c.getAuthTag()), b64(ct)].join(".");
}

/** Returns the plaintext, or null if the value is malformed or the key/field is wrong. Never throws and never echoes input. */
export function decryptSecret(stored: string, field: string, key: Buffer): string | null {
  try {
    const [v, iv, tag, ct] = stored.split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAAD(AAD(field));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch { return null; }
}
