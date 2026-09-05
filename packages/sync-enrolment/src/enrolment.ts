import { getTableColumns, getTableName, type Table } from "drizzle-orm";

/** insert-only → `ON CONFLICT DO NOTHING`; watermark-upsert → `ON CONFLICT DO UPDATE SET …`. */
export type SyncMode = "insert-only" | "watermark-upsert";

/** The DML the capture trigger fires on. */
export type CaptureOp = "insert" | "update" | "delete";

/** Which replication lane carries a table. `payments`/`payment_refunds` ride the fast lane; every
 * other enrolled table rides the ordered lane. */
export type SyncLane = "ordered" | "fast";

/** Every sync lane, for callers acting ACROSS all lanes (the disposal guard). */
export const SYNC_LANES = ["ordered", "fast"] as const satisfies readonly SyncLane[];

/**
 * One enrolled table's replication metadata. Declared by the OWNING package (the package that owns
 * the Drizzle table), assembled by the composition root, and consumed by `@waitron/sync` — which no
 * longer imports any domain schema. `columns` is the ordered physical column-name list the apply
 * path needs for a watermark `DO UPDATE SET`; it is DERIVED by {@link enrol}, never hand-written, so
 * it cannot drift from the schema (spec §2b/§2c).
 */
export interface EnrolledTable {
  table: string;
  mode: SyncMode;
  conflictKey: string[];
  watermarkColumn: string | null;
  captureOps: CaptureOp[];
  fkRank: number;
  lane: SyncLane;
  columns: string[];
}

/**
 * Build an {@link EnrolledTable} from a Drizzle table plus its replication metadata. Reads the
 * physical table name and the ordered physical column-name list off the schema object (identical to
 * the old central `columnNamesFor`), so the owning package declares enrolment without `@waitron/sync`
 * ever seeing its schema (spec §2c).
 */
export function enrol(table: Table, meta: Omit<EnrolledTable, "table" | "columns">): EnrolledTable {
  return {
    table: getTableName(table),
    columns: Object.values(getTableColumns(table)).map((c) => c.name),
    ...meta,
  };
}

/** The physical table names on one lane, derived from the assembled enrolment set. */
export function tablesForLane(enrolments: readonly EnrolledTable[], lane: SyncLane): string[] {
  return enrolments.filter((e) => e.lane === lane).map((e) => e.table);
}
