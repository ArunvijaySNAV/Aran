import { Card } from "@/components/ui";
import { AranMark, DataPlanePreview, Flight } from "@/components/aran";
import { PageHead } from "@/components/PageHead";
import { requireSession } from "@/lib/auth";
import { OnboardForm } from "./OnboardForm";

export const metadata = { title: "Onboard a customer" };
export default async function NewCustomer() {
  await requireSession("onboard");
  return (
    <div className="max-w-5xl">
      <PageHead title="Onboard a customer" sub="KYC intake. Raw values go to Aran only; this bank stores tokens." />
      <Flight bank={<Card className="rounded-none border-0 shadow-none"><OnboardForm /></Card>} plane={<DataPlanePreview />} boundaryMark={<AranMark size={26} />} />
    </div>
  );
}
