import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tablesCreatedBy } from "@waitron/sync-enrolment";

function created(folder: string, tags: readonly string[]): Set<string> {
  return tablesCreatedBy(tags.map((tag) => readFileSync(join(folder, `${tag}.sql`), "utf8")));
}

/**
 * Today's append-only list for a database built from `kept` alone: it drops only the tables the
 * left-out migrations, applied alone, leave in place, so a table this parse misses stays listed and its trigger fails loudly.
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
