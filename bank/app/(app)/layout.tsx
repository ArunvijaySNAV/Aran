import { Logo } from "@/components/Logo";
import { Nav, type NavItem } from "@/components/Nav";
import { Badge, Button } from "@/components/ui";
import { can, requireSession, ROLE_LABEL } from "@/lib/auth";
import { logout } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const items: NavItem[] = ([
    ["/dashboard", "Dashboard", "dashboard"], ["/customers", "Customers", "customers"], ["/accounts", "Accounts", "accounts"],
    ["/support", "Support console", "support"], ["/vendor", "Loan vendor export", "vendor"], ["/compliance", "Compliance centre", "compliance"], ["/data-plane", "Data plane", "dataplane"],
  ] as const).filter(([, , f]) => can(s.role, f)).map(([href, label]) => ({ href, label }));
  return (
    <div className="md:grid md:min-h-[calc(100vh-57px)] md:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 border-b border-line bg-surface p-3 md:h-screen md:border-b-0 md:border-r md:p-4">
        <div className="mb-2 flex items-center justify-between md:mb-6 md:block"><Logo /><div className="md:mt-3"><Badge tone="accent">{ROLE_LABEL[s.role]}</Badge></div></div>
        <Nav items={items} />
        <form action={logout} className="mt-2 md:mt-6"><div className="mb-2 hidden truncate text-xs text-muted md:block">{s.email}</div><Button size="sm" type="submit" className="w-full">Sign out</Button></form>
      </aside>
      <main id="content" className="min-w-0 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
