# Aran Brand & Design Language Specification

> **Document Version**: 2.0.0 (Post-Brand Step Review)  
> **Target Products**: Aran Cloud SaaS (`aran_cloud/`) & Heritage Co-operative Bank Portal (`demo_bank/`)  
> **Status**: Approved Specification  
> **Compliance Note**: All text and marks in `aran_cloud/` and `demo_bank/` use standard Latin characters only. Zero Tamil script or words.

---

## 1. Brand Identity & Name Story

### 1.1 The Name: Aran
The name **Aran** represents the concept of a **fortress, rampart, or defensive stronghold** built around customer data.

In enterprise banking and modern cloud data infrastructure, customer PII (Aadhaar, PAN, credit cards, bank accounts) is constantly exposed during database storage, application logging, and AI assistant queries.

**Aran operates as the digital fortress**:
- Intercepts sensitive payloads directly at the application boundary.
- Replaces raw identifiers with format-preserving vault tokens that retain format and utility.
- When customer consent ends under DPDP Act 2023 Section 12, Aran crypto-shreds the purpose key so plaintext cannot be recovered from tokens, and publishes verifiable post-quantum transparency receipts (Ed25519 + NIST ML-DSA-65).

### 1.2 Tagline Options
1. **Option A (Architectural & Direct)**:  
   *"The cryptographic fortress for customer data."*
2. **Option B (Technical & Verifiable)**:  
   *"Deterministic protection at the wire. Verifiable proof at the end."*
3. **Option C (Operational)**:  
   *"Format-preserving tokens in. Post-quantum erasure receipts out."*

---

## 2. Logo System (Self-Drawn Inline SVG)

The Aran mark features an **arch gate nested within a geometric rounded shield**, constructed from two architectural strokes with a central portal keystone.

### 2.1 Vector Icon Mark (`aran-mark.svg`)

#### Dark Surface Version (Aran Cloud)
- **Shield Outline**: `#818CF8` (stroke width: 2.5px, fill: `#0D111F`)
- **Inner Arch Gate**: `#A5B4FC` (stroke width: 2.5px, stroke-linecap: round)
- **Keystone & Base Line**: `#A5B4FC`
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none">
  <!-- Outer Fortress Shield -->
  <path d="M24 4L8 10V22C8 32.5 14.8 42.1 24 44C33.2 42.1 40 32.5 40 22V10L24 4Z" 
        stroke="#818CF8" 
        stroke-width="2.5" 
        stroke-linejoin="round" 
        fill="#0D111F" />
  <!-- Inner Fort Arch Gate (Stroke in #A5B4FC) -->
  <path d="M17 34V23C17 19.134 20.134 16 24 16C27.866 16 31 19.134 31 23V34" 
        stroke="#A5B4FC" 
        stroke-width="2.5" 
        stroke-linecap="round" />
  <!-- Center Keystone -->
  <circle cx="24" cy="24" r="2" fill="#A5B4FC" />
  <!-- Base Horizon Line -->
  <line x1="14" y1="34" x2="34" y2="34" stroke="#A5B4FC" stroke-width="2" stroke-linecap="round" />
</svg>
```

#### Light Surface Version (Bank Portals & Docs)
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" fill="none">
  <path d="M24 4L8 10V22C8 32.5 14.8 42.1 24 44C33.2 42.1 40 32.5 40 22V10L24 4Z" 
        stroke="#4338CA" 
        stroke-width="2.5" 
        stroke-linejoin="round" 
        fill="#EEF2FF" />
  <path d="M17 34V23C17 19.134 20.134 16 24 16C27.866 16 31 19.134 31 23V34" 
        stroke="#312E81" 
        stroke-width="2.5" 
        stroke-linecap="round" />
  <circle cx="24" cy="24" r="2" fill="#4338CA" />
  <line x1="14" y1="34" x2="34" y2="34" stroke="#4338CA" stroke-width="2" stroke-linecap="round" />
</svg>
```

### 2.2 Wordmark Lockup ("ARAN" only)
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" width="160" height="48" fill="none">
  <!-- Embedded Mark (32x32) -->
  <g transform="translate(4, 8) scale(0.67)">
    <path d="M24 4L8 10V22C8 32.5 14.8 42.1 24 44C33.2 42.1 40 32.5 40 22V10L24 4Z" 
          stroke="#818CF8" stroke-width="3" stroke-linejoin="round" fill="#12182B" />
    <path d="M17 34V23C17 19.134 20.134 16 24 16C27.866 16 31 19.134 31 23V34" 
          stroke="#A5B4FC" stroke-width="3" stroke-linecap="round" />
    <line x1="14" y1="34" x2="34" y2="34" stroke="#A5B4FC" stroke-width="2.5" stroke-linecap="round" />
  </g>
  <!-- Wordmark in Display Font (Sora) -->
  <text x="46" y="32" font-family="'Sora', -apple-system, sans-serif" font-size="22" font-weight="800" fill="#FFFFFF" letter-spacing="0.08em">ARAN</text>
</svg>
```

### 2.3 Favicon (32 × 32 Vector)
Tested and verified at 32px and 16px with crisp legibility:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none">
  <rect width="32" height="32" rx="7" fill="#070913" />
  <path d="M16 4L6 8V16C6 22.5 10.3 27.5 16 29C21.7 27.5 26 22.5 26 16V8L16 4Z" stroke="#818CF8" stroke-width="1.8" fill="#12182B" />
  <path d="M11 22V15C11 12.5 13.2 10.5 16 10.5C18.8 10.5 21 12.5 21 15V22" stroke="#A5B4FC" stroke-width="1.8" stroke-linecap="round" />
</svg>
```

---

## 3. Measured WCAG 2.1 Contrast Ratios (Script Verified)

The following contrast ratios were calculated directly using the official WCAG 2.1 relative luminance algorithm:

| Element / Color Pair | Foreground | Background | Measured Contrast | Compliance |
| :--- | :--- | :--- | :--- | :--- |
| **White on Primary Button** | `#FFFFFF` | `#4338CA` | **7.90:1** | **PASS ($\ge 7:1$)** |
| **Accent Text/Links on Dark Base** | `#A5B4FC` | `#070913` | **9.96:1** | **PASS ($\ge 7:1$)** |
| **Accent Text/Links on Dark Card** | `#A5B4FC` | `#12182B` | **8.84:1** | **PASS ($\ge 7:1$)** |
| **Text Contrast on Dark Base** | `#FFFFFF` | `#070913` | **19.86:1** | **PASS ($\ge 7:1$)** |
| **Text Contrast on Dark Card** | `#FFFFFF` | `#12182B` | **17.63:1** | **PASS ($\ge 7:1$)** |
| **Text Primary on Dark Card** | `#F1F4F9` | `#12182B` | **15.99:1** | **PASS ($\ge 7:1$)** |
| **Text Muted on Dark Card** | `#CBD5E1` | `#12182B` | **11.87:1** | **PASS ($\ge 7:1$)** |
| **Dark Raw Red on Card** | `#FCA5A5` | `#12182B` | **9.29:1** | **PASS ($\ge 7:1$)** |
| **Dark Token Green on Card** | `#4ADE80` | `#12182B` | **10.12:1** | **PASS ($\ge 7:1$)** |
| **Dark Amber Warning on Card** | `#FCD34D` | `#12182B` | **12.23:1** | **PASS ($\ge 7:1$)** |
| **Bank Primary on Cream Base** | `#1C2333` | `#FBF9F5` | **14.93:1** | **PASS ($\ge 7:1$)** |
| **Bank Primary on White Card** | `#1C2333` | `#FFFFFF` | **15.70:1** | **PASS ($\ge 7:1$)** |
| **Bank Muted on Cream Base** | `#475063` | `#FBF9F5` | **7.69:1** | **PASS ($\ge 7:1$)** |
| **Bank Muted on White Card** | `#475063` | `#FFFFFF` | **8.09:1** | **PASS ($\ge 7:1$)** |
| **Light Raw Red on Cream Base** | `#991B1B` | `#FBF9F5` | **7.90:1** | **PASS ($\ge 7:1$)** |
| **Light Raw Red on White Card** | `#991B1B` | `#FFFFFF` | **8.31:1** | **PASS ($\ge 7:1$)** |
| **Light Token Green on Cream Base**| `#14532D` | `#FBF9F5` | **8.66:1** | **PASS ($\ge 7:1$)** |
| **Light Token Green on White Card**| `#14532D` | `#FFFFFF` | **9.11:1** | **PASS ($\ge 7:1$)** |
| **Light Amber on Cream Base** | `#78350F` | `#FBF9F5` | **8.63:1** | **PASS ($\ge 7:1$)** |
| **Light Amber on White Card** | `#78350F` | `#FFFFFF` | **9.07:1** | **PASS ($\ge 7:1$)** |

---

## 4. Color Palette Specifications

### 4.1 Aran Cloud (Dark Theme)
- **Base Ground**: `--bg-deep: #070913`
- **Surfaces**:
  - Level 1: `--bg-surface: #0D111F`
  - Level 2 (Cards): `--bg-card: #12182B`
  - Level 3 (Hover/Active): `--bg-card-hover: #19223D`
- **Primary Button Fill**: `--accent-primary: #4338CA` (with `#FFFFFF` text $\to$ **7.90:1**)
- **Accent Text, Links, SVG Chart Stroke**: `--accent-bright: #A5B4FC` (Contrast on cards: **8.84:1**)
- **Glow & Border Highlight**: `--accent-border: #818CF8`, `--accent-glow: rgba(129, 140, 248, 0.28)`, `--accent-subtle: rgba(67, 56, 202, 0.16)`
- **Borders**: Card border `--border-card: #1E2742`, Hairline `--border-hairline: rgba(255, 255, 255, 0.08)`

### 4.2 Heritage Co-operative Bank (Light Theme)
- **Name**: **Heritage Co-operative Bank**
- **Surfaces**: Warm Cream Base `--bank-bg: #FBF9F5`, White Cards `--bank-card: #FFFFFF`, Hover `--bank-hover: #F4EFEB`
- **Top Header**: Deep Imperial Navy `--bank-navy: #101B2E` with Gold Hairline `--bank-gold: #C59B27`
- **Borders**: Card border `--bank-border: #E2DDD5`, Strong border `--bank-border-strong: #C9C2B5`
- **Text**: Primary `--bank-text-primary: #1C2333` (**15.70:1**), Muted `--bank-text-muted: #475063` (**8.09:1**)
- **Mandatory Footer Notice**: *"Fictional bank for demonstration. Sample data only."*

### 4.3 Meaning Colours (Fixed, Never Decorative)
- **RED (Exposed Raw Data)**:
  - Dark: Text `--raw-red: #FCA5A5` (**9.29:1**), Bg: `rgba(239, 68, 68, 0.15)`, Border: `rgba(239, 68, 68, 0.45)`
  - Light: Text `--raw-red-light: #991B1B` (**8.31:1**), Bg: `#FEE2E2`, Border: `#F87171`
- **GREEN (Protected Vault Token)**:
  - Dark: Text `--token-green: #4ADE80` (**10.12:1**), Bg: `rgba(34, 197, 94, 0.15)`, Border: `rgba(34, 197, 94, 0.45)`
  - Light: Text `--token-green-light: #14532D` (**9.11:1**), Bg: `#DCFCE7`, Border: `#86EFAC`
- **AMBER (Unprotected Warning)**:
  - Dark: Text `--warning-amber: #FCD34D` (**12.23:1**), Bg: `rgba(245, 158, 11, 0.15)`, Border: `rgba(245, 158, 11, 0.45)`
  - Light: Text `--warning-amber-light: #78350F` (**9.07:1**), Bg: `#FEF3C7`, Border: `#FCD34D`

---

## 5. Typography System

- **Display**: **`Sora`** (Weights: 400, 600, 700) for brand headers, page titles, and metric indicators.
- **Body**: **`Inter`** (Weights: 400, 500, 600) for body copy, form controls, and table rows.
- **Monospace**: **`JetBrains Mono`** (Weights: 400, 500) for tabular digits (`tabular-nums`), tokens, hashes, and code snippets.
- **Files**: All served strictly as local `.woff2` files from `static/fonts/`. Zero external requests at runtime.
- **Projector Baseline**: Body $\ge 18\text{px}$ (`--text-base: 1.125rem`), Key Data $\ge 22\text{px}$ (`--text-xl: 1.375rem` up to `2.25rem`).

---

## 6. Voice, Tone & UI Strings

### 6.1 Principles
- No overclaims: never say "zero-knowledge", "impenetrable", or "bulletproof".
- Describe exact cryptographic properties: format-preserving tokenisation, purpose-key shredding, and post-quantum Merkle signature verification.

### 6.2 10 Approved Canonical UI Strings
1. **Primary Action**: `[ Issue Vault Token ]`
2. **Destruction Action**: `[ Crypto-Shred Purpose Key ]`
3. **Verification Action**: `[ Verify Post-Quantum Proof ]`
4. **Forensic Action**: `[ Trace Exfiltration Dump ]`
5. **Empty State (Traffic)**:  
   *"No payloads intercepted yet. Traffic routed through `/v1/protect` or `/v1/gateway` will appear here in real time."*
6. **Empty State (Receipts)**:  
   *"Zero purpose keys destroyed. Initiate a DPDP Section 12 erasure to generate verifiable transparency log receipts."*
7. **Empty State (Trace)**:  
   *"No tokens identified in the provided snippet. Paste an exfiltrated log or SQL backup to attribute the leaking sink."*
8. **Owner Conflict Notice**:  
   *"Identifier already enrolled under an existing customer. Format-preserving token issued under the original owner."*
9. **Checksum Failure Note**:  
   *"Sequence matched digit pattern but failed Luhn/Verhoeff checksum. Passed through as non-identifier."*
10. **Legal & Cryptographic Disclaimer**:  
    *"DPDP Section 12 cryptographic erasure is irreversible. Plaintext data cannot be reconstructed once the purpose key is destroyed."*
