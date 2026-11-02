import type { FieldKind } from "./types.js";

/**
 * One labelled sentence per field. The wording matters: the detector reads context. Measured against a
 * live stack (scripts/field_format_experiment.py, 40 samples per cell): every identifier format below
 * was protected 40/40; for names "Account holder X opened an account" was 40/40 while "Customer name: X"
 * was 32/40 and "Name: X" 31/40.
 */
export const TEMPLATES: Record<FieldKind, { prefix: string; suffix: string }> = {
  name: { prefix: "Account holder ", suffix: " opened an account" },
  mobile: { prefix: "Mobile number: ", suffix: "" },
  aadhaar: { prefix: "Aadhaar number: ", suffix: "" },
  card: { prefix: "Card number: ", suffix: "" },
  pan: { prefix: "PAN number: ", suffix: "" },
  upi: { prefix: "UPI ID ", suffix: "" },
};

const ALIASES: Record<string, FieldKind> = {
  name: "name", fullname: "name", full_name: "name", customername: "name", accountholder: "name",
  mobile: "mobile", phone: "mobile", mobilenumber: "mobile", mobile_number: "mobile", phonenumber: "mobile",
  aadhaar: "aadhaar", aadhar: "aadhaar", uid: "aadhaar", aadhaarnumber: "aadhaar",
  card: "card", cardnumber: "card", card_number: "card",
  pan: "pan", pannumber: "pan", pan_number: "pan",
  upi: "upi", upiid: "upi", upi_id: "upi", vpa: "upi",
};

export function kindOf(field: string): FieldKind | undefined {
  return ALIASES[field.toLowerCase().replace(/[\s-]/g, "")] ?? ALIASES[field.toLowerCase()];
}

/** finding.type that must be protected for each kind */
export const FINDING_TYPE: Record<FieldKind, string> = {
  name: "PER",
  mobile: "MOBILE",
  aadhaar: "AADHAAR",
  card: "CARD",
  pan: "PAN",
  upi: "UPI",
};
