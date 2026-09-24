import { decimal, toScale } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { DR303_ENVELOPE_CLOSE_TEMPLATE, DR303_LAYOUT, type Dr303Segment } from "./dr303-layout.js";
import type { Modelo303 } from "./modelo-303.js";
import { parsePeriodToken } from "./period.js";

/**
 * Serializes a {@link Modelo303} casilla map into the official AEAT modelo 303 fixed-layout file — the
 * "diseño de registro" (DR303) a human uploads via the sede "por fichero" path. A wrong byte offset is
 * an invalid filing, so the field layout is not hand-typed here: it is generated from the AEAT record
 * design into `dr303-layout.ts`.
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
 * SCOPE: a régimen-general deli emits the envelope + página 1 (régimen general devengado +
 * deducible + resultado) + página 3 (resultado de la autoliquidación). Páginas 2/4/5 (régimen
 * simplificado) are out of scope, and the DID / domiciliación (IBAN) page is not emitted (it carries
 * no VAT computation).
 *
 * PRE-FILING CAVEATS (operational — a human MUST clear both before the FIRST LIVE filing; this
 * serializer produces a CANDIDATE file, not a proven submission-ready one):
 *  1. Página 2 (régimen simplificado, DP30302) is OMITTED. Nothing in this codebase verifies that the
 *     AEAT sede "por fichero" uploader accepts a file with página 2 absent — that can only be
 *     established by uploading a real file to the real sede — so the generated file MUST be validated
 *     once against that uploader before any live submission.
 *  2. Under prorrata (a `deductible_proportion` below the full 10000 basis points), the deducible
 *     BASE (casilla 28/30) is emitted in FULL and only the cuota (29/31) is scaled by the
 *     proportion (upstream, in computeInputVat). Whether AEAT expects the base unscaled under
 *     prorrata is NOT confirmed; an asesor fiscal must confirm it before a live prorrata filing.
 */

const ZERO = decimal("0.00");

export interface Dr303Options {
  /** The obligado's NIF/CIF (our identity), e.g. "B12345678". Uppercased, left-aligned into the field. */
  taxId: string;
  /** Apellidos y nombre o razón social. Uppercased, accents stripped (Ñ/Ç kept), truncated to 80. */
  name: string;
  /** Ejercicio de devengo — the 4-digit civil year, e.g. 2026. */
  year: number;
  /** Período — "01".."12" (monthly) or "1T".."4T" (quarterly). */
  period: string;
  /** Tipo de declaración indicator (AEAT Nota 1), a single char, e.g. "I" ingreso / "D" devolución. */
  declarationType: string;
}

/**
 * Packs a Decimal into a fixed-width AEAT numeric field: right-aligned, zero-filled left, `decimals`
 * implied fractional digits, no decimal point. A NEGATIVE value is only representable in an `N`
 * (numérico con signo) field, where it takes an `N` in position 1 followed by the zero-filled
 * magnitude; a negative value handed to a `Num` (unsigned) field is a caller bug and throws.
 */
export function formatNumericField(
  value: Decimal,
  width: number,
  type: "Num" | "N",
  decimals: number,
): string {
  const scaled = toScale(value, decimals);
  const negative = scaled.startsWith("-");
  const body = negative ? scaled.slice(1) : scaled;
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

/** Formats the 2-char período (PP): "01".."12" monthly or "1T".."4T" quarterly, validated by
 * `parsePeriodToken`, the grammar the export route shares. */
function formatPeriod(period: string): string {
  const p = period.trim().toUpperCase();
  if (parsePeriodToken(p) === undefined) {
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
      // real values are data-entry/asesor inputs, not part of the VAT computation.
      out = " ".repeat(field.len);
      break;
  }
  /* v8 ignore start */
  if (out.length !== field.len) {
    // Unreachable against a valid layout; kept as a safety net for a legal file.
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
    // Unreachable: the layout is contiguous (dr303-layout.test.ts) and each field renders to its
    // exact length.
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
 * aggregate's amounts are FOR (`modelo303.year`/`modelo303.period`), or the file would contradict
 * itself. The year is always cross-checked; the período by `modelo303.period`'s kind:
 *  - ANNUAL is REFUSED — there is no modelo 303 annual período (the annual VAT resumen is modelo 390);
 *  - MONTHLY is cross-checked against its month, when `options.period` is a month token;
 *  - QUARTERLY is not checked — the download route derives `options.period` from the same parsed
 *    token it computed the aggregate for.
 * A mismatch throws a plain Error, matching the writer's other guards.
 */
export function toDr303Record(modelo303: Modelo303, options: Dr303Options): Buffer {
  const year = formatYear(options.year);
  const period = formatPeriod(options.period);

  if (options.year !== modelo303.year) {
    throw new Error(
      `dr303: envelope year ${options.year} does not match the aggregate's liquidation year ${modelo303.year}`,
    );
  }
  const p = modelo303.period;
  if (p.kind === "year") {
    throw new Error(
      "dr303: an annual aggregate has no modelo 303 period (the annual return is modelo 390); no file is emitted",
    );
  }
  if (p.kind === "month" && /^\d{2}$/.test(period) && period !== monthlyPeriod(p.month)) {
    throw new Error(
      `dr303: envelope period ${period} does not match the aggregate's liquidation month ${monthlyPeriod(p.month)}`,
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
    // Unreachable: year is 4 chars and period 2 (both validated). A safety net against a template edit.
    throw new Error(`dr303: envelope close is ${close.length} chars, expected 18`);
  }
  /* v8 ignore stop */

  return Buffer.from(body + close, "latin1");
}
