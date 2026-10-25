import { shortNameKey } from "@waitron/shared";

/** The columns a write of a live table's short name sets: the name, and the folded key the
 * venue's unique index is on. */
export function shortNameColumns(shortName: string | null): {
  shortName: string | null;
  shortNameKey: string | null;
} {
  return { shortName, shortNameKey: shortName === null ? null : shortNameKey(shortName) };
}
