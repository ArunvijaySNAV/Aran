import { BadInput, Forbidden, NotFound, ServiceUnavailable } from "./domain";

export interface ActionState<T = unknown> { ok: boolean; status?: number; message?: string; fieldErrors?: Record<string, string>; data?: T }

/** Maps domain errors to a form-friendly state. Aran failures surface as 503 and nothing was written. */
export function fail(e: unknown): ActionState {
  if (e instanceof BadInput) return { ok: false, status: 422, message: e.message, fieldErrors: e.fields };
  if (e instanceof ServiceUnavailable) { console.error("aran unavailable:", (e.cause as Error)?.message ?? e.cause); return { ok: false, status: 503, message: e.message }; }
  if (e instanceof Forbidden) return { ok: false, status: 403, message: e.message };
  if (e instanceof NotFound) return { ok: false, status: 404, message: e.message };
  console.error(e);
  return { ok: false, status: 500, message: "Something went wrong. Nothing was saved." };
}
