/** Loading placeholder drawn as redaction bars (ink at 8% opacity, shimmering). */
export function RedactionSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  const widths = ["92%", "78%", "64%", "86%", "55%"];
  return (
    <div aria-hidden="true" className={`space-y-2.5 ${className}`}>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skel h-[18px]" style={{ width: widths[i % widths.length] }} />)}
    </div>
  );
}
