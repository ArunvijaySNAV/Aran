import type { ReactNode } from "react";
import { Guilloche } from "./Guilloche";

/** The signature container: bond paper, 1.5px ink outline, radius 18, a masked guilloche in one corner. Holds one big number and its verdict. */
export function Plate({ children, className = "", guilloche = true }: { children: ReactNode; className?: string; guilloche?: boolean }) {
  return (
    <div className={`edge-float relative overflow-hidden rounded-[18px] bg-bond p-6 sm:p-7 ${className}`}>
      {guilloche ? (
        <div aria-hidden="true" className="pointer-events-none absolute -right-[170px] -top-[170px] h-[520px] w-[520px] text-seal opacity-50 [mask-image:linear-gradient(to_left,#000_25%,transparent_70%)]">
          <Guilloche className="h-full w-full" />
        </div>
      ) : null}
      <div className="relative">{children}</div>
    </div>
  );
}

/** Microprint rule: decorative, repeated line, aria-hidden. */
export function Microprint({ text = "Protected before it is stored", className = "" }: { text?: string; className?: string }) {
  return <div aria-hidden="true" className={`overflow-hidden whitespace-nowrap text-[7px] uppercase tracking-[.22em] text-ink2 opacity-75 ${className}`}>{Array.from({ length: 6 }, () => text).join("   ")}</div>;
}
