import type { ReactNode } from "react";
export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-ink pb-5">
      <div><h1 className="w-headline text-[clamp(30px,3.6vw,48px)] leading-[1.02]">{title}</h1>{sub ? <p className="mt-2 max-w-[62ch] text-[17px] text-ink2">{sub}</p> : null}</div>
      {actions}
    </header>
  );
}
