/**
 * The one form a person's display name or email address is compared in when the question is "has
 * somebody already got this?". The result is stored in its own column beside the value, and the
 * unique indexes on `persons` are over that column (`./schema/persons.ts`), because this engine's
 * `lower()` and `COLLATE NOCASE` fold ASCII letters only. An application-defined SQL function would
 * fold correctly, but with an index built on one, a connection that has not registered it is
 * refused an INSERT, `integrity_check` and `VACUUM` — and the cold restore and operator tooling
 * open the file directly.
 *
 * `toLowerCase`, never `toLocaleLowerCase`: the stored fold must be the same on every machine that
 * writes the file, and `toLocaleLowerCase()` with no argument reads the running process's default
 * locale (Turkish folds `I` differently).
 *
 * `normalize("NFC")` before, because an accent has two encodings — a precomposed `é` (U+00E9), or
 * `e` followed by a combining acute (U+0065 U+0301) — that lower-casing alone does not bring
 * together. And again after, because a case mapping can in principle leave a base letter beside a
 * combining mark that would compose.
 *
 * A case fold, not an accent stripper: `Lopez` and `López` are two people.
 */
export function foldForUniqueness(value: string): string {
  return value.trim().normalize("NFC").toLowerCase().normalize("NFC");
}
