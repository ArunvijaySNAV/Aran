import type { ReactNode } from "react";

/** The flight scene frame: bank form on the left (light), a dashed boundary with the Aran mark, the Night data plane on the right.
 *  Presentational layout only; the real chips and cells are passed in as children by the screen that has the data. */
export function Flight({ bank, plane, boundaryMark }: { bank: ReactNode; plane: ReactNode; boundaryMark: ReactNode }) {
  return (
    <div className="grid items-stretch md:grid-cols-[minmax(0,4.2fr)_48px_minmax(0,7.8fr)]">
      <div className="edge overflow-hidden rounded-t-[16px] bg-bond md:rounded-l-[16px] md:rounded-tr-none">{bank}</div>
      <div aria-hidden="true" className="relative flex h-11 items-center justify-center bg-stock md:h-auto">
        <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[repeating-linear-gradient(90deg,var(--seal)_0_8px,transparent_8px_14px)] md:inset-x-auto md:inset-y-0 md:left-1/2 md:top-0 md:h-auto md:w-[2px] md:-translate-x-1/2 md:translate-y-0 md:bg-[repeating-linear-gradient(var(--seal)_0_8px,transparent_8px_14px)]" />
        <span className="relative bg-stock py-2 text-seal">{boundaryMark}</span>
      </div>
      <div className="night edge overflow-hidden rounded-b-[16px] md:rounded-r-[16px] md:rounded-bl-none">{plane}</div>
    </div>
  );
}
