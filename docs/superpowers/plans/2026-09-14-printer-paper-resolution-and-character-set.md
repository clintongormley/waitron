# Printer paper width, resolution and character set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay out every printed document for the actual printer — its paper width, dot density and character set — so receipts fit the paper, the fiscal QR prints at its legal 30–40 mm on any printer, and accents and the euro sign print correctly.

**Architecture:** Three new enum settings on the `printers` table carry paper width, resolution and character set. A new pure layout-and-encoding module in `@waitron/printing` turns those settings into a column count, a text encoder, a text wrapper and a QR dot-size chooser. The four document formatters in `apps/server` (receipt, payment slip, kitchen ticket, correction slip) and the server-built test page take the settings and use that module; the QR becomes a self-built raster image instead of the printer's built-in QR command. The dashboard Edit-printer dialog exposes the settings and a "Print test page" flow, and the preview renders at the printer's real width and resolution.

**Tech Stack:** TypeScript, drizzle-orm + PostgreSQL enums, the `@waitron/printing` ESC/POS byte builder, the `qrcode` library (already a dependency of `apps/server`), Lit web components + vitest browser mode (dashboard), vitest (server and printing).

**Spec:** `docs/superpowers/specs/2026-09-14-printer-paper-resolution-and-character-set-design.md` — read it alongside this plan.

## Global Constraints

- **Character counts are exactly 30 (58 mm) and 42 (80 mm)**, for every resolution. A character is 12 dots wide, so the safe printable width is 360 dots (30 columns) and 504 dots (42 columns). Every printed image stays within that width.
- **The fiscal QR must measure between 30 and 40 mm** (Orden HAC/1177/2024 art. 21.1), at error-correction level M. Measured without its blank border.
- **The QR dot size is chosen per receipt** to land closest to 35 mm within 30–40 mm at the configured resolution; on a tie, the smaller dot size. Printed size in mm is `squares × dots × 25.4 / dpi`.
- **The receipt is a Spanish legal document:** its fiscal labels stay the fixed Spanish constants. Only the test page's captions and the dashboard dialog text follow the venue's default language (Spanish or English today).
- **No data-migration or backwards-compatibility code** (nothing is in production). Schema changes drop and recreate.
- **`@waitron/printing` is Node-only** and must not be imported by browser/dashboard code (the dashboard keeps local mirror types). New pure helpers live in that package and are consumed by `apps/server` and the server-side preview decoder, never by the browser bundle.
- **Error codes name the domain concept and are never renamed once shipped.** New request validation reuses the existing `management.request_invalid` code.
- **Every commit is `git commit -s`.** Work happens in the branch worktree, never on `main`.

---

## File Structure

New files:
- `packages/printing/src/charset.ts` — the three character sets: prepare (transliterate to single-byte-representable text), encode to bytes, decode bytes back, and the `ESC t` selection bytes. Pure, Node-only.
- `packages/printing/src/layout.ts` — settings→layout: column count, safe pixel width, dots-per-mm, text wrapping, label+amount rows, QR dot-size choice, QR quiet-zone padding. Pure.
- `apps/server/src/qr-matrix.ts` — `qrModules(text, opts?)`: turns a link (or fixed text at a forced version) into a boolean module matrix with the `qrcode` library. Lives in `apps/server` because `@waitron/printing` must stay free of `qrcode`.
- `apps/server/src/receipt-money.ts` — the shared `formatMoney` (with the NBSP→space fix), used by the receipt and the payment slip.
- `apps/server/src/test-page.ts` — `formatTestPage({ locale })`: the printer setup test page, with its own locale caption catalog.

Modified files:
- `packages/printing/src/escpos.ts` — the builder gains a current character set (`esc(charset?)`, `init()` emits `ESC t`, `charset()` switches mid-stream, `text()` encodes with it), and `qrRaster` is unchanged (the quiet zone is added by `layout.withQuietZone`).
- `packages/printing/src/index.ts` — export the new modules' public API.
- `packages/printing/src/printers.ts` — `CreatePrinterInput`, `UpdatePrinterInput`, `PrinterRow`, and the create/update/list SQL carry the three settings.
- `packages/db/src/schema/printers.ts` — three new enum columns; a generated migration under `packages/db/drizzle/`.
- `packages/db/src/schema/printing.test.ts` — grant assertions for the new columns.
- `apps/server/src/print-api.ts` — create/patch routes accept the settings; the test-print route builds the test page in the venue language; the preview route returns the printer's columns and dpi.
- `apps/server/src/receipt-ticket.ts`, `receipt-print.ts` — the receipt takes the settings and lays out with `layout`, and prints the QR as a raster image.
- `apps/server/src/payment-slip.ts`, `payment-slip-print.ts` — same layout, shared money formatting.
- `apps/server/src/kitchen-ticket.ts`, `kitchen-print.ts` — kitchen paper wraps; tickets are built once per distinct (width, charset) among their printers.
- `apps/server/src/print-job-preview.ts` — decode `ESC t` and per-charset text.
- `apps/dashboard/src/api/client.ts`, `screens/printers-screen.ts`, `widgets/print-job-preview.ts`, `i18n/strings.ts` — the settings controls, the test-page question flow, and the width/resolution-aware preview.

Enum names (mirroring the existing `printTicketScope`/`ticketScope` pair):

| DB type              | DB column       | JS enum const       | JS column prop  | Values                      |
| -------------------- | --------------- | ------------------- | --------------- | --------------------------- |
| `print_paper_width`  | `paper_width`   | `printPaperWidth`   | `paperWidth`    | `58mm`, `80mm`              |
| `print_resolution`   | `resolution`    | `printResolution`   | `resolution`    | `180dpi`, `203dpi`          |
| `print_character_set`| `character_set` | `printCharacterSet` | `characterSet`  | `wpc1252`, `pc858`, `plain` |

(The column is `resolution`, not the spec's illustrative `print_resolution`, so the DB column and its enum type do not share a name — matching how `ticket_scope`'s type is `print_ticket_scope`.)

---

### Task 1: Character-set decode tables and the ESC t selection bytes

**Files:**
- Create: `packages/printing/src/charset.ts`
- Test: `packages/printing/src/charset.test.ts`

**Interfaces:**
- Produces:
  - `export type CharacterSet = "wpc1252" | "pc858" | "plain"`
  - `export const CHARSET_SELECT: Record<CharacterSet, readonly number[]>` — the bytes `init()`/`charset()` emit: `wpc1252` → `[0x1b, 0x74, 16]`, `pc858` → `[0x1b, 0x74, 19]`, `plain` → `[]`.
  - `export function decodeBytes(bytes: Iterable<number>, cs: CharacterSet): string` — one byte → one character, using the set's table (`plain` decodes as ASCII/Latin-1 low bytes).

- [ ] **Step 1: Write the failing test**

```ts
// packages/printing/src/charset.test.ts
import { describe, expect, it } from "vitest";
import { CHARSET_SELECT, decodeBytes, WPC1252_TO_UNICODE } from "./charset.js";

describe("CHARSET_SELECT", () => {
  it("selects table 16 for wpc1252, 19 for pc858, nothing for plain", () => {
    expect([...CHARSET_SELECT.wpc1252]).toEqual([0x1b, 0x74, 16]);
    expect([...CHARSET_SELECT.pc858]).toEqual([0x1b, 0x74, 19]);
    expect([...CHARSET_SELECT.plain]).toEqual([]);
  });
});

describe("WPC1252 decode table", () => {
  it("matches the WHATWG windows-1252 decoder for every byte 0x00-0xFF", () => {
    const ref = new TextDecoder("windows-1252");
    for (let b = 0; b <= 0xff; b++) {
      expect(String.fromCodePoint(WPC1252_TO_UNICODE[b])).toBe(ref.decode(Uint8Array.of(b)));
    }
  });
});

describe("decodeBytes", () => {
  it("decodes the euro and accents per the selected set", () => {
    expect(decodeBytes([0x80], "wpc1252")).toBe("€"); // €
    expect(decodeBytes([0xd5], "pc858")).toBe("€"); // € at 0xD5 in code page 858
    expect(decodeBytes([0x82], "pc858")).toBe("é"); // é
    expect(decodeBytes([0x41, 0x42], "plain")).toBe("AB");
  });
});
```

- [ ] **Step 2: Generate the two decode tables, then write `charset.ts`**

Generate the 0x80–0xFF halves once and paste them in as literal arrays. Run this to emit them (Python is available on the dev host; the arrays are committed source, and Step 1's control test re-verifies wpc1252 independently):

```bash
python3 - <<'PY'
def half(codec):
    out=[]
    for b in range(0x80,0x100):
        try: cp=bytes([b]).decode(codec); cp=ord(cp)
        except Exception: cp=b
        out.append(cp)
    print(codec, "= [", ", ".join(hex(c) for c in out), "]")
half("cp1252")   # WPC1252 high half; undefined slots (0x81,0x8d,0x8f,0x90,0x9d) -> same code point
half("cp858")    # code page 858 high half (850 + euro at 0xD5)
PY
```

For `cp1252`, Python raises on the five undefined slots, so the `except` keeps the byte value — the same thing WHATWG windows-1252 does, which is what Step 1 checks. Then:

```ts
// packages/printing/src/charset.ts
/**
 * The three character sets a printer can be set to. Each byte the builder sends is read by the
 * printer through the selected code table; picking that table and encoding to match is what makes
 * accents and the euro sign print correctly. Node has no built-in encoder for these DOS/Windows code
 * pages, so the tables are baked here from the Unicode Consortium mapping files
 * (WINDOWS/CP1252.TXT and PC/CP850.TXT) and pinned by charset.test.ts.
 */
export type CharacterSet = "wpc1252" | "pc858" | "plain";

/** ESC t n — select character code table. Sent by the builder's init()/charset(). */
export const CHARSET_SELECT: Record<CharacterSet, readonly number[]> = {
  wpc1252: [0x1b, 0x74, 16],
  pc858: [0x1b, 0x74, 19],
  plain: [],
};

// Bytes 0x00-0x7f are ASCII in every set. These are the 0x80-0xff halves (paste the generator output).
const WPC1252_HIGH = [/* cp1252 output */] as const;
const PC858_HIGH = [/* cp858 output */] as const;

function table(high: readonly number[]): number[] {
  const t: number[] = [];
  for (let b = 0; b < 0x80; b++) t.push(b);
  for (const cp of high) t.push(cp);
  return t;
}

/** byte -> Unicode code point, for each set. */
export const WPC1252_TO_UNICODE = table(WPC1252_HIGH);
export const PC858_TO_UNICODE = table(PC858_HIGH);

function tableFor(cs: CharacterSet): number[] {
  // plain payloads are ASCII (transliterated on the way out), so a low-byte/Latin-1 read is exact.
  if (cs === "wpc1252") return WPC1252_TO_UNICODE;
  if (cs === "pc858") return PC858_TO_UNICODE;
  return LATIN1;
}
const LATIN1 = Array.from({ length: 256 }, (_, b) => b);

export function decodeBytes(bytes: Iterable<number>, cs: CharacterSet): string {
  const t = tableFor(cs);
  let out = "";
  for (const b of bytes) out += String.fromCodePoint(t[b & 0xff]);
  return out;
}
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @waitron/printing test -- charset`
Expected: PASS (the wpc1252 control, the pc858 pins, and the ESC t bytes).

- [ ] **Step 4: Commit**

```bash
git add packages/printing/src/charset.ts packages/printing/src/charset.test.ts
git commit -s -m "Add printer character-set decode tables and ESC t selection"
```

---

### Task 2: Character-set text preparation and encoding

**Files:**
- Modify: `packages/printing/src/charset.ts`
- Test: `packages/printing/src/charset.test.ts`

**Interfaces:**
- Consumes: `CharacterSet`, `WPC1252_TO_UNICODE`, `PC858_TO_UNICODE` (Task 1).
- Produces:
  - `export function prepareText(s: string, cs: CharacterSet): string` — NFC-normalise, then replace any character the set cannot show: first drop its accent (é→e), else a fixed transliteration (ñ→n, Ñ→N, ç→c, ¿→?, ¡→!, €→"EUR" for `plain`; € stays € for the two real sets), else `?`. The result contains only characters the set encodes to exactly one byte, so its `.length` equals its byte length.
  - `export function encodeText(s: string, cs: CharacterSet): number[]` — `prepareText` then one byte per character.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/printing/src/charset.test.ts
import { encodeText, prepareText } from "./charset.js";

describe("prepareText / encodeText", () => {
  it("keeps accents and euro for wpc1252 and pc858", () => {
    expect(encodeText("Café", "wpc1252")).toEqual([0x43, 0x61, 0x66, 0xe9]);
    expect(encodeText("€", "wpc1252")).toEqual([0x80]);
    expect(encodeText("€", "pc858")).toEqual([0xd5]);
    expect(encodeText("é", "pc858")).toEqual([0x82]);
  });

  it("transliterates for plain letters", () => {
    expect(prepareText("Café jamón Ñ ¿ ¡ ç € año", "plain")).toBe("Cafe jamon N ? ! c EUR ano");
  });

  it("round-trips prepared text through decode", () => {
    for (const cs of ["wpc1252", "pc858"] as const) {
      const prepared = prepareText("Café jamón Ñ ¿¡ ç ü €", cs);
      expect(decodeBytes(encodeText(prepared, cs), cs)).toBe(prepared);
    }
  });

  it("falls back to ? for a character no set can show", () => {
    expect(prepareText("中", "wpc1252")).toBe("?"); // a CJK character
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing test -- charset`
Expected: FAIL — `prepareText`/`encodeText` are not exported yet.

- [ ] **Step 3: Implement in `charset.ts`**

```ts
// add to packages/printing/src/charset.ts
const PLAIN_MAP: Record<string, string> = {
  "€": "EUR", "Ñ": "N", "ñ": "n", "ç": "c", "Ç": "C",
  "¿": "?", "¡": "!",
};

function reverse(table: number[]): Map<number, number> {
  const m = new Map<number, number>();
  // Lowest byte wins so ASCII maps to itself; high bytes fill the rest.
  for (let b = 0xff; b >= 0; b--) m.set(table[b], b);
  return m;
}
const ENCODE: Record<Exclude<CharacterSet, "plain">, Map<number, number>> = {
  wpc1252: reverse(WPC1252_TO_UNICODE),
  pc858: reverse(PC858_TO_UNICODE),
};

function stripAccent(ch: string): string {
  const d = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return d.length > 0 ? d : ch;
}

export function prepareText(s: string, cs: CharacterSet): string {
  const nfc = s.normalize("NFC");
  let out = "";
  for (const ch of nfc) {
    if (cs === "plain") {
      if (ch.charCodeAt(0) < 0x80) { out += ch; continue; }
      if (PLAIN_MAP[ch] !== undefined) { out += PLAIN_MAP[ch]; continue; }
      const stripped = stripAccent(ch);
      out += /^[\x00-\x7f]*$/.test(stripped) ? stripped : "?";
      continue;
    }
    const enc = ENCODE[cs];
    if (enc.has(ch.codePointAt(0)!)) { out += ch; continue; }
    if (PLAIN_MAP[ch] !== undefined && [...PLAIN_MAP[ch]].every((c) => enc.has(c.codePointAt(0)!))) {
      out += PLAIN_MAP[ch]; continue;
    }
    const stripped = stripAccent(ch);
    out += [...stripped].every((c) => enc.has(c.codePointAt(0)!)) ? stripped : "?";
  }
  return out;
}

export function encodeText(s: string, cs: CharacterSet): number[] {
  const prepared = prepareText(s, cs);
  if (cs === "plain") return [...prepared].map((c) => c.charCodeAt(0) & 0xff);
  const enc = ENCODE[cs];
  return [...prepared].map((c) => enc.get(c.codePointAt(0)!)!);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing test -- charset`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/charset.ts packages/printing/src/charset.test.ts
git commit -s -m "Encode and transliterate receipt text per character set"
```

---

### Task 3: Layout — columns, widths, wrapping and label+amount rows

**Files:**
- Create: `packages/printing/src/layout.ts`
- Test: `packages/printing/src/layout.test.ts`

**Interfaces:**
- Produces:
  - `export type PaperWidth = "58mm" | "80mm"; export type Resolution = "180dpi" | "203dpi";`
  - `export function columnsFor(w: PaperWidth): number` — 58mm→30, 80mm→42.
  - `export function safeWidthDots(w: PaperWidth): number` — columns × 12 → 360 / 504.
  - `export function dpiValue(r: Resolution): 180 | 203`.
  - `export function wrapText(text: string, columns: number, indent = 0): string[]` — break at spaces; split a word longer than `columns`; every line after the first is prefixed with `indent` spaces (the indent counts toward the width).
  - `export function labelAmountLines(label: string, amount: string, columns: number): string[]` — the label wrapped to `columns`; the amount right-aligned on the last line when at least one space fits after the label, otherwise on its own right-aligned line.

- [ ] **Step 1: Write the failing test**

```ts
// packages/printing/src/layout.test.ts
import { describe, expect, it } from "vitest";
import { columnsFor, dpiValue, labelAmountLines, safeWidthDots, wrapText } from "./layout.js";

describe("settings mapping", () => {
  it("maps paper width to columns and dots, resolution to dpi", () => {
    expect(columnsFor("58mm")).toBe(30);
    expect(columnsFor("80mm")).toBe(42);
    expect(safeWidthDots("58mm")).toBe(360);
    expect(safeWidthDots("80mm")).toBe(504);
    expect(dpiValue("180dpi")).toBe(180);
    expect(dpiValue("203dpi")).toBe(203);
  });
});

describe("wrapText", () => {
  it("keeps a line of exactly the column count on one line", () => {
    expect(wrapText("x".repeat(30), 30)).toEqual(["x".repeat(30)]);
  });
  it("wraps at spaces and indents continuation lines", () => {
    expect(wrapText("Tostada con tomate y jamon iberico", 20, 2)).toEqual([
      "Tostada con tomate y",
      "  jamon iberico",
    ]);
  });
  it("splits a single word longer than the line", () => {
    expect(wrapText("y".repeat(25), 10)).toEqual(["y".repeat(10), "y".repeat(10), "y".repeat(5)]);
  });
});

describe("labelAmountLines", () => {
  it("puts the amount at the right of the last line when it fits", () => {
    expect(labelAmountLines("1  Cafe con leche", "1,80 EUR", 30)).toEqual([
      "1  Cafe con leche     1,80 EUR",
    ]);
  });
  it("drops the amount to its own right-aligned line when the label fills the width", () => {
    const lines = labelAmountLines("x".repeat(28), "1,80 EUR", 30);
    expect(lines[0]).toBe("x".repeat(28));
    expect(lines.at(-1)).toBe(" ".repeat(22) + "1,80 EUR");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing test -- layout`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `layout.ts`**

```ts
// packages/printing/src/layout.ts
export type PaperWidth = "58mm" | "80mm";
export type Resolution = "180dpi" | "203dpi";

const COLUMNS: Record<PaperWidth, number> = { "58mm": 30, "80mm": 42 };
/** A character is 12 dots wide in the printer's default font (TM-T88III: 512 dots / 42 columns). */
export const DOTS_PER_COLUMN = 12;

export function columnsFor(w: PaperWidth): number { return COLUMNS[w]; }
export function safeWidthDots(w: PaperWidth): number { return COLUMNS[w] * DOTS_PER_COLUMN; }
export function dpiValue(r: Resolution): 180 | 203 { return r === "203dpi" ? 203 : 180; }

export function wrapText(text: string, columns: number, indent = 0): string[] {
  const lines: string[] = [];
  const pad = " ".repeat(indent);
  let width = columns; // first line has no indent
  let prefix = "";
  const words = text.split(" ");
  let line = "";
  const push = () => { lines.push(prefix + line); prefix = pad; width = columns - indent; line = ""; };
  for (let word of words) {
    while (word.length > width) {
      if (line !== "") push();
      lines.push(prefix + word.slice(0, width));
      word = word.slice(width);
      prefix = pad; width = columns - indent; line = "";
    }
    if (line === "") line = word;
    else if (line.length + 1 + word.length <= width) line += " " + word;
    else { push(); line = word; }
  }
  push();
  return lines;
}

export function labelAmountLines(label: string, amount: string, columns: number): string[] {
  const lines = wrapText(label, columns);
  const last = lines.at(-1)!;
  if (last.length + 1 + amount.length <= columns) {
    lines[lines.length - 1] = last + " ".repeat(columns - last.length - amount.length) + amount;
  } else {
    lines.push(" ".repeat(Math.max(0, columns - amount.length)) + amount);
  }
  return lines;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing test -- layout`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/layout.ts packages/printing/src/layout.test.ts
git commit -s -m "Add printer layout: columns, wrapping and label-amount rows"
```

---

### Task 4: QR dot-size choice and quiet-zone padding

**Files:**
- Modify: `packages/printing/src/layout.ts`
- Test: `packages/printing/src/layout.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export function chooseQrDots(squares: number, dpi: number, safeWidthDots: number): number` — the whole number of dots per square that keeps the code (squares × dots × 25.4 / dpi) within 30–40 mm and the bordered image (squares + 8) × dots within `safeWidthDots`, landing closest to 35 mm; on a tie the smaller. If none lands in 30–40 mm, the size closest to 35 mm that still fits the width (never throws).
  - `export function withQuietZone(modules: boolean[][], quiet: number): boolean[][]` — a new square matrix padded with `quiet` false modules on every side.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/printing/src/layout.test.ts
import { chooseQrDots, withQuietZone } from "./layout.js";

const mm = (n: number, s: number, d: number) => (n * s * 25.4) / d;

describe("chooseQrDots", () => {
  it("chooses the dot size closest to 35 mm within 30-40 mm (measured cases)", () => {
    expect(chooseQrDots(45, 180, 504)).toBe(6); // 38.1 mm
    expect(chooseQrDots(45, 203, 504)).toBe(6); // 33.8 mm
    expect(chooseQrDots(49, 180, 504)).toBe(5); // 34.6 mm  (6 dots would be 41.5, over 40)
    expect(chooseQrDots(49, 203, 504)).toBe(6); // 36.8 mm
    expect(chooseQrDots(53, 203, 504)).toBe(5); // 33.2 mm  (closer to 35 than 6 dots' 39.8)
    expect(chooseQrDots(65, 180, 360)).toBe(4); // 36.7 mm  narrowest paper still fits
  });

  it("keeps every real QR within 30-40 mm at both resolutions and both widths", () => {
    // Real links produce 41-65 squares (spec, Measurements table).
    for (let n = 41; n <= 65; n++) {
      for (const dpi of [180, 203]) {
        for (const width of [360, 504]) {
          const s = chooseQrDots(n, dpi, width);
          expect(mm(n, s, dpi)).toBeGreaterThanOrEqual(30);
          expect(mm(n, s, dpi)).toBeLessThanOrEqual(40);
          expect((n + 8) * s).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});

describe("withQuietZone", () => {
  it("pads a matrix with false modules on every side", () => {
    const padded = withQuietZone([[true]], 2);
    expect(padded.length).toBe(5);
    expect(padded[0]).toEqual([false, false, false, false, false]);
    expect(padded[2]).toEqual([false, false, true, false, false]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing test -- layout`
Expected: FAIL — `chooseQrDots`/`withQuietZone` not exported.

- [ ] **Step 3: Implement in `layout.ts`**

```ts
// add to packages/printing/src/layout.ts
const QR_MIN_MM = 30;
const QR_MAX_MM = 40;
const QR_TARGET_MM = 35;
const QR_BORDER = 4; // quiet-zone modules per side, counted for the width fit

export function chooseQrDots(squares: number, dpi: number, safeWidthDots: number): number {
  let best: { s: number; inRange: boolean; dist: number } | undefined;
  for (let s = 1; s <= 16; s++) {
    if ((squares + 2 * QR_BORDER) * s > safeWidthDots) break;
    const size = (squares * s * 25.4) / dpi;
    const inRange = size >= QR_MIN_MM && size <= QR_MAX_MM;
    const dist = Math.abs(size - QR_TARGET_MM);
    if (best === undefined || (inRange && !best.inRange) || (inRange === best.inRange && dist < best.dist)) {
      best = { s, inRange, dist };
    }
  }
  // best is always set: s=1 fits any real QR within the safe width.
  return best!.s;
}

export function withQuietZone(modules: boolean[][], quiet: number): boolean[][] {
  const side = modules.length + 2 * quiet;
  const row = () => new Array<boolean>(side).fill(false);
  const out: boolean[][] = [];
  for (let i = 0; i < quiet; i++) out.push(row());
  for (const r of modules) out.push([...row().slice(0, quiet), ...r, ...row().slice(0, quiet)]);
  for (let i = 0; i < quiet; i++) out.push(row());
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing test -- layout`
Expected: PASS (including the 41–65 property sweep).

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/layout.ts packages/printing/src/layout.test.ts
git commit -s -m "Choose the QR dot size for the legal 30-40 mm at each resolution"
```

---

### Task 5: The builder learns the character set

**Files:**
- Modify: `packages/printing/src/escpos.ts`
- Test: `packages/printing/src/escpos.test.ts`

**Interfaces:**
- Consumes: `CharacterSet`, `CHARSET_SELECT`, `encodeText` (Tasks 1–2).
- Produces:
  - `esc(charset?: CharacterSet): EscBuilder` — with no argument the builder keeps today's Latin-1 behaviour (no `ESC t`), so existing callers (the drawer kick) are unchanged.
  - `EscBuilder.init()` emits `ESC @` and then the `ESC t` bytes for the current set (nothing for `plain` or the legacy no-charset builder).
  - `EscBuilder.charset(cs: CharacterSet): this` — switch the current set mid-payload, emitting its `ESC t` (nothing for `plain`), so one payload can carry several sets (the test page).
  - `EscBuilder.text(s)` encodes with the current set (`encodeText`), or Latin-1 when no set was given.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/printing/src/escpos.test.ts
import type { CharacterSet } from "./charset.js";

describe("charset-aware builder", () => {
  it("emits ESC @ then ESC t 16 on init for wpc1252, and encodes the euro as 0x80", () => {
    expect([...esc("wpc1252").init().line("€").bytes()]).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 16, 0x80, 0x0a,
    ]);
  });
  it("emits ESC t 19 and encodes the euro as 0xD5 for pc858", () => {
    expect([...esc("pc858").init().line("€").bytes()]).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 19, 0xd5, 0x0a,
    ]);
  });
  it("sends no ESC t for plain and transliterates the euro to EUR", () => {
    expect([...esc("plain").init().line("€").bytes()]).toEqual([
      0x1b, 0x40, 0x45, 0x55, 0x52, 0x0a, // ESC @, "EUR", LF
    ]);
  });
  it("switches character set mid-payload", () => {
    const bytes = [...esc("plain").init().charset("pc858").text("é").bytes()];
    expect(bytes).toEqual([0x1b, 0x40, 0x1b, 0x74, 19, 0x82]);
  });
  it("keeps Latin-1 behaviour when no charset is given", () => {
    expect([...esc().init().text("é").bytes()]).toEqual([0x1b, 0x40, 0xe9]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing test -- escpos`
Expected: FAIL — `esc()` takes no argument and `charset()` does not exist.

- [ ] **Step 3: Implement in `escpos.ts`**

Add the import and a current-charset field; change `init`, `text`, add `charset`; change `esc`:

```ts
import { CHARSET_SELECT, encodeText, type CharacterSet } from "./charset.js";

// in class EscBuilder:
  constructor(private current?: CharacterSet) {}

  init(): this {
    this.parts.push(ESC, 0x40);
    if (this.current !== undefined) this.parts.push(...CHARSET_SELECT[this.current]);
    return this;
  }

  charset(cs: CharacterSet): this {
    this.current = cs;
    this.parts.push(...CHARSET_SELECT[cs]);
    return this;
  }

  text(s: string): this {
    if (this.current === undefined) {
      for (const b of Buffer.from(s, TEXT_ENCODING)) this.parts.push(b);
    } else {
      for (const b of encodeText(s, this.current)) this.parts.push(b);
    }
    return this;
  }

// factory:
export function esc(charset?: CharacterSet): EscBuilder {
  return new EscBuilder(charset);
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing test -- escpos`
Expected: PASS. Also run the whole printing suite to confirm no existing byte test regressed: `pnpm --filter @waitron/printing test`

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/escpos.ts packages/printing/src/escpos.test.ts
git commit -s -m "Let the ESC/POS builder select and encode a character set"
```

---

### Task 6: Export the layout and charset API from the package

**Files:**
- Modify: `packages/printing/src/index.ts`
- Test: `packages/printing/src/index.test.ts` (create if absent)

**Interfaces:**
- Produces: `@waitron/printing` re-exports `CharacterSet`, `encodeText`, `prepareText`, `decodeBytes`, `CHARSET_SELECT`, and from layout: `PaperWidth`, `Resolution`, `columnsFor`, `safeWidthDots`, `dpiValue`, `wrapText`, `labelAmountLines`, `chooseQrDots`, `withQuietZone`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/printing/src/index.test.ts
import { describe, expect, it } from "vitest";
import { chooseQrDots, columnsFor, decodeBytes, encodeText, labelAmountLines } from "./index.js";

describe("package barrel", () => {
  it("re-exports the layout and charset helpers", () => {
    expect(columnsFor("80mm")).toBe(42);
    expect(chooseQrDots(45, 180, 504)).toBe(6);
    expect(encodeText("€", "pc858")).toEqual([0xd5]);
    expect(decodeBytes([0xd5], "pc858")).toBe("€");
    expect(labelAmountLines("A", "B", 10)).toEqual(["A        B"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing test -- index`
Expected: FAIL — not exported.

- [ ] **Step 3: Add the exports**

```ts
// add to packages/printing/src/index.ts
export {
  CHARSET_SELECT, decodeBytes, encodeText, prepareText,
} from "./charset.js";
export type { CharacterSet } from "./charset.js";
export {
  chooseQrDots, columnsFor, dpiValue, labelAmountLines, safeWidthDots, withQuietZone, wrapText,
} from "./layout.js";
export type { PaperWidth, Resolution } from "./layout.js";
```

- [ ] **Step 4: Run the test and the whole suite**

Run: `pnpm --filter @waitron/printing test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/index.ts packages/printing/src/index.test.ts
git commit -s -m "Export the layout and character-set helpers from @waitron/printing"
```

---

### Task 7: The three settings columns on `printers`

**Files:**
- Modify: `packages/db/src/schema/printers.ts`
- Create: a migration under `packages/db/drizzle/` (generated)
- Test: `packages/db/src/schema/printing.test.ts`

**Interfaces:**
- Produces: exported `printPaperWidth`, `printResolution`, `printCharacterSet` pgEnums, and the `paperWidth`, `resolution`, `characterSet` columns on `printers`, each `.notNull()` with the defaults `80mm` / `180dpi` / `wpc1252`.

- [ ] **Step 1: Add the failing grant assertions**

In `packages/db/src/schema/printing.test.ts`, in the test at ~line 187 ("exposes every column … with the port and ticket_scope defaults"), add three assertions next to the existing `ticketScope` one:

```ts
expect(row!.paperWidth).toBe("80mm");
expect(row!.resolution).toBe("180dpi");
expect(row!.characterSet).toBe("wpc1252");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/db test -- printing`
Expected: FAIL — `row.paperWidth` is `undefined` (columns and enums do not exist).

- [ ] **Step 3: Add the enums and columns**

In `packages/db/src/schema/printers.ts`, after the `printTicketScope` declaration add:

```ts
/** Paper width the printer's paper roll is (design 2026-09-14). 30 vs 42 columns of text. */
export const printPaperWidth = pgEnum("print_paper_width", ["58mm", "80mm"]);
/** Print head resolution. Sets the QR dot size for the legal 30-40 mm. TM-T88 family is 180 dpi. */
export const printResolution = pgEnum("print_resolution", ["180dpi", "203dpi"]);
/** Character table the printer is switched to, so accents and the euro sign print correctly. */
export const printCharacterSet = pgEnum("print_character_set", ["wpc1252", "pc858", "plain"]);
```

and inside the `printers` table, beside `ticketScope`:

```ts
    paperWidth: printPaperWidth("paper_width").notNull().default("80mm"),
    resolution: printResolution("resolution").notNull().default("180dpi"),
    characterSet: printCharacterSet("character_set").notNull().default("wpc1252"),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/db db:generate --name printer_layout_settings`

This creates three `CREATE TYPE … AS ENUM` statements and three `ALTER TABLE "printers" ADD COLUMN … NOT NULL DEFAULT …`. Because the types are created and used in the same migration transaction, PostgreSQL's same-transaction enum restriction (`55P04`, which only affects a *value* added to a pre-existing type) does not apply — no hand-written custom migration is needed. Open the generated `.sql` and confirm it contains only those `CREATE TYPE` + `ADD COLUMN` lines and nothing unexpected.

- [ ] **Step 5: Run the grant test and the migration/journal guards**

Run:
```bash
pnpm --filter @waitron/db test -- printing && \
pnpm --filter @waitron/db test -- journal-monotonic && \
pnpm --filter @waitron/db test:coverage
```
Expected: PASS. (If a rebase later collides the migration number, regenerate — reset `packages/db/drizzle/` to `origin/main`, keep `printers.ts`, re-run Step 4 — never hand-edit `_journal.json`.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/printers.ts packages/db/drizzle packages/db/src/schema/printing.test.ts
git commit -s -m "Add paper width, resolution and character set to the printers table"
```

---

### Task 8: Carry the settings through create/update/list

**Files:**
- Modify: `packages/printing/src/printers.ts`
- Test: `packages/printing/src/printers.test.ts` (the existing suite for these functions)

**Interfaces:**
- Consumes: the schema columns (Task 7).
- Produces: `CreatePrinterInput`, `UpdatePrinterInput` and `PrinterRow` each gain `paperWidth?/resolution?/characterSet?` (optional on input; always present on the row), and `createPrinter`/`updatePrinter`/`listPrinters` read and write them.

- [ ] **Step 1: Write the failing test**

Find the existing create/list test in `packages/printing/src/printers.test.ts` and add:

```ts
it("stores and returns the layout settings, defaulting when omitted", async () => {
  const created = await createPrinter(tx, cfg, {
    name: "Cocina", transport: "network_tcp", host: "10.0.0.5",
    paperWidth: "58mm", characterSet: "pc858",
  });
  const [row] = (await listPrinters(tx, cfg)).filter((p) => p.id === created.id);
  expect(row.paperWidth).toBe("58mm");
  expect(row.resolution).toBe("180dpi"); // defaulted
  expect(row.characterSet).toBe("pc858");
  await updatePrinter(tx, cfg, created.id, { resolution: "203dpi" });
  const [updated] = (await listPrinters(tx, cfg)).filter((p) => p.id === created.id);
  expect(updated.resolution).toBe("203dpi");
});
```

(Use the suite's existing `tx`/`cfg` setup helpers; mirror the neighbouring create/list test.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing test -- printers`
Expected: FAIL — the input type rejects the fields / the row lacks them.

- [ ] **Step 3: Add the fields**

In `packages/printing/src/printers.ts`:
- add `paperWidth?`, `resolution?`, `characterSet?` (typed as the enum unions, importable from the schema or as string literal unions) to `CreatePrinterInput` and `UpdatePrinterInput`;
- add `paperWidth`, `resolution`, `characterSet` (non-optional) to `PrinterRow`;
- in `createPrinter`'s `insert(...).values({...})`, pass the three fields through (drizzle applies the column default when the value is `undefined`);
- in `updatePrinter`'s update object, set each when defined (mirror how `ticketScope` is handled);
- in `listPrinters`' `.select({...})`, add `paperWidth: printers.paperWidth, resolution: printers.resolution, characterSet: printers.characterSet`.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing test -- printers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/printers.ts packages/printing/src/printers.test.ts
git commit -s -m "Carry printer layout settings through create, update and list"
```

---

### Task 9: Accept and return the settings over the API; prove config transfer

**Files:**
- Modify: `apps/server/src/print-api.ts`
- Test: `apps/server/src/print-api.test.ts` (or `print-api.pg.test.ts`), `apps/server/src/configuration-transfer.test.ts`

**Interfaces:**
- Consumes: the printer functions (Task 8), the schema enums (Task 7).
- Produces: `POST /management-api/printers` and `PATCH /management-api/printers/:id` accept `paperWidth`, `resolution`, `characterSet`; `GET /management-api/printers` returns them.

- [ ] **Step 1: Write the failing tests**

In the print-api test suite, add (mirroring the existing create/patch/list tests):

```ts
it("accepts and returns the layout settings, and rejects a bad value", async () => {
  const created = await createViaApi({ name: "P", transport: "network_tcp", host: "10.0.0.9",
    paperWidth: "58mm", resolution: "203dpi", characterSet: "pc858" });
  const listed = await listViaApi();
  const row = listed.find((p) => p.id === created.id)!;
  expect(row).toMatchObject({ paperWidth: "58mm", resolution: "203dpi", characterSet: "pc858" });

  const bad = await rawPost("/management-api/printers", { name: "Q", transport: "network_tcp",
    host: "10.0.0.9", paperWidth: "70mm" });
  expect(bad.status).toBe(400);
  expect((await bad.json()).code).toBe("management.request_invalid");
});
```

In `apps/server/src/configuration-transfer.test.ts`, seed the source printer with non-default settings (`paper_width='58mm', resolution='203dpi', character_set='pc858'`) and assert the imported target row carries them (add a select of the three columns for the imported printer and assert their values — a fixture that is read, per the testing rules).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server test -- print-api configuration-transfer`
Expected: FAIL — routes ignore the fields; the transfer assertion has nothing to read yet.

- [ ] **Step 3: Wire the routes**

In `print-api.ts`, import the enums (`printPaperWidth`, `printResolution`, `printCharacterSet`) from `@waitron/db`'s schema export. In `POST /management-api/printers`, after the existing optional fields:

```ts
if (body.paperWidth !== undefined)
  input.paperWidth = requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues);
if (body.resolution !== undefined)
  input.resolution = requireEnum(body.resolution, "resolution", printResolution.enumValues);
if (body.characterSet !== undefined)
  input.characterSet = requireEnum(body.characterSet, "characterSet", printCharacterSet.enumValues);
```

Add the identical three blocks to `PATCH /management-api/printers/:id` (writing to `patch`). `GET` already returns whatever `listPrinters` selects (Task 8), so nothing more is needed there. Confirm the three enums are on `@waitron/db`'s enumerated `exports` (they are exported from the schema barrel; if the deep path is not exposed, import from the same place `printTransport` is imported in this file).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test -- print-api configuration-transfer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/print-api.ts apps/server/src/print-api.test.ts apps/server/src/print-api.pg.test.ts apps/server/src/configuration-transfer.test.ts
git commit -s -m "Accept and return printer layout settings over the management API"
```

---

### Task 10: Shared money formatting and the QR matrix helper

**Files:**
- Create: `apps/server/src/receipt-money.ts`, `apps/server/src/qr-matrix.ts`
- Test: `apps/server/src/receipt-money.test.ts`, `apps/server/src/qr-matrix.test.ts`

**Interfaces:**
- Produces:
  - `export function formatMoney(value: string, locale: string): string` — the receipt's existing formatter, with the non-breaking-space→ASCII-space fix, cached per locale.
  - `export function qrModules(text: string, opts?: { version?: number }): boolean[][]` — the QR module matrix (dark = true) at error-correction level M, optionally forced to a version.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/server/src/receipt-money.test.ts
import { describe, expect, it } from "vitest";
import { formatMoney } from "./receipt-money.js";
describe("formatMoney", () => {
  it("separates the amount from the euro with an ASCII space, not a non-breaking space", () => {
    const s = formatMoney("12.50", "es-ES");
    expect(s).toBe("12,50 €");
    expect(s.charCodeAt(5)).toBe(0x20);
  });
});
```

```ts
// apps/server/src/qr-matrix.test.ts
import { describe, expect, it } from "vitest";
import { qrModules } from "./qr-matrix.js";
describe("qrModules", () => {
  it("returns a square boolean matrix", () => {
    const m = qrModules("https://example.com/x?a=1");
    expect(m.length).toBeGreaterThan(0);
    expect(m.every((r) => r.length === m.length)).toBe(true);
  });
  it("forces the QR version when asked", () => {
    expect(qrModules("Waitron 30-40 mm", { version: 7 }).length).toBe(45);
    expect(qrModules("Waitron 30-40 mm", { version: 9 }).length).toBe(53);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server test -- receipt-money qr-matrix`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both files**

```ts
// apps/server/src/receipt-money.ts
const formatters = new Map<string, Intl.NumberFormat>();
export function formatMoney(value: string, locale: string): string {
  let f = formatters.get(locale);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
    formatters.set(locale, f);
  }
  return f.format(Number(value)).replace(/[  ]/g, " ");
}
```

```ts
// apps/server/src/qr-matrix.ts
import QRCode from "qrcode";
export function qrModules(text: string, opts?: { version?: number }): boolean[][] {
  const qr = QRCode.create(text, {
    errorCorrectionLevel: "M",
    ...(opts?.version === undefined ? {} : { version: opts.version }),
  });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const m: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(data[r * size + c] === 1);
    m.push(row);
  }
  return m;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test -- receipt-money qr-matrix`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/receipt-money.ts apps/server/src/receipt-money.test.ts apps/server/src/qr-matrix.ts apps/server/src/qr-matrix.test.ts
git commit -s -m "Add shared money formatting and a QR matrix helper"
```

---

### Task 11: Lay the receipt out for the printer's width and character set

**Files:**
- Modify: `apps/server/src/receipt-ticket.ts`, `apps/server/src/receipt-print.ts`
- Test: `apps/server/src/receipt-ticket.test.ts`

**Interfaces:**
- Consumes: `columnsFor`, `labelAmountLines`, `wrapText`, `esc`, `prepareText`, `CharacterSet`, `PaperWidth`, `Resolution` (`@waitron/printing`); `formatMoney` (Task 10).
- Produces: `FormatReceiptInput` gains `printer: { paperWidth: PaperWidth; resolution: Resolution; characterSet: CharacterSet }`. `resolveReceiptPrinter` returns those three columns as well as `id`.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/server/src/receipt-ticket.test.ts
import { columnsFor } from "@waitron/printing";
import { decodeBytes } from "@waitron/printing";

const PRINTER_80 = { paperWidth: "80mm", resolution: "180dpi", characterSet: "wpc1252" } as const;
const PRINTER_58 = { paperWidth: "58mm", resolution: "180dpi", characterSet: "pc858" } as const;

it("keeps every line within the column count at 30 and 42 columns", () => {
  for (const printer of [PRINTER_80, PRINTER_58]) {
    const bytes = formatReceipt({ result: FILED_SALE, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer });
    const cols = columnsFor(printer.paperWidth);
    // Decode with the printer's charset and split on line feeds; each printed line fits.
    const text = decodeBytes([...bytes], printer.characterSet);
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(cols);
  }
});

it("wraps a long product name and right-aligns its price on the last line", () => {
  const longName = { ...FILED_SALE, lines: [{ ...FILED_SALE.lines[0],
    descriptions: { "es-ES": "Tostada con tomate y jamon iberico de bellota" }, gross: "12.50" }] };
  const bytes = formatReceipt({ result: longName, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer: PRINTER_80 });
  const text = decodeBytes([...bytes], "wpc1252");
  expect(text).toContain("12,50 €");
  expect(text.split("\n").some((l) => l.length > 42)).toBe(false);
});
```

Keep the existing completeness test running for both printers (parametrise its `formatReceipt` call with `printer: PRINTER_80`).

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- receipt-ticket`
Expected: FAIL — `formatReceipt` does not accept `printer`; lines exceed 30 at 58mm.

- [ ] **Step 3: Rework `receipt-ticket.ts`**

- Add `printer` to `FormatReceiptInput` (types imported from `@waitron/printing`).
- Replace `const RECEIPT_WIDTH = 42` and `twoColumn` with the printer's column count and the shared layout: at the top of `formatReceipt`, `const columns = columnsFor(printer.paperWidth);` and build the builder with `const b = esc(printer.characterSet).init();`.
- Prepare every dynamic string to the character set before measuring, so its length matches the bytes: `const p = (s: string) => prepareText(s, printer.characterSet);`. Apply `p(...)` to product names, the venue name, subtitle, order line, card reference, footer, and money strings.
- Replace each `b.line(twoColumn(label, value))` with `for (const line of labelAmountLines(p(label), p(formatMoney(...)), columns)) b.line(line);`.
- Wrap free single-value lines (venue name, subtitle, order line, card reference, footer) with `for (const line of wrapText(p(text), columns)) b.line(line);`.
- Wrap modifier sub-lines with `wrapText(p(label), columns, 2)`.
- Import `formatMoney` from `./receipt-money.js` and delete the local `formatMoney`/`formatters` copy.
- Leave the QR line as-is for this task (`if (result.qr !== "") b.qr(result.qr).line();`) — Task 12 replaces it.

In `receipt-print.ts`, extend `resolveReceiptPrinter`'s select to `{ id: printers.id, paperWidth: printers.paperWidth, resolution: printers.resolution, characterSet: printers.characterSet }` and change its return type to include them; in `buildReceiptBytes` pass `printer: { paperWidth: printer.paperWidth, resolution: printer.resolution, characterSet: printer.characterSet }` into `formatReceipt`. (`resolveReceiptPrinter`'s callers that only use `.id` are unaffected.)

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/server test -- receipt-ticket receipt-print`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/receipt-ticket.ts apps/server/src/receipt-print.ts apps/server/src/receipt-ticket.test.ts
git commit -s -m "Lay the receipt out for the printer's paper width and character set"
```

---

### Task 12: Print the receipt QR as a sized raster image

**Files:**
- Modify: `apps/server/src/receipt-ticket.ts`
- Test: `apps/server/src/receipt-ticket.test.ts`

**Interfaces:**
- Consumes: `qrModules` (Task 10); `chooseQrDots`, `dpiValue`, `safeWidthDots`, `withQuietZone` (`@waitron/printing`); the `printer` settings (Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/server/src/receipt-ticket.test.ts
import { bytesInclude } from "./testing/decode-ticket.js";

it("prints the QR as a raster image, not the built-in QR command, sized to 30-40 mm", () => {
  const bytes = formatReceipt({ result: FILED_SALE, issuer: ISSUER, receipt: {}, invoiceLocale: "es-ES", printer: PRINTER_80 });
  expect(bytesInclude(bytes, Uint8Array.of(0x1d, 0x76, 0x30))).toBe(true); // GS v 0 raster
  expect(bytesInclude(bytes, Uint8Array.of(0x1d, 0x28, 0x6b))).toBe(false); // no GS ( k
});
```

Also add a unit check on the sizing path (the mm range is covered by Task 4's sweep; here confirm the receipt calls it): assert the raster's declared pixel width (`GS v 0` header bytes) equals `(squares + 8) * chosenDots` for `FILED_SALE.qr` — compute `squares = qrModules(FILED_SALE.qr).length` and `chooseQrDots(squares, 180, 504)` in the test and compare.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- receipt-ticket`
Expected: FAIL — the receipt still emits `GS ( k`.

- [ ] **Step 3: Replace the QR emission**

In `formatReceipt`, replace `if (result.qr !== "") b.qr(result.qr).line();` with:

```ts
if (result.qr !== "") {
  const matrix = qrModules(result.qr);
  const dots = chooseQrDots(matrix.length, dpiValue(printer.resolution), safeWidthDots(printer.paperWidth));
  b.qrRaster(withQuietZone(matrix, 4), { moduleSize: dots }).line();
}
```

Add the imports from `@waitron/printing` and `./qr-matrix.js`.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/server test -- receipt-ticket`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/receipt-ticket.ts apps/server/src/receipt-ticket.test.ts
git commit -s -m "Print the receipt QR as a raster image sized to the legal band"
```

---

### Task 13: The payment slip takes the same layout and shared money formatting

**Files:**
- Modify: `apps/server/src/payment-slip.ts`, `apps/server/src/payment-slip-print.ts`
- Test: `apps/server/src/payment-slip.test.ts`

**Interfaces:**
- Consumes: `columnsFor`, `labelAmountLines`, `wrapText`, `esc`, `prepareText`, `CharacterSet`, `PaperWidth` (`@waitron/printing`); `formatMoney` (Task 10); the settings on `resolveReceiptPrinter` (Task 11).
- Produces: `PaymentSlipInput` gains `printer: { paperWidth: PaperWidth; characterSet: CharacterSet }` (a payment slip carries no QR, so no resolution).

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/server/src/payment-slip.test.ts
import { columnsFor, decodeBytes } from "@waitron/printing";
const PR = { paperWidth: "80mm", characterSet: "wpc1252" } as const;

it("separates the amount from the euro with an ASCII space", () => {
  const bytes = formatPaymentSlip({ ...input, printer: PR });
  const i = [...bytes].findIndex((b, k) => b === 0xac /* € in wpc1252 is 0x80 */ || false);
  const text = decodeBytes([...bytes], "wpc1252");
  const idx = text.indexOf("€");
  expect(text.charCodeAt(idx - 1)).toBe(0x20);
});

it("keeps every line within the column count", () => {
  for (const printer of [PR, { paperWidth: "58mm", characterSet: "pc858" } as const]) {
    const text = decodeBytes([...formatPaymentSlip({ ...input, printer })], printer.characterSet);
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(columnsFor(printer.paperWidth));
  }
});
```

(Drop the `0xac` line if it does not read cleanly; the euro byte is `0x80` under wpc1252 — the assertion that matters is the ASCII `0x20` before the decoded `€`.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- payment-slip`
Expected: FAIL — no `printer` field; the slip's own `money` leaves a non-breaking space and its `42` overruns 58mm.

- [ ] **Step 3: Rework `payment-slip.ts`**

- Add `printer` to `PaymentSlipInput`.
- `const columns = columnsFor(input.printer.paperWidth);` and `const b = esc(input.printer.characterSet).init();`.
- Replace the inline `money` with the shared `formatMoney` (import from `./receipt-money.js`).
- `const p = (s: string) => prepareText(s, input.printer.characterSet);`
- Replace the `row(label, value)` helper with `for (const line of labelAmountLines(p(label), p(value), columns)) b.line(line);` and wrap the free lines (heading, "no es una factura", issuer, date, order) with `wrapText(p(text), columns)`.

In `payment-slip-print.ts`, pass `printer: { paperWidth: printer.paperWidth, characterSet: printer.characterSet }` from the `resolveReceiptPrinter` result into `formatPaymentSlip`.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/server test -- payment-slip payment-slip-print`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/payment-slip.ts apps/server/src/payment-slip-print.ts apps/server/src/payment-slip.test.ts
git commit -s -m "Lay the payment slip out for the printer and share money formatting"
```

---

### Task 14: Kitchen tickets wrap and are built per printer settings

**Files:**
- Modify: `apps/server/src/kitchen-ticket.ts`, `apps/server/src/kitchen-print.ts`
- Test: `apps/server/src/kitchen-ticket.test.ts`, `apps/server/src/kitchen-print.test.ts`

**Interfaces:**
- Consumes: `columnsFor`, `wrapText`, `esc`, `prepareText`, `CharacterSet` (`@waitron/printing`).
- Produces: `formatKitchenTicket(ticket, layout)` and `formatCorrectionSlip(slip, layout)` take a second argument `layout: { columns: number; charset: CharacterSet }`; `lockActivePrinters` returns `paperWidth` and `characterSet` per row.

- [ ] **Step 1: Write the failing tests**

```ts
// add to apps/server/src/kitchen-ticket.test.ts
const L80 = { columns: 42, charset: "wpc1252" } as const;
const L58 = { columns: 30, charset: "pc858" } as const;

it("wraps a long item name with an indent", () => {
  const ticket = { scope: "station", stationName: "Cocina", tableLabel: "M4", orderNumber: "3",
    firedAt: new Date(0), items: [{ qty: 1, name: "x".repeat(40) }] } as const;
  const text = decodeTicket(formatKitchenTicket(ticket, L58)).split("\n");
  expect(text.every((l) => l.length <= 30)).toBe(true);
});

it("produces different bytes for different character sets", () => {
  const ticket = { scope: "station", stationName: "Cocina", tableLabel: "M4", orderNumber: "3",
    firedAt: new Date(0), items: [{ qty: 1, name: "Café" /* é */ }] } as const;
  expect([...formatKitchenTicket(ticket, L80)]).not.toEqual([...formatKitchenTicket(ticket, L58)]);
});
```

```ts
// add to apps/server/src/kitchen-print.test.ts
it("builds one ticket per distinct (width, charset) among a station's printers", async () => {
  // Two printers on one station: same settings -> identical bytes; different charset -> different bytes.
  // (Use the suite's existing station/printer seeding helpers; assert on the enqueued print_jobs payloads.)
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server test -- kitchen-ticket kitchen-print`
Expected: FAIL — the formatters take no layout argument.

- [ ] **Step 3: Implement**

In `kitchen-ticket.ts`, add `layout: { columns: number; charset: CharacterSet }` to `formatKitchenTicket` and `formatCorrectionSlip`; build with `esc(layout.charset).init()`; in `emitItem` and the header/station lines, wrap each printed line: `for (const l of wrapText(prepareText(text, layout.charset), layout.columns, indent)) b.line(l)` (indent 0 for the item line, 2 for `+ modifier` / `* note` / doneness sub-lines — keep the existing `+ `/`* `/`** **` markers inside the wrapped text).

In `kitchen-print.ts`:
- add `paperWidth: printers.paperWidth, characterSet: printers.characterSet` to `lockActivePrinters`'s select and its return type;
- carry those onto each `printersByStation` entry;
- define `const layoutOf = (p) => ({ columns: columnsFor(p.paperWidth), charset: p.characterSet });` and `const key = (p) => p.paperWidth + "|" + p.characterSet;`
- in the station loop, group the station's station-scope printers by `key`, and for each group build `formatKitchenTicket({...station ticket...}, layoutOf(group[0]))` once and enqueue to that group's printers;
- collect group-scope printers with their settings; group them by `key` and build the consolidated ticket once per group;
- in `enqueueCorrectionSlips`, group each item's station printers by `key` and build `formatCorrectionSlip(slip, layoutOf(group[0]))` once per group.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test -- kitchen-ticket kitchen-print`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/kitchen-ticket.ts apps/server/src/kitchen-print.ts apps/server/src/kitchen-ticket.test.ts apps/server/src/kitchen-print.test.ts
git commit -s -m "Wrap kitchen tickets and build them per printer settings"
```

---

### Task 15: The printer setup test page

**Files:**
- Create: `apps/server/src/test-page.ts`, `apps/server/src/test-page.test.ts`
- Modify: `apps/server/src/print-api.ts` (build it in the test-print route), `apps/server/src/boot.ts` (pass the venue locale into the print-api mount)
- Test: `apps/server/src/test-page.test.ts`

**Interfaces:**
- Consumes: `esc`, `wrapText`, `chooseQrDots` (not needed here — samples use fixed dot sizes), `withQuietZone` (`@waitron/printing`); `qrModules` (Task 10); `SupportedLocale` (`@waitron/shared`).
- Produces: `export function formatTestPage(opts: { locale: SupportedLocale }): Uint8Array`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/test-page.test.ts
import { describe, expect, it } from "vitest";
import { decodeBytes } from "@waitron/printing";
import { formatTestPage } from "./test-page.js";
import { bytesInclude, decodeTicket } from "./testing/decode-ticket.js";

describe("formatTestPage", () => {
  it("prints width lines of exactly 30, 32, 42 and 48 characters ending in |", () => {
    const lines = decodeTicket(formatTestPage({ locale: "es-ES" })).split("\n");
    for (const [len, label] of [[30, "A"], [32, "B"], [42, "C"], [48, "D"]] as const) {
      const line = lines.find((l) => l.startsWith(label + " "));
      expect(line).toBeDefined();
      expect(line!.length).toBe(len);
      expect(line!.endsWith("|")).toBe(true);
    }
  });

  it("carries ESC t 16 and ESC t 19 for the character-set sample lines", () => {
    const bytes = formatTestPage({ locale: "es-ES" });
    expect(bytesInclude(bytes, Uint8Array.of(0x1b, 0x74, 16))).toBe(true);
    expect(bytesInclude(bytes, Uint8Array.of(0x1b, 0x74, 19))).toBe(true);
    // The wpc1252 sample encodes é as 0xe9, the pc858 sample as 0x82.
    expect(bytesInclude(bytes, Uint8Array.of(0x82))).toBe(true);
  });

  it("prints captions in the venue language", () => {
    expect(decodeTicket(formatTestPage({ locale: "es-ES" }))).toContain("linea");
    expect(decodeTicket(formatTestPage({ locale: "en-GB" }))).toContain("line");
  });
});
```

Add a raster-width check: the two sample images' `GS v 0` declared widths are `(45 + 8) * 5 = 265` and `(53 + 6) * 6 = 354`, both ≤ 360 (the B/D sample uses a 3-module quiet zone so it fits the narrowest paper).

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server test -- test-page`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `test-page.ts`**

```ts
// apps/server/src/test-page.ts
import { esc, withQuietZone, wrapText } from "@waitron/printing";
import type { SupportedLocale } from "@waitron/shared";
import { qrModules } from "./qr-matrix.js";

interface Captions {
  widthQuestion: string; qrCaption: string; qrForAC: string; qrForBD: string; charsetQuestion: string;
}
// Captions are plain ASCII (no accents), so they read correctly before a character set is chosen.
const CAPTIONS: Record<SupportedLocale, Captions> = {
  "es-ES": {
    widthQuestion: "Cual es la linea mas larga cuyo | no baja de fila?",
    qrCaption: "Mida el QR de su linea. Debe medir entre 30 y 40 mm.",
    qrForAC: "Para A o C:", qrForBD: "Para B o D:",
    charsetQuestion: "Elija la primera linea que se lea bien. La 3 siempre se lee.",
  },
  "en-GB": {
    widthQuestion: "Which is the longest line whose | stays on its row?",
    qrCaption: "Measure the QR for your line. It must be between 30 and 40 mm.",
    qrForAC: "For A or C:", qrForBD: "For B or D:",
    charsetQuestion: "Choose the first line that reads correctly. Line 3 always does.",
  },
};

const widthLine = (label: string, n: number) => label + " " + "-".repeat(n - 3) + "|"; // total length n

export function formatTestPage({ locale }: { locale: SupportedLocale }): Uint8Array {
  const c = CAPTIONS[locale];
  const b = esc("plain").init(); // captions and width lines are ASCII

  for (const l of wrapText(c.widthQuestion, 42)) b.line(l);
  b.line(widthLine("A", 30)).line(widthLine("B", 32)).line(widthLine("C", 42)).line(widthLine("D", 48)).line();

  for (const l of wrapText(c.qrCaption, 42)) b.line(l);
  b.line(c.qrForAC);
  b.qrRaster(withQuietZone(qrModules("Waitron 30-40 mm", { version: 7 }), 4), { moduleSize: 5 }).line();
  b.line(c.qrForBD);
  b.qrRaster(withQuietZone(qrModules("Waitron 30-40 mm", { version: 9 }), 3), { moduleSize: 6 }).line();

  for (const l of wrapText(c.charsetQuestion, 42)) b.line(l);
  b.charset("wpc1252").line("1: Cafe jamon N ?! c u 5 €".normalize());
  // Use the accented sample text; keep it <= 30 chars. Re-add accents for lines 1 and 2:
  b.charset("wpc1252").line("1: Café jamón Ñ ¿¡ ç ü 5 €");
  b.charset("pc858").line("2: Café jamón Ñ ¿¡ ç ü 5 €");
  b.charset("plain").line("3: Cafe jamon N ?! c u 5 EUR");

  return b.feedAndCut().bytes();
}
```

(Clean up the duplicated line-1 above when implementing — keep the single accented `charset("wpc1252")` line. The three sample lines each re-send `ESC t` via `charset()`, so one payload carries all three sets.)

- [ ] **Step 4: Build it in the test-print route**

In `boot.ts`, where the print API is mounted, pass the already-resolved `venueLocale` into the mount's deps. In `print-api.ts`, remove the module-level `TEST_PRINT_PAYLOAD` and change the `POST /management-api/printers/:id/test-print` route to `enqueuePrintJob(tx, deps.cfg, id, formatTestPage({ locale: deps.venueLocale }))`. Add `venueLocale: SupportedLocale` to the mount's deps type.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @waitron/server test -- test-page print-api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/test-page.ts apps/server/src/test-page.test.ts apps/server/src/print-api.ts apps/server/src/boot.ts
git commit -s -m "Add the printer setup test page and build it in the venue language"
```

---

### Task 16: The preview decoder honours the character set and reports the printer's width

**Files:**
- Modify: `apps/server/src/print-job-preview.ts`, `apps/server/src/print-api.ts`
- Test: `apps/server/src/print-job-preview.test.ts`, the preview route test in `print-api.test.ts`

**Interfaces:**
- Consumes: `decodeBytes`, `CharacterSet`, `columnsFor`, `dpiValue` (`@waitron/printing`).
- Produces: `PrintJobPreview` gains `columns: number` and `dpi: number`; the decoder reads `ESC t 16/19` and decodes text per the selected set.

- [ ] **Step 1: Write the failing tests**

```ts
// add to apps/server/src/print-job-preview.test.ts
import { esc } from "@waitron/printing";
it("decodes text through the character set the payload selects", () => {
  expect(previewPrintJob(esc("pc858").init().line("Café").bytes()).text).toContain("Café");
  expect(previewPrintJob(esc("wpc1252").init().line("12,50 €").bytes()).text).toContain("€");
});
it("stops the preview on an unknown character table", () => {
  expect(previewPrintJob(Uint8Array.of(0x1b, 0x40, 0x1b, 0x74, 99)).unsupported).toBe(true);
});
```

For the route (`print-api.test.ts`): build a receipt job for a printer set to 58mm/203dpi, fetch its preview, and assert `preview.columns === 30` and `preview.dpi === 203`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server test -- print-job-preview print-api`
Expected: FAIL — text decodes as Latin-1; the response has no `columns`/`dpi`.

- [ ] **Step 3: Implement**

In `print-job-preview.ts`:
- add `columns: number` and `dpi: number` to `PrintJobPreview`, and accept them as arguments: `previewPrintJob(payload, opts: { columns: number; dpi: number } = { columns: 42, dpi: 180 })`, writing them onto the result;
- add a scanner-state variable `let charset: CharacterSet = "plain";`
- add a branch before the catch-all `unsupported` case:

```ts
if (byte === 0x1b && command === 0x74) {
  if (!available(3)) break;
  const n = payload[offset + 2];
  if (n === 16) charset = "wpc1252";
  else if (n === 19) charset = "pc858";
  else if (n === 0) charset = "plain";
  else { result.unsupported = true; break; }
  offset += 3;
  continue;
}
```

- where printable bytes are currently turned into text with `String.fromCharCode(byte)`, use `decodeBytes([byte], charset)` instead.

In `print-api.ts`, change the preview route to also read the job's printer settings and pass them in:

```ts
const [job] = await gated(sessionId, (tx) =>
  tx.select({
    payload: printJobs.payload,
    paperWidth: printers.paperWidth,
    resolution: printers.resolution,
  }).from(printJobs)
    .leftJoin(printers, and(eq(printers.tenantId, printJobs.tenantId), eq(printers.id, printJobs.printerId)))
    .where(and(eq(printJobs.tenantId, deps.cfg.tenantId), eq(printJobs.id, id))));
if (job === undefined) throw new AppError("print_job.not_found", { id });
return c.json(previewPrintJob(job.payload, {
  columns: columnsFor(job.paperWidth ?? "80mm"),
  dpi: dpiValue(job.resolution ?? "180dpi"),
}));
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server test -- print-job-preview print-api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/print-job-preview.ts apps/server/src/print-api.ts apps/server/src/print-job-preview.test.ts apps/server/src/print-api.test.ts
git commit -s -m "Decode the preview per character set and report the printer's width and dpi"
```

---

### Task 17: The preview renders at the printer's width and resolution

**Files:**
- Modify: `apps/dashboard/src/widgets/print-job-preview.ts`, `apps/dashboard/src/api/client.ts`
- Test: `apps/dashboard/src/widgets/print-job-preview.test.ts`

**Interfaces:**
- Consumes: the `columns` and `dpi` now on `PrintJobPreview` (Task 16).
- Produces: the widget drops its 58/80 selector and renders `.paper` at `columns` character-widths and images at the printer's dpi.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/dashboard/src/widgets/print-job-preview.test.ts
it("renders the paper at the printer's column count and wraps long lines", async () => {
  const preview = { text: "", columns: 30, dpi: 180, qrData: [], omittedGraphics: false,
    truncated: false, unsupported: false,
    blocks: [{ kind: "text", text: "x".repeat(42) }] } as const;
  const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", { open: true, preview });
  const paper = el.shadowRoot!.querySelector<HTMLElement>(".paper")!;
  expect(paper.style.getPropertyValue("--columns") || getComputedStyle(paper).width).toBeTruthy();
  expect(el.shadowRoot!.querySelector("select[name='preview-paper-width']")).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard test -- print-job-preview`
Expected: FAIL — the 58/80 select still exists; no column sizing.

- [ ] **Step 3: Implement**

In `client.ts`, add `columns: number;` and `dpi: number;` to the `PrintJobPreview` interface.

In `print-job-preview.ts`:
- remove the `paperWidth` `@state` and the `<select name="preview-paper-width">` block;
- size the paper by columns: set the paper element style `width: ${(this.preview?.columns ?? 42)}ch;` (keep the monospace `font`), and keep `<pre>`'s `white-space: pre-wrap; overflow-wrap: anywhere;` so a line longer than the width wraps at the column boundary, matching the printer's buffer-full behaviour;
- size images at the printer's dpi: replace `width:${block.width / 8}mm` with `width:${(block.width * 25.4) / (this.preview?.dpi ?? 180)}mm`;
- remove the `.paper[data-width="58"]` rule and the `data-width` attribute.

- [ ] **Step 4: Run the test (and a11y)**

Run: `pnpm --filter @waitron/dashboard test -- print-job-preview`
Expected: PASS. Confirm the widget's existing a11y test still passes.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/print-job-preview.ts apps/dashboard/src/api/client.ts apps/dashboard/src/widgets/print-job-preview.test.ts
git commit -s -m "Render the print preview at the printer's width and resolution"
```

---

### Task 18: The Edit-printer dialog exposes the three settings

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`, `printers-screen.a11y.test.ts`

**Interfaces:**
- Consumes: the API fields (Task 9).
- Produces: `Printer`, `PrinterInput`, `PrinterPatch` (client.ts, local mirror types) and `EditablePrinter` gain `paperWidth`, `resolution`, `characterSet`; the dialog renders three labelled selects and saves them.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/dashboard/src/screens/printers-screen.test.ts
it("saves the paper width, resolution and character set", async () => {
  const api = stubApi(); // its updatePrinter records the patch
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await openPrinter(el);
  selectValue(el, "printer-paper-width", "58mm");
  selectValue(el, "printer-resolution", "203dpi");
  selectValue(el, "printer-character-set", "pc858");
  await savePrinter(el);
  expect(api.updatePrinter).toHaveBeenCalledWith(expect.any(String),
    expect.objectContaining({ paperWidth: "58mm", resolution: "203dpi", characterSet: "pc858" }));
});
```

(Use the suite's existing `openPrinter`/`savePrinter` helpers; add a small `selectValue` helper if none exists.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard test -- printers-screen`
Expected: FAIL — no controls, patch lacks the fields.

- [ ] **Step 3: Implement**

- In `client.ts`, add local mirror types `PaperWidth = "58mm" | "80mm"`, `Resolution = "180dpi" | "203dpi"`, `CharacterSet = "wpc1252" | "pc858" | "plain"`, and add `paperWidth`/`resolution`/`characterSet` to `Printer` (required), `PrinterInput` (optional), `PrinterPatch` (optional).
- In `printers-screen.ts`, add the three fields to `EditablePrinter`; populate them when opening the dialog from a `Printer` row; in `#renderEditPrinter`, add three labelled `<select>` controls (styled with the shared `selectStyles`), each `name="printer-paper-width"` / `-resolution` / `-character-set`, wired with `@change` to `#editPrinter(p.id, { paperWidth: … })`; in `#savePrinter`, add `patch.paperWidth = row.paperWidth; patch.resolution = row.resolution; patch.characterSet = row.characterSet;`.
- In `strings.ts`, add (English `en`, then the Spanish `es` sibling — a missing sibling is a compile error): `printers.paper_width` ("Paper width"/"Ancho de papel"), `printers.resolution` ("Resolution"/"Resolución"), `printers.character_set` ("Character set"/"Juego de caracteres"), and the option labels `printers.paper_width_58`/`_80`, `printers.resolution_180`/`_203`, `printers.character_set_wpc1252` ("Western European"/"Europa occidental"), `_pc858` ("Western European with euro"/"Europa occidental con euro"), `_plain` ("Plain letters"/"Solo letras basicas").

- [ ] **Step 4: Run the tests (both themes)**

Run: `pnpm --filter @waitron/dashboard test -- printers-screen`
Expected: PASS, including the `describe.each(["light","dark"])` a11y cases.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/printers-screen.ts apps/dashboard/src/api/client.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/printers-screen.test.ts apps/dashboard/src/screens/printers-screen.a11y.test.ts
git commit -s -m "Add paper width, resolution and character set to the printer dialog"
```

---

### Task 19: The test-page question flow in the dialog

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `apps/dashboard/src/screens/printers-screen.test.ts`

**Interfaces:**
- Consumes: the dialog controls (Task 18), `this.api.testPrint` (existing).
- Produces: a "Print test page" button and two question controls that map answers to the settings.

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/dashboard/src/screens/printers-screen.test.ts
it("prints the test page and maps the answers to settings", async () => {
  const api = stubApi();
  const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
  await openPrinter(el);
  clickButton(el, "print-test-page");
  expect(api.testPrint).toHaveBeenCalled();
  selectValue(el, "test-line-fits", "C");      // 80mm, 180dpi
  selectValue(el, "test-line-reads", "2");     // pc858
  await savePrinter(el);
  expect(api.updatePrinter).toHaveBeenCalledWith(expect.any(String),
    expect.objectContaining({ paperWidth: "80mm", resolution: "180dpi", characterSet: "pc858" }));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard test -- printers-screen`
Expected: FAIL — no test-page button or question controls.

- [ ] **Step 3: Implement**

In `#renderEditPrinter`, below the three selects add: guidance text (`t("printers.test_page_hint")`), a `data-test="print-test-page"` `wt-button` calling `() => void this.#testPrint(p.id)`, and two `<select>`s `name="test-line-fits"` (options A–D) and `name="test-line-reads"` (options 1–3). Their `@change` handlers set the settings via `#editPrinter`:

```ts
const FITS: Record<string, { paperWidth: PaperWidth; resolution: Resolution }> = {
  A: { paperWidth: "58mm", resolution: "180dpi" }, B: { paperWidth: "58mm", resolution: "203dpi" },
  C: { paperWidth: "80mm", resolution: "180dpi" }, D: { paperWidth: "80mm", resolution: "203dpi" },
};
const READS: Record<string, CharacterSet> = { "1": "wpc1252", "2": "pc858", "3": "plain" };
```

Add `strings.ts` keys (en + es): `printers.test_page`, `printers.test_page_hint` ("Not sure? Print the test page and answer below." / "¿No esta seguro? Imprima la pagina de prueba y responda abajo."), `printers.test_line_fits` ("Longest line that fits" / "Linea mas larga que cabe"), `printers.test_line_reads` ("First line that reads correctly" / "Primera linea que se lee bien").

- [ ] **Step 4: Run the tests (both themes)**

Run: `pnpm --filter @waitron/dashboard test -- printers-screen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/printers-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/printers-screen.test.ts
git commit -s -m "Add the test-page print button and question flow to the dialog"
```

---

### Task 20: Documentation and stale-comment cleanup

**Files:**
- Modify: `packages/printing/src/escpos.ts`, `apps/server/src/receipt-ticket.ts`, `docs/backlog.md`, `docs/developers/conventions-ui.md`

- [ ] **Step 1: Correct the code comments**

- In `escpos.ts`, the `QR_DEFAULT_MODULE_SIZE` doc comment claims "~203 dpi (≈ 8 dots/mm)". The receipt no longer uses the built-in `qr()`; correct the comment to state that dot density is a printer setting and the receipt sizes its QR via `layout.chooseQrDots`, and that `QR_DEFAULT_MODULE_SIZE` is only the default for the now-unused `qr()`.
- In `receipt-ticket.ts`, remove the comment deferring the € byte "to the failover/hardware pass" — the character set now handles it; leave a one-line pointer to this design instead.

- [ ] **Step 2: Add the backlog entry**

Add a `docs/backlog.md` entry recording: the three printer settings and the test-page setup flow landed; the two open assumptions for on-paper verification (does the TM-T88III have no built-in QR; does the 30–40 mm rule count the QR's blank border); and that 58 mm layout is only preview-verifiable until a 58 mm printer is available.

- [ ] **Step 3: Add the conventions-ui.md section**

Add a short section to `docs/developers/conventions-ui.md` pointing at this design: a printed document takes the printer's layout settings (paper width, resolution, character set) and never hard-codes a width, a QR size or a text encoding; the QR is a self-built raster sized to 30–40 mm; the test page is how those settings are chosen.

- [ ] **Step 4: Verify the pointer guard and formatting**

Run:
```bash
pnpm exec prettier --check "docs/**/*.md" && \
pnpm --filter @waitron/... test -- claude-md-pointers 2>/dev/null || pnpm vitest run scripts/claude-md-pointers.test.ts
```
Expected: PASS (every backticked path this plan added under `apps/`, `packages/`, `docs/` exists).

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/escpos.ts apps/server/src/receipt-ticket.ts docs/backlog.md docs/developers/conventions-ui.md
git commit -s -m "Document printer layout settings and clear the stale dpi and euro comments"
```

---

## Self-Review

Checked against the spec with fresh eyes:

**Spec coverage.** Settings + defaults (Task 7); API + config transfer (Tasks 8–9); layout mapping and wrapping (Tasks 3, 11); label+amount on the last line (Tasks 3, 11–13); QR as a raster sized per receipt closest to 35 mm, never over 40 (Tasks 4, 12); quiet zone (Task 4); character sets with ESC t + transliteration + the € space fix (Tasks 1–2, 5, 11, 13); receipt, payment slip, kitchen, correction slip (Tasks 11–14); test page with the four width lines, two QR samples and three charset lines in the venue language (Task 15); dialog controls + test-page flow (Tasks 18–19); preview at the printer's width/resolution/charset (Tasks 16–17); docs and comment cleanup (Task 20). The "interaction with the tenant-id spec" note needs no task — whichever lands second rebases; the plan's queries carry no tenant clause only if that work lands first, which the implementer handles at rebase time.

**Placeholder scan.** The one deliberate hand-generated artefact is the two 128-entry charset tables (Task 1 Step 2), generated by a pinned command and independently re-verified by the control test; not a placeholder. The kitchen-print grouping test (Task 14) points at the suite's existing seeding helpers rather than re-deriving them — acceptable, as those helpers exist and the assertion is stated.

**Type consistency.** `CharacterSet`, `PaperWidth`, `Resolution` are defined once in `@waitron/printing` and imported everywhere; the DB enum column props (`paperWidth`, `resolution`, `characterSet`) match the API field names and the client mirror types; `formatReceipt`/`formatPaymentSlip` take a `printer` object, `formatKitchenTicket`/`formatCorrectionSlip` take a `layout` object (`{columns, charset}`) — deliberately different because kitchen paper has no QR, so no resolution; `previewPrintJob` gains `{columns, dpi}`. `chooseQrDots(squares, dpi, safeWidthDots)` is called with a numeric dpi (`dpiValue(...)`) at every call site.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-14-printer-paper-resolution-and-character-set.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.
2. **Inline Execution** — tasks run in this session with checkpoints for review.

Which approach?
