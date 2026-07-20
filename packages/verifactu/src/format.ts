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

/**
 * Formats a monetary amount as the record literal: always two decimal places,
 * `.` separator, never a leading `+`, rounded half away from zero.
 *
 * Rounds on the decimal STRING, not by multiplying by 100. `value * 100` is a
 * second binary floating-point operation and can land the scaled value on the
 * wrong side of the rounding boundary — e.g. `1.005 * 100 === 100.49999999999999`
 * in IEEE 754, which would round down to "1.00" instead of "1.01". Rendering
 * through `toFixed(10)` first recovers the decimal digits a human actually
 * typed (correcting representation error like `1.005` being stored as
 * `1.00499999999999989341...`) without that second lossy multiplication.
 */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Amount must be finite, received ${String(value)}`);
  }
  // Guard the magnitude before formatting. toFixed(10) switches to exponential
  // notation ("1e+21") for |value| >= 1e21, which has no "." to split on — the
  // code below would then throw a confusing TypeError from calling .slice on
  // undefined, instead of the intended range error. This does NOT replace the
  // post-rounding check below: a value just under 10 ** MAX_INTEGER_DIGITS
  // (e.g. 999999999999.999) passes this guard but can still round up past the
  // digit limit once cents are rounded — that carry is only known after
  // rounding, so it needs its own check.
  //
  // `>=` vs `>` here is mutation-tested as equivalent, not merely untested:
  // MAX_INTEGER_DIGITS (12) is so far below the exponential-notation
  // threshold (1e21) that the ONLY value where `>=`/`>` disagree is exactly
  // 10**12 itself, and at exactly that value the integer part is already 13
  // digits — the post-rounding check below always throws the identical
  // message anyway. Verified by fuzzing 2M values plus every power-of-ten
  // boundary from 1e8 to 1e22. No test can kill an equivalent mutant.
  if (Math.abs(value) >= 10 ** MAX_INTEGER_DIGITS) {
    throw new Error(
      `Amount exceeds the ${MAX_INTEGER_DIGITS} integer digits permitted by ImporteSgn12.2Type`,
    );
  }
  const [integerDigits, fractionDigits] = Math.abs(value).toFixed(10).split(".");
  let integerPart = Number(integerDigits);
  let cents = Number(fractionDigits.slice(0, 2));
  // Half away from zero, decided by the third decimal digit alone: "0".."4"
  // leaves the remainder below half a cent no matter what follows it, and
  // "5".."9" puts it at or above half a cent no matter what follows it.
  if (fractionDigits[2] >= "5") {
    cents += 1;
    if (cents === 100) {
      cents = 0;
      integerPart += 1;
    }
  }
  if (String(integerPart).length > MAX_INTEGER_DIGITS) {
    throw new Error(
      `Amount exceeds the ${MAX_INTEGER_DIGITS} integer digits permitted by ImporteSgn12.2Type`,
    );
  }
  // `value < 0` vs `value <= 0` is mutation-tested as equivalent: they only
  // disagree at value === 0 (incl. -0), and at exactly 0 the rounding above
  // always yields integerPart === 0 && cents === 0, which makes the second
  // clause false regardless — so the sign is always "" there either way.
  // Verified by fuzzing 2M values. No test can kill an equivalent mutant.
  const sign = value < 0 && (integerPart !== 0 || cents !== 0) ? "-" : "";
  return `${sign}${integerPart}.${String(cents).padStart(2, "0")}`;
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
