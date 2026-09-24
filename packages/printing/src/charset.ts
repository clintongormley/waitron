import type { printCharacterSet } from "@waitron/db";

/**
 * Receipt text uses a named byte encoding. The printer's numeric `ESC t n` table is a separate
 * setting: physical testing found the same Windows-1252 glyph map at table 6 on an NT-806 while
 * other ESC/POS manuals assign it to table 16.
 *
 * Source of the tables: the 0x80-0xFF halves below were generated with Python 3's `cp1252` codec
 * (which CPython generates from the Unicode Consortium file MAPPINGS/VENDORS/MICSFT/WINDOWS/CP1252.TXT)
 * and its `cp858` codec (CPython's cp850 table with 0xD5 changed to the euro sign). The five bytes
 * cp1252 leaves undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the same code point, as the WHATWG
 * windows-1252 decoder does.
 */
export type CharacterSet = (typeof printCharacterSet.enumValues)[number];

/** Legacy/common defaults used only when a caller has no printer profile. */
export const DEFAULT_CHARACTER_TABLE: Readonly<Record<CharacterSet, number | undefined>> = {
  wpc1252: 16,
  pc858: 19,
  plain: undefined,
};

/** `ESC t n` — select the printer's numeric character table. */
export function selectCharacterTable(table: number): number[] {
  if (!Number.isInteger(table) || table < 0 || table > 0xff) {
    throw new RangeError(`character table must be an integer in [0, 255], got ${table}`);
  }
  return [0x1b, 0x74, table];
}

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
  "×": "x",
  "·": "-",
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
 * so `.length` of the result is its printed width. Map every control character (0x00–0x1F, 0x7F) to
 * a single space, as they would otherwise reach the printer and interfere with layout or commands.
 */
export function prepareText(s: string, cs: CharacterSet): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const codePoint = ch.codePointAt(0)!;
    if (codePoint < 0x20 || codePoint === 0x7f) {
      out += " ";
    } else {
      const fallback = FALLBACK[ch];
      if (encodable(ch, cs)) out += ch;
      else if (fallback !== undefined && encodable(fallback, cs)) out += fallback;
      else {
        const stripped = ch.normalize("NFD").replace(/\p{Diacritic}/gu, "");
        out += stripped !== "" && encodable(stripped, cs) ? stripped : "?";
      }
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
