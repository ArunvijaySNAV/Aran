// Pure input validation (no server-only: also used by client-side inline validation and tests).
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];

export function verhoeffValid(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let c = 0;
  [...num].reverse().forEach((ch, i) => { c = D[c]![P[i % 8]![Number(ch)]!]!; });
  return c === 0;
}
export function luhnValid(num: string): boolean {
  if (!/^\d+$/.test(num)) return false;
  let s = 0;
  [...num].reverse().forEach((ch, i) => { let v = Number(ch); if (i % 2 === 1) { v *= 2; if (v > 9) v -= 9; } s += v; });
  return s % 10 === 0;
}
export const digitsOnly = (s: string) => s.replace(/[\s-]/g, "");
export const isAadhaar = (s: string) => { const d = digitsOnly(s); return /^[2-9]\d{11}$/.test(d) && verhoeffValid(d); };
export const isCard = (s: string) => { const d = digitsOnly(s); return /^\d{16}$/.test(d) && luhnValid(d); };
export const isMobile = (s: string) => /^[6-9]\d{9}$/.test(digitsOnly(s).replace(/^\+?91/, ""));
export const normMobile = (s: string) => digitsOnly(s).replace(/^\+?91/, "");
export const isPan = (s: string) => /^[A-Z]{5}\d{4}[A-Z]$/.test(s.trim().toUpperCase());
export const isName = (s: string) => /^[A-Za-z][A-Za-z .'-]{1,59}$/.test(s.trim());

export type FieldErrors = Record<string, string>;
export interface OnboardInput { name: string; mobile: string; aadhaar: string; pan?: string; card?: string; loanInterest?: boolean; loanAmountRupees?: number }

export function validateOnboard(i: OnboardInput): FieldErrors {
  const e: FieldErrors = {};
  if (!isName(i.name ?? "")) e.name = "Enter the full name using letters only.";
  if (!isMobile(i.mobile ?? "")) e.mobile = "Enter a 10-digit Indian mobile number starting with 6-9.";
  if (!isAadhaar(i.aadhaar ?? "")) e.aadhaar = "Enter a valid 12-digit Aadhaar (the last digit is a checksum).";
  if (i.pan && !isPan(i.pan)) e.pan = "PAN looks like ABCDE1234F.";
  if (i.card && !isCard(i.card)) e.card = "Enter a valid 16-digit card number (Luhn check failed).";
  if (i.loanInterest && !(Number(i.loanAmountRupees) >= 10000)) e.loanAmountRupees = "Loan amount must be at least ₹10,000.";
  return e;
}
