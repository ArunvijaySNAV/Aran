import { NextResponse } from "next/server";
import { deps, getSession, can } from "@/lib/auth";
import { BadInput, onboardCustomer, ServiceUnavailable } from "@/lib/domain";

/** JSON API used by integrations/tests. Fails closed: if Aran is unreachable the answer is 503 and nothing is written. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ detail: "Not signed in" }, { status: 401 });
  if (!can(s.role, "onboard")) return NextResponse.json({ detail: "Your role cannot onboard customers" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  try {
    const r = await onboardCustomer(deps(), s, body);
    return NextResponse.json({ customerRef: r.customerRef }, { status: 201 });
  } catch (e) {
    if (e instanceof ServiceUnavailable) return NextResponse.json({ detail: e.message }, { status: 503 });
    if (e instanceof BadInput) return NextResponse.json({ detail: e.message, fields: e.fields }, { status: 422 });
    console.error(e);
    return NextResponse.json({ detail: "Internal error. Nothing was saved." }, { status: 500 });
  }
}
