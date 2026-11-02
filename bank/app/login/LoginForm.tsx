"use client";
import { useActionState } from "react";
import { Banner, Button, Field, Input } from "@/components/ui";
import { login } from "./actions";

export function LoginForm() {
  const [s, action, pending] = useActionState(login, { ok: false });
  return (
    <form action={action} className="space-y-4" noValidate>
      {s.message ? <Banner tone="bad" role="alert">{s.message}</Banner> : null}
      <Field label="Work email" htmlFor="email" error={s.fieldErrors?.email}><Input id="email" name="email" type="email" autoComplete="username" required aria-invalid={!!s.fieldErrors?.email} /></Field>
      <Field label="Password" htmlFor="password" error={s.fieldErrors?.password}><Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!s.fieldErrors?.password} /></Field>
      <Button variant="primary" type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
