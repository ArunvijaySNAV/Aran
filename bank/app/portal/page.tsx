import Link from "next/link";
import { Logo } from "@/components/Logo";
import { DemoNotice } from "@/components/DemoNotice";
import { MyDataPanel, SignUp } from "./Portal";

export const metadata = { title: "Customer portal" };
export default function Portal() {
  return (
    <>
      <header className="flex h-14 items-center justify-between gap-3 border-b-[3px] border-gold bg-bank px-4 text-white md:px-6"><Logo className="text-white" /><Link className="inline-flex min-h-11 items-center text-[15px] font-semibold text-white underline underline-offset-4" href="/login">Staff sign in</Link></header>
      <main id="content" className="mx-auto max-w-2xl space-y-8 px-4 py-9">
        <DemoNotice />
        <div><h1 className="w-headline text-[clamp(32px,5vw,48px)] leading-[1.02]">Customer portal</h1><p className="mt-3 max-w-[56ch] text-[17px] text-ink2">Register yourself, see what we hold about you, and erase it. Your Aadhaar, mobile and PAN are tokenised before they reach our database.</p></div>
        <SignUp />
        <MyDataPanel />
      </main>
    </>
  );
}
