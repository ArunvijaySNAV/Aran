import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Archivo is declared with @font-face + unicode-range in globals.css (latin and latin-ext, so the rupee sign renders in Archivo).
// Martian Mono (variable width) is served from /public/fonts. Both are SIL OFL, no CDN.
const martian = localFont({
  src: [{ path: "../public/fonts/martian-mono-latin-wdth-normal.woff2", style: "normal" }],
  variable: "--font-martian", weight: "100 800", display: "swap",
  declarations: [{ prop: "font-stretch", value: "75% 112.5%" }],
});

export const metadata: Metadata = { title: { default: "Tessera Bank", template: "%s · Tessera Bank" }, description: "Tessera Bank staff console (fictional demo bank)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={martian.variable}>
      <body className="bank-ui min-h-screen antialiased">
        <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-3 focus:font-bold focus:text-white">Skip to content</a>
        {children}
        <footer className="border-t border-rule px-4 py-5 text-center text-[13px] text-ink2">Fictional bank for demonstration. Sample data only.</footer>
      </body>
    </html>
  );
}
