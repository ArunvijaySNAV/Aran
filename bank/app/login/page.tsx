import Link from "next/link";
import { Card } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };
export default function LoginPage() {
  return (
    <main id="content" className="mx-auto grid min-h-[80vh] max-w-md place-items-center px-4 py-10">
      <div className="w-full space-y-6">
        <Logo />
        <Card>
          <h1 className="mb-1 text-2xl font-bold">Staff sign in</h1>
          <p className="mb-5 text-sm text-muted">Tessera Bank management console.</p>
          <LoginForm />
        </Card>
        <p className="text-center text-sm text-muted">Customer? <Link className="underline" href="/portal">Open the customer portal</Link></p>
      </div>
    </main>
  );
}
