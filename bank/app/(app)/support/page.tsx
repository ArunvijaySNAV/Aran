import { desc, eq } from "drizzle-orm";
import { Banner, Card, CardTitle, Empty } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { getDb } from "@/db";
import * as t from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { Chat } from "./Chat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support console" };

export default async function Support() {
  await requireSession("support");
  const recent = await getDb().select().from(t.messages).where(eq(t.messages.role, "user")).orderBy(desc(t.messages.createdAt)).limit(5);
  return (
    <div className="space-y-6">
      <PageHead title="Support console" sub="Ask the AI assistant about a customer's problem. Every prompt passes through Aran first." />
      <Banner tone="neutral">The AI provider in use (an external model, or Aran&apos;s echo stand-in that makes no external call) is named under every answer, next to a panel showing exactly what it received.</Banner>
      <Card><Chat /></Card>
      <Card><CardTitle>Stored conversation lines (redacted)</CardTitle>
        {recent.length === 0 ? <Empty title="Nothing stored yet" /> : <ul className="space-y-2 text-sm">{recent.map((m) => <li key={m.id} className="break-words rounded bg-surface2 px-3 py-2">{m.content}</li>)}</ul>}</Card>
    </div>
  );
}
