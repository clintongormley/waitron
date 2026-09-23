/**
 * The one form a person's display name or email address is compared in when the question is "has
 * somebody already got this?".
 *
 * ## Why the fold happens here rather than in SQL
 *
 * It used to happen in SQL — the three unique indexes on `persons` were declared over
 * `lower(...)`, and PostgreSQL's `lower()` folds the whole of Unicode. This engine's folds ASCII
 * and stops. Measured 2026-09-23 on Node v26.7.0, with a plain-letter control in the other
 * direction so the probe discriminates rather than agreeing with itself:
 *
 * ```
 * SQLite lower('JOSÉ GARCÍA') = josÉ garcÍa
 * SQLite lower('ANA LOPEZ')   = ana lopez
 * ```
 *
 * `COLLATE NOCASE` is the same story and was measured the same way: `'JOSÉ' = 'josé' collate
 * nocase` answers 0 where `'ANA' = 'ana' collate nocase` answers 1, and a unique index over a
 * `NOCASE` column accepted `JOSÉ GARCÍA` beside `José García` while refusing `ANA LOPEZ` beside
 * `Ana Lopez`. A `GENERATED ALWAYS AS (lower(...))` column would carry the identical gap, since it
 * is the same function. An application-defined SQL function would fold correctly, but an index
 * built on one leaves the venue FILE dependent on it, and the file is opened directly by the cold
 * restore and by operator tooling. Measured 2026-09-23 on Node v26.7.0: a second connection that
 * had not registered the function still read rows — by primary key and by a full scan — and was
 * refused an INSERT (`unknown function: wtfold()`), `pragma integrity_check` (the same message)
 * and `VACUUM` (`no such function: wtfold`). So the file is not unreadable, which is the narrower
 * and true version of the claim; it is unwritable and uncheckable, which is enough.
 *
 * So the fold runs in JavaScript, its result is stored in its own column beside the value, and the
 * index is over that column. A caller never writes one without the other; see `./schema/persons.ts`.
 *
 * ## What this function does, and why each step is there
 *
 * `trim`, then compose, then lower-case, then compose again.
 *
 * **`toLowerCase`, never `toLocaleLowerCase`.** The stored fold has to be the same on every machine
 * that writes the file, and `toLocaleLowerCase()` with no argument asks the RUNNING process's
 * default locale. Two code points in the Basic Multilingual Plane fold differently under the
 * Turkish rules — U+0049 `I`, which becomes a dotless `ı`, and U+0130 `İ` — swept on Node v26.7.0
 * over every code point in that plane. Spanish itself has no such rule, so `toLowerCase` folds
 * `JOSÉ`, `BEGOÑA`, `MARTÍN` and `NUÑO` exactly as a Spanish reader expects.
 *
 * **`normalize("NFC")` before, because the same accent has two spellings.** `José` can be a
 * precomposed `é` (U+00E9) or a plain `e` followed by a combining acute (U+0065 U+0301). They
 * render identically, they are different strings, and lower-casing does not bring them together:
 * measured, `"José".toLowerCase() === "José".toLowerCase()` is `false`, and `true` once both
 * are composed first. macOS produces the second form where phone keyboards produce the first, so a
 * venue really can receive both. This is the half PostgreSQL did not fold either — it is a gap
 * being closed, not a regression being repaired.
 *
 * **`normalize("NFC")` again after, and this is the step with a hedge on it.** The Unicode order is
 * to re-compose after case mapping, because a lower-case mapping can in principle leave a base
 * letter next to a combining mark that would compose. A sweep of every code point in the Basic
 * Multilingual Plane found NONE where `toLowerCase` left a composed input un-composed, so nothing
 * here needs it today. The sweep covered single code points and not SEQUENCES, which is what a
 * composition can also arise from, so the step stays: it is cheap, and its absence would be a
 * silent wrong answer rather than a loud one.
 *
 * It is a CASE fold and not an accent stripper. `Lopez` and `López` are two people and this venue
 * must be able to employ both; `packages/identity/src/persons.accented-case.test.ts` holds that as
 * its control in the other direction.
 */
export function foldForUniqueness(value: string): string {
  return value.trim().normalize("NFC").toLowerCase().normalize("NFC");
}
