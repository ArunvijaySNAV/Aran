import { Banner } from "@/components/ui";

/** Shown on the pages where a stranger could type personal data: login, portal, onboarding. */
export function DemoNotice({ className }: { className?: string }) {
  return (
    <div className={className} data-demo-notice>
      <Banner tone="warn" role="note"><strong>Fictional bank for demonstration.</strong> Do not enter real personal data.</Banner>
    </div>
  );
}
