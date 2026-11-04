"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string }
// Display labels (DESIGN.md section 12); hrefs and access rules come from the layout unchanged.
const LABELS: Record<string, string> = { "/support": "Support", "/vendor": "Vendor exports", "/compliance": "Compliance", "/data-plane": "Data Plane" };
export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((i) => {
        const active = path === i.href || (i.href !== "/dashboard" && path.startsWith(i.href));
        return <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
          className={`flex min-h-11 items-center whitespace-nowrap rounded-[8px] px-3.5 text-[15px] font-semibold ${active ? "bg-bank text-white" : "text-ink2 hover:bg-stock hover:text-ink"}`}>{LABELS[i.href] ?? i.label}</Link>;
      })}
    </nav>
  );
}
