import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql, type SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tablesCreatedBy } from "@waitron/sync-enrolment";
import { CORE_CHANGE_SOURCES, CORE_CLASSIFICATION } from "./classification.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { TRIGGER_ABORT } from "./sql-state.js";
import { captureError, engineErrorMessage } from "./testing/errors.js";
import { useVenueDb } from "./testing/venue-db.js";
import { isRefusal } from "./unique-violation.js";

const DRIZZLE = join(import.meta.dirname, "..", "drizzle");

/** The tables core's migrations LEAVE IN EXISTENCE — CREATEs minus later DROPs, a RENAME
 * counting as a drop of the old name and a create of the new, in filename order (`readdirSync`
 * does not sort). */
function tablesInDrizzle(): Set<string> {
  const files = readdirSync(DRIZZLE)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(DRIZZLE, f), "utf8"));
  return tablesCreatedBy(files);
}

describe("CORE_CLASSIFICATION", () => {
  it("has a valid class and a non-empty reason for every entry", () => {
    for (const c of CORE_CLASSIFICATION) {
      expect(["ledger", "state", "local"]).toContain(c.class);
      expect(c.reason.trim().length).toBeGreaterThan(0);
    }
  });
  it("names each table at most once", () => {
    const names = CORE_CLASSIFICATION.map((c) => c.table);
    expect(new Set(names).size).toBe(names.length);
  });
  it("classifies exactly the tables core's migrations create", () => {
    const classified = new Set(CORE_CLASSIFICATION.map((c) => c.table));
    const created = tablesInDrizzle();
    expect([...created].filter((t) => !classified.has(t)).sort()).toEqual([]);
    expect([...classified].filter((t) => !created.has(t)).sort()).toEqual([]);
  });
});

describe("CORE_CHANGE_SOURCES", () => {
  it("declares the complete today-only groups without quieting saved fields", () => {
    expect(CORE_CHANGE_SOURCES.find((source) => source.table === "dining_tables")?.quiet).toEqual({
      type: "dining_tables.today",
      columns: [
        "on_floor",
        "today_seats",
        "today_fixed",
        "today_x",
        "today_y",
        "today_width",
        "today_height",
        "today_shape",
        "today_rotation",
        "taken_off",
        "today_name",
        "merge_id",
        "merge_before_x",
        "merge_before_y",
        "merge_before_rotation",
      ],
    });
    expect(CORE_CHANGE_SOURCES.find((source) => source.table === "floor_zones")?.quiet).toEqual({
      type: "floor_zones.today",
      columns: [
        "today_business_day",
        "today_revision",
        "today_set_id",
        "today_layout_revision",
        "today_occurrence",
      ],
    });
  });
  it("declares settings changes by module", () => {
    expect(CORE_CHANGE_SOURCES).toContainEqual({
      table: "settings",
      type: "settings",
      typeSuffixColumn: "module",
      related: [],
    });
  });
  it("is not a change source for the table it writes into", () => {
    // `change_log` is classified like every other core table, so the completeness check above
    // passes — but a change trigger on it would insert a row for every row it writes, and that row
    // would trigger another.
    expect(CORE_CLASSIFICATION.map((c) => c.table)).toContain("change_log");
    expect(CORE_CHANGE_SOURCES.map((s) => s.table)).not.toContain("change_log");
  });
  it("is not a change source for the sealed state row", () => {
    expect(CORE_CLASSIFICATION.map((c) => c.table)).toContain("node_sealed_state");
    expect(CORE_CHANGE_SOURCES.map((s) => s.table)).not.toContain("node_sealed_state");
  });
  it("is not a change source for the recovery pack record", () => {
    expect(CORE_CLASSIFICATION).toContainEqual(
      expect.objectContaining({ table: "recovery_packs", class: "local" }),
    );
    expect(CORE_CHANGE_SOURCES.map((s) => s.table)).not.toContain("recovery_packs");
  });
});

/** The append-only tables core took in from catalogue, venue-service, adjustments and handover. */
const FOLDED_APPEND_ONLY = [
  "menu_versions",
  "menu_version_images",
  "sale_receipt_headers",
  "bill_number_allocations",
  "adjustments",
  "adjustment_refunds",
  "adjustment_lines",
  "handover_activations",
] as const;

const AT = "2026-11-06T10:00:00.000Z";
const IMAGE = `${"a".repeat(64)}.png`;

/** One row per table, and an update that changes a column of it. Parents are not what these cases
 * test, so the rows are written with foreign keys off; only the media trigger needs a real image. */
const ROWS: Record<(typeof FOLDED_APPEND_ONLY)[number], { insert: SQL[]; update: SQL }> = {
  menu_versions: {
    insert: [
      sql`insert into menu_versions (id, menu_id, number, document, content_hash, published_at, published_by)
          values ('version-1', 'menu-1', 1, '{}', 'hash', ${AT}, 'person-1')`,
    ],
    update: sql`update menu_versions set published_by = 'person-2'`,
  },
  menu_version_images: {
    insert: [
      sql`insert into media_images (id, filename, names, created_at, updated_at)
          values ('image-1', ${IMAGE}, '{}', ${AT}, ${AT})`,
      sql`insert into menu_version_images (version_id, filename) values ('version-1', ${IMAGE})`,
    ],
    update: sql`update menu_version_images set version_id = 'version-2'`,
  },
  sale_receipt_headers: {
    insert: [
      sql`insert into sale_receipt_headers (sale_id, department_id, trading_name, print_trading_name)
          values ('sale-1', null, 'Bar', 1)`,
    ],
    update: sql`update sale_receipt_headers set trading_name = 'Other'`,
  },
  bill_number_allocations: {
    insert: [
      sql`insert into bill_number_allocations (id, party_id, number, working_order_id, allocated_at)
          values ('allocation-1', 'party-1', 1, 'order-1', ${AT})`,
    ],
    update: sql`update bill_number_allocations set number = 2`,
  },
  adjustments: {
    insert: [
      sql`insert into adjustments (id, working_order_id, splits, reason_id, reason_name, policy_snapshot,
            action, before_amount, after_amount, reduction, nominal_value, requested_by, created_at)
          values ('adjustment-1', 'order-1', '[]', 'reason-1', 'Promotion', '{}', 'discount_amount',
            1000, 900, 100, 100, 'person-1', ${AT})`,
    ],
    update: sql`update adjustments set note = 'changed'`,
  },
  adjustment_refunds: {
    insert: [
      sql`insert into adjustment_refunds (id, adjustment_id, tender_refund_id, amount, created_at)
          values ('refund-link-1', 'adjustment-1', 'tender-refund-1', 100, ${AT})`,
    ],
    update: sql`update adjustment_refunds set amount = 50`,
  },
  adjustment_lines: {
    insert: [
      sql`insert into adjustment_lines (id, adjustment_id, line_id, reduction, quantity)
          values ('adjustment-line-1', 'adjustment-1', 'line-1', 100, 1)`,
    ],
    update: sql`update adjustment_lines set reduction = 50`,
  },
  handover_activations: {
    insert: [
      sql`insert into handover_activations
            (operation_id, scenario, source_node_id, destination_node_id, evidence, person_id, activated_at)
          values ('operation-1', 'controlled', 'node-1', 'node-2', '{}', 'person-1', ${AT})`,
    ],
    update: sql`update handover_activations set person_id = 'person-2'`,
  },
};

describe("the append-only tables core took in from other modules", () => {
  it("CORE_MIGRATIONS names every one of them as append-only", () => {
    expect(CORE_MIGRATIONS.appendOnlyTables).toEqual(
      expect.arrayContaining([...FOLDED_APPEND_ONLY]),
    );
  });

  describe("in a database holding core's set alone", () => {
    const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

    const insertRow = (table: (typeof FOLDED_APPEND_ONLY)[number]) => {
      suite.db.run(sql`pragma foreign_keys = off`);
      try {
        for (const statement of ROWS[table].insert) suite.db.run(statement);
      } finally {
        suite.db.run(sql`pragma foreign_keys = on`);
      }
      expect(suite.db.all(sql`select 1 from ${sql.identifier(table)}`)).toHaveLength(1);
    };

    it.each(FOLDED_APPEND_ONLY)("%s accepts an insert and refuses an update", async (table) => {
      insertRow(table);
      const update = await captureError(() => suite.db.run(ROWS[table].update));
      expect(isRefusal(update, TRIGGER_ABORT)).toBe(true);
      expect(engineErrorMessage(update)).toBe(`${table} is append-only`);
    });

    it.each(FOLDED_APPEND_ONLY)("%s refuses a delete", async (table) => {
      insertRow(table);
      const deletion = await captureError(() =>
        suite.db.run(sql`delete from ${sql.identifier(table)}`),
      );
      expect(isRefusal(deletion, TRIGGER_ABORT)).toBe(true);
      expect(engineErrorMessage(deletion)).toBe(`${table} is append-only`);
      expect(suite.db.all(sql`select 1 from ${sql.identifier(table)}`)).toHaveLength(1);
    });
  });
});
