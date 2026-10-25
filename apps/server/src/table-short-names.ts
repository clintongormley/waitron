import {
  AppError,
  SHORT_NAME_MAX,
  proposeShortName,
  shortNameKey,
  shortNameLength,
} from "@waitron/shared";
import "./errors.js";

export interface ShortNameEntry {
  label: string;
  shortName?: string;
  /** The stored plan table's label and short name, for an entry with an id. */
  stored?: { label: string; shortName: string | null };
}

/**
 * `taken` maps a short name's key to the full name of the table holding it. Kept values are
 * claimed first, then sent ones (refused when taken), then proposals (none when taken), so a sent
 * value never takes an untouched table's stored one and a proposal never displaces a chosen one.
 */
export function resolveShortNames(
  entries: readonly ShortNameEntry[],
  taken: ReadonlyMap<string, string>,
): (string | null)[] {
  const claimed = new Map(taken);
  const result: (string | null)[] = entries.map(() => null);
  const claim = (index: number, value: string): boolean => {
    const key = shortNameKey(value);
    if (claimed.has(key)) return false;
    claimed.set(key, entries[index]!.label.trim());
    result[index] = value;
    return true;
  };

  const proposed: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.shortName !== undefined) return;
    const stored = entry.stored;
    if (stored !== undefined && stored.label === entry.label.trim()) {
      if (stored.shortName !== null) claim(index, stored.shortName);
      else proposed.push(index);
    } else {
      proposed.push(index);
    }
  });

  entries.forEach((entry, index) => {
    if (entry.shortName === undefined) return;
    const value = entry.shortName.trim();
    if (value === "" || shortNameLength(value) > SHORT_NAME_MAX) {
      throw new AppError("floor_plan.invalid", { field: `tables.${index}.shortName` });
    }
    const holder = claimed.get(shortNameKey(value));
    if (holder !== undefined) {
      throw new AppError("table.short_name_taken", {
        shortName: value,
        takenBy: holder,
        field: "shortName",
      });
    }
    claim(index, value);
  });

  for (const index of proposed) claim(index, proposeShortName(entries[index]!.label));
  return result;
}
