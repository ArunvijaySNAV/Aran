import Link from "next/link";
import { Guilloche } from "@/components/aran";
import { Logo } from "@/components/Logo";
import { DemoNotice } from "@/components/DemoNotice";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };
export default function LoginPage() {
  return (
    <>
      <header className="flex h-14 items-center border-b-[3px] border-gold bg-bank px-4 text-white md:px-6"><Logo /></header>
      <main id="content" className="mx-auto grid min-h-[78vh] max-w-md place-items-center px-4 py-10">
        <div className="w-full space-y-6">
          <DemoNotice />
          <section className="edge-float relative overflow-hidden rounded-[18px] bg-bond p-7">
            <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-[380px] w-[380px] text-bank opacity-30 [mask-image:linear-gradient(to_left,#000_20%,transparent_70%)]"><Guilloche className="h-full w-full" /></div>
            <div className="relative">
              <h1 className="w-headline mb-1 text-[34px] leading-none">Staff sign in</h1>
              <p className="mb-6 text-[15px] text-ink2">Tessera Bank management console.</p>
              <LoginForm />
            </div>
          </section>
          <p className="text-center text-[15px] text-ink2">Customer? <Link className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4" href="/portal">Open the customer portal</Link></p>
        </div>
      </main>
    </>
  );
}
