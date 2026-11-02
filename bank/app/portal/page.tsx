import Link from "next/link";
import { Logo } from "@/components/Logo";
import { MyDataPanel, SignUp } from "./Portal";

export const metadata = { title: "Customer portal" };
export default function Portal() {
  return (
    <main id="content" className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3"><Logo /><Link className="text-sm underline" href="/login">Staff sign in</Link></header>
      <div><h1 className="text-3xl font-bold">Customer portal</h1><p className="mt-1 max-w-2xl text-muted">Register yourself, see what we hold about you, and erase it. Your Aadhaar, mobile and PAN are tokenised before they reach our database.</p></div>
      <div className="grid gap-6 md:grid-cols-2"><SignUp /><MyDataPanel /></div>
    </main>
  );
}
