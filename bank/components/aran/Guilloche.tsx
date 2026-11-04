import { useId } from "react";

/** Generative rosette: a hypotrochoid drawn 10 times, rotated, 0.55px strokes in currentColor. Decorative. */
function rosettePaths(R = 220, r = 71, d = 150, copies = 10): string[] {
  const steps = 720, turns = r / gcd(R, r);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * turns;
    const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
    const y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    pts.push(`${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  const path = pts.join("");
  return Array.from({ length: copies }, (_, k) => `${path}|${(360 / copies) * k}`);
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function Guilloche({ className = "", spin = true }: { className?: string; spin?: boolean }) {
  const id = useId();
  const copies = rosettePaths();
  return (
    <svg aria-hidden="true" viewBox="-260 -260 520 520" className={`${spin ? "guil-spin" : ""} ${className}`} fill="none" stroke="currentColor" strokeWidth=".55" data-guilloche={id}>
      {copies.map((c, i) => { const [d, rot] = c.split("|"); return <path key={i} d={d} transform={`rotate(${rot})`} />; })}
    </svg>
  );
}

/** Sine-interlace band for certificates and receipts (34px tall). */
export function GuillocheBand({ className = "" }: { className?: string }) {
  const lines = [0, 1, 2, 3, 4].map((k) => {
    let d = "";
    for (let x = 0; x <= 600; x += 4) d += `${x ? "L" : "M"}${x} ${(17 + 11 * Math.sin((x / 600) * Math.PI * 6 + k * 0.9)).toFixed(1)}`;
    return d;
  });
  return (
    <svg aria-hidden="true" viewBox="0 0 600 34" preserveAspectRatio="none" className={className} fill="none" stroke="currentColor" strokeWidth=".6">
      {lines.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
