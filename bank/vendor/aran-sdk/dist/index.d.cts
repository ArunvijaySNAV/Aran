interface AranOptions {
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
type Purpose = "KYC" | "Loans" | "Service" | "Marketing";
interface Finding {
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
interface ProtectInput {
    text: string;
    customerRef?: string;
    purpose?: Purpose | (string & {});
    sink?: string;
}
interface ProtectResult {
    after: string;
    findings: Finding[];
    notes: string[];
    latencyMs: number;
    raw: Record<string, unknown>;
}
type FieldKind = "name" | "mobile" | "aadhaar" | "card" | "pan" | "upi";
interface ProtectFieldsInput {
    /** field name -> raw value. Field names: name, mobile, aadhaar, card, pan, upi (aliases accepted). */
    fields: Record<string, string>;
    customerRef: string;
    purpose: Purpose | (string & {});
    sink: string;
}
interface GatewayInput {
    prompt: string;
    role: "kyc-officer" | "customer-care" | "analyst" | (string & {});
}
interface DetokeniseResult {
    token: string;
    value: string | null;
    status: "ok" | "erased" | "unknown" | (string & {});
    reason?: string;
}
interface TraceResult {
    candidates: number;
    matched: number;
    ranking: {
        sink: string;
        tokens: number;
        share: number;
    }[];
    top: {
        sink: string;
        tokens: number;
        share: number;
    } | null;
    items: {
        value: string;
        sink: string | null;
        how: string | null;
    }[];
    raw_identifiers_in_dump: number;
}
interface Receipt {
    event: Record<string, unknown>;
    signature: string;
    public_key: string;
    alg?: string;
    key_id?: string;
    [k: string]: unknown;
}
interface VerifyResult {
    valid: boolean;
    signature_valid?: boolean;
    included_in_log?: boolean;
    post_quantum_valid?: boolean | null;
    error?: string;
    [k: string]: unknown;
}

declare class Aran {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeoutMs;
    private readonly fetchImpl;
    private readonly retryBaseMs;
    constructor(opts: AranOptions);
    private attempt;
    private static detail;
    private call;
    /** Tokenise sensitive values in free text. Not retried: a retry could issue a second token set. */
    protect(input: ProtectInput): Promise<ProtectResult>;
    /**
     * Tokenise labelled fields in ONE request (one sentence per field) and return the token for each field.
     * Throws AranUnprotectedError if any field is not provably tokenised; never returns a raw value.
     */
    protectFields(input: ProtectFieldsInput): Promise<Record<string, string>>;
    /** Redact a prompt through the AI gateway. */
    gateway(input: GatewayInput): Promise<Record<string, unknown>>;
    /** Find which sink leaked a dump of tokens. */
    trace(input: {
        dump: string;
    }): Promise<TraceResult>;
    /** Reveal a token's original value. Needs the `detokenise` scope; every call is audited. */
    detokenise(input: {
        token: string;
        caller?: string;
    }): Promise<DetokeniseResult>;
    /** Destroy a customer's key for a purpose (right to erasure). Returns the signed receipt. */
    erase(input: {
        customerRef: string;
        purpose: string;
    }): Promise<Receipt>;
    /** Verify an erasure receipt against this workspace's signing keys. */
    verifyReceipt(receipt: Receipt): Promise<VerifyResult>;
}

/** Base class of every error the SDK throws. */
declare class AranError extends Error {
    readonly status: number | undefined;
    readonly body: unknown;
    constructor(message: string, status?: number, body?: unknown);
}
/** 401: the API key is missing, invalid or revoked. */
declare class AranAuthError extends AranError {
    constructor(message: string, body?: unknown);
}
/** 403: the key is valid but lacks the scope for this call. */
declare class AranScopeError extends AranError {
    constructor(message: string, body?: unknown);
}
/** 429: too many requests. `retryAfter` is in seconds (from the Retry-After header). */
declare class AranRateLimitError extends AranError {
    readonly retryAfter: number | undefined;
    constructor(message: string, retryAfter: number | undefined, body?: unknown);
}
/** The request never produced a response: DNS, connection, TLS, abort or timeout. */
declare class AranNetworkError extends AranError {
    readonly cause: unknown;
    constructor(message: string, cause?: unknown);
}
/**
 * A value that had to be tokenised came back unprotected (or could not be located in the response).
 * The SDK never returns raw values: the caller must treat this as a failure and write nothing.
 */
declare class AranUnprotectedError extends AranError {
    readonly field: string;
    constructor(field: string, reason: string);
}

export { Aran, AranAuthError, AranError, AranNetworkError, type AranOptions, AranRateLimitError, AranScopeError, AranUnprotectedError, type DetokeniseResult, type FieldKind, type Finding, type GatewayInput, type ProtectFieldsInput, type ProtectInput, type ProtectResult, type Purpose, type Receipt, type TraceResult, type VerifyResult };
