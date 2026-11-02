"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem { href: string; label: string }
export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {items.map((i) => {
        const active = path === i.href || (i.href !== "/dashboard" && path.startsWith(i.href));
        return <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
          className={`flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-semibold ${active ? "bg-accentweak text-accent" : "text-muted hover:bg-surface2 hover:text-ink"}`}>{i.label}</Link>;
      })}
    </nav>
  );
}
