import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { readView } from "@/lib/connection";
import { AranConnectionPanel } from "./Panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aran connection" };

/** Admin only (role check in requireSession). The page receives the public view: addresses, last four characters and results, never a key. */
export default async function AranConnectionPage() {
  const s = await requireSession("settings");
  const view = await readView(getDb(), s);
  return (
    <div className="space-y-6">
      <PageHead title="Aran connection" sub="Connect this bank to Aran Cloud. Keys are stored encrypted and are never shown again." />
      <AranConnectionPanel initial={view} />
    </div>
  );
}
