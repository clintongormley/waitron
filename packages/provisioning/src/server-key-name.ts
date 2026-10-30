import { randomInt } from "node:crypto";

/** A server key name for the UTC `day`: the day and four characters, drawn again while the name is `taken`. */
export function newBreakGlassKeyName(day: string, taken: ReadonlySet<string>): string {
  const alphabet = "34679ACDEFHJKMNPQRTUVWXY";
  let next: string;
  do {
    const code = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
    next = `${day} · ${code}`;
  } while (taken.has(next));
  return next;
}
