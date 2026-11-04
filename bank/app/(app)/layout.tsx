import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Nav, type NavItem } from "@/components/Nav";
import { Button } from "@/components/ui";
import { can, requireSession, ROLE_LABEL } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const items: NavItem[] = ([
    ["/dashboard", "Dashboard", "dashboard"], ["/customers", "Customers", "customers"], ["/accounts", "Accounts", "accounts"],
    ["/support", "Support console", "support"], ["/vendor", "Loan vendor export", "vendor"], ["/compliance", "Compliance centre", "compliance"], ["/data-plane", "Data plane", "dataplane"],
  ] as const).filter(([, , f]) => can(s.role, f)).map(([href, label]) => ({ href, label }));
  return (
    <div className="min-h-[calc(100vh-61px)]">
      {/* top bar: bank green with the 3px gold line (DESIGN.md section 5) */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b-[3px] border-gold bg-bank px-4 text-white md:px-6">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded text-white no-underline"><Logo /></Link>
        <div className="flex items-center gap-3">
          <span className="hidden truncate text-[13px] text-white/80 sm:inline">{s.email}</span>
          <span className="rounded-full bg-white/20 px-3 py-0.5 text-[14px] font-semibold">{ROLE_LABEL[s.role]}</span>
          <form action={logout}><Button size="sm" type="submit" className="min-h-11 text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,.7)] hover:bg-white/10">Sign out</Button></form>
        </div>
      </header>
      <div className="md:grid md:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="fixed inset-x-0 bottom-0 z-30 border-t-[1.5px] border-ink bg-bond p-2 md:sticky md:top-14 md:h-[calc(100vh-56px)] md:border-r-[1.5px] md:border-t-0 md:p-4">
          <Nav items={items} />
        </aside>
        <main id="content" className="min-w-0 px-4 pb-28 pt-7 md:px-10 md:pb-16 md:pt-9">{children}</main>
      </div>
    </div>
  );
}
