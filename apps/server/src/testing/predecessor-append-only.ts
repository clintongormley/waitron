import { readFileSync } from "node:fs";
import { join } from "node:path";

const CREATED = /CREATE TABLE (?:IF NOT EXISTS )?[`"]?(\w+)/gi;

function created(folder: string, tags: readonly string[]): Set<string> {
  return new Set(
    tags.flatMap((tag) =>
      [...readFileSync(join(folder, `${tag}.sql`), "utf8").matchAll(CREATED)].map(
        (match) => match[1]!,
      ),
    ),
  );
}

/**
 * Today's append-only list for a database built from `kept` alone: it drops only the tables the
 * left-out migrations create, so a table this parse misses stays listed and its trigger fails loudly.
 */
export function predecessorAppendOnly(
  tables: readonly string[] | undefined,
  folder: string,
  kept: readonly string[],
  leftOut: readonly string[],
): string[] {
  const before = created(folder, kept);
  const added = created(folder, leftOut);
  return (tables ?? []).filter((table) => before.has(table) || !added.has(table));
}
