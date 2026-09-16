# Printer paper width, resolution and character set — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay out every printed document for the actual printer — its paper width, dot density and character set — so receipts fit the paper, the fiscal QR prints at its legal 30–40 mm on any printer, and accents and the euro sign print correctly.

**Architecture:** Three new enum settings on the `printers` table carry paper width, resolution and character set. A new pure layout-and-encoding module in `@waitron/printing` turns those settings into a column count, a text encoder, a text wrapper and a QR dot-size chooser. The receipt, payment slip, kitchen ticket, correction slip and the new setup test page in `apps/server` take the settings and use that module; the receipt QR becomes a raster image Waitron builds instead of the printer's built-in QR command. The server-side preview decoder learns the character tables and reports the printer's column count. The dashboard Edit-printer dialog exposes the settings and the test-page questions, and the preview widget renders at the printer's width.

**Tech Stack:** TypeScript, drizzle-orm + PostgreSQL enums, the `@waitron/printing` ESC/POS byte builder, the `qrcode` library (already a dependency of `apps/server`), Lit web components + vitest browser mode (dashboard), vitest (server and printing).

**Spec:** `docs/superpowers/specs/2026-09-14-printer-paper-resolution-and-character-set-design.md` — read it alongside this plan. The controller's ledger `.superpowers/sdd/2026-09-14-printer-paper-resolution-and-character-set/progress.md` records the rulings this plan follows, including one deliberate departure from the spec (the dialog text follows the dashboard language, Task 19).

## Global Constraints

- **Character counts are exactly 30 (58 mm) and 42 (80 mm)**, for every resolution. A character is 12 dots wide, so the safe printable width is 360 dots (30 columns) and 504 dots (42 columns). Every printed image stays within that width.
- **No printed line is longer than the column count.** Every string is prepared for the character set (`prepareText`) before it is measured; `wrapText` and `labelAmountLines` never return a longer line.
- **The fiscal QR measures 30–40 mm** (Orden HAC/1177/2024 art. 21.1) at error-correction level M, measured without its blank border. Its dot size is chosen per receipt, closest to 35 mm, the smaller on a tie. Printed size in mm is `squares × dots × 25.4 / dpi`.
- **The receipt is a Spanish legal document:** its fiscal labels stay the fixed Spanish constants. The test page's captions follow the venue language (`readVenueLocale`); the dashboard dialog follows the dashboard's own i18n (ruling I, a recorded departure from the spec).
- **No data-migration or backwards-compatibility code** (nothing is in production).
- **`@waitron/printing` is Node-only** and is never imported by dashboard code; the dashboard keeps local mirror types.
- **Error codes:** request validation reuses `management.request_invalid`. No new code.
- **Every commit is `git commit -s`.** Work happens in the branch worktree, never on `main`.
- **Tests:** run the focused commands each task names. Every test must pass against the implementation and fail against the defect it guards; the "Verified while revising" note at the end lists what was run while writing this plan.
- **File:line pointers are as of `main` at 28060ac2.** Earlier edits (including earlier steps of the same task) shift some by a few lines; every pointer also names the test, helper or fixture to search for.
- **Unicode escapes in source:** write invisible or typographic characters as `\u{a0}`-style escapes (a regular expression that contains one needs the `u` flag).

---

## File Structure

New files:
- `packages/printing/src/charset.ts` — the three character sets: decode tables, `ESC t` bytes, `prepareText`, `encodeText`, `decodeBytes`.
- `packages/printing/src/layout.ts` — settings → layout: `columnsFor`, `safeWidthDots`, `dpiValue`, `wrapText`, `labelAmountLines`, `chooseQrDots`, `withQuietZone`, `QR_QUIET_ZONE`.
- `packages/printing/src/index.test.ts` — barrel smoke test.
- `apps/server/src/qr-matrix.ts` — `qrModules(text, { version? })` with the `qrcode` library (level M).
- `apps/server/src/qr-link-range.test.ts` — the grid sizes real receipt links produce.
- `apps/server/src/receipt-money.ts` — the shared `formatMoney`.
- `apps/server/src/test-page.ts` — `formatTestPage({ locale })`.
- a generated migration under `packages/db/drizzle/`.

Modified files:
- `packages/printing/src/escpos.ts`, `index.ts`, `printers.ts`.
- `packages/db/src/schema/printers.ts`, `packages/db/src/index.ts`, `packages/db/src/schema/printing.test.ts`.
- `apps/server/src/print-job-preview.ts`, `testing/decode-ticket.ts`, `receipt-ticket.ts`, `receipt-print.ts`, `payment-slip.ts`, `payment-slip-print.ts`, `kitchen-ticket.ts`, `kitchen-print.ts`, `print-api.ts`, `boot.ts`, and their tests.
- `apps/dashboard/src/api/client.ts`, `screens/printers-screen.ts`, `widgets/print-job-preview.ts`, `i18n/strings.ts`, and their tests.
- `docs/backlog.md`, `docs/developers/conventions-ui.md`.

Enum names (mirroring the existing `printTicketScope` / `ticket_scope` pair):

| DB type               | DB column       | JS enum const       | JS column prop | Values                      |
| --------------------- | --------------- | ------------------- | -------------- | --------------------------- |
| `print_paper_width`   | `paper_width`   | `printPaperWidth`   | `paperWidth`   | `58mm`, `80mm`              |
| `print_resolution`    | `resolution`    | `printResolution`   | `resolution`   | `180dpi`, `203dpi`          |
| `print_character_set` | `character_set` | `printCharacterSet` | `characterSet` | `wpc1252`, `pc858`, `plain` |

The column is `resolution`, not the spec's illustrative `print_resolution`, so the column and its enum type do not share a name — matching how `ticket_scope`'s type is `print_ticket_scope`.

**Interaction with the drop-tenant-id work** (`docs/superpowers/specs/2026-09-14-drop-tenant-id-design.md`): the queries below carry `tenant_id` predicates because that work has not landed. If it lands first, drop those predicates when rebasing; do not add new ones.

---

### Task 1: Character-set decode tables and the ESC t selection bytes

**Files:**
- Create: `packages/printing/src/charset.ts`, `packages/printing/src/charset.test.ts`

**Interfaces produced:** `type CharacterSet = "wpc1252" | "pc858" | "plain"`; `CHARSET_SELECT`; `WPC1252_TO_UNICODE`, `PC858_TO_UNICODE`; `decodeBytes(bytes, cs)`.

- [ ] **Step 1: Write the failing test** — create `packages/printing/src/charset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CHARSET_SELECT, PC858_TO_UNICODE, WPC1252_TO_UNICODE, decodeBytes } from "./charset.js";

describe("CHARSET_SELECT", () => {
  it("selects table 16 for wpc1252, 19 for pc858, nothing for plain", () => {
    expect([...CHARSET_SELECT.wpc1252]).toEqual([0x1b, 0x74, 16]);
    expect([...CHARSET_SELECT.pc858]).toEqual([0x1b, 0x74, 19]);
    expect([...CHARSET_SELECT.plain]).toEqual([]);
  });
});

describe("decode tables", () => {
  it("matches the WHATWG windows-1252 decoder for every byte", () => {
    const reference = new TextDecoder("windows-1252");
    for (let b = 0; b <= 0xff; b++) {
      expect(String.fromCodePoint(WPC1252_TO_UNICODE[b]!), `byte ${b}`).toBe(
        reference.decode(Uint8Array.of(b)),
      );
    }
  });

  it("pins the code page 858 positions receipts and the test page use", () => {
    const pins: [number, string][] = [
      [0x80, "Ç"],
      [0x81, "ü"],
      [0x82, "é"],
      [0x87, "ç"],
      [0x9e, "×"],
      [0xa0, "á"],
      [0xa1, "í"],
      [0xa2, "ó"],
      [0xa3, "ú"],
      [0xa4, "ñ"],
      [0xa5, "Ñ"],
      [0xa6, "ª"],
      [0xa7, "º"],
      [0xa8, "¿"],
      [0xad, "¡"],
      [0xd5, "€"],
      [0xfa, "·"],
      [0xff, "\u{a0}"],
    ];
    for (const [byte, ch] of pins) expect(decodeBytes([byte], "pc858"), `byte ${byte}`).toBe(ch);
    for (let b = 0; b < 0x80; b++) expect(PC858_TO_UNICODE[b]).toBe(b);
  });

  it("maps every byte of each table to a distinct character", () => {
    expect(new Set(WPC1252_TO_UNICODE).size).toBe(256);
    expect(new Set(PC858_TO_UNICODE).size).toBe(256);
  });

  it("decodes plain as Latin-1", () => {
    expect(decodeBytes([0x41, 0x42, 0xe9], "plain")).toBe("ABé");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/charset.test.ts`
Expected: FAIL — `./charset.js` does not exist.

- [ ] **Step 3: Write `packages/printing/src/charset.ts`** (the tables are literal; do not regenerate them):

```ts
/**
 * The three character sets a receipt printer can be set to (design 2026-09-14, "Character set").
 * A printer reads every byte through its selected code table, so the builder selects the table with
 * `ESC t n` and encodes text with the same table.
 *
 * Source of the tables: the 0x80-0xFF halves below were generated with Python 3's `cp1252` codec
 * (which CPython generates from the Unicode Consortium file MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1252.TXT)
 * and its `cp858` codec (CPython's cp850 table with 0xD5 changed to the euro sign). The five bytes
 * cp1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the same code point, as the WHATWG
 * windows-1252 decoder does. charset.test.ts pins both tables.
 */
export type CharacterSet = "wpc1252" | "pc858" | "plain";

/** `ESC t n` — select character code table. `plain` sends nothing: ASCII reads the same in every table. */
export const CHARSET_SELECT: Readonly<Record<CharacterSet, readonly number[]>> = {
  wpc1252: [0x1b, 0x74, 16],
  pc858: [0x1b, 0x74, 19],
  plain: [],
};

// prettier-ignore
const WPC1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
  0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7,
  0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7,
  0x00b8, 0x00b9, 0x00ba, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x00bf,
  0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c6, 0x00c7,
  0x00c8, 0x00c9, 0x00ca, 0x00cb, 0x00cc, 0x00cd, 0x00ce, 0x00cf,
  0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d7,
  0x00d8, 0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df,
  0x00e0, 0x00e1, 0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7,
  0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec, 0x00ed, 0x00ee, 0x00ef,
  0x00f0, 0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f7,
  0x00f8, 0x00f9, 0x00fa, 0x00fb, 0x00fc, 0x00fd, 0x00fe, 0x00ff,
];

// prettier-ignore
const PC858_HIGH: readonly number[] = [
  0x00c7, 0x00fc, 0x00e9, 0x00e2, 0x00e4, 0x00e0, 0x00e5, 0x00e7,
  0x00ea, 0x00eb, 0x00e8, 0x00ef, 0x00ee, 0x00ec, 0x00c4, 0x00c5,
  0x00c9, 0x00e6, 0x00c6, 0x00f4, 0x00f6, 0x00f2, 0x00fb, 0x00f9,
  0x00ff, 0x00d6, 0x00dc, 0x00f8, 0x00a3, 0x00d8, 0x00d7, 0x0192,
  0x00e1, 0x00ed, 0x00f3, 0x00fa, 0x00f1, 0x00d1, 0x00aa, 0x00ba,
  0x00bf, 0x00ae, 0x00ac, 0x00bd, 0x00bc, 0x00a1, 0x00ab, 0x00bb,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x00c1, 0x00c2, 0x00c0,
  0x00a9, 0x2563, 0x2551, 0x2557, 0x255d, 0x00a2, 0x00a5, 0x2510,
  0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x00e3, 0x00c3,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x00a4,
  0x00f0, 0x00d0, 0x00ca, 0x00cb, 0x00c8, 0x20ac, 0x00cd, 0x00ce,
  0x00cf, 0x2518, 0x250c, 0x2588, 0x2584, 0x00a6, 0x00cc, 0x2580,
  0x00d3, 0x00df, 0x00d4, 0x00d2, 0x00f5, 0x00d5, 0x00b5, 0x00fe,
  0x00de, 0x00da, 0x00db, 0x00d9, 0x00fd, 0x00dd, 0x00af, 0x00b4,
  0x00ad, 0x00b1, 0x2017, 0x00be, 0x00b6, 0x00a7, 0x00f7, 0x00b8,
  0x00b0, 0x00a8, 0x00b7, 0x00b9, 0x00b3, 0x00b2, 0x25a0, 0x00a0,
];

function table(high: readonly number[]): readonly number[] {
  return [...Array.from({ length: 0x80 }, (_, b) => b), ...high];
}

/** Byte → Unicode code point. */
export const WPC1252_TO_UNICODE = table(WPC1252_HIGH);
export const PC858_TO_UNICODE = table(PC858_HIGH);
/** `plain` payloads are ASCII; a legacy job with no table selection decodes as the Latin-1 it was built with. */
const LATIN1_TO_UNICODE: readonly number[] = Array.from({ length: 0x100 }, (_, b) => b);

const DECODE: Readonly<Record<CharacterSet, readonly number[]>> = {
  wpc1252: WPC1252_TO_UNICODE,
  pc858: PC858_TO_UNICODE,
  plain: LATIN1_TO_UNICODE,
};

export function decodeBytes(bytes: Iterable<number>, cs: CharacterSet): string {
  const decode = DECODE[cs];
  let out = "";
  for (const b of bytes) out += String.fromCodePoint(decode[b & 0xff]!);
  return out;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing exec vitest run src/charset.test.ts`
Expected: PASS (5 tests). The Windows-1252 table is checked byte for byte against Node's own decoder; code page 858 is pinned at every position the receipts and test page use, plus a distinctness check that catches a duplicated paste.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/charset.ts packages/printing/src/charset.test.ts
git commit -s -m "Add the printer character-set tables and their table-selection bytes"
```

---

### Task 2: Character-set text preparation and encoding

**Files:**
- Modify: `packages/printing/src/charset.ts`, `packages/printing/src/charset.test.ts`

**Interfaces produced:** `prepareText(s, cs): string` — NFC, then for each character the set cannot print: a fixed fallback (€→EUR, Ñ→N, ñ→n, Ç→C, ç→c, ¿→?, ¡→!, curly quotes → straight, en/em dash → `-`, ellipsis → `...`, º→o, ª→a, no-break spaces → space) when the set can print the fallback, else the character without its accents, else `?`. `encodeText(s, cs): number[]` — one byte per prepared character.

- [ ] **Step 1: Write the failing tests** — change the import at the top of `charset.test.ts` to

```ts
import {
  CHARSET_SELECT,
  PC858_TO_UNICODE,
  WPC1252_TO_UNICODE,
  decodeBytes,
  encodeText,
  prepareText,
} from "./charset.js";
```

and append:

```ts
describe("prepareText / encodeText", () => {
  it("keeps accents and the euro sign in wpc1252 and pc858", () => {
    expect(encodeText("Café", "wpc1252")).toEqual([0x43, 0x61, 0x66, 0xe9]);
    expect(encodeText("€", "wpc1252")).toEqual([0x80]);
    expect(encodeText("€", "pc858")).toEqual([0xd5]);
    expect(encodeText("é", "pc858")).toEqual([0x82]);
  });

  it("transliterates for plain letters", () => {
    expect(prepareText("Café jamón Ñ ¿ ¡ ç € año", "plain")).toBe("Cafe jamon N ? ! c EUR ano");
  });

  it("round-trips the test page sample through each real set", () => {
    for (const cs of ["wpc1252", "pc858"] as const) {
      const sample = "1: Café jamón Ñ ¿¡ ç ü 5 €";
      expect(prepareText(sample, cs)).toBe(sample);
      expect(decodeBytes(encodeText(sample, cs), cs)).toBe(sample);
    }
  });

  it("uses typographic fallbacks only where the set lacks the character", () => {
    const text =
      "\u{2018}a\u{2019} \u{201c}b\u{201d} c\u{2013}d e\u{2014}f g\u{2026} 1º 2ª x\u{a0}y z\u{202f}w";
    expect(prepareText(text, "wpc1252")).toBe(
      "\u{2018}a\u{2019} \u{201c}b\u{201d} c\u{2013}d e\u{2014}f g\u{2026} 1º 2ª x\u{a0}y z w",
    );
    expect(prepareText(text, "pc858")).toBe("'a' \"b\" c-d e-f g... 1º 2ª x\u{a0}y z w");
    expect(prepareText(text, "plain")).toBe("'a' \"b\" c-d e-f g... 1o 2a x y z w");
  });

  it("strips an accent the set lacks, and prints ? when that is not enough", () => {
    expect(prepareText("Łódź", "wpc1252")).toBe("?ódz");
    expect(prepareText("Łódź", "pc858")).toBe("?ódz");
    expect(prepareText("Łódź", "plain")).toBe("?odz");
    expect(prepareText("ệ", "pc858")).toBe("e");
    expect(prepareText("中", "wpc1252")).toBe("?");
  });

  it("normalises decomposed input before measuring", () => {
    expect(prepareText("Café", "pc858")).toBe("Café");
  });

  it("gives one byte per prepared character in every set", () => {
    const text = "Café 👍 € \u{2018}x\u{2019} Łódź 中 ×2 · 12\u{a0}€";
    for (const cs of ["wpc1252", "pc858", "plain"] as const) {
      const prepared = prepareText(text, cs);
      const bytes = encodeText(text, cs);
      expect(bytes).toHaveLength([...prepared].length);
      expect(bytes).toHaveLength(prepared.length);
      expect(decodeBytes(bytes, cs)).toBe(prepared);
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/charset.test.ts`
Expected: FAIL — `prepareText`/`encodeText` are not exported.

- [ ] **Step 3: Append to `charset.ts`:**

```ts
function reverse(decode: readonly number[]): ReadonlyMap<number, number> {
  const encode = new Map<number, number>();
  decode.forEach((codePoint, byte) => encode.set(codePoint, byte));
  return encode;
}

const ENCODE: Readonly<Record<Exclude<CharacterSet, "plain">, ReadonlyMap<number, number>>> = {
  wpc1252: reverse(WPC1252_TO_UNICODE),
  pc858: reverse(PC858_TO_UNICODE),
};

/**
 * Replacements for characters a set lacks, tried before an accent is stripped and before `?`. Each
 * applies only when the set cannot print the original character.
 */
const FALLBACK: Readonly<Record<string, string>> = {
  "€": "EUR",
  Ñ: "N",
  ñ: "n",
  Ç: "C",
  ç: "c",
  "¿": "?",
  "¡": "!",
  "\u{2018}": "'",
  "\u{2019}": "'",
  "\u{201c}": '"',
  "\u{201d}": '"',
  "\u{2013}": "-",
  "\u{2014}": "-",
  "\u{2026}": "...",
  º: "o",
  ª: "a",
  "\u{a0}": " ",
  "\u{202f}": " ",
};

function encodable(text: string, cs: CharacterSet): boolean {
  for (const c of text) {
    const codePoint = c.codePointAt(0)!;
    if (cs === "plain" ? codePoint >= 0x80 : !ENCODE[cs].has(codePoint)) return false;
  }
  return true;
}

/**
 * Normalise `s` to NFC and replace every character `cs` cannot print: first a fixed fallback, then the
 * character without its accents, then `?`. Every character of the result encodes to exactly one byte,
 * so `.length` of the result is its printed width.
 */
export function prepareText(s: string, cs: CharacterSet): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const fallback = FALLBACK[ch];
    if (encodable(ch, cs)) out += ch;
    else if (fallback !== undefined && encodable(fallback, cs)) out += fallback;
    else {
      const stripped = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      out += stripped !== "" && encodable(stripped, cs) ? stripped : "?";
    }
  }
  return out;
}

/** `prepareText`, then one byte per character. */
export function encodeText(s: string, cs: CharacterSet): number[] {
  const bytes: number[] = [];
  for (const c of prepareText(s, cs)) {
    const codePoint = c.codePointAt(0)!;
    bytes.push(cs === "plain" ? codePoint : ENCODE[cs].get(codePoint)!);
  }
  return bytes;
}
```

No regular expression here contains a control-character range, so ESLint's `no-control-regex` does not fire (the ASCII check is `codePoint >= 0x80`).

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing exec vitest run src/charset.test.ts`
Expected: PASS (12 tests). Removing the fallback line fails "transliterates for plain letters" and "uses typographic fallbacks…"; swapping two code page 858 entries fails the pin test (both checked while revising).

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/charset.ts packages/printing/src/charset.test.ts
git commit -s -m "Prepare and encode printed text for the printer's character set"
```

---

### Task 3: Layout — columns, wrapping and label-with-amount rows

**Files:**
- Create: `packages/printing/src/layout.ts`, `packages/printing/src/layout.test.ts`

**Interfaces produced:**
- `type PaperWidth = "58mm" | "80mm"`, `type Resolution = "180dpi" | "203dpi"`; `DOTS_PER_COLUMN = 12`; `columnsFor`, `safeWidthDots`, `dpiValue`.
- `wrapText(text, columns, indent = 0): string[]` — leading spaces of `text` are the first line's indent (so `"  + Grande"` keeps its two spaces); later lines start with `indent` spaces; both indents are capped at `columns - 1`; no line exceeds `columns`.
- `labelAmountLines(label, amount, columns, indent = 0): string[]` — label wrapped with `indent`; amount at the end of the last line when a space fits, else on right-aligned lines of its own, itself wrapped when wider than the paper.

- [ ] **Step 1: Write the failing test** — create `packages/printing/src/layout.test.ts`:

```ts
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
    expect(wrapText("aaaa bbbb cccc dddd eeee fff g", 30)).toEqual([
      "aaaa bbbb cccc dddd eeee fff g",
    ]);
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

  it.each([30, 42])("keeps the leading-space indent of sub-lines at %i columns", (columns) => {
    expect(wrapText("  + Grande", columns, 4)).toEqual(["  + Grande"]);
    expect(wrapText("  Extra queso", columns, 2)).toEqual(["  Extra queso"]);
    expect(wrapText("  * sin sal muy hecho", columns, 4)).toEqual(["  * sin sal muy hecho"]);
  });

  it("indents the continuation of a sub-line under its text", () => {
    expect(wrapText("  + Salsa de setas silvestres con trufa negra", 30, 4)).toEqual([
      "  + Salsa de setas silvestres",
      "    con trufa negra",
    ]);
  });

  it("never lets a word that follows a break overrun the indented line", () => {
    expect(wrapText("ab cdefghijk", 10, 2)).toEqual(["ab", "  cdefghij", "  k"]);
    expect(wrapText(`1  ${"x".repeat(28)}`, 30, 3)).toEqual(["1", `   ${"x".repeat(27)}`, "   x"]);
  });

  it("keeps runs of spaces inside a line and drops spaces at a break", () => {
    expect(wrapText("1  Cafe", 30)).toEqual(["1  Cafe"]);
    expect(wrapText("abc   def", 5)).toEqual(["abc", "def"]);
    expect(wrapText("abc ", 3)).toEqual(["abc"]);
  });

  it("returns one empty line for empty text and terminates when the indent fills the line", () => {
    expect(wrapText("", 30)).toEqual([""]);
    expect(wrapText("aaaa bbbb", 4, 9)).toEqual(["aaaa", "   b", "   b", "   b", "   b"]);
  });

  it("never returns a line longer than the column count", () => {
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let trial = 0; trial < 2000; trial++) {
      const columns = 5 + next(40);
      const words = Array.from({ length: 1 + next(12) }, () => "w".repeat(next(columns + 6)));
      const text = " ".repeat(next(4)) + words.join(" ".repeat(1 + next(2)));
      const indent = next(6);
      for (const l of wrapText(text, columns, indent))
        expect(l.length).toBeLessThanOrEqual(columns);
      for (const l of labelAmountLines(text, "w".repeat(next(columns + 10)), columns, indent)) {
        expect(l.length).toBeLessThanOrEqual(columns);
      }
    }
  });
});

describe("labelAmountLines", () => {
  it("puts the amount at the right of the last line when it fits", () => {
    expect(labelAmountLines("1  Cafe con leche", "1,80 EUR", 30)).toEqual([
      "1  Cafe con leche     1,80 EUR",
    ]);
  });

  it("drops the amount to its own right-aligned line when the label leaves no space", () => {
    expect(labelAmountLines("x".repeat(28), "1,80 EUR", 30)).toEqual([
      "x".repeat(28),
      " ".repeat(22) + "1,80 EUR",
    ]);
  });

  it("indents an item's continuation under its product name", () => {
    expect(
      labelAmountLines("1  Tostada con tomate y jamón ibérico de bellota", "12,50 €", 30, 3),
    ).toEqual(["1  Tostada con tomate y jamón", "   ibérico de bellota  12,50 €"]);
  });

  it.each([30, 42])("keeps an option's leading indent at %i columns", (columns) => {
    const [line] = labelAmountLines("  Extra queso ×2", "1,50 €", columns, 2);
    expect(line).toBe("  Extra queso ×2" + " ".repeat(columns - 22) + "1,50 €");
  });

  it("wraps an amount wider than the paper onto right-aligned lines of its own", () => {
    expect(labelAmountLines("Factura", "SERIE-MUY-LARGA-2026/000123", 20)).toEqual([
      "Factura",
      "SERIE-MUY-LARGA-2026",
      "             /000123",
    ]);
    expect(labelAmountLines("TOTAL", "-123.456.789.012,34 EUR", 20)).toEqual([
      "TOTAL",
      " -123.456.789.012,34",
      "                 EUR",
    ]);
  });

  it("right-aligns an amount with an empty label", () => {
    expect(labelAmountLines("", "1,00 €", 10)).toEqual(["    1,00 €"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/printing/src/layout.ts`:**

```ts
/**
 * Everything that turns a printer's settings into layout (design 2026-09-14, "Layout" and "The QR
 * code"). No other file holds these numbers. Text passed to the wrapping helpers must already be
 * prepared for the printer's character set (`prepareText`), so one character is one printed column.
 */
export type PaperWidth = "58mm" | "80mm";
export type Resolution = "180dpi" | "203dpi";

const COLUMNS: Readonly<Record<PaperWidth, number>> = { "58mm": 30, "80mm": 42 };

/** Dots one character occupies: the TM-T88III prints 42 columns in 512 dots and 30 in 360. */
export const DOTS_PER_COLUMN = 12;

export function columnsFor(width: PaperWidth): number {
  return COLUMNS[width];
}

/** The printable width images must stay within: 360 dots on 58mm, 504 on 80mm. */
export function safeWidthDots(width: PaperWidth): number {
  return COLUMNS[width] * DOTS_PER_COLUMN;
}

export function dpiValue(resolution: Resolution): 180 | 203 {
  return resolution === "203dpi" ? 203 : 180;
}

/**
 * Break `text` into lines of at most `columns` characters. Spaces at the start of `text` are kept as
 * the first line's indent; every later line starts with `indent` spaces. Lines break at spaces, runs
 * of spaces inside a line are kept, spaces at a break are dropped, and a word longer than the room
 * left on a line is split. Both indents are capped at `columns - 1` so a line always has room.
 */
export function wrapText(text: string, columns: number, indent = 0): string[] {
  const lead = /^ */.exec(text)![0].length;
  const firstPrefix = " ".repeat(Math.min(lead, columns - 1));
  const nextPrefix = " ".repeat(Math.min(indent, columns - 1));
  const lines: string[] = [];
  let prefix = firstPrefix;
  let line = "";
  const room = (): number => columns - prefix.length;
  const flush = (): void => {
    lines.push(prefix + line.replace(/ +$/, ""));
    prefix = nextPrefix;
    line = "";
  };
  for (let word of text.slice(lead).split(" ")) {
    if (line !== "") {
      if (line.length + 1 + word.length <= room()) {
        line += " " + word;
        continue;
      }
      flush();
    }
    if (word === "") continue;
    while (word.length > room()) {
      const take = room();
      line = word.slice(0, take);
      word = word.slice(take);
      flush();
    }
    line = word;
  }
  if (line !== "" || lines.length === 0) flush();
  return lines;
}

/**
 * A label with an amount at the right-hand edge. The label wraps as {@link wrapText} does, with
 * continuation lines indented by `indent`. The amount goes at the end of the label's last line when at
 * least one space is left between them; otherwise it takes lines of its own, right-aligned, wrapped
 * like any other text when it is wider than the paper. No line is longer than `columns`.
 */
export function labelAmountLines(
  label: string,
  amount: string,
  columns: number,
  indent = 0,
): string[] {
  const lines = wrapText(label, columns, indent);
  const last = lines[lines.length - 1]!;
  if (last.length + 1 + amount.length <= columns) {
    lines[lines.length - 1] = last + " ".repeat(columns - last.length - amount.length) + amount;
    return lines;
  }
  for (const part of wrapText(amount, columns)) lines.push(part.padStart(columns));
  return lines;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing exec vitest run src/layout.test.ts`
Expected: PASS (18 tests). The earlier draft of `wrapText` (which dropped leading spaces and let a word after a break overrun the indented line) fails 11 of them, including both "keeps the leading-space indent" cases and the 2000-case "never returns a line longer than the column count" sweep.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/layout.ts packages/printing/src/layout.test.ts
git commit -s -m "Add printer layout: columns, wrapping and label-with-amount rows"
```

---

### Task 4: QR dot size and blank border

**Files:**
- Modify: `packages/printing/src/layout.ts`, `packages/printing/src/layout.test.ts`

**Interfaces produced:** `QR_QUIET_ZONE = 4`; `chooseQrDots(squares, dpi, safeWidthDots): number` (never throws; 1 when nothing fits); `withQuietZone(modules, quiet): boolean[][]`.

**Recorded deferral (ruling H):** the spec asks the receipt to log a warning when no dot size is legal. No logger is reachable in `apps/server/src/receipt-print.ts` without widening signatures outside that file (its functions take `(tx, cfg, …)` and the file imports no logger), so the warning is deferred. The sweep below (37–77 squares) and `qr-link-range.test.ts` (Task 10, real links 41–73 squares) show the fallback is unreachable for any link `validate.ts` accepts. Task 21 records the deferral in the backlog.

- [ ] **Step 1: Write the failing tests** — change the import in `layout.test.ts` to

```ts
import {
  chooseQrDots,
  columnsFor,
  dpiValue,
  labelAmountLines,
  safeWidthDots,
  withQuietZone,
  wrapText,
} from "./layout.js";
```

and append:

```ts
const mm = (squares: number, dots: number, dpi: number): number => (squares * dots * 25.4) / dpi;

describe("chooseQrDots", () => {
  it("chooses the dot size closest to 35 mm within 30-40 mm (measured cases)", () => {
    expect(chooseQrDots(41, 180, 504)).toBe(6); // 34.7 mm
    expect(chooseQrDots(41, 203, 504)).toBe(7); // 35.9 mm
    expect(chooseQrDots(45, 180, 504)).toBe(6); // 38.1 mm (5 dots: 31.75, further from 35)
    expect(chooseQrDots(45, 203, 504)).toBe(6); // 33.8 mm
    expect(chooseQrDots(49, 180, 504)).toBe(5); // 34.6 mm (6 dots: 41.5, over 40)
    expect(chooseQrDots(49, 203, 504)).toBe(6); // 36.8 mm
    expect(chooseQrDots(53, 203, 504)).toBe(5); // 33.2 mm (6 dots: 39.8, further from 35)
    expect(chooseQrDots(65, 180, 360)).toBe(4); // 36.7 mm; 5 dots would be 365 dots wide
  });

  it("keeps every grid size 37-77 within 30-40 mm at both resolutions and both widths", () => {
    for (let squares = 37; squares <= 77; squares++) {
      for (const dpi of [180, 203]) {
        for (const width of [360, 504]) {
          const dots = chooseQrDots(squares, dpi, width);
          const label = `${squares} squares, ${dpi} dpi, ${width} dots`;
          expect(mm(squares, dots, dpi), label).toBeGreaterThanOrEqual(30);
          expect(mm(squares, dots, dpi), label).toBeLessThanOrEqual(40);
          expect((squares + 8) * dots, label).toBeLessThanOrEqual(width);
          for (let other = 1; (squares + 8) * other <= width; other++) {
            const size = mm(squares, other, dpi);
            if (size >= 30 && size <= 40) {
              expect(Math.abs(size - 35), label).toBeGreaterThanOrEqual(
                Math.abs(mm(squares, dots, dpi) - 35) - 1e-9,
              );
            }
          }
        }
      }
    }
  });

  it("takes the smaller dot size on a tie", () => {
    // 50 squares at 127 dpi: 3 dots = 30 mm and 4 dots = 40 mm, both 5 mm from 35.
    expect(chooseQrDots(50, 127, 504)).toBe(3);
  });

  it("falls back without throwing when no size is legal", () => {
    expect(chooseQrDots(177, 180, 360)).toBe(1); // 25 mm, the only size that fits
    expect(chooseQrDots(400, 180, 360)).toBe(1); // nothing fits
  });
});

describe("withQuietZone", () => {
  it("pads a matrix with light modules on every side", () => {
    expect(
      withQuietZone(
        [
          [true, false],
          [false, true],
        ],
        1,
      ),
    ).toEqual([
      [false, false, false, false],
      [false, true, false, false],
      [false, false, true, false],
      [false, false, false, false],
    ]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/layout.test.ts`
Expected: FAIL — `chooseQrDots`/`withQuietZone` are not exported.

- [ ] **Step 3: Append to `layout.ts`:**

```ts
const QR_MIN_MM = 30;
const QR_MAX_MM = 40;
const QR_TARGET_MM = 35;
/** The QR standard's blank border, in squares per side, counted when fitting the paper. */
export const QR_QUIET_ZONE = 4;

/**
 * Dots per QR square for a code `squares` wide (without its border) on a `dpi` printer whose images
 * must fit `safeWidthDots`. Picks the whole number that keeps the printed code within 30-40 mm
 * (Orden HAC/1177/2024 art. 21.1) and the bordered image within the paper, closest to 35 mm, the
 * smaller on a tie. When no size is within 30-40 mm it returns the fitting size closest to 35 mm, and
 * 1 when nothing fits at all: it never throws, because the receipt is built inside the sale's
 * transaction.
 */
export function chooseQrDots(squares: number, dpi: number, safeWidthDots: number): number {
  let best: { dots: number; inRange: boolean; distance: number } | undefined;
  for (let dots = 1; (squares + 2 * QR_QUIET_ZONE) * dots <= safeWidthDots; dots++) {
    const mm = (squares * dots * 25.4) / dpi;
    const inRange = mm >= QR_MIN_MM && mm <= QR_MAX_MM;
    const distance = Math.abs(mm - QR_TARGET_MM);
    if (
      best === undefined ||
      (inRange && !best.inRange) ||
      (inRange === best.inRange && distance < best.distance)
    ) {
      best = { dots, inRange, distance };
    }
  }
  return best?.dots ?? 1;
}

/** A new square matrix with `quiet` light modules added on every side. */
export function withQuietZone(
  modules: readonly (readonly boolean[])[],
  quiet: number,
): boolean[][] {
  const side = modules.length + 2 * quiet;
  const blank = (): boolean[] => new Array<boolean>(side).fill(false);
  const margin = new Array<boolean>(quiet).fill(false);
  return [
    ...Array.from({ length: quiet }, blank),
    ...modules.map((row) => [...margin, ...row, ...margin]),
    ...Array.from({ length: quiet }, blank),
  ];
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing exec vitest run src/layout.test.ts`
Expected: PASS (23 tests). Changing `distance < best.distance` to `<=` fails the tie test.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/layout.ts packages/printing/src/layout.test.ts
git commit -s -m "Choose the QR dot size for the legal 30-40 mm at each resolution"
```

---

### Task 5: The builder learns the character set

**Files:**
- Modify: `packages/printing/src/escpos.ts`, `packages/printing/src/escpos.test.ts`

**Interfaces produced:** `esc(charset?: CharacterSet)`; `init()` emits `ESC @` then the set's `ESC t` (nothing for `plain` or no set); `charset(cs)` switches mid-payload; `text()` encodes with the current set, or Latin-1 when none was given (the drawer kick and `EscBuilder.qr` stay byte-identical).

- [ ] **Step 1: Write the failing tests** — append to `packages/printing/src/escpos.test.ts` (its existing import `{ FEED_BEFORE_CUT, esc }` already covers these):

```ts
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
      0x1b, 0x40, 0x45, 0x55, 0x52, 0x0a,
    ]);
  });
  it("switches character set mid-payload", () => {
    expect([...esc("plain").init().charset("pc858").text("é").bytes()]).toEqual([
      0x1b, 0x40, 0x1b, 0x74, 19, 0x82,
    ]);
  });
  it("keeps Latin-1 and selects no table when no charset is given", () => {
    expect([...esc().init().text("é€").bytes()]).toEqual([0x1b, 0x40, 0xe9, 0xac]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/escpos.test.ts`
Expected: FAIL — `esc()` takes no argument and `charset()` does not exist.

- [ ] **Step 3: Implement in `escpos.ts`**

Add at the top of the file, above the module comment:

```ts
import { CHARSET_SELECT, encodeText, type CharacterSet } from "./charset.js";
```

Replace the `TEXT_ENCODING` doc comment with:

```ts
/**
 * The encoding of a builder created without a character set: ONE byte per character via Latin-1, so
 * every code point 0x00-0xFF maps to its own byte. A builder created with a set encodes with that
 * set's table instead (`charset.ts`); the drawer kick and the legacy `qr()` store data keep Latin-1.
 */
```

In `class EscBuilder`, replace the `init()` and `text()` methods with:

```ts
  /** `charset` undefined keeps the Latin-1 builder that selects no table (the drawer kick, legacy jobs). */
  constructor(private current?: CharacterSet) {}

  /** Initialise the printer — `ESC @`, then the current character set's `ESC t` selection, if any. */
  init(): this {
    this.parts.push(ESC, 0x40);
    if (this.current !== undefined) this.parts.push(...CHARSET_SELECT[this.current]);
    return this;
  }

  /** Switch character set mid-payload: emits its `ESC t` (nothing for `plain`) and encodes later text with it. */
  charset(cs: CharacterSet): this {
    this.current = cs;
    this.parts.push(...CHARSET_SELECT[cs]);
    return this;
  }

  /** Append `s` encoded for the current character set (Latin-1 when none was given), with no terminator. */
  text(s: string): this {
    if (this.current === undefined) {
      for (const b of Buffer.from(s, TEXT_ENCODING)) this.parts.push(b);
    } else {
      for (const b of encodeText(s, this.current)) this.parts.push(b);
    }
    return this;
  }
```

Replace the factory at the end of the file with:

```ts
/** Start a new ESC/POS command chain, optionally for a character set. */
export function esc(charset?: CharacterSet): EscBuilder {
  return new EscBuilder(charset);
}
```

- [ ] **Step 4: Run the whole printing suite**

Run: `pnpm --filter @waitron/printing exec vitest run src/escpos.test.ts src/charset.test.ts src/layout.test.ts`
Expected: PASS (26 escpos tests: the 21 existing byte pins unchanged, plus 5 new).

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/escpos.ts packages/printing/src/escpos.test.ts
git commit -s -m "Let the ESC/POS builder select and encode a character set"
```

---

### Task 6: Export the layout and character-set API from the package

**Files:**
- Modify: `packages/printing/src/index.ts`
- Create: `packages/printing/src/index.test.ts`

- [ ] **Step 1: Write the failing test** — create `packages/printing/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  chooseQrDots,
  columnsFor,
  decodeBytes,
  dpiValue,
  encodeText,
  esc,
  labelAmountLines,
  prepareText,
  QR_QUIET_ZONE,
  safeWidthDots,
  withQuietZone,
  wrapText,
} from "./index.js";

describe("package barrel", () => {
  it("re-exports the layout and character-set helpers", () => {
    expect(columnsFor("80mm")).toBe(42);
    expect(safeWidthDots("58mm")).toBe(360);
    expect(dpiValue("203dpi")).toBe(203);
    expect(QR_QUIET_ZONE).toBe(4);
    expect(chooseQrDots(45, 180, 504)).toBe(6);
    expect(encodeText("€", "pc858")).toEqual([0xd5]);
    expect(decodeBytes([0xd5], "pc858")).toBe("€");
    expect(prepareText("€", "plain")).toBe("EUR");
    expect(labelAmountLines("A", "B", 10)).toEqual(["A        B"]);
    expect(wrapText("a b", 1)).toEqual(["a", "b"]);
    expect(withQuietZone([[true]], 1)[1]).toEqual([false, true, false]);
    expect([...esc("pc858").init().bytes()]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/index.test.ts`
Expected: FAIL — the helpers are not exported.

- [ ] **Step 3: Add the exports** — append to `packages/printing/src/index.ts`:

```ts
export { decodeBytes, encodeText, prepareText } from "./charset.js";
export type { CharacterSet } from "./charset.js";
export {
  QR_QUIET_ZONE,
  chooseQrDots,
  columnsFor,
  dpiValue,
  labelAmountLines,
  safeWidthDots,
  withQuietZone,
  wrapText,
} from "./layout.js";
export type { PaperWidth, Resolution } from "./layout.js";
```

(`FEED_BEFORE_CUT`, `EscBuilder` and `esc` are already exported.) `src/index.ts` is excluded from this package's coverage, and `index.test.ts` only proves the names are reachable.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing exec vitest run src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/index.ts packages/printing/src/index.test.ts
git commit -s -m "Export the layout and character-set helpers from @waitron/printing"
```

---

### Task 7: The three settings columns on `printers`

**Files:**
- Modify: `packages/db/src/schema/printers.ts`, `packages/db/src/index.ts`, `packages/db/src/schema/printing.test.ts`
- Create: a migration under `packages/db/drizzle/` (generated)

- [ ] **Step 1: Add the failing assertions** — in `packages/db/src/schema/printing.test.ts`, in the test `"printers: exposes every column through the Drizzle export, with the port and ticket_scope defaults"`, after `expect(row!.ticketScope).toBe("station"); // the enum default` add:

```ts
    expect(row!.paperWidth).toBe("80mm");
    expect(row!.resolution).toBe("180dpi");
    expect(row!.characterSet).toBe("wpc1252");
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/db exec vitest run src/schema/printing.test.ts`
Expected: FAIL — `row.paperWidth` is `undefined`.

- [ ] **Step 3: Add the enums and columns** — in `packages/db/src/schema/printers.ts`, after the `printTicketScope` declaration:

```ts
/** The paper roll's width: 30 columns of text on 58mm, 42 on 80mm (design 2026-09-14). */
export const printPaperWidth = pgEnum("print_paper_width", ["58mm", "80mm"]);
/** The print head's dot density; it sets the QR dot size for the legal 30-40 mm. */
export const printResolution = pgEnum("print_resolution", ["180dpi", "203dpi"]);
/** The character table the printer is switched to, so accents and the euro sign print correctly. */
export const printCharacterSet = pgEnum("print_character_set", ["wpc1252", "pc858", "plain"]);
```

and inside the `printers` table, directly after `ticketScope`:

```ts
    // Layout settings (design 2026-09-14). Defaults match the TM-T88III: 80mm, 180 dpi, table 16.
    paperWidth: printPaperWidth("paper_width").notNull().default("80mm"),
    resolution: printResolution("resolution").notNull().default("180dpi"),
    characterSet: printCharacterSet("character_set").notNull().default("wpc1252"),
```

In `packages/db/src/index.ts`, replace

```ts
export { printTicketScope, printTransport, printers } from "./schema/printers.js";
```

with

```ts
export {
  printCharacterSet,
  printPaperWidth,
  printResolution,
  printTicketScope,
  printTransport,
  printers,
} from "./schema/printers.js";
```

(`@waitron/db`'s root barrel names each schema export explicitly; without this line Task 9's import fails.)

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @waitron/db db:generate --name printer_layout_settings`

Open the generated `packages/db/drizzle/0025_printer_layout_settings.sql` (the number follows `0024_modifiers_editing_rework`). It must contain exactly three `CREATE TYPE "public"."print_…" AS ENUM(…)` statements and three `ALTER TABLE "printers" ADD COLUMN "…" … DEFAULT '…' NOT NULL` statements, and nothing else. The types are created in the same migration that uses them, so PostgreSQL's same-transaction enum rule (`55P04`, which concerns a value ADDED to an existing type) does not apply, and `scripts/enum-add-value-safety.test.ts` sees no `ADD VALUE`. The baseline grants `SELECT, INSERT, UPDATE ON "printers"` to `app_user` table-wide (`0001_db_baseline_sql.sql:482`), so no grant is needed.

- [ ] **Step 5: Run the column test and the root migration guards**

```bash
pnpm --filter @waitron/db exec vitest run src/schema/printing.test.ts && \
pnpm vitest run scripts/journal-monotonic.test.ts scripts/enum-add-value-safety.test.ts
```

Expected: PASS. (If a rebase later collides the migration number, regenerate: reset `packages/db/drizzle/` to `origin/main`, keep `printers.ts`, re-run Step 4 — never hand-edit `_journal.json`.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema/printers.ts packages/db/src/index.ts packages/db/drizzle packages/db/src/schema/printing.test.ts
git commit -s -m "Add paper width, resolution and character set to the printers table"
```

---

### Task 8: Carry the settings through create, update and list

**Files:**
- Modify: `packages/printing/src/printers.ts`, `packages/printing/src/printers.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/printing/src/printers.test.ts` (it uses the file's own `setup()`, `asTx()` and `seedPrinter()` helpers, lines 21-67):

```ts
describe("printer layout settings", () => {
  it("defaults to 80mm, 180dpi and wpc1252, and stores, updates and lists each setting", async () => {
    const cfg = await setup();
    const defaulted = await seedPrinter(cfg, "Defaults");
    const { id } = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, {
        name: "Narrow",
        transport: "network_tcp",
        host: "10.0.0.10",
        paperWidth: "58mm",
        characterSet: "pc858",
      }),
    );
    await asTx(cfg, (tx) => updatePrinter(tx, cfg, id, { resolution: "203dpi" }));
    const rows = await asTx(cfg, (tx) => listPrinters(tx, cfg));
    expect(rows.find((r) => r.id === defaulted)).toMatchObject({
      paperWidth: "80mm",
      resolution: "180dpi",
      characterSet: "wpc1252",
    });
    expect(rows.find((r) => r.id === id)).toMatchObject({
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/printing exec vitest run src/printers.test.ts`
Expected: FAIL — the rows carry no settings (and the input type rejects the fields under typecheck).

- [ ] **Step 3: Add the fields** — in `packages/printing/src/printers.ts`:

Add the imports:

```ts
import type { CharacterSet } from "./charset.js";
import type { PaperWidth, Resolution } from "./layout.js";
```

Add to `CreatePrinterInput` (after `pollId?: string;`) and to `UpdatePrinterInput` (after `ticketScope?`):

```ts
  paperWidth?: PaperWidth;
  resolution?: Resolution;
  characterSet?: CharacterSet;
```

Add to `PrinterRow` (after `ticketScope`):

```ts
  paperWidth: PaperWidth;
  resolution: Resolution;
  characterSet: CharacterSet;
```

In `createPrinter`'s `.values({ … })`, after `pollId: input.pollId,`:

```ts
        // Undefined settings are omitted too, so each takes its column default (80mm, 180dpi, wpc1252).
        paperWidth: input.paperWidth,
        resolution: input.resolution,
        characterSet: input.characterSet,
```

In `listPrinters`' `.select({ … })`, after `ticketScope: printers.ticketScope,`:

```ts
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
      characterSet: printers.characterSet,
```

`updatePrinter` needs no change: it already writes every defined key of the patch.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @waitron/printing exec vitest run src/printers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/printers.ts packages/printing/src/printers.test.ts
git commit -s -m "Carry printer layout settings through create, update and list"
```

---

### Task 9: Accept and return the settings over the API; prove configuration transfer

**Files:**
- Modify: `apps/server/src/print-api.ts`, `apps/server/src/print-api.test.ts`, `apps/server/src/configuration-transfer.test.ts`

- [ ] **Step 1: Write the failing API test** — in `apps/server/src/print-api.test.ts`, inside `describe("mountPrintApi — management: printers CRUD", …)` (line 1022), add (it uses the file's `mountApp` (113), `send` (133), `createNetworkPrinter` (207) and `managerCookie`):

```ts
  it("stores, lists and patches the three layout settings, and rejects an unknown value", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Estrecha",
        transport: "network_tcp",
        host: "10.0.0.31",
        paperWidth: "58mm",
        characterSet: "pc858",
      },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const defaulted = await createNetworkPrinter(app, "10.0.0.32", 9100, "Por defecto");
    const patched = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { resolution: "203dpi" },
    });
    expect(patched.status).toBe(204);
    const listed = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string; paperWidth: string; resolution: string; characterSet: string }[];
    expect(listed.find((p) => p.id === id)).toMatchObject({
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
    });
    expect(listed.find((p) => p.id === defaulted)).toMatchObject({
      paperWidth: "80mm",
      resolution: "180dpi",
      characterSet: "wpc1252",
    });
    for (const [method, path, body, field] of [
      [
        "POST",
        "/management-api/printers",
        { name: "Mala", transport: "network_tcp", host: "10.0.0.33", paperWidth: "70mm" },
        "paperWidth",
      ],
      ["PATCH", `/management-api/printers/${id}`, { resolution: "300dpi" }, "resolution"],
      ["PATCH", `/management-api/printers/${id}`, { characterSet: "cp437" }, "characterSet"],
    ] as const) {
      const res = await send(app, method, path, { cookie: managerCookie, body });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });
```

- [ ] **Step 2: Write the configuration-transfer assertion** — in `apps/server/src/configuration-transfer.test.ts`, in the test `"copies declared configuration into a fresh venue while scrubbing staff authenticators"`:

Replace the source printer insert (line 306) with:

```ts
      await tx.execute(sql`
        insert into printers
          (id, tenant_id, location_id, name, transport, local_key, active,
           paper_width, resolution, character_set)
        values
          ('55555555-aaaa-aaaa-aaaa-555555555555', ${source.tenantId}, ${source.locationId},
           'Kitchen printer', 'usb', 'B120300001', true, '58mm', '203dpi', 'pc858')`);
```

and directly after the `expect(imported.rows[0]).toEqual({ … });` block (line 440-460), add:

```ts
    const printerSettings = await suite.db.execute<{
      paper_width: string;
      resolution: string;
      character_set: string;
    }>(sql`
      select paper_width, resolution, character_set from printers
      where tenant_id = ${target.tenantId} and local_key = 'B120300001'`);
    expect(printerSettings.rows).toEqual([
      { paper_width: "58mm", resolution: "203dpi", character_set: "pc858" },
    ]);
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts src/configuration-transfer.test.ts`
Expected: the API test FAILS (the routes ignore the fields: the created printer lists `80mm`, the bad values return 201/204). The transfer test already PASSES, because `packages/db/src/configuration-transfer.ts` copies every `printers` column except `poll_token_hash`. Prove it guards something: temporarily add `"paper_width"` to that `omit` list (line 33), re-run, watch the transfer test fail on `"80mm"`, then revert the edit.

- [ ] **Step 4: Wire the routes** — in `apps/server/src/print-api.ts`:

Add `printCharacterSet`, `printPaperWidth` and `printResolution` to the `@waitron/db` import.

In `POST /management-api/printers`, after `if (pollId !== undefined) input.pollId = pollId;`, and in `PATCH /management-api/printers/:id` after the `ticketScope` block (writing to `patch` instead of `input`), add:

```ts
      if (body.paperWidth !== undefined) {
        input.paperWidth = requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues);
      }
      if (body.resolution !== undefined) {
        input.resolution = requireEnum(body.resolution, "resolution", printResolution.enumValues);
      }
      if (body.characterSet !== undefined) {
        input.characterSet = requireEnum(
          body.characterSet,
          "characterSet",
          printCharacterSet.enumValues,
        );
      }
```

`GET /management-api/printers` spreads each `listPrinters` row, so it returns the settings with no change.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts src/configuration-transfer.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/print-api.ts apps/server/src/print-api.test.ts apps/server/src/configuration-transfer.test.ts
git commit -s -m "Accept and return printer layout settings over the management API"
```

---

### Task 10: Shared money formatting, the QR matrix, and the grid sizes real links produce

**Files:**
- Create: `apps/server/src/receipt-money.ts`, `apps/server/src/receipt-money.test.ts`, `apps/server/src/qr-matrix.ts`, `apps/server/src/qr-matrix.test.ts`, `apps/server/src/qr-link-range.test.ts`

**Interfaces produced:** `formatMoney(value, locale)`; `qrModules(text, { version? }): boolean[][]` at level M.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/receipt-money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMoney } from "./receipt-money.js";

describe("formatMoney", () => {
  it("separates the amount from the euro sign with an ASCII space", () => {
    const s = formatMoney("12.50", "es-ES");
    expect(s).toBe("12,50 €");
    expect(s.charCodeAt(5)).toBe(0x20);
  });
});
```

`apps/server/src/qr-matrix.test.ts` — includes an independent reader of the QR's format information (it does not use the encoder), with the level-L/Q/H negative controls:

```ts
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { qrModules } from "./qr-matrix.js";

/**
 * Read the error-correction level from a matrix's format information (ISO/IEC 18004 §7.9): 15 bits
 * stored twice beside the top-left finder pattern, masked with 101010000010010, whose top two bits are
 * the level (01 = L, 00 = M, 11 = Q, 10 = H) and whose last ten are a BCH check. Independent of the
 * encoder: it only reads the dark and light modules.
 */
function formatInfoLevel(m: readonly (readonly boolean[])[]): "L" | "M" | "Q" | "H" {
  const size = m.length;
  let vertical = 0;
  let horizontal = 0;
  for (let i = 0; i < 15; i++) {
    const row = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    const col = i < 8 ? size - 1 - i : i < 9 ? 7 : 14 - i;
    if (m[row]![8]) vertical |= 1 << i;
    if (m[8]![col]) horizontal |= 1 << i;
  }
  expect(horizontal, "the two copies of the format information agree").toBe(vertical);
  const bits = vertical ^ 0b101010000010010;
  let remainder = bits;
  for (let b = 14; b >= 10; b--) if (remainder & (1 << b)) remainder ^= 0b10100110111 << (b - 10);
  expect(remainder, "the format information's BCH check holds").toBe(0);
  return (["M", "L", "H", "Q"] as const)[bits >> 13]!;
}

const LINK =
  "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345678&numserie=A%2F1&fecha=17-08-2026&importe=20.90";

/** The same matrix read straight from the library, at a chosen level — the negative control. */
function libraryMatrix(text: string, level: "L" | "M" | "Q" | "H"): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: level });
  return Array.from({ length: qr.modules.size }, (_, r) =>
    Array.from({ length: qr.modules.size }, (_, c) => qr.modules.get(r, c) === 1),
  );
}

describe("qrModules", () => {
  it("returns a square matrix of the link's grid size", () => {
    const m = qrModules(LINK);
    expect(m).toHaveLength(41);
    expect(m.every((row) => row.length === 41)).toBe(true);
  });

  it("encodes at error-correction level M, read back from the format information", () => {
    expect(formatInfoLevel(qrModules(LINK))).toBe("M");
    expect(formatInfoLevel(qrModules("Waitron 30-40 mm", { version: 9 }))).toBe("M");
  });

  it("reads a different level from a level-L code (negative control for the reader)", () => {
    expect(formatInfoLevel(libraryMatrix(LINK, "L"))).toBe("L");
    expect(formatInfoLevel(libraryMatrix(LINK, "Q"))).toBe("Q");
    expect(formatInfoLevel(libraryMatrix(LINK, "H"))).toBe("H");
  });

  it("keeps rows as rows (a transposed matrix fails the format check)", () => {
    const m = qrModules(LINK);
    const transposed = m.map((row, r) => row.map((_, c) => m[c]![r]!));
    expect(() => formatInfoLevel(transposed)).toThrow();
  });

  it("forces the QR version when asked", () => {
    expect(qrModules("Waitron 30-40 mm", { version: 7 })).toHaveLength(45);
    expect(qrModules("Waitron 30-40 mm", { version: 9 })).toHaveLength(53);
  });
});
```

`apps/server/src/qr-link-range.test.ts` — builds the shortest and longest links `validate.ts` accepts, through the real record builder, and checks their grid sizes fall inside Task 4's sweep. A test importing `@waitron/verifactu` is allowed: `scripts/module-seams.test.ts` scans non-test source only (its `sourceFiles`, line 76).

```ts
import { buildAltaRecord, buildQrPayload, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { describe, expect, it } from "vitest";
import { qrModules } from "./qr-matrix.js";

/** The dot-size sweep in packages/printing/src/layout.test.ts covers these grid sizes. */
const SWEPT = { min: 37, max: 77 };

function alta(
  overrides: Pick<AltaInput, "IDEmisorFactura" | "NumSerieFactura" | "ImporteTotal">,
): AltaInput {
  return {
    ...overrides,
    FechaExpedicionFactura: new Date("2026-09-14T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta",
    Desglose: [
      {
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: overrides.ImporteTotal,
        CuotaRepercutida: "0.00",
      },
    ],
    CuotaTotal: "0.00",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: {
      NombreRazon: "Waitron",
      NIF: "B12345678",
      NombreSistemaInformatico: "Waitron POS",
      IdSistemaInformatico: "WT",
      Version: "1.0.0",
      NumeroInstalacion: "001",
      TipoUsoPosibleSoloVerifactu: "S",
      TipoUsoPosibleMultiOT: "S",
      IndicadorMultiplesOT: "N",
    },
    generadoEn: new Date("2026-09-14T10:00:00+02:00"),
    offsetMinutes: 120,
  };
}

describe("the grid sizes a real receipt QR can have", () => {
  it.each([
    [
      "shortest: preproduction, 1-character series, 0.00",
      "preproduction",
      "B12345678",
      "A",
      "0.00",
      41,
    ],
    ["production, 1-character series, 0.00", "production", "B12345678", "A", "0.00", 45],
    [
      "longest series: production, 60 characters that all need escaping, -123456789012.34",
      "production",
      "B12345678",
      "/".repeat(60),
      "-123456789012.34",
      65,
    ],
    [
      "longest link: that series and a 9-character NIF of euro signs (validate.ts checks NIF length only)",
      "production",
      "€".repeat(9),
      "/".repeat(60),
      "-123456789012.34",
      69,
    ],
  ] as const)("%s", (_label, environment, nif, series, amount, squares) => {
    const record = buildAltaRecord(
      alta({ IDEmisorFactura: nif, NumSerieFactura: series, ImporteTotal: amount }),
    );
    expect(validate(record).filter((issue) => issue.severity === "error")).toEqual([]);
    const size = qrModules(buildQrPayload(record, environment)).length;
    expect(size).toBe(squares);
    expect(size).toBeGreaterThanOrEqual(SWEPT.min);
    expect(size).toBeLessThanOrEqual(SWEPT.max);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/receipt-money.test.ts src/qr-matrix.test.ts src/qr-link-range.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both files**

`apps/server/src/receipt-money.ts`:

```ts
const formatters = new Map<string, Intl.NumberFormat>();

/**
 * A money amount for paper, formatted in `locale`. `Intl.NumberFormat("es-ES", …)` separates the amount
 * and the € with a no-break space (U+00A0, or U+202F on some ICU builds); it becomes an ASCII space so
 * every character set prints the same gap. `Number(value)` is display-only: at money scale it is exact.
 */
export function formatMoney(value: string, locale: string): string {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" });
    formatters.set(locale, formatter);
  }
  return formatter.format(Number(value)).replace(/[\u{a0}\u{202f}]/gu, " ");
}
```

`apps/server/src/qr-matrix.ts`:

```ts
import QRCode from "qrcode";

/**
 * The QR module matrix for `text` at error-correction level M (Orden HAC/1177/2024 art. 21.1), dark =
 * true, without the blank border. `version` forces a size (the test page's fixed samples); the receipt
 * lets the library pick the smallest version that holds the link.
 */
export function qrModules(text: string, opts: { version?: number } = {}): boolean[][] {
  const qr = QRCode.create(text, {
    errorCorrectionLevel: "M",
    ...(opts.version === undefined ? {} : { version: opts.version }),
  });
  const size = qr.modules.size;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => qr.modules.get(row, col) === 1),
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/receipt-money.test.ts src/qr-matrix.test.ts src/qr-link-range.test.ts`
Expected: PASS (1 + 5 + 4 tests). Encoding at level L instead of M fails the format-information test (and changes the grid size); swapping rows and columns in `qrModules` fails it too.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/receipt-money.ts apps/server/src/receipt-money.test.ts apps/server/src/qr-matrix.ts apps/server/src/qr-matrix.test.ts apps/server/src/qr-link-range.test.ts
git commit -s -m "Add shared money formatting and a level-M QR matrix helper"
```

---

### Task 11: The preview decoder reads character tables

This comes before the document tasks because their tests read printed text through it.

**Files:**
- Modify: `apps/server/src/print-job-preview.ts`, `apps/server/src/print-job-preview.test.ts`, `apps/server/src/testing/decode-ticket.ts`

**Interfaces produced:**
- `PrintJobPreview` gains `columns: number` and `dpi: number`; `previewPrintJob(payload, printer = { columns: 42, dpi: 180 })`.
- The decoder honours `ESC t 16` (Windows-1252) and `ESC t 19` (code page 858); any other table number, 0 included, stops the preview (`unsupported`). `ESC @` returns to the starting table, which is read as Latin-1. Under table 16 or 19, bytes 0x80–0x9F are text.
- `printedLines(bytes): string[]` in `apps/server/src/testing/decode-ticket.ts` — the printed lines through the preview, asserting `unsupported === false` and `truncated === false`.

- [ ] **Step 1: Write the failing tests** — append to `apps/server/src/print-job-preview.test.ts`:

```ts
describe("character sets", () => {
  it("decodes text through the table the payload selects, including bytes 0x80-0x9F", () => {
    const wpc = previewPrintJob(esc("wpc1252").init().line("12,50 €").bytes());
    expect(wpc).toMatchObject({ text: "12,50 €\n", unsupported: false, truncated: false });
    const pc = previewPrintJob(esc("pc858").init().line("Café ü ç Ç €").bytes());
    expect(pc).toMatchObject({ text: "Café ü ç Ç €\n", unsupported: false, truncated: false });
  });

  it("returns to the starting table on ESC @", () => {
    const result = previewPrintJob(
      Uint8Array.of(0x1b, 0x74, 19, 0x82, 0x0a, 0x1b, 0x40, 0xe9, 0x0a),
    );
    expect(result).toMatchObject({ text: "é\né\n", unsupported: false, truncated: false });
  });

  it("stops at a byte 0x80-0x9F when no table was selected", () => {
    expect(previewPrintJob(Uint8Array.of(0x41, 0x80, 0x0a)).unsupported).toBe(true);
  });

  it.each([0, 1, 17, 99])("stops the preview on character table %i", (table) => {
    const result = previewPrintJob(Uint8Array.of(0x1b, 0x40, 0x1b, 0x74, table, 0x41));
    expect(result.unsupported).toBe(true);
    expect(result.text).toBe("");
  });

  it("reports the printer's column count and resolution", () => {
    expect(previewPrintJob(Uint8Array.of(0x41), { columns: 30, dpi: 203 })).toMatchObject({
      columns: 30,
      dpi: 203,
    });
  });
});
```

and add `columns: 42,` and `dpi: 180,` as the first two keys of the expected object in the two existing `toEqual` tests, `"shows receipt text without the printer commands or drawer pulse"` (line 11) and `"extracts QR content when the stored symbol is printed"` (line 29). Keep every other expected key unchanged.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/print-job-preview.test.ts`
Expected: FAIL — `ESC t` stops the preview, `0x80` stops it, the result has no `columns`/`dpi`.

- [ ] **Step 3: Implement in `print-job-preview.ts`**

Add the import:

```ts
import { decodeBytes, type CharacterSet } from "@waitron/printing";
```

Add to `PrintJobPreview`, before `text`:

```ts
  /** The printer's column count and resolution, for the dashboard to size the paper and images. */
  columns: number;
  dpi: number;
```

Change the signature and the result literal's first lines:

```ts
export function previewPrintJob(
  payload: Uint8Array,
  printer: { columns: number; dpi: number } = { columns: 42, dpi: 180 },
): PrintJobPreview {
  const result: PrintJobPreview = {
    columns: printer.columns,
    dpi: printer.dpi,
```

After `let feedLines = 0;`:

```ts
  // The table text is read through: `ESC t 16`/`ESC t 19` select one, `ESC @` returns to the starting
  // table, which is read as Latin-1 (the builder's encoding when it selects no table).
  let charset: CharacterSet = "plain";
```

Replace the printable-byte condition and the character conversion:

```ts
    if (
      byte === 0x0a ||
      (byte >= 0x20 && byte <= 0x7e) ||
      byte >= 0xa0 ||
      (byte >= 0x80 && charset !== "plain")
    ) {
```

```ts
      const character = decodeBytes([byte], charset);
```

In the `ESC @` branch, add `charset = "plain";` as its first statement. Directly after the `ESC @` branch, before the `ESC d`/`ESC p` branch, add:

```ts
    if (byte === 0x1b && command === 0x74) {
      if (!available(3)) break;
      const table = payload[offset + 2];
      if (table === 16) charset = "wpc1252";
      else if (table === 19) charset = "pc858";
      else {
        result.unsupported = true;
        break;
      }
      offset += 3;
      continue;
    }
```

Append to `apps/server/src/testing/decode-ticket.ts` (and add the two imports at its top):

```ts
import { expect } from "vitest";
import { previewPrintJob } from "../print-job-preview.js";
```

```ts
/**
 * The lines a payload prints, read through the character tables it selects, with every command and
 * image skipped. Asserts the preview decoded the whole payload, so a stop part-way (an unsupported
 * command or byte) fails the calling test instead of hiding the rest of the ticket.
 */
export function printedLines(bytes: Uint8Array): string[] {
  const preview = previewPrintJob(bytes);
  expect(preview.unsupported, "preview stopped at an unsupported command").toBe(false);
  expect(preview.truncated, "preview was truncated").toBe(false);
  return preview.text.split("\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/print-job-preview.test.ts`
Expected: PASS (46 tests). Each change is guarded: without the 0x80–0x9F widening two tests fail; without the `ESC @` reset one fails; accepting table 0 fails the table-0 case.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/print-job-preview.ts apps/server/src/print-job-preview.test.ts apps/server/src/testing/decode-ticket.ts
git commit -s -m "Decode print previews through the character table the job selects"
```

---

### Task 12: Lay the receipt out for the printer's width and character set

**Files:**
- Modify: `apps/server/src/receipt-ticket.ts`, `apps/server/src/receipt-ticket.test.ts`, `apps/server/src/receipt-print.ts`, `apps/server/src/receipt-print.test.ts`

**Interfaces produced:** `ReceiptPrinterSettings { paperWidth; resolution; characterSet }` exported from `receipt-ticket.ts`; `FormatReceiptInput.printer: ReceiptPrinterSettings`; `ReceiptPrinter` (settings + `id`) returned by `resolveReceiptPrinter`.

- [ ] **Step 1: Update the existing receipt tests and write the failing ones** — in `apps/server/src/receipt-ticket.test.ts`:

1. Replace the two import lines

```ts
import { FEED_BEFORE_CUT, esc } from "@waitron/printing";
```
```ts
import type { ReceiptIssuer, ReceiptTrim } from "./receipt-ticket.js";
import { bytesInclude, decodeTicket } from "./testing/decode-ticket.js";
```

with

```ts
import { FEED_BEFORE_CUT, columnsFor, esc } from "@waitron/printing";
```
```ts
import type { ReceiptIssuer, ReceiptPrinterSettings, ReceiptTrim } from "./receipt-ticket.js";
import { bytesInclude, decodeTicket, printedLines } from "./testing/decode-ticket.js";
```

2. After `const QR_LEAD_BYTES = …;` add:

```ts
const PRINTER_80: ReceiptPrinterSettings = {
  paperWidth: "80mm",
  resolution: "180dpi",
  characterSet: "wpc1252",
};
const PRINTER_58: ReceiptPrinterSettings = {
  paperWidth: "58mm",
  resolution: "180dpi",
  characterSet: "pc858",
};
```

(they go above the existing `FILED_SALE` constant.)

3. Every existing `formatReceipt` call must say which printer: replace each `invoiceLocale: "es-ES"` in this file with `invoiceLocale: "es-ES", printer: PRINTER_80` (24 occurrences; the 25th call, `formatReceipt({ ...input, duplicate: true })`, spreads an `input` that contains one of them). Do not change any assertion.

4. Run the legal-completeness test at both widths through the character-set-aware reader. Replace

```ts
  it("reproduces every mandated art. 7.1 / arts. 20-21 element of a filed receipt", () => {
    const bytes = formatReceipt({
      result: FILED_SALE,
      issuer: ISSUER,
      receipt: TRIM,
      invoiceLocale: "es-ES", printer: PRINTER_80,
    });
    const s = decodeTicket(bytes);
```

with

```ts
  it.each([PRINTER_80, PRINTER_58])(
    "reproduces every mandated art. 7.1 / arts. 20-21 element of a filed receipt on $paperWidth paper",
    (printer) => {
      const bytes = formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: TRIM,
        invoiceLocale: "es-ES",
        printer,
      });
      const s = printedLines(bytes).join("\n");
```

and close it with `},` and `);` on two lines instead of `});`. Its assertions, including the native-QR one, stay as they are in this task.

5. Append:

```ts
describe("formatReceipt — printer layout", () => {
  const LONG_SALE: TillSaleResult = {
    ...FILED_SALE,
    orderLabel: "Terraza mesa del fondo junto a la fuente",
    total: "13.00",
    vatBreakdown: [{ rate: "10", base: "11.82", tax: "1.18" }],
    lines: [
      {
        descriptions: { "es-ES": "Tostada con tomate y jamón ibérico de bellota" },
        quantity: "1",
        gross: "12.50",
        parentLineNo: null,
        modifierSnapshots: [],
      },
      {
        descriptions: { "es-ES": "Aceite de oliva virgen extra de la casa" },
        quantity: "1",
        gross: "0.50",
        parentLineNo: 1,
      },
    ],
    tender: { method: "cash", change: "7.00" },
  };
  const LONG_ISSUER: ReceiptIssuer = {
    venueName: "Charcutería y Bodega La Buena Mesa de Madrid",
    nif: "B12345678",
  };
  const LONG_TRIM: ReceiptTrim = {
    headerSubtitle: "Calle Mayor 1, 28013 Madrid — abierto todos los días",
    footerMessage:
      "¡Gracias por su visita! Vuelva pronto… “La Buena” le espera",
  };

  it.each([
    PRINTER_80,
    PRINTER_58,
    { paperWidth: "58mm", resolution: "203dpi", characterSet: "plain" } as const,
    { paperWidth: "80mm", resolution: "203dpi", characterSet: "pc858" } as const,
  ])("keeps every printed line within the column count ($paperWidth, $characterSet)", (printer) => {
    const lines = printedLines(
      formatReceipt({
        result: LONG_SALE,
        issuer: LONG_ISSUER,
        receipt: LONG_TRIM,
        invoiceLocale: "es-ES",
        printer,
        simulated: true,
        duplicate: true,
      }),
    );
    const columns = columnsFor(printer.paperWidth);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
    expect(lines.join("\n")).toContain("VERI*FACTU");
  });

  it("wraps a long product name under the name and right-aligns its price on the last line", () => {
    const lines = printedLines(
      formatReceipt({
        result: LONG_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: PRINTER_58,
      }),
    );
    const first = lines.indexOf("1  Tostada con tomate y jamón");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines.slice(first, first + 4)).toEqual([
      "1  Tostada con tomate y jamón",
      "   ibérico de bellota  12,50 €",
      "  Aceite de oliva virgen extra",
      `  de la casa${" ".repeat(12)}0,50 €`,
    ]);
  });

  it("measures the euro sign after conversion: EUR takes three columns in plain letters", () => {
    const lines = printedLines(
      formatReceipt({
        result: FILED_SALE,
        issuer: ISSUER,
        receipt: {},
        invoiceLocale: "es-ES",
        printer: { paperWidth: "58mm", resolution: "180dpi", characterSet: "plain" },
      }),
    );
    expect(lines).toContain(`TOTAL${" ".repeat(16)}20,90 EUR`);
    expect(lines).toContain(`Base 21%${" ".repeat(13)}10,00 EUR`);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts`
Expected: FAIL — lines exceed 30 columns on 58mm, the long name runs into its price, and pc858 names read wrongly through the preview.

- [ ] **Step 3: Rework `receipt-ticket.ts`**

Replace the `@waitron/printing` import and the `./till-sale.js` import with:

```ts
import {
  columnsFor,
  esc,
  labelAmountLines,
  prepareText,
  wrapText,
  type CharacterSet,
  type PaperWidth,
  type Resolution,
} from "@waitron/printing";
import { addDecimal, decimal, perDishOptionQuantity } from "@waitron/shared";

import { formatMoney } from "./receipt-money.js";
import type { TillSaleLine, TillSaleResult } from "./till-sale.js";
```

Delete: the `RECEIPT_WIDTH` constant and its comment; the `formatters` map, the local `formatMoney` and both comments above them (this removes the note deferring the € byte "to the failover/hardware pass"); `twoColumn` and its comment. Replace the `QTY_BADGE` comment with `/** The multiplication sign of a per-dish option-quantity badge (`×2`); `receipt-ticket.test.ts` pins it. */`. In the module comment, replace the paragraph beginning ` * NO emphasis/bold` with:

```ts
 * PRINTER LAYOUT. The receipt takes the printer's paper width, resolution and character set
 * (design 2026-09-14): text is prepared for the character set, wrapped to the column count, and the QR
 * is a raster image sized to 30-40 mm. The builder has no bold verb, so the layout is plain text. The
 * paper itself is verified manually on the real printer; `receipt-ticket.test.ts` pins the bytes.
```

Above `export interface FormatReceiptInput`, add:

```ts
/** The three printer settings a receipt is laid out for (design 2026-09-14). */
export interface ReceiptPrinterSettings {
  paperWidth: PaperWidth;
  resolution: Resolution;
  characterSet: CharacterSet;
}
```

In `FormatReceiptInput`, after `invoiceLocale: string;`:

```ts
  /** The receipt printer's settings: they set the column count, the QR dot size and the text encoding. */
  printer: ReceiptPrinterSettings;
```

Replace `formatReceipt` (its comment and body) with:

```ts
/**
 * Render one filed sale to an ESC/POS payload — the customer's factura simplificada. Pure and total:
 * an empty `lines`/`vatBreakdown` yields a header-and-total ticket rather than throwing, and an empty
 * `result.qr` prints no QR while still printing the legend. The element ORDER mirrors
 * `till-ticket-view.ts` element for element; only the line breaks depend on the printer. Every string
 * is prepared for the printer's character set before it is measured, so no printed line is longer than
 * the paper's column count.
 */
export function formatReceipt({
  result,
  issuer,
  receipt,
  invoiceLocale,
  printer,
  simulated = false,
  duplicate = false,
}: FormatReceiptInput): Uint8Array {
  const locale = invoiceLocale;
  const columns = columnsFor(printer.paperWidth);
  const p = (s: string): string => prepareText(s, printer.characterSet);
  const b = esc(printer.characterSet).init();
  const text = (s: string, indent = 0): void => {
    for (const line of wrapText(p(s), columns, indent)) b.line(line);
  };
  const row = (label: string, amount: string, indent = 0): void => {
    for (const line of labelAmountLines(p(label), p(amount), columns, indent)) b.line(line);
  };

  // The practice warning surrounds the immutable receipt content. It never enters the filed record or
  // its hash, but it must survive when a paper ticket leaves a Demo/Prepare till.
  if (simulated) {
    text("PRUEBA - SIN COBRO REAL");
    b.line();
  }

  // Issuer block — venue name, optional non-fiscal subtitle, NIF (art. 7.1.d).
  text(issuer.venueName);
  if (receipt.headerSubtitle) text(receipt.headerSubtitle);
  if (duplicate) b.line("DUPLICADO");
  text(`${LABEL.nif}: ${issuer.nif}`);
  b.line();

  text([result.orderLabel, `Pedido ${result.orderNumber}`].filter(Boolean).join(" · "));

  // Metadata — serie+número (7.1.a) and fecha de expedición (7.1.b).
  row(LABEL.invoice, result.invoiceNumber);
  row(LABEL.date, issueDate(result.issuedAt, locale));
  b.line();

  // Goods identification (7.1.e) — the FILED composition, grouped so each option prints indented beneath
  // its dish at its own delta. A dish name's continuation lines start under the name, not the quantity.
  for (const { dish, options } of groupByParent(result.lines)) {
    const unit = dish.unitName == null ? "" : ` ${lineName(dish.unitName, locale)}`;
    const quantity = p(`${dish.quantity}${unit}  `);
    row(
      `${quantity}${lineName(dish.descriptions, locale)}`,
      formatMoney(dish.gross, locale),
      quantity.length,
    );
    for (const label of modifierSnapshotLabels(dish.modifierSnapshots ?? [], locale)) {
      text(`  ${label}`, 2);
    }
    for (const option of options) {
      // No quantity prefix: an option is priced per dish. A "×N" badge shows a per-dish count above 1.
      const perDish = perDishOptionQuantity(option.quantity, dish.quantity);
      const name = lineName(option.descriptions, locale);
      const label = perDish > 1 ? `  ${name} ${QTY_BADGE}${perDish}` : `  ${name}`;
      row(label, formatMoney(option.gross, locale), 2);
    }
  }
  b.line();

  // VAT breakdown (7.1.f) — base imponible + cuota per tipo impositivo.
  for (const v of result.vatBreakdown) {
    row(`${LABEL.base} ${v.rate}%`, formatMoney(v.base, locale));
    row(`${LABEL.vat} ${v.rate}%`, formatMoney(v.tax, locale));
  }
  b.line();

  // Contraprestación total (7.1.g).
  row(LABEL.total, formatMoney(result.total, locale));
  b.line();

  // Allowed operational extras — the tender block. Card identity belongs on the payment slip.
  const t = result.tender;
  if (t.method === "cash") {
    row(LABEL.cash, formatMoney(addDecimal(decimal(result.total), decimal(t.change)), locale));
    row(LABEL.change, formatMoney(t.change, locale));
  } else if (t.method === "card") {
    b.line("Tarjeta");
    if (t.reference !== null) text(`Ref. ${t.reference}`);
    // String compare: `tenders.tip_amount` is `numeric(12,2)`, always canonical "0.00"/"0.50".
    if (t.tip !== "0.00") {
      row(LABEL.tip, formatMoney(t.tip, locale));
      row(LABEL.charged, formatMoney(t.charged, locale));
    }
  }
  b.line();

  // The QR (arts. 20-21). A sale's cotejo URL can legitimately be "" (the fiscal backend minted none),
  // and a QR of nothing is not a scannable code, so print no QR then while still printing the legend.
  if (result.qr !== "") b.qr(result.qr).line();

  // The VERI*FACTU legend — printed UNCONDITIONALLY in Veri*Factu mode (art. 20.1.b).
  b.line(LEGEND);

  // Non-fiscal footer trim, under the legend.
  if (receipt.footerMessage) text(receipt.footerMessage);

  return b.feedAndCut().bytes();
}
```

In `apps/server/src/receipt-print.ts`: add `import type { ReceiptPrinterSettings } from "./receipt-ticket.js";` (beside the existing `formatReceipt` import), then replace `resolveReceiptPrinter`'s signature and select, `buildReceiptBytes`' signature and its `formatReceipt` call, and `resolvePrinterAndReceipt`, as follows:

```ts
/** The till's active receipt printer and the settings its receipts are laid out for. */
export interface ReceiptPrinter extends ReceiptPrinterSettings {
  id: string;
}

export async function resolveReceiptPrinter(
  tx: Transaction,
  cfg: TillConfig,
): Promise<ReceiptPrinter | undefined> {
  const [printer] = await tx
    .select({
      id: printers.id,
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
      characterSet: printers.characterSet,
    })
    .from(tills)
    .innerJoin(
      printers,
      and(
        eq(printers.tenantId, tills.tenantId),
        eq(printers.id, tills.receiptPrinterId),
        eq(printers.active, true),
      ),
    )
    .where(and(eq(tills.tenantId, cfg.tenantId), eq(tills.id, cfg.tillId)))
    .for("share", { of: printers });
  return printer;
}
```

```ts
async function buildReceiptBytes(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
  duplicate: boolean,
  printer: ReceiptPrinterSettings,
): Promise<Uint8Array | undefined> {
```

with `printer,` added to its `formatReceipt({ … })` object after `invoiceLocale: cfg.locale,`; and in `resolvePrinterAndReceipt` change the return type to `Promise<{ printer: ReceiptPrinter; receiptBytes: Uint8Array } | undefined>` and the build call to `buildReceiptBytes(tx, cfg, ticket, duplicate, printer)`. The callers that read only `.id` (`enqueueCashSaleDrawer`, `till-api.ts:1734`) are unaffected.

In `apps/server/src/receipt-print.test.ts`, add `updatePrinter` to the `@waitron/printing` import, `printedLines` to the `./testing/decode-ticket.js` import, and inside `describe("print-on-sale hook (auto-enqueue + cash drawer kick, post-filing outbox)", …)` add (it uses the file's `setupVenue` (122), `makePrinter` (184), `configureReceipt` (204), `printJobsFor` (225), `printCfg` (115), `deps` and `OPERATOR`):

```ts
  it("lays the automatic receipt out for the till printer's paper width and character set", async () => {
    const { cfg, each } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await updatePrinter(tx, printCfg(cfg), printerId, {
        paperWidth: "58mm",
        characterSet: "pc858",
      });
    });
    await configureReceipt(cfg, { mode: "auto", printerId });
    await recordTillSale(
      deps(),
      cfg,
      { lines: [{ productId: each.id, quantity: "2" }], tender: { method: "cash", amount: "5.00" } },
      OPERATOR,
    );
    const receipt = (await printJobsFor(cfg))
      .map((job) => new Uint8Array(job.payload))
      .find((payload) => decodeTicket(payload).includes("VERI*FACTU"))!;
    expect([...receipt.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    for (const line of printedLines(receipt)) expect(line.length, line).toBeLessThanOrEqual(30);
  });
```

(`withTenant` and `asAppUser` are already imported from `@waitron/db` in this file; `decodeTicket` from `./testing/decode-ticket.js`.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts src/receipt-print.test.ts`
Expected: PASS (receipt-ticket: 31 tests). Hard-coding 42 columns fails four of the new tests; measuring the amount before preparing it fails the plain-letters tests; dropping the item indent fails the long-name test.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/receipt-ticket.ts apps/server/src/receipt-ticket.test.ts apps/server/src/receipt-print.ts apps/server/src/receipt-print.test.ts
git commit -s -m "Lay the receipt out for the printer's paper width and character set"
```

---

### Task 13: Print the receipt QR as a sized raster image

**Files:**
- Modify: `apps/server/src/receipt-ticket.ts`, `apps/server/src/receipt-ticket.test.ts`

- [ ] **Step 1: Write the failing tests** — in `apps/server/src/receipt-ticket.test.ts`:

1. Replace the import lines above `import type { TillSaleResult } from "./till-sale.js";` with

```ts
import { FEED_BEFORE_CUT, columnsFor, esc, withQuietZone } from "@waitron/printing";
import { compareDecimal, decimal, sumDecimals } from "@waitron/shared";
import { describe, expect, it } from "vitest";

import { formatReceipt } from "./receipt-ticket.js";
import type { ReceiptIssuer, ReceiptPrinterSettings, ReceiptTrim } from "./receipt-ticket.js";
import { qrModules } from "./qr-matrix.js";
import { bytesInclude, decodeTicket, printedLines } from "./testing/decode-ticket.js";
```

2. After `const QR_LEAD_BYTES = …;` add:

```ts
/** GS v 0 with m = 0 — the lead bytes of a raster image (`escpos.ts` `qrRaster`). */
const RASTER_LEAD_BYTES = Uint8Array.from([0x1d, 0x76, 0x30, 0x00]);
```

3. In the completeness test, replace the native-QR comment and assertion (`expect(bytesInclude(bytes, esc().qr(FILED_SALE.qr).bytes())).toBe(true);`) with:

```ts
      // The QR (arts. 20-21): the raster image of the sale's link, with its 4-square border, at 6 dots
      // per square (this 41-square link at 180 dpi) must appear verbatim in the receipt bytes.
      expect(
        bytesInclude(
          bytes,
          esc()
            .qrRaster(withQuietZone(qrModules(FILED_SALE.qr), 4), { moduleSize: 6 })
            .bytes(),
        ),
      ).toBe(true);
```

4. In `"prints no QR command when the regime minted none, but still prints the legend"`, replace the comment and assertion before the legend check with:

```ts
    // No QR image or native QR command is emitted (mirrors `qrSvg("") === ""` on the screen)...
    expect(bytesInclude(bytes, RASTER_LEAD_BYTES)).toBe(false);
    expect(bytesInclude(bytes, QR_LEAD_BYTES)).toBe(false);
```

5. Inside `describe("formatReceipt — printer layout", …)`, after its last test, add:

```ts
  it.each([
    ["180dpi", 6, 294, 37],
    ["203dpi", 7, 343, 43],
  ] as const)(
    "prints the QR as a %s raster image of the sale's link, 30-40 mm, with no native QR command",
    (resolution, dots, heightDots, widthBytes) => {
      for (const paperWidth of ["58mm", "80mm"] as const) {
        const bytes = formatReceipt({
          result: FILED_SALE,
          issuer: ISSUER,
          receipt: {},
          invoiceLocale: "es-ES",
          printer: { paperWidth, resolution, characterSet: "wpc1252" },
        });
        expect(bytesInclude(bytes, QR_LEAD_BYTES)).toBe(false);
        const at = bytes.findIndex((_, i) => RASTER_LEAD_BYTES.every((v, j) => bytes[i + j] === v));
        expect(at).toBeGreaterThan(0);
        // GS v 0 m xL xH yL yH: x is bytes per row, y is the height in dots.
        expect(bytes[at + 4]! + 256 * bytes[at + 5]!).toBe(widthBytes);
        expect(bytes[at + 6]! + 256 * bytes[at + 7]!).toBe(heightDots);
        const squares = qrModules(FILED_SALE.qr).length;
        expect(squares).toBe(41);
        expect(heightDots).toBe((squares + 8) * dots);
        const mm = (squares * dots * 25.4) / (resolution === "203dpi" ? 203 : 180);
        expect(mm).toBeGreaterThanOrEqual(30);
        expect(mm).toBeLessThanOrEqual(40);
        const image = esc()
          .qrRaster(withQuietZone(qrModules(FILED_SALE.qr), 4), { moduleSize: dots })
          .bytes();
        expect(bytesInclude(bytes, image)).toBe(true);
      }
    },
  );
```

The resolution's path into `formatReceipt` needs no integration test of its own: Task 12 passes the whole `ReceiptPrinter` row as `printer`, so resolution travels with the paper width and character set that `receipt-print.test.ts` already checks, and the unit tests below prove `formatReceipt` reads it.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts`
Expected: FAIL — the receipt still emits `GS ( k` and no raster.

- [ ] **Step 3: Replace the QR emission** — in `receipt-ticket.ts`, add `chooseQrDots`, `dpiValue`, `QR_QUIET_ZONE`, `safeWidthDots` and `withQuietZone` to the `@waitron/printing` import and `import { qrModules } from "./qr-matrix.js";`, then replace the QR comment and `if (result.qr !== "") b.qr(result.qr).line();` with:

```ts
  // The QR (arts. 20-21), printed as an image Waitron builds, sized for this printer (30-40 mm). A sale's
  // cotejo URL can legitimately be "" (the fiscal backend minted none): then no QR, but still the legend.
  if (result.qr !== "") {
    const matrix = qrModules(result.qr);
    const dots = chooseQrDots(
      matrix.length,
      dpiValue(printer.resolution),
      safeWidthDots(printer.paperWidth),
    );
    b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), { moduleSize: dots }).line();
  }
```

`EscBuilder.qr` stays in the builder with no caller (spec, "The built-in QR command").

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/receipt-ticket.test.ts src/receipt-print.test.ts`
Expected: PASS (receipt-ticket: 33 tests). Replacing `dpiValue(printer.resolution)` with `180` fails the 203-dpi case.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/receipt-ticket.ts apps/server/src/receipt-ticket.test.ts
git commit -s -m "Print the receipt QR as a raster image sized to the legal 30-40 mm"
```

---

### Task 14: The payment slip takes the same layout and shared money formatting

**Files:**
- Modify: `apps/server/src/payment-slip.ts`, `apps/server/src/payment-slip.test.ts`, `apps/server/src/payment-slip-print.ts`, `apps/server/src/till-api.receipt.test.ts`

- [ ] **Step 1: Write the failing tests** — in `apps/server/src/payment-slip.test.ts`: add `printedLines` to the `./testing/decode-ticket.js` import; add `printer: { paperWidth: "80mm", characterSet: "wpc1252" } as const,` as the last key of the `input` constant (every existing call spreads `input`); append:

```ts
describe("payment slip printer layout", () => {
  it("separates each amount from the euro sign with an ASCII space", () => {
    const bytes = formatPaymentSlip(input);
    const euro = 0x80; // € in Windows-1252
    const positions = [...bytes].flatMap((byte, i) => (byte === euro ? [i] : []));
    expect(positions).toHaveLength(3); // Importe, Propina, Cobrado
    for (const i of positions) expect(bytes[i - 1]).toBe(0x20);
  });

  it.each([
    { paperWidth: "80mm", characterSet: "wpc1252" },
    { paperWidth: "58mm", characterSet: "pc858" },
    { paperWidth: "58mm", characterSet: "plain" },
  ] as const)(
    "keeps every line within the column count ($paperWidth, $characterSet)",
    (printer) => {
      const lines = printedLines(
        formatPaymentSlip({
          ...input,
          issuer: { venueName: "Charcutería y Bodega La Buena Mesa", nif: "B12345678" },
          orderLabel: "Terraza mesa del fondo",
          printer,
        }),
      );
      const columns = printer.paperWidth === "58mm" ? 30 : 42;
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(columns);
      expect(lines).toContain(
        printer.characterSet === "plain"
          ? `Cobrado${" ".repeat(columns - 15)}1,50 EUR`
          : `Cobrado${" ".repeat(columns - 13)}1,50 €`,
      );
    },
  );
});
```

In `apps/server/src/till-api.receipt.test.ts`, add `updatePrinter` to the `@waitron/printing` import (line 29), `printedLines` to the `./testing/decode-ticket.js` import (line 48), and inside `describe("payment slip persisted capture facts", …)` (line 919) add (it uses that file's `setupVenue` (116), `makePrinter` (227), `configureReceipt` (241), `printJobsFor` (262), `login` (339), `ringSale` (375), `apiDeps` (214), `printCfg` (106) and `noopLog`):

```ts
  it("lays the payment slip out for the till printer's paper width and character set", async () => {
    const { cfg, each, operatorId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await withTenant(suite.admin, cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await updatePrinter(tx, printCfg(cfg), printerId, { paperWidth: "58mm", characterSet: "plain" });
    });
    await configureReceipt(cfg, { mode: "never", printerId });
    const app = new Hono();
    mountTillApi(app, apiDeps(cfg), noopLog);
    const cookie = await login(app, cfg, operatorId);
    const id = await ringSale(app, cfg, cookie, each.menuItemId, "card");
    await suite.admin.execute(
      sql`update payments set provider = 'sumup', card_scheme = 'VISA', card_last4 = '5838', card_entry_mode = 'contactless', card_auth_code = '328600' where tenant_id = ${cfg.tenantId} and working_order_id = ${id}`,
    );
    const res = await app.request(`/api/sales/${id}/payment-slip`, { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const [job] = await printJobsFor(cfg);
    const payload = new Uint8Array(job!.payload);
    expect([...payload.subarray(0, 3)]).toEqual([0x1b, 0x40, 0x4a]); // ESC @, then "J": no table selection
    const lines = printedLines(payload);
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    expect(lines.join("\n")).toContain("EUR");
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/payment-slip.test.ts src/till-api.receipt.test.ts`
Expected: FAIL — the slip ignores `printer`, keeps its own 42 columns and a no-break space before €.

- [ ] **Step 3: Rework `payment-slip.ts`** — replace the whole file with:

```ts
import {
  columnsFor,
  esc,
  labelAmountLines,
  prepareText,
  wrapText,
  type CharacterSet,
  type PaperWidth,
} from "@waitron/printing";
import type { CardDetails } from "@waitron/payments";
import { formatMoney } from "./receipt-money.js";

/** Payment facts only: no invoice identifiers or fiscal rendering dependencies. */
export interface PaymentSlipInput {
  issuer: { venueName: string; nif: string };
  paidAt: string;
  orderLabel: string | null;
  orderNumber: number;
  amount: string;
  tip: string;
  charged: string;
  card: CardDetails | null;
  invoiceLocale: string;
  /** The receipt printer's layout settings. A slip carries no QR, so resolution does not apply. */
  printer: { paperWidth: PaperWidth; characterSet: CharacterSet };
}

const ENTRY_MODE_LABEL: Partial<Record<CardDetails["entryMode"], string>> = {
  contactless: "Sin contacto",
  chip: "Chip",
  swipe: "Banda",
};

export function formatPaymentSlip(input: PaymentSlipInput): Uint8Array {
  const columns = columnsFor(input.printer.paperWidth);
  const p = (s: string): string => prepareText(s, input.printer.characterSet);
  const b = esc(input.printer.characterSet).init();
  const text = (s: string): void => {
    for (const line of wrapText(p(s), columns)) b.line(line);
  };
  const row = (label: string, value: string): void => {
    for (const line of labelAmountLines(p(label), p(value), columns)) b.line(line);
  };
  text("JUSTIFICANTE DE PAGO");
  text("Este documento no es una factura");
  text(`${input.issuer.venueName} · ${input.issuer.nif}`);
  text(
    new Intl.DateTimeFormat(input.invoiceLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(input.paidAt)),
  );
  text([input.orderLabel, `Pedido ${input.orderNumber}`].filter(Boolean).join(" · "));
  b.line();
  if (input.card !== null) {
    row("Tarjeta", `${input.card.scheme} **** ${input.card.last4}`);
    const entry = ENTRY_MODE_LABEL[input.card.entryMode];
    if (entry !== undefined) row("Entrada", entry);
    if (input.card.authCode !== null) row("Autorización", input.card.authCode);
    b.line();
  }
  row("Importe", formatMoney(input.amount, input.invoiceLocale));
  if (input.tip !== "0.00") row("Propina", formatMoney(input.tip, input.invoiceLocale));
  row("Cobrado", formatMoney(input.charged, input.invoiceLocale));
  return b.feedAndCut().bytes();
}
```

In `apps/server/src/payment-slip-print.ts`, add to the `formatPaymentSlip({ … })` call, after `invoiceLocale: cfg.locale,`:

```ts
      printer: { paperWidth: printer.paperWidth, characterSet: printer.characterSet },
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/payment-slip.test.ts src/till-api.receipt.test.ts`
Expected: PASS (payment-slip: 9 tests). A slip that keeps `Intl`'s no-break space fails the ASCII-space test.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/payment-slip.ts apps/server/src/payment-slip.test.ts apps/server/src/payment-slip-print.ts apps/server/src/till-api.receipt.test.ts
git commit -s -m "Lay the payment slip out for the printer and share money formatting"
```

---

### Task 15: Kitchen tickets and correction slips wrap, and are built per printer layout

**Files:**
- Modify: `apps/server/src/kitchen-ticket.ts`, `apps/server/src/kitchen-ticket.test.ts`, `apps/server/src/kitchen-print.ts`, `apps/server/src/kitchen-print.test.ts`

**Interfaces produced:** `KitchenLayout { columns; charset }`; `formatKitchenTicket(ticket, layout)`, `formatCorrectionSlip(slip, layout)`; `lockActivePrinters` returns `paperWidth` and `characterSet`.

- [ ] **Step 1: Write the failing formatter tests** — in `apps/server/src/kitchen-ticket.test.ts`:

1. Replace `import { decodeTicket } from "./testing/decode-ticket.js";` with

```ts
import type { KitchenLayout, KitchenTicket } from "./kitchen-ticket.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
```

2. After `const FEED_THEN_CUT = …;` add

```ts
const KITCHEN_80: KitchenLayout = { columns: 42, charset: "wpc1252" };
const KITCHEN_58: KitchenLayout = { columns: 30, charset: "pc858" };
```

3. Pass `KITCHEN_80` as the second argument of every existing call: `formatKitchenTicket({ … })` at lines 19, 45, 59, 73, 107, 123, 131, 143, 158, 189 and `formatCorrectionSlip({ … })` at lines 204, 227, 243 become `formatKitchenTicket({ … }, KITCHEN_80)` and so on. Do not change any assertion — `"  + Grande"` and `"  * sin sal muy hecho"` must still pass.

4. Append:

```ts
describe("kitchen paper layout", () => {
  const ticket: KitchenTicket = {
    scope: "station",
    stationName: "Cocina",
    tableLabel: "Mesa 4",
    orderNumber: "A-17",
    firedAt: new Date(2026, 7, 17, 14, 30),
    items: [
      {
        qty: 2,
        name: "Chuletón de buey madurado a la brasa",
        doneness: "medium_rare",
        modifiers: ["Grande", "Salsa de setas silvestres con trufa negra"],
        note: "sin sal y con la guarnición aparte por favor",
      },
    ],
  };

  it.each([KITCHEN_80, KITCHEN_58])(
    "keeps every line within $columns columns, indented under its text",
    (layout) => {
      const lines = printedLines(formatKitchenTicket(ticket, layout));
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(layout.columns);
      expect(lines).toContain("  + Grande");
    },
  );

  it("wraps item, modifier and note lines at 30 columns with their indents", () => {
    const lines = printedLines(formatKitchenTicket(ticket, KITCHEN_58));
    const first = lines.indexOf("2 x Chuletón de buey madurado");
    expect(first).toBeGreaterThan(0);
    expect(lines.slice(first)).toEqual([
      "2 x Chuletón de buey madurado",
      "    a la brasa",
      "  ** MEDIUM RARE **",
      "  + Grande",
      "  + Salsa de setas silvestres",
      "    con trufa negra",
      "  * sin sal y con la",
      "    guarnición aparte por",
      "    favor",
      "",
    ]);
  });

  it("encodes with the layout's character set", () => {
    const bytes = [
      ...formatKitchenTicket({ ...ticket, items: [{ qty: 1, name: "Café" }] }, KITCHEN_58),
    ];
    expect(bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(bytes).toContain(0x82); // é in code page 858
    expect(bytes).not.toContain(0xe9);
  });

  it("wraps a correction slip to the layout too", () => {
    const lines = printedLines(
      formatCorrectionSlip(
        {
          kind: "VOID",
          stationName: "Cocina",
          tableLabel: null,
          orderNumber: "A-17",
          at: "2026-08-17T12:30:00.000Z",
          item: ticket.items[0]!,
        },
        KITCHEN_58,
      ),
    );
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    expect(lines).toContain("  + Salsa de setas silvestres");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts`
Expected: FAIL — the five new tests (no wrapping, Latin-1 bytes, no `ESC t`).

- [ ] **Step 3: Rework `kitchen-ticket.ts`**

Replace `import { esc } from "@waitron/printing";` with `import { esc, prepareText, wrapText, type CharacterSet } from "@waitron/printing";`.

Replace the `emitItem` function (keep its comment) with:

```ts
function emitItem(b: ReturnType<typeof esc>, item: KitchenTicketItem, layout: KitchenLayout): void {
  // Each line wraps to the paper; a continuation starts under the text after its marker.
  const text = (s: string, indent: number): void => {
    for (const line of wrapText(prepareText(s, layout.charset), layout.columns, indent))
      b.line(line);
  };
  const prefix = `${item.qty}${item.unit ? ` ${item.unit}` : ""} x `;
  text(itemLine(item), prepareText(prefix, layout.charset).length);
  if (item.doneness !== undefined && item.doneness !== "") {
    text(`  ** ${item.doneness.replace(/_/g, " ").toUpperCase()} **`, 5);
  }
  for (const modifier of item.modifiers ?? []) text(`  + ${modifier}`, 4);
  if (item.note !== undefined && item.note !== "") {
    // Sanitise the operator-typed note (strip CR/LF and other control bytes) so it prints as one
    // sub-line and cannot garble the ticket. A note that is ALL control chars sanitises to "" — skip it.
    const note = sanitizeNote(item.note);
    if (note !== "") text(`  * ${note}`, 4);
  }
}
```

Above the `hhmm` comment add:

```ts
/** The printer settings a kitchen ticket is laid out for. Kitchen paper carries no QR, so no resolution. */
export interface KitchenLayout {
  columns: number;
  charset: CharacterSet;
}
```

Replace `formatKitchenTicket`'s signature and body with:

```ts
export function formatKitchenTicket(ticket: KitchenTicket, layout: KitchenLayout): Uint8Array {
  const b = esc(layout.charset).init();
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s, layout.charset), layout.columns)) b.line(line);
  };

  // Header line differs by scope; the table / order / time block is shared by both.
  text(ticket.scope === "station" ? ticket.stationName : ORDER_HEADER);
  text(ticket.tableLabel);
  text(ticket.orderNumber);
  b.line(hhmm(ticket.firedAt));

  if (ticket.scope === "station") {
    for (const item of ticket.items) emitItem(b, item, layout);
  } else {
    for (const station of ticket.stations) {
      text(station.stationName);
      for (const item of station.items) emitItem(b, item, layout);
    }
  }

  return b.feedAndCut().bytes();
}
```

Replace `formatCorrectionSlip`'s signature and body with:

```ts
export function formatCorrectionSlip(slip: CorrectionSlip, layout: KitchenLayout): Uint8Array {
  const b = esc(layout.charset).init();
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s, layout.charset), layout.columns)) b.line(line);
  };

  b.line(`*** ${slip.kind} ***`);
  text(slip.stationName);
  if (slip.tableLabel !== null) text(slip.tableLabel);
  text(slip.orderNumber);
  b.line(hhmm(new Date(slip.at)));
  emitItem(b, slip.item, layout);

  return b.feedAndCut().bytes();
}
```

Run: `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 4: Write the failing grouping tests** — in `apps/server/src/kitchen-print.test.ts`: change `import { eq, sql } from "drizzle-orm";` to `import { and, eq, sql } from "drizzle-orm";`, change `import { enqueueKitchenTickets, reprintOrderTickets } from "./kitchen-print.js";` to `import { enqueueCorrectionSlips, enqueueKitchenTickets, reprintOrderTickets } from "./kitchen-print.js";`, change `import { decodeTicket } from "./testing/decode-ticket.js";` to `import { decodeTicket, printedLines } from "./testing/decode-ticket.js";`, and inside the `describe` that holds `"prints a per-station ticket and ONE consolidated ticket for a group printer (the R-D dedupe)"` (line 256) add (it uses the file's `setupVenue` (65), `asApp` (103), `printJobsFor` (111), `line`, `makeProduct` (129), `makePrinter` (152), `fireNewOrder` (171), `printCfg` (97), plus `createStation`, `attachPrinterToStation` and `updatePrinter`, all already imported):

```ts
  it("builds one kitchen ticket per distinct paper width and character set among the printers", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const ids = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const wide = await makePrinter(tx, cfg, "Cocina 80 A", "station");
      const wideTwin = await makePrinter(tx, cfg, "Cocina 80 B", "station");
      const narrow = await makePrinter(tx, cfg, "Cocina 58", "station");
      await updatePrinter(tx, printCfg(cfg), narrow, { paperWidth: "58mm" });
      const pass = await makePrinter(tx, cfg, "Pase 1252", "order");
      const passPc858 = await makePrinter(tx, cfg, "Pase 858", "order");
      await updatePrinter(tx, printCfg(cfg), passPc858, { characterSet: "pc858" });
      for (const printerId of [wide, wideTwin, narrow, pass, passPc858]) {
        await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
      }
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuletón de buey madurado a la brasa", {
        stationId: cocina.id,
      });
      await fireNewOrder(tx, cfg, [line(steak)]);
      return { wide, wideTwin, narrow, pass, passPc858, jobs: await printJobsFor(tx) };
    });
    const payloadOf = (printerId: string): Buffer => {
      const own = ids.jobs.filter((job) => job.printerId === printerId);
      expect(own).toHaveLength(1);
      return own[0]!.payload;
    };
    expect(payloadOf(ids.wideTwin).equals(payloadOf(ids.wide))).toBe(true);
    expect(payloadOf(ids.narrow).equals(payloadOf(ids.wide))).toBe(false);
    for (const printed of printedLines(new Uint8Array(payloadOf(ids.narrow)))) {
      expect(printed.length, printed).toBeLessThanOrEqual(30);
    }
    expect(
      printedLines(new Uint8Array(payloadOf(ids.wide))).some((l) =>
        l.endsWith("x Chuletón de buey madurado a la brasa"),
      ),
    ).toBe(true);
    expect(payloadOf(ids.passPc858).equals(payloadOf(ids.pass))).toBe(false);
    expect([...payloadOf(ids.passPc858).subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
  });

  it("builds a correction slip once per distinct layout among the line's printers", async () => {
    const { cfg, catalogueId } = await setupVenue();
    const result = await asApp(cfg, async (tx) => {
      const cocina = await createStation(tx, cfg, { name: "Cocina", isDefault: true });
      const wide = await makePrinter(tx, cfg, "Cocina 80", "station");
      const narrow = await makePrinter(tx, cfg, "Cocina 58", "order");
      await updatePrinter(tx, printCfg(cfg), narrow, { paperWidth: "58mm" });
      for (const printerId of [wide, narrow]) {
        await attachPrinterToStation(tx, printCfg(cfg), { stationId: cocina.id, printerId });
      }
      const steak = await makeProduct(tx, cfg, catalogueId, "Chuletón de buey madurado a la brasa", {
        stationId: cocina.id,
      });
      const orderId = await fireNewOrder(tx, cfg, [line(steak)]);
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .where(and(eq(ticketItems.tenantId, cfg.tenantId), eq(ticketItems.workingOrderId, orderId)));
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await enqueueCorrectionSlips(tx, cfg, orderId, fired, "VOID");
      const slips = (await printJobsFor(tx)).filter((job) => !before.has(job.id));
      return { wide, narrow, slips };
    });
    const slipFor = (printerId: string): Buffer => {
      const own = result.slips.filter((job) => job.printerId === printerId);
      expect(own).toHaveLength(1);
      return own[0]!.payload;
    };
    expect(slipFor(result.narrow).equals(slipFor(result.wide))).toBe(false);
    for (const printed of printedLines(new Uint8Array(slipFor(result.narrow)))) {
      expect(printed.length, printed).toBeLessThanOrEqual(30);
    }
  });
```

Also pass through the existing tests in this file unchanged.

- [ ] **Step 5: Run them and watch them fail**

Run: `pnpm --filter @waitron/server exec vitest run src/kitchen-print.test.ts`
Expected: FAIL — `formatKitchenTicket` is called without a layout (and the grouping does not exist).

- [ ] **Step 6: Rework `kitchen-print.ts`**

Imports: add `columnsFor`, `type CharacterSet` and `type PaperWidth` to the `@waitron/printing` import, and `type KitchenLayout` to the `./kitchen-ticket.js` import.

Replace `lockActivePrinters` with:

```ts
async function lockActivePrinters(
  tx: Transaction,
  tenantId: string,
  stationIds: string[],
): Promise<
  {
    stationId: string;
    printerId: string;
    ticketScope: "station" | "order";
    paperWidth: PaperWidth;
    characterSet: CharacterSet;
  }[]
> {
  return tx
    .select({
      stationId: stationPrinters.stationId,
      printerId: stationPrinters.printerId,
      ticketScope: printers.ticketScope,
      paperWidth: printers.paperWidth,
      characterSet: printers.characterSet,
    })
    .from(stationPrinters)
    .innerJoin(
      printers,
      and(
        eq(stationPrinters.printerId, printers.id),
        eq(stationPrinters.tenantId, printers.tenantId),
      ),
    )
    .where(
      and(
        eq(stationPrinters.tenantId, tenantId),
        inArray(stationPrinters.stationId, stationIds),
        eq(printers.active, true),
      ),
    )
    .for("share", { of: printers });
}
```

Add after it:

```ts
/** The settings that change a kitchen ticket's bytes. Resolution does not: kitchen paper has no QR. */
interface KitchenPrinterLayout {
  paperWidth: PaperWidth;
  characterSet: CharacterSet;
}

function layoutOf(printer: KitchenPrinterLayout): KitchenLayout {
  return { columns: columnsFor(printer.paperWidth), charset: printer.characterSet };
}

/** `printers` grouped by paper width and character set, in first-seen order: one ticket per group. */
function groupByLayout<T extends KitchenPrinterLayout>(printers: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const printer of printers) {
    const key = `${printer.paperWidth}|${printer.characterSet}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [printer]);
    else group.push(printer);
  }
  return [...groups.values()];
}
```

In `enqueueKitchenTickets`, replace everything from `const printersByStation = new Map<` to the end of the function with:

```ts
  interface AttachedPrinter extends KitchenPrinterLayout {
    printerId: string;
    ticketScope: "station" | "order";
  }
  const printersByStation = new Map<string, AttachedPrinter[]>();
  for (const mapping of mappingRows) {
    const bucket = printersByStation.get(mapping.stationId) ?? [];
    bucket.push({
      printerId: mapping.printerId,
      ticketScope: mapping.ticketScope,
      paperWidth: mapping.paperWidth,
      characterSet: mapping.characterSet,
    });
    printersByStation.set(mapping.stationId, bucket);
  }

  const printCfg: PrintConfig = { tenantId: cfg.tenantId, locationId: cfg.locationId };
  const firedAt = new Date();
  const tableLabel = order.tableLabel ?? "";
  const orderNumber = order.orderNumber;

  // Station-scope printers print their OWN station's items now, one ticket per distinct layout;
  // order-scope (group) printers are collected and deduped by id, then print ONE consolidated
  // whole-event ticket per distinct layout, below.
  const groupPrinters = new Map<string, AttachedPrinter>();
  for (const station of stations) {
    const attached = printersByStation.get(station.id) ?? [];
    for (const printer of attached) {
      if (printer.ticketScope === "order") groupPrinters.set(printer.printerId, printer);
    }
    const stationScope = attached.filter((printer) => printer.ticketScope === "station");
    for (const group of groupByLayout(stationScope)) {
      const stationTicket = formatKitchenTicket(
        {
          scope: "station",
          stationName: station.name,
          tableLabel,
          orderNumber,
          firedAt,
          items: station.items,
        },
        layoutOf(group[0]!),
      );
      for (const printer of group) {
        await enqueuePrintJob(tx, printCfg, printer.printerId, stationTicket);
      }
    }
  }

  for (const group of groupByLayout([...groupPrinters.values()])) {
    const consolidated = formatKitchenTicket(
      {
        scope: "order",
        tableLabel,
        orderNumber,
        firedAt,
        stations: stations.map(
          (station): KitchenTicketStation => ({
            stationName: station.name,
            items: station.items,
          }),
        ),
      },
      layoutOf(group[0]!),
    );
    for (const printer of group) {
      await enqueuePrintJob(tx, printCfg, printer.printerId, consolidated);
    }
  }
}
```

In `enqueueCorrectionSlips`, replace everything from `// Every ACTIVE printer attached to a station` to the end of the function with:

```ts
  // Every ACTIVE printer attached to a station, keyed by station id (station- and order-scope alike — a
  // correction slip has no consolidated variant, so scope does not branch here).
  const printersByStation = new Map<string, (KitchenPrinterLayout & { printerId: string })[]>();
  for (const mapping of mappingRows) {
    const bucket = printersByStation.get(mapping.stationId) ?? [];
    bucket.push({
      printerId: mapping.printerId,
      paperWidth: mapping.paperWidth,
      characterSet: mapping.characterSet,
    });
    printersByStation.set(mapping.stationId, bucket);
  }

  const printCfg: PrintConfig = { tenantId: cfg.tenantId, locationId: cfg.locationId };
  const at = new Date().toISOString();

  for (const target of items) {
    const attachedPrinters = printersByStation.get(target.stationId);
    // A line whose station has no active printer produced no paper — nothing to correct there.
    if (attachedPrinters === undefined) continue;
    const entry = itemsByLine.get(target.workingOrderLineId)!;
    // One slip's bytes per item and distinct layout, enqueued to each printer with that layout.
    for (const group of groupByLayout(attachedPrinters)) {
      const bytes = formatCorrectionSlip(
        {
          kind,
          stationName: stationNames.get(target.stationId)!,
          tableLabel: header.tableLabel,
          orderNumber: header.orderNumber,
          at,
          item: entry.item,
        },
        layoutOf(group[0]!),
      );
      for (const printer of group) {
        await enqueuePrintJob(tx, printCfg, printer.printerId, bytes);
      }
    }
  }
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/kitchen-ticket.test.ts src/kitchen-print.test.ts`
Expected: PASS. Building one ticket for all of a station's printers (the old shape) fails the `narrow` inequality.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/kitchen-ticket.ts apps/server/src/kitchen-ticket.test.ts apps/server/src/kitchen-print.ts apps/server/src/kitchen-print.test.ts
git commit -s -m "Wrap kitchen tickets and build them per printer layout"
```

---

### Task 16: The printer setup test page

**Files:**
- Create: `apps/server/src/test-page.ts`, `apps/server/src/test-page.test.ts`
- Modify: `apps/server/src/print-api.ts`, `apps/server/src/print-api.test.ts`, `apps/server/src/print-api.pg.test.ts`, `apps/server/src/print-agent-e2e.test.ts`, `apps/server/src/boot.ts`

**Interfaces produced:** `formatTestPage({ locale: SupportedLocale }): Uint8Array`; `PrintApiDeps.venueLocale: SupportedLocale`.

- [ ] **Step 1: Write the failing test** — create `apps/server/src/test-page.test.ts`:

```ts
import { encodeText } from "@waitron/printing";
import { describe, expect, it } from "vitest";
import { formatTestPage } from "./test-page.js";
import { bytesInclude, printedLines } from "./testing/decode-ticket.js";

/** Every GS v 0 image header in `bytes`: width in bytes per row and height in dots. */
function rasterHeaders(bytes: Uint8Array): { widthBytes: number; heightDots: number }[] {
  const headers: { widthBytes: number; heightDots: number }[] = [];
  for (let i = 0; i + 8 <= bytes.length; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0) {
      const widthBytes = bytes[i + 4]! + 256 * bytes[i + 5]!;
      const heightDots = bytes[i + 6]! + 256 * bytes[i + 7]!;
      headers.push({ widthBytes, heightDots });
      i += 7 + widthBytes * heightDots;
    }
  }
  return headers;
}

describe("formatTestPage", () => {
  it("prints width lines of exactly 30, 32, 42 and 48 characters ending in |", () => {
    const lines = printedLines(formatTestPage({ locale: "es-ES" }));
    for (const [label, length] of [
      ["A", 30],
      ["B", 32],
      ["C", 42],
      ["D", 48],
    ] as const) {
      const line = lines.find((l) => l.startsWith(`${label} -`));
      expect(line, label).toBe(`${label} ${"-".repeat(length - 3)}|`);
      expect(line).toHaveLength(length);
    }
  });

  it("wraps every caption to 30 columns", () => {
    for (const locale of ["es-ES", "en-GB"] as const) {
      const lines = printedLines(formatTestPage({ locale })).filter((l) => !/^[BCD] -/.test(l));
      for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(30);
    }
  });

  it("prints two QR samples: 45 squares at 5 dots and 53 squares at 6 dots, each within 360 dots", () => {
    const headers = rasterHeaders(formatTestPage({ locale: "es-ES" }));
    expect(headers).toEqual([
      { widthBytes: 34, heightDots: (45 + 8) * 5 },
      { widthBytes: 45, heightDots: (53 + 6) * 6 },
    ]);
    for (const { widthBytes } of headers) expect(widthBytes * 8).toBeLessThanOrEqual(360);
  });

  it("sends each sample line in its own character table, and each reads correctly", () => {
    const bytes = formatTestPage({ locale: "en-GB" });
    expect(
      bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 16, ...encodeText("1: Café", "wpc1252")])),
    ).toBe(true);
    expect(
      bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 19, ...encodeText("2: Café", "pc858")])),
    ).toBe(true);
    const lines = printedLines(bytes);
    expect(lines).toContain("1: Café jamón Ñ ¿¡ ç ü 5 €");
    expect(lines).toContain("2: Café jamón Ñ ¿¡ ç ü 5 €");
    expect(lines).toContain("3: Cafe jamon N ?! c u 5 EUR");
  });

  it("prints its captions in the venue language, as ASCII", () => {
    const es = printedLines(formatTestPage({ locale: "es-ES" })).join(" ");
    const en = printedLines(formatTestPage({ locale: "en-GB" })).join(" ");
    expect(es).toContain("Cual es la linea mas larga");
    expect(es).not.toContain("Which");
    expect(en).toContain("Which is the longest line");
    expect(en).not.toContain("Cual");
    const bytes = formatTestPage({ locale: "es-ES" });
    const beforeFirstImage = bytes.subarray(0, bytes.indexOf(0x1d));
    expect([...beforeFirstImage].every((b) => b < 0x80)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/test-page.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/server/src/test-page.ts`:**

```ts
import { esc, withQuietZone, wrapText } from "@waitron/printing";
import type { SupportedLocale } from "@waitron/shared";
import { qrModules } from "./qr-matrix.js";

/**
 * The printer setup test page (design 2026-09-14, "The test page"). It is the same for every printer
 * and depends only on the venue language. Captions are plain ASCII so they read correctly before a
 * character set is chosen, and wrap at 30 columns, the narrowest paper. Images fit in 360 dots.
 */
interface Captions {
  widthQuestion: string;
  qrQuestion: string;
  qrForAC: string;
  qrForBD: string;
  charsetQuestion: string;
}

const CAPTIONS: Readonly<Record<SupportedLocale, Captions>> = {
  "es-ES": {
    widthQuestion: "Cual es la linea mas larga cuyo | queda en la misma fila?",
    qrQuestion: "Mida el codigo QR de su linea. Debe medir entre 30 y 40 mm.",
    qrForAC: "Para A o C:",
    qrForBD: "Para B o D:",
    charsetQuestion: "Elija la primera linea que se lea bien. La linea 3 siempre se lee bien.",
  },
  "en-GB": {
    widthQuestion: "Which is the longest line whose | is on the same row?",
    qrQuestion: "Measure the QR code for your line. It must be between 30 and 40 mm.",
    qrForAC: "For A or C:",
    qrForBD: "For B or D:",
    charsetQuestion: "Choose the first line that reads correctly. Line 3 always does.",
  },
};

/** The narrowest paper's column count: every caption fits it. */
const CAPTION_COLUMNS = 30;
/** Fixed sample content, not a tax-agency link, so scanning a sample submits nothing. */
const SAMPLE_QR_TEXT = "Waitron 30-40 mm";
const SAMPLE_LINE = "Café jamón Ñ ¿¡ ç ü 5 €";

/** `label`, a space, dashes, and `|` as the last of exactly `length` characters. */
function widthLine(label: string, length: number): string {
  return `${label} ${"-".repeat(length - 3)}|`;
}

export function formatTestPage({ locale }: { locale: SupportedLocale }): Uint8Array {
  const c = CAPTIONS[locale];
  const b = esc("plain").init();
  const caption = (text: string): void => {
    for (const line of wrapText(text, CAPTION_COLUMNS)) b.line(line);
  };

  caption(c.widthQuestion);
  for (const [label, length] of [
    ["A", 30],
    ["B", 32],
    ["C", 42],
    ["D", 48],
  ] as const) {
    b.line(widthLine(label, length));
  }
  b.line();

  caption(c.qrQuestion);
  // 45 squares at 5 dots: 31.8 mm at 180 dpi. With its full border it is 265 dots wide.
  caption(c.qrForAC);
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 7 }), 4), { moduleSize: 5 }).line();
  // 53 squares at 6 dots: 39.8 mm at 203 dpi. A 3-square border keeps it at 354 dots, within 360.
  caption(c.qrForBD);
  b.qrRaster(withQuietZone(qrModules(SAMPLE_QR_TEXT, { version: 9 }), 3), { moduleSize: 6 }).line();
  b.line();

  caption(c.charsetQuestion);
  b.charset("wpc1252").line(`1: ${SAMPLE_LINE}`);
  b.charset("pc858").line(`2: ${SAMPLE_LINE}`);
  b.charset("plain").line(`3: ${SAMPLE_LINE}`);

  return b.feedAndCut().bytes();
}
```

The "For B or D" sample uses a 3-square border (354 dots, packed into 45 bytes = 360 dots) instead of the spec's 21-dot trim, because the builder pads whole squares (ruling recorded in the ledger).

Run: `pnpm --filter @waitron/server exec vitest run src/test-page.test.ts`
Expected: PASS (5 tests). Wrapping captions at 42, sending line 2 through table 16, always printing Spanish, or a 4-square border on the B/D sample each fail one test.

- [ ] **Step 4: Write the failing route test** — in `apps/server/src/print-api.test.ts`:

- add `printJobs` to the `@waitron/db` import (line 5), `type SupportedLocale` to the `@waitron/shared` import (line 11-17), and `import { formatTestPage } from "./test-page.js";`;
- change `mountApp` (line 113) to accept and pass a venue locale:

```ts
function mountApp(
  opts: {
    pairingOpen?: boolean;
    enrolRateLimiter?: EnrolRateLimiter;
    venueLocale?: SupportedLocale;
  } = {},
): Hono {
  const app = new Hono();
  const pairingMode = createPairingMode();
  if (opts.pairingOpen ?? true) pairingMode.open();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg,
      pairingMode,
      readMembership: async () => MEMBERSHIP,
      enrolRateLimiter: opts.enrolRateLimiter,
      venueLocale: opts.venueLocale ?? "es-ES",
    },
    noopLog,
  );
  return app;
}
```

- inside `describe("mountPrintApi — management: test-print", …)` (line 1242) add:

```ts
  it.each(["es-ES", "en-GB"] as const)(
    "queues the setup test page in the venue language (%s)",
    async (venueLocale) => {
      const app = mountApp({ venueLocale });
      const printerId = await createNetworkPrinter(app, "10.0.0.41", 9100, `Prueba ${venueLocale}`);
      const res = await send(app, "POST", `/management-api/printers/${printerId}/test-print`, {
        cookie: managerCookie,
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: string };
      const [job] = await suite.db
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.id, jobId));
      expect([...new Uint8Array(job!.payload)]).toEqual([...formatTestPage({ locale: venueLocale })]);
    },
  );
```

Add `venueLocale: "es-ES"` to the other mounts of `mountPrintApi`, which otherwise fail typecheck: `apps/server/src/print-api.pg.test.ts:131` and `apps/server/src/print-agent-e2e.test.ts:167` and `:256`.

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts -t "setup test page"`
Expected: FAIL — the route enqueues the two-line `TEST_PRINT_PAYLOAD`.

- [ ] **Step 6: Build it in the route** — in `apps/server/src/print-api.ts`:

- add `import type { SupportedLocale } from "@waitron/shared";` (beside the `AppError` import) and `import { formatTestPage } from "./test-page.js";`;
- add to `PrintApiDeps`:

```ts
  /** The venue's default language (`readVenueLocale`, resolved once at boot): the test page's captions. */
  venueLocale: SupportedLocale;
```

- delete `TEST_PRINT_PAYLOAD` and its comment, and remove `esc` from the `@waitron/printing` import (nothing else in the file uses it);
- in `POST /management-api/printers/:id/test-print`, replace `enqueuePrintJob(tx, deps.cfg, id, TEST_PRINT_PAYLOAD)` with `enqueuePrintJob(tx, deps.cfg, id, formatTestPage({ locale: deps.venueLocale }))`, and in the comment above it replace "enqueue ONE known ESC/POS payload" with "enqueue the setup test page (`test-page.ts`)".

In `apps/server/src/boot.ts` (line 1936), change the mount's deps to `{ db, cfg: till, readMembership: () => readNodeMembership(db), pairingMode, venueLocale }` (`venueLocale` is resolved at line 1781 in the same function).

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/test-page.test.ts src/print-api.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/test-page.ts apps/server/src/test-page.test.ts apps/server/src/print-api.ts apps/server/src/print-api.test.ts apps/server/src/print-api.pg.test.ts apps/server/src/print-agent-e2e.test.ts apps/server/src/boot.ts
git commit -s -m "Print a setup test page in the venue language"
```

---

### Task 17: The preview route reports the printer's column count and resolution

**Files:**
- Modify: `apps/server/src/print-api.ts`, `apps/server/src/print-api.test.ts`

- [ ] **Step 1: Write the failing test** — in `apps/server/src/print-api.test.ts`, inside `describe("mountPrintApi — management: recent jobs", …)` (line 1280), add (it uses `enqueue` (252), `createNetworkPrinter` (207), `send`, `managerCookie`, and `esc`, already imported):

```ts
  it("previews a job at its printer's current columns and resolution, through its character table", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Vista 58",
        transport: "network_tcp",
        host: "10.0.0.42",
        paperWidth: "58mm",
        resolution: "203dpi",
      },
    });
    const { id: narrow } = (await created.json()) as { id: string };
    const narrowJob = await enqueue(narrow, esc("pc858").init().line("Café 12,50 €").bytes());
    const narrowPreview = await send(app, "GET", `/management-api/print-jobs/${narrowJob}/preview`, {
      cookie: managerCookie,
    });
    expect(narrowPreview.status).toBe(200);
    expect(await narrowPreview.json()).toMatchObject({
      columns: 30,
      dpi: 203,
      text: "Café 12,50 €\n",
      unsupported: false,
      truncated: false,
    });
    const wide = await createNetworkPrinter(app, "10.0.0.43", 9100, "Vista 80");
    const wideJob = await enqueue(wide, esc().init().line("x").bytes());
    const widePreview = await send(app, "GET", `/management-api/print-jobs/${wideJob}/preview`, {
      cookie: managerCookie,
    });
    expect(await widePreview.json()).toMatchObject({ columns: 42, dpi: 180 });
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts -t "current columns"`
Expected: FAIL — the narrow job previews at the default 42 columns and 180 dpi.

- [ ] **Step 3: Read the printer with the job** — in `print-api.ts`, add `columnsFor` and `dpiValue` to the `@waitron/printing` import and replace the preview route's query and response with:

```ts
      const [job] = await gated(sessionId, (tx) =>
        tx
          .select({
            payload: printJobs.payload,
            paperWidth: printers.paperWidth,
            resolution: printers.resolution,
          })
          .from(printJobs)
          .innerJoin(
            printers,
            and(eq(printers.tenantId, printJobs.tenantId), eq(printers.id, printJobs.printerId)),
          )
          .where(and(eq(printJobs.tenantId, deps.cfg.tenantId), eq(printJobs.id, id))),
      );
      if (job === undefined) throw new AppError("print_job.not_found", { id });
      // The printer's CURRENT settings: a job built for 42 columns previews as it would print now.
      return c.json(
        previewPrintJob(job.payload, {
          columns: columnsFor(job.paperWidth),
          dpi: dpiValue(job.resolution),
        }),
      );
```

`print_jobs.printer_id` is `NOT NULL` with a tenant-consistent foreign key to `printers` (`packages/db/src/schema/print-jobs.ts:56`), so the inner join loses no job; the job read keeps its own tenant predicate and the join matches on tenant as well as id.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @waitron/server exec vitest run src/print-api.test.ts`
Expected: PASS, including the existing `"returns a tenant-scoped preview only to printer managers"`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/print-api.ts apps/server/src/print-api.test.ts
git commit -s -m "Preview print jobs at their printer's current width and resolution"
```

---

### Task 18: The preview widget renders at the printer's column count

**Files:**
- Modify: `apps/dashboard/src/widgets/print-job-preview.ts`, `apps/dashboard/src/widgets/print-job-preview.test.ts`, `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/screens/printers-screen.test.ts`

The QR's text readout disappears from the preview for new receipts: `qrData` is filled only by the built-in QR command, and receipts now print a raster image. The image still renders and a phone can scan it from the screen (ruling C; Task 21 records a follow-up).

- [ ] **Step 1: Write the failing test** — in `apps/dashboard/src/widgets/print-job-preview.test.ts`:

- add `columns: 42,` and `dpi: 180,` to the `preview` constant;
- delete the test `"changes the paper approximation without changing stored job content"` (the 58/80 switch it exercises is removed by the spec);
- append:

```ts
it("sizes the paper's text area to the printer's columns and images in the same character units", async () => {
  const { el } = await mountWidget<PrintJobPreviewDialog>("dashboard-print-job-preview", {
    open: true,
    preview: {
      ...preview,
      columns: 30,
      qrData: [],
      blocks: [
        { kind: "text", text: "x".repeat(30) },
        { kind: "text", text: "y".repeat(31) },
        // 180 dots = 15 printed columns at 12 dots per column: half the paper.
        { kind: "image", width: 180, height: 2, data: btoa("\0".repeat(23 * 2)) },
      ],
    },
  });
  await el.shadowRoot!.querySelector<WtModal>("wt-modal")!.updateComplete;
  const paper = el.shadowRoot!.querySelector<HTMLElement>(".paper")!;
  const [fits, spills] = [...paper.querySelectorAll("pre")];
  const lineHeight = parseFloat(getComputedStyle(fits!).lineHeight);
  expect(fits!.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
  expect(spills!.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 1.5);
  const probe = document.createElement("span");
  probe.style.whiteSpace = "pre";
  probe.textContent = "0".repeat(30);
  paper.append(probe);
  const contentWidth = parseFloat(getComputedStyle(paper).width);
  expect(Math.abs(contentWidth - probe.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  probe.remove();
  const img = paper.querySelector("img")!;
  expect(Math.abs(img.getBoundingClientRect().width - contentWidth / 2)).toBeLessThanOrEqual(1);
  expect(el.shadowRoot!.querySelector("select")).toBeNull();
});
```

In `apps/dashboard/src/screens/printers-screen.test.ts`, add `columns: 42,` and `dpi: 180,` to the `getPrintJobPreview` stub's resolved object (line 198).

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/print-job-preview.test.ts`
Expected: FAIL — the paper is 80mm wide and the select is still there.

- [ ] **Step 3: Implement**

In `apps/dashboard/src/api/client.ts`, add to `PrintJobPreview` (line 1253), before `text`:

```ts
  /** The printer's current column count and resolution. */
  columns: number;
  dpi: number;
```

In `apps/dashboard/src/widgets/print-job-preview.ts`:

- change the imports to `import { customElement, property } from "lit/decorators.js";` and `import { baseStyles } from "@waitron/ui";`, and remove `selectStyles` from `static override styles`;
- in the `.paper` rule, replace `box-sizing: border-box;` and `width: 80mm;` with `box-sizing: content-box;` (the inline width set below is the text area; the 4mm padding sits outside it);
- delete the `.paper[data-width="58"]` rule and the `.paper-field` rule;
- delete `@state() private paperWidth = "80";`;
- in the `image` case of `#renderBlock`, replace `style=${`width:${block.width / 8}mm`}` with:

```ts
          style=${`width:${block.width / 12}ch`}
```

(12 dots per printed column, so an image keeps its size relative to the text: `DOTS_PER_COLUMN` in `packages/printing/src/layout.ts`.)
- delete the `<label class="paper-field">…</label>` block;
- replace `<div class="paper" data-width=${this.paperWidth}>` with:

```ts
                        <div class="paper" style=${`width:${preview.columns}ch`}>
```

In `apps/dashboard/src/i18n/strings.ts`, delete the now-unused `"printers.preview_paper_width"` entries from `en` (line 209) and `es` (line 1402).

- [ ] **Step 4: Run the tests (both themes, a11y included)**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/print-job-preview.test.ts src/screens/printers-screen.test.ts`
Expected: PASS, including the existing `"renders ordered paper blocks and actual bitmap pixels in %s mode"` a11y cases. Keeping `border-box` makes the 30-character line wrap and fails the new test; sizing the image in mm fails its width check.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/widgets/print-job-preview.ts apps/dashboard/src/widgets/print-job-preview.test.ts apps/dashboard/src/api/client.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/printers-screen.test.ts
git commit -s -m "Render the print preview at the printer's column count"
```

---

### Task 19: The Edit-printer dialog exposes the three settings

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/screens/printers-screen.ts`, `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/screens/printers-screen.test.ts`, and the `Printer` fixtures listed in Step 1

**Ruling I:** the dialog's text follows the dashboard's own i18n (`t()`), not the venue locale. This departs from the spec's "the dialog's text use the venue's default language"; the controller records it and tells the owner. Spanish strings carry proper accents.

- [ ] **Step 1: Update the fixtures and write the failing test**

Every typed `Printer` fixture gains the three settings (the type makes them required). After each `ticketScope: "station",` line listed here, add `paperWidth: "80mm",`, `resolution: "180dpi",` and `characterSet: "wpc1252",`:

- `apps/dashboard/src/screens/printers-screen.test.ts`: lines 52, 65, 78, 1644, 1681;
- `apps/dashboard/src/screens/printers-screen.a11y.test.ts`: lines 47, 73;
- `apps/dashboard/src/screens/printing-rules-screen.test.ts`: lines 26, 39;
- `apps/dashboard/src/screens/devices-screen.test.ts`: line 143;
- `apps/dashboard/src/screens/devices-screen.a11y.test.ts`: line 121.

(`apps/dashboard/src/api/client.test.ts:2320` is an untyped response body; leave it.)

In `apps/dashboard/src/screens/printers-screen.test.ts`, after `toggleSwitch` (line 283) add the helper:

```ts
/** Choose `value` in the native select named `name` and let the screen re-render. */
async function chooseOption(el: PrintersScreen, name: string, value: string): Promise<void> {
  const select = q(el, `select[name="${name}"]`) as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
  await flush(el);
}
```

and append (it uses `stubApi` (191), `mountWidget`, `flush` (234), `q` (252) and `openPrinter` (264)):

```ts
describe("printer layout settings", () => {
  it("saves a changed paper width, resolution and character set with the connection fields", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    expect((q(el, 'select[name="printer-paper-width"]') as HTMLSelectElement).value).toBe("80mm");
    await chooseOption(el, "printer-paper-width", "58mm");
    await chooseOption(el, "printer-resolution", "203dpi");
    await chooseOption(el, "printer-character-set", "pc858");
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina",
      host: "10.0.0.9",
      port: 9100,
      active: true,
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
    });
  });
});
```

The existing exact-match save tests (`"saves an edited network_tcp printer's host+port …"` at line 1605 and its siblings at 1661, 1714, 1989) keep passing only if an unchanged setting is NOT sent; that is what guards the "send only what changed" rule.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "printer layout settings"`
Expected: FAIL — no `printer-paper-width` select.

- [ ] **Step 3: Implement**

In `apps/dashboard/src/api/client.ts`, after `export type PrintTicketScope = "station" | "order";` (line 1139):

```ts
/** A printer's layout settings — mirrors `@waitron/printing`'s `PaperWidth`, `Resolution`, `CharacterSet`. */
export type PrintPaperWidth = "58mm" | "80mm";
export type PrintResolution = "180dpi" | "203dpi";
export type PrintCharacterSet = "wpc1252" | "pc858" | "plain";
```

Add to `Printer` (after `ticketScope`):

```ts
  paperWidth: PrintPaperWidth;
  resolution: PrintResolution;
  characterSet: PrintCharacterSet;
```

and to both `PrinterInput` (after `pollId?`) and `PrinterPatch` (after `ticketScope?`):

```ts
  paperWidth?: PrintPaperWidth;
  resolution?: PrintResolution;
  characterSet?: PrintCharacterSet;
```

In `apps/dashboard/src/screens/printers-screen.ts`:

- add `PrintCharacterSet`, `PrintPaperWidth` and `PrintResolution` to the `../api/client.js` type import;
- add to `EditablePrinter`:

```ts
  paperWidth: PrintPaperWidth;
  resolution: PrintResolution;
  characterSet: PrintCharacterSet;
  /** The settings as saved, so a save sends only the ones that changed. */
  saved: { paperWidth: PrintPaperWidth; resolution: PrintResolution; characterSet: PrintCharacterSet };
```

- add to the `.form-fields` rule's neighbours in `static override styles`:

```css
      .setting-field {
        display: grid;
        gap: var(--wt-space-1);
      }
```

- in `#openPrinter`, add to the `editingPrinter` literal:

```ts
      paperWidth: p.paperWidth,
      resolution: p.resolution,
      characterSet: p.characterSet,
      saved: { paperWidth: p.paperWidth, resolution: p.resolution, characterSet: p.characterSet },
```

- in `#savePrinter`, after the transport `if … else` block and before `await this.#submit(`:

```ts
    if (row.paperWidth !== row.saved.paperWidth) patch.paperWidth = row.paperWidth;
    if (row.resolution !== row.saved.resolution) patch.resolution = row.resolution;
    if (row.characterSet !== row.saved.characterSet) patch.characterSet = row.characterSet;
```

- in `#renderEditPrinter`, directly after the `<wt-switch name="printer-active" …></wt-switch>` element and inside `.form-fields`:

```ts
        <label class="setting-field"
          >${t("printers.paper_width")}
          <select
            name="printer-paper-width"
            .value=${p.paperWidth}
            @change=${(e: Event) =>
              this.#editPrinter(p.id, {
                paperWidth: (e.target as HTMLSelectElement).value as PrintPaperWidth,
              })}
          >
            <option value="80mm">${t("printers.paper_width_80")}</option>
            <option value="58mm">${t("printers.paper_width_58")}</option>
          </select>
        </label>
        <label class="setting-field"
          >${t("printers.resolution")}
          <select
            name="printer-resolution"
            .value=${p.resolution}
            @change=${(e: Event) =>
              this.#editPrinter(p.id, {
                resolution: (e.target as HTMLSelectElement).value as PrintResolution,
              })}
          >
            <option value="180dpi">${t("printers.resolution_180")}</option>
            <option value="203dpi">${t("printers.resolution_203")}</option>
          </select>
        </label>
        <label class="setting-field"
          >${t("printers.character_set")}
          <select
            name="printer-character-set"
            .value=${p.characterSet}
            @change=${(e: Event) =>
              this.#editPrinter(p.id, {
                characterSet: (e.target as HTMLSelectElement).value as PrintCharacterSet,
              })}
          >
            <option value="wpc1252">${t("printers.character_set_wpc1252")}</option>
            <option value="pc858">${t("printers.character_set_pc858")}</option>
            <option value="plain">${t("printers.character_set_plain")}</option>
          </select>
        </label>
```

In `apps/dashboard/src/i18n/strings.ts`, add to `en` (beside `"printers.active"`, line 625):

```ts
  "printers.paper_width": "Paper width",
  "printers.paper_width_58": "58 mm",
  "printers.paper_width_80": "80 mm",
  "printers.resolution": "Print resolution",
  "printers.resolution_180": "180 dpi",
  "printers.resolution_203": "203 dpi",
  "printers.character_set": "Character set",
  "printers.character_set_wpc1252": "Windows Latin (WPC1252)",
  "printers.character_set_pc858": "Multilingual with euro (PC858)",
  "printers.character_set_plain": "Plain letters, no accents",
```

and to `es` (beside `"printers.active"`, line 1789):

```ts
  "printers.paper_width": "Ancho del papel",
  "printers.paper_width_58": "58 mm",
  "printers.paper_width_80": "80 mm",
  "printers.resolution": "Resolución de impresión",
  "printers.resolution_180": "180 ppp",
  "printers.resolution_203": "203 ppp",
  "printers.character_set": "Juego de caracteres",
  "printers.character_set_wpc1252": "Windows latino (WPC1252)",
  "printers.character_set_pc858": "Multilingüe con euro (PC858)",
  "printers.character_set_plain": "Letras sin acentos",
```

The selects are not required fields (each always holds a value), so the form-error rules in `docs/developers/design-system.md` → Forms add nothing here; each has a semantic `name` and a visible label.

- [ ] **Step 4: Run the tests (both themes, a11y included)**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts src/screens/printers-screen.a11y.test.ts src/screens/printing-rules-screen.test.ts src/screens/devices-screen.test.ts src/screens/devices-screen.a11y.test.ts`
Expected: PASS, including `"renders printer editing accessibly"` in both themes, which now scans the three labelled selects.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/api/client.ts apps/dashboard/src/screens/printers-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/printers-screen.test.ts apps/dashboard/src/screens/printers-screen.a11y.test.ts apps/dashboard/src/screens/printing-rules-screen.test.ts apps/dashboard/src/screens/devices-screen.test.ts apps/dashboard/src/screens/devices-screen.a11y.test.ts
git commit -s -m "Add paper width, resolution and character set to the printer dialog"
```

---

### Task 20: The test-page questions in the dialog

**Files:**
- Modify: `apps/dashboard/src/screens/printers-screen.ts`, `apps/dashboard/src/i18n/strings.ts`, `apps/dashboard/src/screens/printers-screen.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe("printer layout settings", …)` in `printers-screen.test.ts`:

```ts
  it("prints the test page and turns the two answers into settings", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PrintersScreen>("dashboard-printers-screen", { api });
    await flush(el);
    await openPrinter(el, "p1");
    expect(q(el, "[data-test=test-page-hint-p1]")?.textContent?.trim()).toBe(
      t("printers.test_page_hint"),
    );
    q(el, "[data-test=print-test-page-p1]")!.click();
    await flush(el);
    expect(api.testPrint).toHaveBeenCalledWith("p1");
    const value = (name: string) => (q(el, `select[name="${name}"]`) as HTMLSelectElement).value;
    expect(value("printer-test-line-fits")).toBe("");
    await chooseOption(el, "printer-test-line-fits", "B");
    expect([value("printer-paper-width"), value("printer-resolution")]).toEqual(["58mm", "203dpi"]);
    await chooseOption(el, "printer-test-line-reads", "3");
    expect(value("printer-character-set")).toBe("plain");
    await chooseOption(el, "printer-test-line-fits", "D");
    q(el, "[data-test=save-printer-p1]")!.click();
    await flush(el);
    expect(api.updatePrinter).toHaveBeenCalledWith("p1", {
      name: "Cocina",
      host: "10.0.0.9",
      port: 9100,
      active: true,
      resolution: "203dpi",
      characterSet: "plain",
    });
  });
```

(The final answer D is 80mm, which is p1's saved width, so only resolution and character set are sent.)

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t "test page"`
Expected: FAIL — no hint, button or question selects.

- [ ] **Step 3: Implement** — in `printers-screen.ts`, above the class:

```ts
/** "Which is the longest line that fits?" — each answer names a paper width and resolution (spec table). */
const LINE_FITS: Readonly<
  Record<string, { paperWidth: PrintPaperWidth; resolution: PrintResolution }>
> = {
  A: { paperWidth: "58mm", resolution: "180dpi" },
  B: { paperWidth: "58mm", resolution: "203dpi" },
  C: { paperWidth: "80mm", resolution: "180dpi" },
  D: { paperWidth: "80mm", resolution: "203dpi" },
};
/** "Which is the first line that reads correctly?" — line 1 is table 16, line 2 table 19, line 3 plain. */
const LINE_READS: Readonly<Record<string, PrintCharacterSet>> = {
  "1": "wpc1252",
  "2": "pc858",
  "3": "plain",
};
```

and in `#renderEditPrinter`, directly after the character-set `<label>` from Task 19:

```ts
        <p class="hint" data-test=${`test-page-hint-${p.id}`}>${t("printers.test_page_hint")}</p>
        <wt-button data-test=${`print-test-page-${p.id}`} @click=${() => void this.#testPrint(p.id)}
          >${t("printers.test_page")}</wt-button
        >
        <label class="setting-field"
          >${t("printers.test_line_fits")}
          <select
            name="printer-test-line-fits"
            @change=${(e: Event) => {
              const answer = LINE_FITS[(e.target as HTMLSelectElement).value];
              if (answer !== undefined) this.#editPrinter(p.id, answer);
            }}
          >
            <option value="">${t("printers.test_answer_choose")}</option>
            ${["A", "B", "C", "D"].map((letter) => html`<option value=${letter}>${letter}</option>`)}
          </select>
        </label>
        <label class="setting-field"
          >${t("printers.test_line_reads")}
          <select
            name="printer-test-line-reads"
            @change=${(e: Event) => {
              const answer = LINE_READS[(e.target as HTMLSelectElement).value];
              if (answer !== undefined) this.#editPrinter(p.id, { characterSet: answer });
            }}
          >
            <option value="">${t("printers.test_answer_choose")}</option>
            ${["1", "2", "3"].map((line) => html`<option value=${line}>${line}</option>`)}
          </select>
        </label>
```

The blank first option is what lets "A" or "1" be chosen with a `change` event. `#testPrint` (line 827) enqueues through the existing `api.testPrint`; the page needs no unsaved settings, because it does not depend on them.

Add to `strings.ts` `en`:

```ts
  "printers.test_page": "Print test page",
  "printers.test_page_hint": "Not sure? Print the test page and answer the questions below.",
  "printers.test_line_fits": "Which is the longest line whose | is on the same row?",
  "printers.test_line_reads": "Which is the first line that reads correctly?",
  "printers.test_answer_choose": "Choose an answer",
```

and `es`:

```ts
  "printers.test_page": "Imprimir página de prueba",
  "printers.test_page_hint":
    "¿No está seguro? Imprima la página de prueba y responda a las preguntas de abajo.",
  "printers.test_line_fits": "¿Cuál es la línea más larga cuyo | queda en la misma fila?",
  "printers.test_line_reads": "¿Cuál es la primera línea que se lee correctamente?",
  "printers.test_answer_choose": "Elija una respuesta",
```

- [ ] **Step 4: Run the tests (both themes, a11y included)**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts src/screens/printers-screen.a11y.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/screens/printers-screen.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/printers-screen.test.ts
git commit -s -m "Add the test-page print button and its questions to the printer dialog"
```

---

### Task 21: Documentation and stale-comment cleanup

**Files:**
- Modify: `packages/printing/src/escpos.ts`, `docs/backlog.md`, `docs/developers/conventions-ui.md`

- [ ] **Step 1: Correct the builder's comments** — in `packages/printing/src/escpos.ts`:

- replace the `QR_DEFAULT_MODULE_SIZE` doc comment (it assumes "~203 dpi (≈ 8 dots/mm)") with:

```ts
/**
 * Default dots per QR square for the built-in `qr()` command and `qrRaster()`. The receipt no longer
 * uses either default: its QR is a raster whose dot size `layout.ts` `chooseQrDots` picks from the
 * printer's configured resolution (180 or 203 dpi) for the legal 30-40 mm.
 */
```

- in the `qrRaster` doc comment, replace the sentence "Not wired to a consumer in this slice; `formatReceipt` uses the native {@link qr}." with "The receipt and the setup test page print their QR codes through it (design 2026-09-14); the matrix comes from `apps/server`'s `qrModules`."

Then confirm no stale claim survives: `grep -n "failover/hardware pass\|~203 dpi\|RECEIPT_WIDTH\|twoColumn" apps/server/src packages/printing/src -r` prints nothing.

- [ ] **Step 2: Add the backlog entry** — in `docs/backlog.md`, under the printing section, add an entry recording:

- the three printer settings, the per-printer layout, the raster receipt QR and the setup test page landed (this design and plan);
- on-paper verification is still owed on the TM-T88III (spec "Verification on paper" steps 1-6), including whether the built-in QR command prints anything and whether the 30-40 mm rule counts the QR's blank border;
- 58 mm layout is checkable only through the preview until a 58 mm printer is available;
- follow-up (ruling C): the preview no longer shows the QR link as text for raster receipts; a possible fix is to carry the link beside the job so the preview can show it;
- deferral (ruling H): the receipt does not log a warning when no legal QR dot size exists — no logger is reachable in `receipt-print.ts`; the fallback is unreachable for links `validate.ts` accepts (`apps/server/src/qr-link-range.test.ts`);
- the Edit-printer dialog follows the dashboard language, not the venue language (ruling I, a departure from the spec).

- [ ] **Step 3: Add the conventions section** — in `docs/developers/conventions-ui.md`, add a section "Printed documents" pointing at `docs/superpowers/specs/2026-09-14-printer-paper-resolution-and-character-set-design.md`: a printed document takes the printer's layout settings (paper width, resolution, character set) and never hard-codes a width, a QR size or a text encoding; text goes through `prepareText` before it is measured and through `wrapText`/`labelAmountLines` before it is printed; the fiscal QR is a raster sized by `chooseQrDots`; tests read printed text with `printedLines` (`apps/server/src/testing/decode-ticket.ts`), which fails on an unsupported byte instead of hiding the rest of the ticket.

- [ ] **Step 4: Run the pointer guard**

```bash
pnpm vitest run scripts/claude-md-pointers.test.ts
```

Expected: PASS. (No Prettier step: `docs/` is in `.prettierignore`, so `prettier --check` on these files reports success without checking them — checked while revising.)

- [ ] **Step 5: Commit**

```bash
git add packages/printing/src/escpos.ts docs/backlog.md docs/developers/conventions-ui.md
git commit -s -m "Document printer layout settings and clear the stale dpi comments"
```

---

## Self-Review

**Spec coverage.**
- Settings, defaults and grants: Task 7. API and config transfer: Tasks 8–9 (the transfer test is proven by a temporary `omit` edit because the code already copies every column).
- Layout mapping, wrapping with a caller-chosen indent, label-with-amount: Task 3. The "€ counts as three in plain letters" rule: Tasks 2, 12, 14.
- QR as a raster at level M, per-receipt dot size, blank border, no throw: Tasks 4, 10, 13. The spec's "every grid size a valid link can produce" test: Task 4's 37–77 sweep plus Task 10's `qr-link-range.test.ts` (41–73 through `buildAltaRecord` + `validate`). The spec's "decodes back to the sale's link with the qrcode library" is replaced by the reconstruction check plus the independent format-information reader (ruling D); `qrcode` cannot decode.
- Character sets, fallbacks and the € space fix: Tasks 1, 2, 5, 10, 14.
- Receipt, payment slip, kitchen ticket, correction slip: Tasks 12–15. Test page and the row's Test print button: Task 16. Preview decoder, route and widget: Tasks 11, 17, 18. Dialog and questions: Tasks 19–20. Documentation: Task 21.
- Recorded departures: the dialog follows the dashboard language (ruling I); the missing-dot-size warning is deferred (ruling H); the preview's QR text readout is dropped (ruling C); the B/D sample border is 3 squares, not a 21-dot trim.

**Placeholder scan.** Every code block is complete. The only generated artefact is the migration SQL (Task 7), whose expected content is stated.

**Type consistency.** `CharacterSet`, `PaperWidth` and `Resolution` are defined once in `@waitron/printing`; the database enum props (`paperWidth`, `resolution`, `characterSet`) match the API fields and the dashboard's mirror types (`PrintPaperWidth`, `PrintResolution`, `PrintCharacterSet`). `formatReceipt` takes `printer: ReceiptPrinterSettings`; `formatPaymentSlip` takes `printer: { paperWidth; characterSet }`; the kitchen formatters take `KitchenLayout { columns; charset }`; `previewPrintJob` takes `{ columns; dpi }`; `chooseQrDots` takes a numeric dpi (`dpiValue`).

**Review findings addressed** (fresh-context review, 2026-09-14): leading-space indents and over-long continuation lines (Task 3); the preview decoder stopping at 0x80–0x9F (Task 11); the pointer guard that never ran (Task 21 runs it directly); the vacuous caption-language test (Task 16); raster header widths in bytes (Tasks 13, 16); existing receipt calls without a printer and the pc858 completeness read (Task 12); item indent under the name (Tasks 3, 12); `buildReceiptBytes` receiving the printer (Task 12); the `@waitron/db` enum exports (Task 7); every `mountPrintApi` mount (Task 16); the preview `toEqual` tests (Task 11); preview width units (Task 18); the QR text readout (Task 18, ruling C); code page 858 pins (Task 1); a 203-dpi receipt case (Task 13); the real test helpers and fixtures (Tasks 8, 9, 12–20).

---

## Verified while revising

The pure code and the formatter tests in this plan were copied into a scratch directory (`/private/tmp/claude-503/review-printer/rev`, with `apps/server/node_modules` linked and `@waitron/printing` aliased to the scratch copies) and run:

```
./node_modules/.bin/vitest run
 Test Files  13 passed (13)
      Tests  182 passed (182)
```

Files run: `charset.test.ts` (12), `layout.test.ts` (23), `escpos.test.ts` existing (21) + charset builder tests (5), `index.test.ts` (1), `receipt-money.test.ts` (1), `qr-matrix.test.ts` (5), `qr-link-range.test.ts` (4), `print-job-preview.test.ts` existing + new (46), `receipt-ticket.test.ts` existing + new (33), `payment-slip.test.ts` (9), `kitchen-ticket.test.ts` (17), `test-page.test.ts` (5). The Task 12 intermediate state (native QR, without Task 13's tests) was run separately: 31 passed. The same files passed `tsc --noEmit` with the repository's compiler options, `eslint --stdin` under each file's destination path, and `prettier --check` with `.prettierrc.json`.

Mutation checks run (each made the named tests fail, then was reverted): the earlier `wrapText`/`labelAmountLines` draft (12 layout failures); `<=` in the tie rule; removing the character-set fallback line; swapping two code page 858 entries; level L in `qrModules`; transposed `qrModules`; no 0x80–0x9F widening, no `ESC @` reset, and accepting table 0 in the decoder; resolution ignored, amount measured before preparing, no item indent, and a fixed 42 columns in `formatReceipt`; the slip keeping `Intl`'s no-break space; the original kitchen formatter; captions at 42 columns, line 2 through table 16, Spanish-only captions and a 4-square B/D border on the test page.

Not run while revising (they need PostgreSQL, the dashboard's browser mode, or the real routes): Tasks 7–9, the database parts of 12–17, and 18–21.


**2026-09-16 follow-up:** Printed test instructions now follow the requesting user's dashboard
language (saved preference, then browser, then venue). The test dialog and setup forms were also
refined. [Design](../specs/2026-09-16-printer-setup-refinements.md) ·
[Implementation and verification](2026-09-16-printer-setup-refinements.md).
