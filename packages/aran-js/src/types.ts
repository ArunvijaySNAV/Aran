export interface AranOptions {
  /** Aran Cloud API key (server-side only; never ship it to a browser). */
  apiKey: string;
  /** Base URL of Aran Cloud, e.g. https://aran.example.com */
  baseUrl: string;
  /** Per-attempt timeout. Default 4000. */
  timeoutMs?: number;
  /** Override fetch (tests, custom agents). Default: global fetch. */
  fetch?: typeof fetch;
  /** Base delay of the exponential backoff between retries of idempotent calls. Default 150. */
  retryBaseMs?: number;
}

export type Purpose = "KYC" | "Loans" | "Service" | "Marketing";

export interface Finding {
  type: string;
  start: number;
  end: number;
  p: number;
  protected: boolean;
  token?: string | null;
  customer_ref?: string | null;
  purpose?: string | null;
  erasable?: boolean;
  [k: string]: unknown;
}

export interface ProtectInput {
  text: string;
  customerRef?: string;
  purpose?: Purpose | (string & {});
  sink?: string;
}

export interface ProtectResult {
  after: string;
  findings: Finding[];
  notes: string[];
  latencyMs: number;
  raw: Record<string, unknown>;
}

export type FieldKind = "name" | "mobile" | "aadhaar" | "card" | "pan" | "upi";

export interface ProtectFieldsInput {
  /** field name -> raw value. Field names: name, mobile, aadhaar, card, pan, upi (aliases accepted). */
  fields: Record<string, string>;
  customerRef: string;
  purpose: Purpose | (string & {});
  sink: string;
}

export interface GatewayInput {
  prompt: string;
  role: "kyc-officer" | "customer-care" | "analyst" | (string & {});
}

export interface DetokeniseResult {
  token: string;
  value: string | null;
  status: "ok" | "erased" | "unknown" | (string & {});
  reason?: string;
}

export interface TraceResult {
  candidates: number;
  matched: number;
  ranking: { sink: string; tokens: number; share: number }[];
  top: { sink: string; tokens: number; share: number } | null;
  items: { value: string; sink: string | null; how: string | null }[];
  raw_identifiers_in_dump: number;
}

export interface Receipt {
  event: Record<string, unknown>;
  signature: string;
  public_key: string;
  alg?: string;
  key_id?: string;
  [k: string]: unknown;
}

export interface VerifyResult {
  valid: boolean;
  signature_valid?: boolean;
  included_in_log?: boolean;
  post_quantum_valid?: boolean | null;
  error?: string;
  [k: string]: unknown;
}
