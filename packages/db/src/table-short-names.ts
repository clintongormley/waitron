import { shortNameKey } from "@waitron/shared";

/** The key is the folded copy the venue's unique index is on. */
export function shortNameColumns(shortName: string | null): {
  shortName: string | null;
  shortNameKey: string | null;
} {
  return { shortName, shortNameKey: shortName === null ? null : shortNameKey(shortName) };
}
