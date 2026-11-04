"use client";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Banner, Button, Field, Input } from "@/components/ui";
import { validateOnboard } from "@/lib/validators";
import { onboardAction } from "../actions";

const STEPS = ["Identity", "Identifiers", "Consent & review"] as const;
const FIELDS_BY_STEP: string[][] = [["name", "mobile"], ["aadhaar", "pan", "card"], ["loanAmountRupees"]];

export function OnboardForm({ action = onboardAction }: { action?: typeof onboardAction }) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const [step, setStep] = useState(0);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [loan, setLoan] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => { if (state.ok && state.data) router.push(`/customers/${state.data.ref}?created=1`); }, [state, router]);
  const e = { ...state.fieldErrors, ...errs };

  const read = () => {
    const f = new FormData(ref.current!);
    return { name: String(f.get("name") ?? ""), mobile: String(f.get("mobile") ?? ""), aadhaar: String(f.get("aadhaar") ?? ""), pan: String(f.get("pan") ?? ""), card: String(f.get("card") ?? ""), loanInterest: f.get("loanInterest") === "on", loanAmountRupees: Number(f.get("loanAmount") ?? 0) };
  };
  const check = (names: string[]) => {
    const all = validateOnboard(read());
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => names.includes(k)));
    setErrs(() => ({ ...Object.fromEntries(names.map((n) => [n, ""])), ...mine }));
    return Object.keys(mine).length === 0;
  };
  const next = () => { if (check(FIELDS_BY_STEP[step]!)) setStep(step + 1); else (ref.current!.querySelector("[aria-invalid=true]") as HTMLElement | null)?.focus(); };
  const err = (k: string) => e[k] || undefined;

  return (
    <form ref={ref} action={formAction} noValidate className="space-y-6" onSubmit={(ev) => { if (!check(FIELDS_BY_STEP.flat())) { ev.preventDefault(); setStep(0); } }}>
      <div>
        <ol className="flex items-center gap-2" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} aria-label={`${i + 1}. ${s}`} className={`tabular w-expanded grid size-11 shrink-0 place-items-center rounded-full text-[16px] ${i === step ? "bg-bank text-white" : i < step ? "bg-banksoft text-bank" : "text-ink2 shadow-[inset_0_0_0_1.5px_var(--rule-strong)]"}`}>{i < step ? <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> : i + 1}</li>
          ))}
          <li aria-hidden="true" className="h-[1.5px] flex-1 bg-rule" />
        </ol>
        <p className="mt-2 text-[15px] font-semibold">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
      </div>
      {state.message ? <Banner tone="bad" role="alert">{state.status === 503 ? "Service unavailable (503). " : ""}{state.message}</Banner> : null}

      <fieldset hidden={step !== 0} className="space-y-4"><legend className="sr-only">Identity</legend>
        <Field label="Full name" htmlFor="name" error={err("name")}><Input id="name" name="name" autoComplete="off" aria-invalid={!!err("name")} aria-describedby={err("name") ? "name-err" : undefined} onBlur={() => check(["name"])} /></Field>
        <Field label="Mobile number" htmlFor="mobile" error={err("mobile")} hint="10 digits, starting 6–9"><Input id="mobile" name="mobile" inputMode="numeric" autoComplete="off" aria-invalid={!!err("mobile")} onBlur={() => check(["mobile"])} /></Field>
      </fieldset>
      <fieldset hidden={step !== 1} className="space-y-4"><legend className="sr-only">Identifiers</legend>
        <Field label="Aadhaar number" htmlFor="aadhaar" error={err("aadhaar")} hint="12 digits; the last digit is checked (Verhoeff)"><Input id="aadhaar" name="aadhaar" inputMode="numeric" autoComplete="off" aria-invalid={!!err("aadhaar")} onBlur={() => check(["aadhaar"])} /></Field>
        <Field label="PAN (optional)" htmlFor="pan" error={err("pan")}><Input id="pan" name="pan" autoComplete="off" className="uppercase" aria-invalid={!!err("pan")} onBlur={() => check(["pan"])} /></Field>
        <Field label="Debit card number (optional)" htmlFor="card" error={err("card")} hint="16 digits (Luhn check)"><Input id="card" name="card" inputMode="numeric" autoComplete="off" aria-invalid={!!err("card")} onBlur={() => check(["card"])} /></Field>
      </fieldset>
      <fieldset hidden={step !== 2} className="space-y-4"><legend className="sr-only">Consent and review</legend>
        <label className="flex min-h-11 items-start gap-3 text-[16px] font-medium"><input type="checkbox" name="loanInterest" checked={loan} onChange={(x) => setLoan(x.target.checked)} className="mt-0.5 size-6 shrink-0 accent-[var(--bank)]" />
          <span>The customer consents to share their name, mobile and PAN with our lending partner for a loan offer.<span className="mt-1 block text-[14px] font-normal text-ink2">The partner only ever receives tokens issued for the loan-vendor destination.</span></span></label>
        {loan ? <Field label="Loan amount (₹)" htmlFor="loanAmount" error={err("loanAmountRupees")}><Input id="loanAmount" name="loanAmount" type="number" min={10000} step={1000} defaultValue={100000} aria-invalid={!!err("loanAmountRupees")} /></Field> : null}
        <Banner>On submit, the values are tokenised by Aran for the KYC archive, CRM{loan ? " and loan vendor" : ""} and a redacted audit line is logged. If Aran cannot be reached nothing is saved.</Banner>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        {step > 0 ? <Button type="button" onClick={() => setStep(step - 1)}>Back</Button> : null}
        {step < 2 ? <Button key="next" type="button" variant="primary" onClick={next}>Continue</Button> : <Button key="submit" type="submit" variant="primary" disabled={pending}>{pending ? "Protecting and saving…" : "Onboard customer"}</Button>}
      </div>
    </form>
  );
}
