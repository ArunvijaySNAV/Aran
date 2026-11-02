import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { staff, type Role } from "@/db/schema";
import { supabaseServer } from "./supabase/server";
import { Forbidden, type Actor } from "./domain";
import { appAran, complianceAran } from "./aran";

export type Feature = "dashboard" | "customers" | "onboard" | "accounts" | "support" | "vendor" | "compliance" | "dataplane";
const ACCESS: Record<Role, Feature[]> = {
  kyc_officer: ["dashboard", "customers", "onboard", "accounts"],
  support_agent: ["dashboard", "customers", "support"],
  compliance_officer: ["dashboard", "customers", "accounts", "compliance"],
  admin: ["dashboard", "customers", "onboard", "accounts", "support", "vendor", "compliance", "dataplane"],
};
export const can = (role: Role, f: Feature) => ACCESS[role].includes(f);
export const ROLE_LABEL: Record<Role, string> = { kyc_officer: "KYC officer", support_agent: "Support agent", compliance_officer: "Compliance officer", admin: "Administrator" };

export interface Session extends Actor { id: string; fullName: string; role: Role }

/** The signed-in staff member, or null. The role comes from core_banking.staff, never from the browser. */
export async function getSession(): Promise<Session | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const [row] = await getDb().select().from(staff).where(eq(staff.id, data.user.id));
  if (!row) return null;
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
}

export async function requireSession(feature?: Feature): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (feature && !can(s.role, feature)) redirect("/dashboard?denied=1");
  return s;
}
/** For server actions: throws instead of redirecting. */
export async function requireActionSession(feature: Feature): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Forbidden("Please sign in again.");
  if (!can(s.role, feature)) throw new Forbidden("Your role cannot do this.");
  return s;
}
export const deps = () => ({ db: getDb(), app: appAran(), compliance: complianceAran() });
