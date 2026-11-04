import { SinkPill } from "./Chips";

const ROWS = [
  { sink: "kyc-archive", purpose: "KYC", fields: "Aadhaar, mobile, name, PAN, card" },
  { sink: "log-platform", purpose: "Service", fields: "A redacted audit line, nothing raw" },
  { sink: "crm", purpose: "Service", fields: "Name and mobile, with the CRM's own tokens" },
  { sink: "loan-vendor", purpose: "Loans", fields: "Only if the customer consents to a loan offer" },
] as const;

/** Night side of the flight frame, before submit: where each value will go. Static description of lib/domain.onboardCustomer; no tokens are shown because none exist yet. */
export function DataPlanePreview() {
  return (
    <div className="p-5 sm:p-6">
      <h2 className="text-[19px] font-bold [font-stretch:100%]">What happens on submit</h2>
      <p className="mt-1 text-[14px] text-ink2">The raw values go to Aran from this server and nowhere else. Each destination gets its own tokens.</p>
      <ol className="mt-5 space-y-3">
        {ROWS.map((r) => (
          <li key={r.sink} className="rounded-[8px] border-[1.5px] border-rule p-3">
            <div className="flex flex-wrap items-center gap-2"><SinkPill>{r.sink}</SinkPill><span className="text-[13px] text-ink2">purpose: {r.purpose}</span></div>
            <p className="mt-2 text-[14px]">{r.fields}</p>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-[14px] font-semibold text-token">The database stores tokens only. If Aran cannot be reached, nothing is saved.</p>
    </div>
  );
}
