import { Card } from "@/components/ui";
import { PageHead } from "@/components/PageHead";
import { requireSession } from "@/lib/auth";
import { OnboardForm } from "./OnboardForm";

export const metadata = { title: "Onboard a customer" };
export default async function NewCustomer() {
  await requireSession("onboard");
  return <div className="max-w-2xl"><PageHead title="Onboard a customer" sub="KYC intake. Raw values go to Aran only; this bank stores tokens." /><Card><OnboardForm /></Card></div>;
}
