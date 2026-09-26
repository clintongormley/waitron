import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  engineErrorMessage,
  isRefusal,
  UNIQUE_VIOLATION,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

interface Row {
  name?: string;
  actions?: string;
  maxPercent?: number | null;
  maxAmount?: number | null;
  applyRole?: string;
  approverRole?: string;
  active?: number;
  position?: number;
}

function insert(row: Row = {}) {
  return sql`insert into adjustment_reasons
      (id, name, names, actions, max_percent, max_amount, apply_role, approver_role,
       note_required, active, position, created_at)
    values (${randomUUID()}, ${row.name ?? "Complaint"}, '{}', ${row.actions ?? '["comp"]'},
      ${row.maxPercent ?? null}, ${row.maxAmount ?? null}, ${row.applyRole ?? "supervisor"},
      ${row.approverRole ?? "manager"}, 1, ${row.active ?? 1}, ${row.position ?? 0},
      ${new Date().toISOString()})`;
}

async function refusedBy(row: Row, constraint: string): Promise<void> {
  const error = await captureError(() => db.execute(insert(row)));
  expect(isRefusal(error, CHECK_VIOLATION), constraint).toBe(true);
  expect(engineErrorMessage(error), constraint).toContain(constraint);
}

describe("the adjustments migration set", () => {
  it("creates adjustment_reasons with the policy's columns and no tenant column", async () => {
    const columns = await db.execute<{ name: string; notnull: number; pk: number }>(
      sql`select name, "notnull", pk from pragma_table_info('adjustment_reasons')`,
    );
    expect(
      Object.fromEntries(columns.rows.map((c) => [c.name, { notNull: c.notnull, pk: c.pk }])),
    ).toEqual({
      id: { notNull: 1, pk: 1 },
      name: { notNull: 1, pk: 0 },
      names: { notNull: 1, pk: 0 },
      actions: { notNull: 1, pk: 0 },
      max_percent: { notNull: 0, pk: 0 },
      max_amount: { notNull: 0, pk: 0 },
      apply_role: { notNull: 1, pk: 0 },
      approver_role: { notNull: 1, pk: 0 },
      note_required: { notNull: 1, pk: 0 },
      active: { notNull: 1, pk: 0 },
      position: { notNull: 1, pk: 0 },
      created_at: { notNull: 1, pk: 0 },
    });
  });

  it("accepts a well-formed reason, with both limits empty", async () => {
    await db.execute(insert());
    await db.execute(insert({ name: "Staff meal", maxPercent: 10000, maxAmount: 1 }));
    expect((await db.execute(sql`select count(*) as n from adjustment_reasons`)).rows).toEqual([
      { n: 2 },
    ]);
  });

  it("refuses a role outside the ladder in either role column", async () => {
    await refusedBy({ applyRole: "owner" }, "adjustment_reasons_apply_role_ck");
    await refusedBy({ approverRole: "owner" }, "adjustment_reasons_approver_role_ck");
  });

  it("refuses a percentage limit of zero or above 100%, and an amount limit of zero", async () => {
    await refusedBy({ maxPercent: 0 }, "adjustment_reasons_max_percent_ck");
    await refusedBy({ maxPercent: 10001 }, "adjustment_reasons_max_percent_ck");
    await refusedBy({ maxAmount: 0 }, "adjustment_reasons_max_amount_ck");
  });

  it("refuses an empty action list, a blank name and a negative position", async () => {
    await refusedBy({ actions: "[]" }, "adjustment_reasons_actions_ck");
    await refusedBy({ name: "  " }, "adjustment_reasons_name_ck");
    await refusedBy({ position: -1 }, "adjustment_reasons_position_ck");
  });

  it("refuses a second ACTIVE reason under a name, and lets an inactive one keep it", async () => {
    await db.execute(insert({ name: "Complaint", active: 0 }));
    await db.execute(insert({ name: "Complaint" }));
    const second = await captureError(() => db.execute(insert({ name: "Complaint" })));
    expect(isRefusal(second, UNIQUE_VIOLATION)).toBe(true);
    expect(engineErrorMessage(second)).toContain("adjustment_reasons.name");
  });
});
