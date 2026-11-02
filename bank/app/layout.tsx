import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Tessera Bank", template: "%s · Tessera Bank" }, description: "Tessera Bank staff console (fictional demo bank)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-accentfg">Skip to content</a>
        {children}
        <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">Demo bank — fictional, not a real institution</footer>
      </body>
    </html>
  );
}
