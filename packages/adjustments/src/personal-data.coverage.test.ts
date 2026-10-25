// Weaker than its name. It knows an actor column only by its name, so a person column under any
// other name is missed until someone reads it; a person id inside a JSON column (`splits`,
// `comped_extras`, `policy_snapshot`) is not seen; and it proves a column was classified, not that
// ADJUSTMENTS_PERSONAL_DATA honours the classification (personal-data.test.ts does that).
import { readFileSync, readdirSync } from "node:fs";
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

// Copied from apps/server/src/personal-data-actions.coverage.test.ts, which a package cannot import.
const ACTOR_COLUMN =
  /(^|_)(person_id|person|by|operator_id|actor_id)$|^(credited_to|owner_id|editor_id)$/;

const READ = ["adjustments.requested_by", "adjustments.approved_by"];

const NOT_YET: Record<string, string> = {
  "adjustments.credited_to":
    'whose sale the item counted as: not in the download yet: backlog, The rest of "who did what" in the download',
};

const ADJUSTMENTS_COLUMNS = {
  in: [
    "action",
    "created_at",
    "working_order_id",
    "line_name",
    "quantity",
    "percent_bp",
    "reduction",
    "nominal_value",
    "reason_name",
    "stage",
    "charge_kept",
    "preparation_started",
    "requested_by",
    "approved_by",
    "by_guest",
    "id",
  ],
  out: [
    "note",
    "credited_to",
    "line_id",
    "splits",
    "comped_extras",
    "reason_id",
    "policy_snapshot",
    "line_quantity",
    "line_list_unit_price",
    "before_amount",
    "after_amount",
    "refund_handoff",
    "refund_value",
  ],
};

const tables = Object.values(schema as Record<string, unknown>).flatMap((value) =>
  is(value, SQLiteTable) ? [getTableConfig(value)] : [],
);

function newestSnapshotTables(): string[] {
  const meta = new URL("../drizzle/meta/", import.meta.url);
  const newest = readdirSync(meta)
    .filter((name) => /^\d+_snapshot\.json$/.test(name))
    .sort()
    .at(-1)!;
  const snapshot = JSON.parse(readFileSync(new URL(newest, meta), "utf8")) as {
    tables: Record<string, { name: string }>;
  };
  return Object.values(snapshot.tables).map((table) => table.name);
}

describe("adjustments personal-data classification", () => {
  it("classifies every actor column of the adjustments tables exactly once", () => {
    const actorColumns = tables.flatMap((config) =>
      config.columns
        .filter((column) => ACTOR_COLUMN.test(column.name))
        .map((column) => `${config.name}.${column.name}`),
    );
    const classified = [...READ, ...Object.keys(NOT_YET)];
    expect(classified.filter((column, index) => classified.indexOf(column) !== index)).toEqual([]);
    expect(actorColumns.sort()).toEqual(classified.sort());
  });

  it("walks every table of the newest adjustments snapshot", () => {
    expect(tables.map((config) => config.name).sort()).toEqual(newestSnapshotTables().sort());
  });

  it("classifies every column of adjustments exactly once", () => {
    const config = tables.find((table) => table.name === "adjustments");
    expect(config).toBeDefined();
    const { in: included, out: excluded } = ADJUSTMENTS_COLUMNS;
    expect(included.filter((column) => excluded.includes(column))).toEqual([]);
    expect(config!.columns.map((c) => c.name).sort()).toEqual([...included, ...excluded].sort());
  });
});
