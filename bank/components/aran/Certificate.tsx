import type { ReactNode } from "react";
import { GuillocheBand } from "./Guilloche";

/** Certificate: bond, 6px radius, ink outline, a guilloche band on top, a circular seal, a signature line. Foil only when `verified`. */
export function Certificate({ title, rows, verified = false, stamped = true, children, footer }: {
  title: string; rows: { label: string; value: ReactNode; mono?: boolean }[]; verified?: boolean; stamped?: boolean; children?: ReactNode; footer?: ReactNode;
}) {
  return (
    <section className="edge relative overflow-hidden rounded-[6px] bg-bond pb-6 shadow-[0_0_0_1.5px_var(--ink),0_24px_40px_-26px_rgba(12,26,43,.5)]" aria-label={title}>
      <div className="relative h-[34px] overflow-hidden bg-sealsoft text-seal">
        <GuillocheBand className="block h-full w-full" />
        {verified ? <div aria-hidden="true" className="absolute inset-0 mix-blend-multiply" style={{ background: "var(--foil)", backgroundSize: "300% 100%", animation: "foil 2.6s var(--ease) 1 forwards" }} /> : null}
      </div>
      <div className="grid gap-6 px-6 pt-6 sm:grid-cols-[1fr_150px] sm:px-9">
        <div>
          <h3 className="w-headline text-[clamp(26px,3vw,38px)] leading-none">{title}</h3>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[15px]">
            {rows.map((r) => (<div key={r.label} className="contents"><dt className="text-ink2">{r.label}</dt><dd className={r.mono ? "break-all font-mono text-[13px]" : "font-semibold"}>{r.value}</dd></div>))}
          </dl>
        </div>
        {stamped ? (
          <svg viewBox="0 0 150 150" aria-hidden="true" className="seal-slam h-[110px] w-[110px] -rotate-[8deg] text-seal sm:h-[150px] sm:w-[150px]" fill="none" stroke="currentColor">
            <circle cx="75" cy="75" r="70" strokeWidth="3" /><circle cx="75" cy="75" r="56" strokeWidth="1" strokeDasharray="2 4" />
            <path d="M48 77l19 19 36-40" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </div>
      {children ? <div className="px-6 pt-4 sm:px-9">{children}</div> : null}
      <div className="flex flex-wrap items-center gap-3.5 px-6 pt-5 sm:px-9">{footer}{verified ? <span role="status" className="inline-flex items-center gap-2 font-bold text-seal"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>Signature valid</span> : null}</div>
      <div aria-hidden="true" className="mx-6 mt-6 border-t border-ink/60 pt-1 text-[13px] text-ink2 sm:mx-9">Issued by Aran</div>
    </section>
  );
}
