import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Guilloche } from "@/components/aran/Guilloche";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export const cn = (...a: ClassValue[]) => twMerge(clsx(a));

// Buttons: 46px, radius 8, press = 1px down. Primary = bank green; secondary = 1.5px ink outline. Destructive is outlined, never red.
const button = cva("inline-flex min-h-[46px] items-center justify-center gap-2 rounded-[8px] px-5 py-2 text-[16px] font-bold transition-[transform,background-color] duration-150 ease-[var(--ease)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45", {
  variants: {
    variant: {
      primary: "bg-bank text-white hover:bg-[#08463a]",
      outline: "bg-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--ink)] hover:bg-bond",
      danger: "bg-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--ink)] hover:bg-attentionsoft",
      ghost: "bg-transparent text-ink hover:bg-bond",
      night: "bg-nighttoken text-night hover:brightness-110",
    },
    size: { md: "", sm: "min-h-11 px-3.5 text-[14px]" },
  },
  defaultVariants: { variant: "outline", size: "md" },
});
export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant, size }), className)} {...p} />;
}
export const linkButton = (v: VariantProps<typeof button> = {}, extra?: string) => cn(button(v), "no-underline", extra);

// Inputs: 17px text, radius 8, 1.5px rule border on bond; focus = bank border + soft ring; error = attention (red is reserved for raw data)
const field = "min-h-[46px] w-full rounded-[8px] border-[1.5px] border-rulestrong bg-bond px-3 py-2.5 text-[17px] text-ink placeholder:text-ink2 placeholder:opacity-80 focus:border-bank focus:outline focus:outline-[3px] focus:outline-banksoft aria-[invalid=true]:border-attention";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, "min-h-28", className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, className)} {...p} />;

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[15px] font-medium text-ink2">{label}</label>
      {children}
      {/* fixed-height message slot: a field error appearing or clearing must never move the controls below it */}
      <div className="min-h-7">
        {error ? <p id={`${htmlFor}-err`} role="alert" className="flex items-start gap-1.5 text-[14px] font-medium text-attention"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 shrink-0"><path d="M8 1.5l7 12.5H1L8 1.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>{error}</p> : hint ? <p className="text-[13px] text-ink2">{hint}</p> : null}
      </div>
    </div>
  );
}

// Panels: bond paper with the 1.5px ink printed edge, radius 14
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLElement>) => <section className={cn("edge min-w-0 rounded-[14px] bg-bond p-5 sm:p-6", className)} {...p} />;
export const CardTitle = ({ children }: { children: ReactNode }) => <h2 className="mb-3 text-[19px] font-bold leading-tight [font-stretch:100%]">{children}</h2>;

const badge = { ok: "bg-sealsoft text-seal", warn: "bg-attentionsoft text-attention", bad: "bg-attentionsoft text-attention", neutral: "bg-stock text-ink2 shadow-[inset_0_0_0_1px_var(--rule)]", accent: "bg-banksoft text-bank" } as const;
export const Badge = ({ tone = "neutral", children }: { tone?: keyof typeof badge; children: ReactNode }) => (
  <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold", badge[tone])}>{children}</span>
);

const bannerIcon = {
  ok: <path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  warn: <><path d="M8 1.5l7 12.5H1L8 1.5z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>,
  neutral: <><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>,
};
export const Banner = ({ tone = "neutral", children, role }: { tone?: "ok" | "warn" | "bad" | "neutral"; children: ReactNode; role?: string }) => (
  <div role={role} className={cn("block rounded-[8px] border-[1.5px] px-4 py-3 text-[15px]", tone === "ok" && "border-seal bg-sealsoft text-seal", (tone === "warn" || tone === "bad") && "border-attention bg-attentionsoft text-attention", tone === "neutral" && "border-rule bg-bond text-ink")}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="float-left mr-2.5 mt-1 shrink-0">{bannerIcon[tone === "bad" ? "warn" : tone]}</svg>
    {children}
  </div>
);
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="rounded-[14px] border-[1.5px] border-dashed border-rule bg-bond px-4 py-9 text-center text-[15px] text-ink2"><strong className="mb-1 block text-[17px] font-bold text-ink">{title}</strong>{children}</div>
);
export const Skeleton = ({ className }: { className?: string }) => <div aria-hidden className={cn("skel h-5", className)} />;

// Big numerals: expanded width, 800, tabular. `lead` makes it the hero tile: it carries the guilloche corner.
export const Stat = ({ label, value, sub, lead = false, className }: { label: string; value: ReactNode; sub?: string; lead?: boolean; className?: string }) => (
  <Card className={cn("relative flex flex-col overflow-hidden", className)}>
    {lead ? <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-[300px] w-[300px] text-seal opacity-40 [mask-image:linear-gradient(to_left,#000_20%,transparent_72%)]"><Guilloche className="h-full w-full" /></div> : null}
    <div className="relative flex flex-1 flex-col justify-between gap-6">
      <div className={cn("w-expanded tabular break-words leading-[1.05] [overflow-wrap:anywhere]", lead ? "text-[clamp(40px,4.6vw,68px)]" : "text-[clamp(24px,2vw,32px)]")}>{value}</div>
      <div><div className="text-[15px] font-semibold">{label}</div>{sub ? <div className="mt-1 max-w-[34ch] text-[13px] text-ink2">{sub}</div> : null}</div>
    </div>
  </Card>
);

// Tables: 44px rows, hairlines, sticky header, condensed header type. Under 640px each row becomes a labelled card (header text is passed to CSS as --h1..--hN, see globals.css .stack).
export function Table({ head, children, label }: { head: string[]; children: ReactNode; label: string }) {
  const labels = Object.fromEntries(head.map((h, i) => [`--h${i + 1}`, JSON.stringify(h)])) as React.CSSProperties;
  return (
    <div className="stack-wrap max-h-[70vh] overflow-auto rounded-[8px] border-[1.5px] border-rule bg-bond">
      <table aria-label={label} style={labels} className="stack w-full border-collapse text-[15px]">
        <thead><tr>{head.map((h) => <th key={h} scope="col" className="sticky top-0 whitespace-nowrap border-b-[1.5px] border-rule bg-bond px-3 py-2.5 text-left text-[13px] font-semibold text-ink2 [font-stretch:80%]">{h}</th>)}</tr></thead>
        <tbody className="[&_td]:min-h-11 [&_td]:border-b [&_td]:border-rule [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_tr:last-child_td]:border-b-0">{children}</tbody>
      </table>
    </div>
  );
}
export const Mono = ({ children }: { children: ReactNode }) => <code className="break-all font-mono text-[12px] font-medium">{children}</code>;
export const rupees = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "03 Nov 2026, 14:05" in IST, 24-hour (DESIGN.md section 9). */
export const when = (d: Date | string) => new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
