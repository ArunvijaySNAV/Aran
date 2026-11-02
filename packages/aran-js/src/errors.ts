/** Base class of every error the SDK throws. */
export class AranError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
  }
}

/** 401: the API key is missing, invalid or revoked. */
export class AranAuthError extends AranError {
  constructor(message: string, body?: unknown) {
    super(message, 401, body);
  }
}

/** 403: the key is valid but lacks the scope for this call. */
export class AranScopeError extends AranError {
  constructor(message: string, body?: unknown) {
    super(message, 403, body);
  }
}

/** 429: too many requests. `retryAfter` is in seconds (from the Retry-After header). */
export class AranRateLimitError extends AranError {
  readonly retryAfter: number | undefined;
  constructor(message: string, retryAfter: number | undefined, body?: unknown) {
    super(message, 429, body);
    this.retryAfter = retryAfter;
  }
}

/** The request never produced a response: DNS, connection, TLS, abort or timeout. */
export class AranNetworkError extends AranError {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

/**
 * A value that had to be tokenised came back unprotected (or could not be located in the response).
 * The SDK never returns raw values: the caller must treat this as a failure and write nothing.
 */
export class AranUnprotectedError extends AranError {
  readonly field: string;
  constructor(field: string, reason: string) {
    super(`Aran did not protect field "${field}": ${reason}`);
    this.field = field;
  }
}
