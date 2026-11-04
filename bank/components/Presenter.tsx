"use client";
import { useEffect, useState } from "react";

/** Presenter mode (presentation only), active only when the URL has ?present=1.
 *  Arrow keys move between the pages in the signed-in role's own navigation (or login and portal when there is none),
 *  a marker shows progress, type is 125% and the cursor hides after 3 s idle. No requests, no storage, no state beyond what is shown. */
export function Presenter() {
  const [m, setM] = useState<{ i: number; n: number; hrefs: string[] } | null>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("present") !== "1") return;
    const nav = Array.from(document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main"] a')).map((a) => a.getAttribute("href") ?? "").filter(Boolean);
    const hrefs = nav.length ? nav : ["/login", "/portal"];
    const here = location.pathname.replace(/\/+$/, "") || "/";
    const i = hrefs.findIndex((h) => here === h || (h !== "/dashboard" && here.startsWith(h)));
    if (i < 0) return;
    const root = document.documentElement;
    root.classList.add("present");
    setM({ i, n: hrefs.length, hrefs });
    const go = (k: number) => { if (k >= 0 && k < hrefs.length) location.href = `${hrefs[k]}?present=1`; };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) return;
      if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
      else if (e.key === "Escape") location.href = here;
    };
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => { root.classList.remove("present-idle"); clearTimeout(timer); timer = setTimeout(() => root.classList.add("present-idle"), 3000); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousemove", wake); wake();
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousemove", wake); clearTimeout(timer); root.classList.remove("present", "present-idle"); };
  }, []);
  if (!m) return null;
  return <div role="status" className="present-marker">Presenter {m.i + 1} / {m.n} · ← → to move · Esc to exit</div>;
}
