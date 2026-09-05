// The static per-table apply SQL for the commercial-lane outbox. Each statement is a pure function of
// its enrolled table's metadata (an EnrolledTable, injected by the composition root — never a captured
// row's contents), so apply.ts builds each apply statement once into a per-set dispatch map and reuses
// it per row, rather than rebuilding for every row of a batch. Table and column names are drawn from
// the EnrolledTable (`table`, `columns`, `conflictKey`), which the OWNING package derived from its own
// Drizzle schema via `enrol` (@waitron/sync-enrolment) — so @waitron/sync imports no domain schema, and
// no identifier here is runtime-derived from row data. The CLAUDE.md §3 identifier-escaping question
// does not arise (apply-sql.test.ts proves it): the whole row_image binds as the single `$1` via
// jsonb_populate_record, exactly the shape the container gates validated
// (docs/superpowers/specs/2026-08-06-sync-container-gates-findings.md).

import type { EnrolledTable } from "@waitron/sync-enrolment";

/**
 * The idempotent upsert/insert statement for one enrolled table:
 *   - insert-only: `… ON CONFLICT (<key>) DO NOTHING` (a re-delivery is a no-op even with different
 *     bytes — the append-only row is never overwritten).
 *   - watermark-upsert WITH a watermark column: `… DO UPDATE SET <cols> WHERE excluded.<wm> > t.<wm>`
 *     so an older/equal image is a no-op and the mirror never regresses (spec §3).
 *   - watermark-upsert with NO watermark column (Group C): the same DO UPDATE SET, UNCONDITIONAL —
 *     non-regression rests on the seq cursor, not a row-level guard (spec §3).
 * `<cols>` is every column of `entry.columns` except the conflict key. The whole row binds as `$1`.
 */
export function applyStatementFor(entry: EnrolledTable): string {
  const t = entry.table;
  const key = entry.conflictKey.join(", ");
  const populate = `insert into ${t} select * from jsonb_populate_record(null::${t}, $1)`;
  if (entry.mode === "insert-only") {
    return `${populate} on conflict (${key}) do nothing`;
  }
  const setCols = entry.columns.filter((c) => !entry.conflictKey.includes(c));
  if (setCols.length === 0) {
    // A watermark-upsert with no non-key columns would emit an empty SET — a broken enrolment, not a
    // valid statement. `enrol` always derives a real column list from the owning package's Drizzle
    // schema, so this only fires on a hand-built fixture (the assertion the old columnNamesFor
    // "no drizzle object" guard made, preserved and adapted to the injected-columns shape).
    throw new Error(`enrolled table "${t}" has no non-key columns to upsert`);
  }
  const setClause = setCols.map((c) => `${c} = excluded.${c}`).join(", ");
  const upsert = `${populate} on conflict (${key}) do update set ${setClause}`;
  if (entry.watermarkColumn === null) {
    return upsert;
  }
  const wm = entry.watermarkColumn;
  return `${upsert} where excluded.${wm} > ${t}.${wm}`;
}

/**
 * The idempotent delete statement for a Group C (DELETE-capable) table: `DELETE … WHERE <key> =
 * ($1->>'<key>')::uuid`, a 0-row no-op when the row is already absent (spec §3). Refuses a table
 * that captures no delete — Group A/B have no delete to apply, so asking for one is a programming
 * error, not a silent empty statement. Group C conflict keys are single-column `id` (spec §2).
 */
export function deleteStatementFor(entry: EnrolledTable): string {
  if (!entry.captureOps.includes("delete")) {
    throw new Error(
      `table "${entry.table}" captures no delete op; deleteStatementFor is for Group C (DELETE-capable) tables only`,
    );
  }
  const key = entry.conflictKey[0];
  return `delete from ${entry.table} where ${key} = ($1->>'${key}')::uuid`;
}
