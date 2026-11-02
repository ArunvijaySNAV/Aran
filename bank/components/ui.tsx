import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

const button = cva("inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60", {
  variants: {
    variant: {
      primary: "border-accent bg-accent text-accentfg hover:brightness-110",
      outline: "border-line2 bg-surface text-ink hover:bg-surface2",
      danger: "border-bad bg-surface text-bad hover:bg-badweak",
      ghost: "border-transparent bg-transparent text-ink hover:bg-surface2",
    },
    size: { md: "", sm: "min-h-9 px-3 text-xs" },
  },
  defaultVariants: { variant: "outline", size: "md" },
});
export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant, size }), className)} {...p} />;
}
export const linkButton = (v: VariantProps<typeof button> = {}, extra?: string) => cn(button(v), "no-underline", extra);

const field = "min-h-11 w-full rounded-lg border border-line2 bg-surface px-3 py-2 text-base text-ink placeholder:text-muted aria-[invalid=true]:border-bad";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, "min-h-24", className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, className)} {...p} />;

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold">{label}</label>
      {children}
      {/* fixed-height message slot: a field error appearing or clearing must never move the controls below it */}
      <div className="min-h-10">
        {error ? <p id={`${htmlFor}-err`} role="alert" className="text-sm text-bad">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLElement>) => <section className={cn("min-w-0 rounded-xl border border-line bg-surface p-5 shadow-sm", className)} {...p} />;
export const CardTitle = ({ children }: { children: ReactNode }) => <h2 className="mb-3 text-base font-semibold">{children}</h2>;

const badge = { ok: "bg-okweak text-ok", warn: "bg-warnweak text-warn", bad: "bg-badweak text-bad", neutral: "bg-surface2 text-muted", accent: "bg-accentweak text-accent" } as const;
export const Badge = ({ tone = "neutral", children }: { tone?: keyof typeof badge; children: ReactNode }) => (
  <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", badge[tone])}>{children}</span>
);

export const Banner = ({ tone = "neutral", children, role }: { tone?: "ok" | "warn" | "bad" | "neutral"; children: ReactNode; role?: string }) => (
  <div role={role} className={cn("rounded-lg border border-line px-4 py-3 text-sm", tone === "ok" && "border-transparent bg-okweak text-ok", tone === "warn" && "border-transparent bg-warnweak text-warn", tone === "bad" && "border-transparent bg-badweak text-bad", tone === "neutral" && "bg-surface2")}>{children}</div>
);
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-line2 bg-surface px-4 py-9 text-center text-sm text-muted"><strong className="mb-1 block text-base text-ink">{title}</strong>{children}</div>
);
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn("skel h-5", className)} />;
export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <Card><div className="text-3xl font-bold tabular-nums">{value}</div><div className="text-sm font-medium text-muted">{label}</div>{sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}</Card>
);
export function Table({ head, children, label }: { head: string[]; children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table aria-label={label} className="w-full border-collapse text-sm">
        <thead><tr>{head.map((h) => <th key={h} scope="col" className="whitespace-nowrap border-b border-line bg-surface2 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">{h}</th>)}</tr></thead>
        <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_tr:last-child_td]:border-b-0">{children}</tbody>
      </table>
    </div>
  );
}
export const Mono = ({ children }: { children: ReactNode }) => <code className="break-all font-mono text-xs">{children}</code>;
export const rupees = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const when = (d: Date | string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
