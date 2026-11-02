import { Skeleton } from "@/components/ui";
export default function Loading() {
  return <div className="space-y-4" aria-busy="true" aria-label="Loading"><Skeleton className="h-8 w-48" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-64" /></div>;
}
