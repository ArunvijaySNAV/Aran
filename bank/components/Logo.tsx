import { TesseraTiles } from "./aran/Mark";

/** Tessera Bank mark: two gold mosaic tiles, then the wordmark in Archivo 700. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span translate="no" className={`inline-flex items-center gap-2.5 text-[20px] font-bold [font-stretch:100%] ${className}`}>
      <TesseraTiles />
      Tessera
    </span>
  );
}
