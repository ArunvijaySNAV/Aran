import { RedactionSkeleton } from "@/components/aran";
export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading">
      <RedactionSkeleton lines={2} className="max-w-md" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="edge rounded-[14px] bg-bond p-5"><RedactionSkeleton lines={2} /></div>)}</div>
      <div className="edge rounded-[14px] bg-bond p-5"><RedactionSkeleton lines={5} /></div>
    </div>
  );
}
