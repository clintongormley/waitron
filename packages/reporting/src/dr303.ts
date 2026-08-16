import { decimal, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { DR303_ENVELOPE_CLOSE_TEMPLATE, DR303_LAYOUT, type Dr303Segment } from "./dr303-layout.js";
import type { Modelo303 } from "./modelo-303.js";

/**
 * Serializes a {@link Modelo303} casilla map into the official AEAT modelo 303 fixed-layout file — the
 * "diseño de registro" (DR303) a human uploads via the sede "por fichero" path. This is a LEGAL TAX
 * FILE: a wrong byte offset is an invalid filing, so the field layout is NOT hand-typed here — it is
 * machine-derived from the AEAT-published record design (packages/reporting/reference/DR303e26.xlsx,
 * md5 e42cbe6baf7f21dd95c274b4c6f11bbe) into `dr303-layout.ts`, validated by dr303-layout.test.ts, and
 * merely consumed below.
 *
 * ENCODING & FORMAT RULES (verbatim from the AEAT manual, packages/reporting/reference/manual_uso.txt):
 *  - ISO-8859-1; positions are 1-based (a 0-based byte offset is posición − 1).
 *  - Alfanumeric: "alineados a la izquierda y rellenos de blancos por la derecha, en mayúsculas … sin
 *    vocales acentuadas" — but the language letters Ñ (byte 209) and Ç (byte 199) are preserved.
 *  - Numeric: "alineados a la derecha y rellenos a ceros por la izquierda, sin signos y sin empaquetar";
 *    an importe is 15 int + 2 dec packed into 17 chars with no decimal point; a Tipo % is 3 int + 2 dec
 *    in 5 chars ("02100" = 21,00 %).
 *  - Signed (N) numeric: "Los datos numéricos negativos llevarán una N en la primera posición del campo"
 *    — a negative result box (e.g. 46/71) renders `N` then the zero-filled magnitude.
 *
 * SCOPE (spec §7/§8/§13): a régimen-general deli emits the envelope + página 1 (régimen general
 * devengado + deducible + resultado) + página 3 (resultado de la autoliquidación). Páginas 2/4/5
 * (régimen simplificado) are out of scope. The DID / domiciliación (IBAN) page is a payment-mechanics
 * follow-up, deliberately NOT emitted here (it carries no VAT computation).
 *
 * PRE-FILING CAVEATS (operational — a human MUST clear both before the FIRST LIVE filing; this
 * serializer produces a CANDIDATE file, not a proven submission-ready one):
 *  1. Página 2 (régimen simplificado, DP30302) is OMITTED. Nothing in this codebase verifies that the
 *     AEAT sede "por fichero" uploader accepts a file with página 2 absent — that can only be
 *     established by uploading a real file to the real sede — so the generated file MUST be validated
 *     once against that uploader before any live submission.
 *  2. Under prorrata (deductible_proportion < 100), the deducible BASE (casilla 28/30) is emitted in
 *     FULL and only the cuota (29/31) is scaled by the proportion (upstream, in computeInputVat).
 *     Whether AEAT expects the base unscaled under prorrata is NOT confirmed here; it is the documented
 *     spec §9 seam and an asesor-fiscal must confirm it before a live prorrata filing.
 *
 * English identifiers throughout (the repo's english-only guard scans packages/reporting): the option
 * `year`/`period`/`declarationType` are the AEAT ejercicio/período/tipo de declaración, named in the
 * doc comments (which the guard excludes) rather than the identifiers (which it does not).
 */

const ZERO = decimal("0.00");

export interface Dr303Options {
  /** The obligado's NIF/CIF (our identity), e.g. "B12345678". Uppercased, left-aligned into the field. */
  taxId: string;
  /** Apellidos y nombre o razón social. Uppercased, accents stripped (Ñ/Ç kept), truncated to 80. */
  name: string;
  /** Ejercicio de devengo — the 4-digit civil year, e.g. 2026. */
  year: number;
  /** Período — "01".."12" (monthly) or "1T".."4T" (quarterly). A deli files monthly. */
  period: string;
  /** Tipo de declaración indicator (AEAT Nota 1), a single char, e.g. "I" ingreso / "D" devolución. */
  declarationType: string;
}

/**
 * Packs a Decimal into a fixed-width AEAT numeric field: right-aligned, zero-filled left, `decimals`
 * implied fractional digits, no decimal point. A NEGATIVE value is only representable in an `N`
 * (numérico con signo) field, where it takes an `N` in position 1 followed by the zero-filled
 * magnitude; a negative value handed to a `Num` (unsigned) field is a caller bug and throws. All
 * arithmetic stays in the exact BigInt decimal codec (`toScale`) — never a JS float.
 */
export function formatNumericField(
  value: Decimal,
  width: number,
  type: "Num" | "N",
  decimals: number,
): string {
  const scaled = toScale(value, decimals); // exact; a no-op for values already at `decimals` scale
  const negative = scaled.startsWith("-");
  const body = negative ? scaled.slice(1) : scaled;
  // `body` carries exactly `decimals` fractional digits (toScale guarantees the scale), so dropping
  // the point yields the value in its smallest units (cents), which is what the field packs.
  const digits = decimals > 0 ? body.replace(".", "") : body;
  if (negative) {
    if (type !== "N") {
      throw new Error(
        `dr303: negative value ${value} cannot be placed in an unsigned (Num) field of width ${width}`,
      );
    }
    if (digits.length > width - 1) {
      throw new Error(`dr303: value ${value} overflows signed field of width ${width}`);
    }
    return "N" + digits.padStart(width - 1, "0");
  }
  if (digits.length > width) {
    throw new Error(`dr303: value ${value} overflows field of width ${width}`);
  }
  return digits.padStart(width, "0");
}

// Accented vowels → their base letter (each direction of accent AEAT may receive). The language
// letters Ñ and Ç are deliberately absent: they are PRESERVED (ISO-8859-1 209 / 199), not stripped.
const VOWEL_ACCENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[ÁÀÂÄÃ]/g, "A"],
  [/[ÉÈÊË]/g, "E"],
  [/[ÍÌÎÏ]/g, "I"],
  [/[ÓÒÔÖÕ]/g, "O"],
  [/[ÚÙÛÜ]/g, "U"],
];

/**
 * Normalizes an alfanumeric value per the manual: uppercased, accents stripped from vowels, the
 * language letters Ñ/Ç preserved, and any residual codepoint outside ISO-8859-1 replaced with a space
 * (so the latin1 byte encoding never emits a corrupted byte). Length is NOT touched here.
 */
export function normalizeAlfa(value: string): string {
  let out = value.toUpperCase();
  for (const [pattern, base] of VOWEL_ACCENTS) {
    out = out.replace(pattern, base);
  }
  return Array.from(out, (ch) => (ch.charCodeAt(0) <= 0xff ? ch : " ")).join("");
}

/** Left-aligns a normalized alfanumeric value into `width`, space-filling right / truncating. */
export function formatAlfa(value: string, width: number): string {
  return normalizeAlfa(value).slice(0, width).padEnd(width, " ");
}

/** Formats the 4-digit ejercicio (EEEE). */
function formatYear(year: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`dr303: year must be a 4-digit value, got ${year}`);
  }
  return String(year);
}

/** Formats the 2-char período (PP): "01".."12" monthly or "1T".."4T" quarterly. */
function formatPeriod(period: string): string {
  const p = period.trim().toUpperCase();
  if (!/^(?:0[1-9]|1[0-2]|[1-4]T)$/.test(p)) {
    throw new Error(
      `dr303: period must be "01".."12" or "1T".."4T", got ${JSON.stringify(period)}`,
    );
  }
  return p;
}

/** All casilla numbers this writer actually places (across the emitted segments). */
const EMITTED_CASILLAS: ReadonlySet<string> = new Set(
  [DR303_LAYOUT.comun, DR303_LAYOUT.pagina1, DR303_LAYOUT.pagina3]
    .flatMap((s) => s.fields)
    .map((f) => f.casilla)
    .filter((c): c is string => c !== null),
);

function renderField(
  field: Dr303Segment["fields"][number],
  boxes: Modelo303["boxes"],
  options: Dr303Options,
  year: string,
  period: string,
): string {
  let out: string;
  switch (field.role) {
    case "constant":
      // The literal is the record design's own (envelope tags, Tipo % constants, </AUX>, end markers).
      // dr303-layout.test.ts guarantees a constant field carries a `len`-length value.
      out = field.value!;
      break;
    case "year":
      out = year;
      break;
    case "period":
      out = period;
      break;
    case "taxId":
      out = formatAlfa(options.taxId, field.len);
      break;
    case "name":
      out = formatAlfa(options.name, field.len);
      break;
    case "declarationType":
      out = formatAlfa(options.declarationType, field.len);
      break;
    case "amount": {
      // dr303-layout.test.ts guarantees every data (importe) field carries a casilla; an absent box is
      // a zero importe, as on the paper form.
      const value = boxes[field.casilla!];
      const type = field.type === "N" ? "N" : "Num";
      out = formatNumericField(value ?? ZERO, field.len, type, field.decimals);
      break;
    }
    case "blank":
      // Reserved AEAT areas + optional Sí/No identification indicators: a type-neutral blank. Their
      // real values are data-entry/asesor inputs, not part of the VAT computation (see report/deferred).
      out = " ".repeat(field.len);
      break;
  }
  /* v8 ignore start */
  if (out.length !== field.len) {
    // Unreachable: every branch above yields exactly `field.len` chars (the formatters pad/truncate to
    // width; constants are length-validated by dr303-layout.test.ts). A runtime safety net for a
    // legal-file layout, kept active but excluded from coverage — it cannot fire against a valid layout.
    throw new Error(
      `dr303: field ${field.n} (${field.role}) rendered ${out.length} chars, expected ${field.len}`,
    );
  }
  /* v8 ignore stop */
  return out;
}

function buildSegment(
  segment: Dr303Segment,
  boxes: Modelo303["boxes"],
  options: Dr303Options,
  year: string,
  period: string,
): string {
  let out = "";
  for (const field of segment.fields) {
    out += renderField(field, boxes, options, year, period);
  }
  /* v8 ignore start */
  if (out.length !== segment.length) {
    // Unreachable: the layout is contiguous and fills its declared length (dr303-layout.test.ts), and
    // each field renders to exactly its length, so the concatenation is exactly `segment.length`.
    throw new Error(
      `dr303: segment ${segment.name} is ${out.length} chars, expected ${segment.length}`,
    );
  }
  /* v8 ignore stop */
  return out;
}

/** The monthly período ("01".."12") for a liquidation month 1..12; zero-padded to 2 chars. */
function monthlyPeriod(month: number): string {
  return String(month).padStart(2, "0");
}

/**
 * Serializes `modelo303` to the DR303 fixed-layout file (ISO-8859-1 bytes). The obligado identity
 * (taxId/name), the ejercicio/período (`year`/`period`) and the tipo de declaración come from
 * `options`; every casilla value comes from `modelo303.boxes`, placed at its record-design position
 * (an absent box is a zero importe, as on the form). Returns a Buffer already encoded in ISO-8859-1.
 *
 * The envelope's ejercicio/período (from `options`) is guarded against the liquidation period the
 * aggregate's amounts are FOR (`modelo303.year`/`modelo303.month`): a caller passing the wrong
 * year/period would emit an internally inconsistent tax file (envelope period ≠ casilla amounts). The
 * year is always cross-checked; the período only when it is MONTHLY ("01".."12"), which maps 1:1 to a
 * month. A trimestral período ("1T".."4T") spans three months, so a single-month aggregate cannot be
 * pinned to one quarter unambiguously and is left unchecked. A mismatch throws a plain Error, matching
 * the writer's other guards.
 */
export function toDr303Record(modelo303: Modelo303, options: Dr303Options): Buffer {
  const year = formatYear(options.year);
  const period = formatPeriod(options.period);

  // Envelope period must match the aggregate's liquidation period, or the file's ejercicio/período
  // would disagree with the casilla amounts it wraps (see the doc comment above).
  if (options.year !== modelo303.year) {
    throw new Error(
      `dr303: envelope year ${options.year} does not match the aggregate's liquidation year ${modelo303.year}`,
    );
  }
  if (/^\d{2}$/.test(period) && period !== monthlyPeriod(modelo303.month)) {
    throw new Error(
      `dr303: envelope period ${period} does not match the aggregate's liquidation month ${monthlyPeriod(modelo303.month)}`,
    );
  }

  // A computed box that this writer does not place would be silently dropped from the filing — refuse
  // rather than emit an incomplete return (e.g. a future map that populates a página-2 box).
  const unplaceable = Object.keys(modelo303.boxes).filter((c) => !EMITTED_CASILLAS.has(c));
  if (unplaceable.length > 0) {
    throw new Error(
      `dr303: Modelo303 has boxes not in the emitted layout: ${unplaceable.join(", ")}`,
    );
  }

  const body =
    buildSegment(DR303_LAYOUT.comun, modelo303.boxes, options, year, period) +
    buildSegment(DR303_LAYOUT.pagina1, modelo303.boxes, options, year, period) +
    buildSegment(DR303_LAYOUT.pagina3, modelo303.boxes, options, year, period);

  // The outer envelope close (común field 15): </T3030 + EEEE + PP + 0000>, 18 chars.
  const close = DR303_ENVELOPE_CLOSE_TEMPLATE.replace("AAAA", year).replace("PP", period);
  /* v8 ignore start */
  if (close.length !== DR303_ENVELOPE_CLOSE_TEMPLATE.length) {
    // Unreachable: year is 4 chars and period 2 (both validated), so the 18-char template stays 18
    // after substitution. A safety net against a template edit, excluded from coverage.
    throw new Error(`dr303: envelope close is ${close.length} chars, expected 18`);
  }
  /* v8 ignore stop */

  return Buffer.from(body + close, "latin1");
}
