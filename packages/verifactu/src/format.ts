/**
 * Value formatting for Veri*Factu records.
 *
 * The huella is SHA-256 over a string built from these literals, and AEAT
 * recomputes from the literal it received — so `123.1` and `123.10` are both
 * valid and hash differently. Every value is therefore formatted exactly once,
 * here, and the same literal goes into both the XML and the hash.
 */

const MAX_INTEGER_DIGITS = 12;

/**
 * Strips leading/trailing whitespace using AEAT's reference semantics: code
 * points <= U+0020 only.
 *
 * Deliberately NOT String.prototype.trim(), which also strips U+00A0 and
 * U+FEFF. AEAT recomputes the huella with the narrower rule, so using the
 * wider one would produce a mismatching hash for any value carrying a
 * non-breaking space. Interior whitespace is preserved verbatim.
 *
 * The `start < end`/`end > start` loop bounds are mutation-tested as
 * equivalent, not merely untested: `String.prototype.slice` returns "" for
 * any `start` past `end`, and whenever a bound would matter (the loop
 * decrementing/incrementing past the other index) the character it would
 * then inspect was already established whitespace by the OTHER loop, so a
 * missing/widened bound only ever walks further through whitespace to the
 * same final "" — verified by exhaustive search over whitespace/non-
 * whitespace strings up to length 6 plus 2M random fuzz inputs, with no
 * observable difference found. No test can kill an equivalent mutant.
 */
export function trimValue(value: string | undefined | null): string {
  if (value === undefined || value === null) return "";
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

// Anchored, no exponent, no leading plus, no leading zeros, at least one digit each side of a
// point — the same shape @waitron/shared's Decimal uses, re-stated here because packages/verifactu
// has ZERO in-repo dependencies and cannot import it.
const AMOUNT_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Formats an exact decimal STRING as the record literal: always two decimals, `.` separator,
 * never a leading `+`, `-` only for a genuine negative, half away from zero. The value never
 * passes through a JS number at any point, so float-representation error (e.g. `1.005 * 100 ===
 * 100.49999999999999` in IEEE 754) cannot arise at all.
 */
export function formatAmountExact(value: string): string {
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) {
    throw new Error(`Amount must be an exact decimal string, received ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const point = body.indexOf(".");
  const intText = point === -1 ? body : body.slice(0, point);
  const fracText = point === -1 ? "" : body.slice(point + 1);

  let integer = BigInt(intText);
  let cents = BigInt((fracText + "00").slice(0, 2));
  // Half away from zero, decided by the third decimal alone: "5".."9" is at or above half a cent
  // no matter what follows it, "0".."4" is below no matter what follows it.
  //
  // `fracText.length > 2 &&` is mutation-tested as equivalent, not merely untested: when
  // fracText.length <= 2, `fracText[2]` is `undefined`, and `undefined >= "5"` is always `false`
  // regardless of what the length check is replaced with (`true`, `>= 2`, etc.) — the second
  // operand alone already forces the same result whenever the first would matter. No test can
  // kill an equivalent mutant here.
  if (fracText.length > 2 && fracText[2] >= "5") {
    cents += 1n;
    if (cents === 100n) {
      cents = 0n;
      integer += 1n;
    }
  }
  const integerText = integer.toString();
  if (integerText.length > MAX_INTEGER_DIGITS) {
    throw new Error(
      `Amount exceeds the ${MAX_INTEGER_DIGITS} integer digits permitted by ImporteSgn12.2Type`,
    );
  }
  const sign = negative && (integer !== 0n || cents !== 0n) ? "-" : "";
  return `${sign}${integerText}.${cents.toString().padStart(2, "0")}`;
}

/**
 * xs:dateTime (and therefore FechaHoraHusoGenRegistro) permits a timezone
 * offset only in the range -14:00..+14:00. Exported so validate.ts's
 * FechaHoraHusoGenRegistro format check pins the same bound rather than
 * duplicating the magic number.
 */
export const MAX_OFFSET_MINUTES = 14 * 60;

/** Shifts a Date by an offset so its UTC accessors read as local-at-that-offset. */
function shift(date: Date, offsetMinutes: number): Date {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date supplied");
  }
  // Fail fast at construction: an out-of-range or fractional offsetMinutes
  // (e.g. 9999, or 90.5 minutes — a fraction of a minute has no representation
  // in +hh:mm) would otherwise serialise into a malformed or out-of-spec
  // offset (e.g. "+166:39", "+01:30.5") that both hashes and validates
  // locally, only to be rejected by AEAT.
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > MAX_OFFSET_MINUTES) {
    throw new Error(
      `offsetMinutes must be an integer between -${MAX_OFFSET_MINUTES} and ${MAX_OFFSET_MINUTES} ` +
        `(xs:dateTime permits offsets only in -14:00..+14:00), received ${String(offsetMinutes)}`,
    );
  }
  return new Date(date.getTime() + offsetMinutes * 60_000);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** Formats the date part as `DD-MM-YYYY` — AEAT's `sf:fecha`, not ISO 8601. */
export function formatDate(date: Date, offsetMinutes: number): string {
  const d = shift(date, offsetMinutes);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/**
 * Formats `FechaHoraHusoGenRegistro` as `YYYY-MM-DDThh:mm:ss±hh:mm`.
 *
 * Always a numeric offset, never `Z`; always whole seconds. Both are policy
 * choices — the schema permits the alternatives, no AEAT example uses them,
 * and the hash is over the literal, so the form must be fixed once.
 */
export function formatDateTime(date: Date, offsetMinutes: number): string {
  const d = shift(date, offsetMinutes);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const datePart = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const timePart = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${datePart}T${timePart}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
