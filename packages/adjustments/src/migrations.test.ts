import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  engineErrorMessage,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  triggerRaised,
  UNIQUE_VIOLATION,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { seedReason, seedWorkingOrder } from "../test/seed.js";

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

/** A comp of one of two €25.00 steaks, as the columns store it; `overrides` replaces columns. */
async function adjustmentRow(
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const reason = await seedReason(db);
  return {
    id: randomUUID(),
    working_order_id: await seedWorkingOrder(db),
    line_id: randomUUID(),
    split_line_ids: "[]",
    line_name: "Steak",
    line_quantity: 2000,
    line_list_unit_price: 2500,
    credited_to: randomUUID(),
    reason_id: reason.id,
    reason_name: "Complaint",
    policy_snapshot: "{}",
    action: "comp",
    quantity: 1000,
    percent_bp: null,
    before_amount: 5000,
    after_amount: 2500,
    reduction: 2500,
    nominal_value: 2500,
    requested_by: randomUUID(),
    approved_by: null,
    note: null,
    stage: "served",
    by_guest: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** A €5.00 discount on the whole bill: no line, no stage, no quantity. */
const BILL_LEVEL = {
  line_id: null,
  line_name: null,
  line_quantity: null,
  line_list_unit_price: null,
  credited_to: null,
  action: "discount_amount",
  quantity: null,
  stage: null,
  before_amount: 4248,
  after_amount: 3748,
  reduction: 500,
  nominal_value: 500,
};

function insertAdjustment(row: Record<string, unknown>) {
  const columns = Object.keys(row);
  return db.execute(
    sql`insert into adjustments (${sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )}) values (${sql.join(
      columns.map((column) => sql`${row[column]}`),
      sql`, `,
    )})`,
  );
}

async function adjustmentRefused(
  overrides: Record<string, unknown>,
  constraint: string,
): Promise<void> {
  const error = await captureError(async () => insertAdjustment(await adjustmentRow(overrides)));
  expect(isRefusal(error, CHECK_VIOLATION), constraint).toBe(true);
  expect(engineErrorMessage(error), constraint).toContain(constraint);
}

describe("the adjustments table", () => {
  it("has the snapshot, policy and amount columns, nullable only where a bill has no line", async () => {
    const columns = await db.execute<{ name: string; notnull: number }>(
      sql`select name, "notnull" from pragma_table_info('adjustments')`,
    );
    expect(Object.fromEntries(columns.rows.map((c) => [c.name, c.notnull]))).toEqual({
      id: 1,
      working_order_id: 1,
      line_id: 0,
      split_line_ids: 1,
      line_name: 0,
      line_quantity: 0,
      line_list_unit_price: 0,
      credited_to: 0,
      reason_id: 1,
      reason_name: 1,
      policy_snapshot: 1,
      action: 1,
      quantity: 0,
      percent_bp: 0,
      before_amount: 1,
      after_amount: 1,
      reduction: 1,
      nominal_value: 1,
      requested_by: 1,
      approved_by: 0,
      note: 0,
      stage: 0,
      by_guest: 1,
      created_at: 1,
    });
  });

  it("accepts a line adjustment and a bill-level discount", async () => {
    await insertAdjustment(await adjustmentRow());
    await insertAdjustment(await adjustmentRow(BILL_LEVEL));
    await insertAdjustment(
      await adjustmentRow({
        action: "discount_percent",
        percent_bp: 1000,
        after_amount: 4500,
        reduction: 500,
        nominal_value: 500,
      }),
    );
    expect((await db.execute(sql`select count(*) as n from adjustments`)).rows).toEqual([{ n: 3 }]);
  });

  it("refuses an action or a stage outside its vocabulary", async () => {
    await adjustmentRefused({ action: "refund" }, "adjustments_action_ck");
    await adjustmentRefused({ stage: "eaten" }, "adjustments_stage_ck");
  });

  it("refuses a reduction that is not before less after, a rise, and a negative value", async () => {
    await adjustmentRefused({ reduction: 2400 }, "adjustments_amounts_ck");
    await adjustmentRefused(
      { before_amount: 2500, after_amount: 5000, reduction: -2500 },
      "adjustments_amounts_ck",
    );
    await adjustmentRefused(
      { before_amount: -1, after_amount: -1, reduction: 0 },
      "adjustments_amounts_ck",
    );
    await adjustmentRefused({ nominal_value: -1 }, "adjustments_amounts_ck");
  });

  it("holds a percentage on a percentage discount only, within 1..10000 basis points", async () => {
    await adjustmentRefused({ action: "discount_percent" }, "adjustments_percent_ck");
    await adjustmentRefused({ percent_bp: 1000 }, "adjustments_percent_ck");
    await adjustmentRefused(
      { action: "discount_percent", percent_bp: 0 },
      "adjustments_percent_ck",
    );
    await adjustmentRefused(
      { action: "discount_percent", percent_bp: 10001 },
      "adjustments_percent_ck",
    );
  });

  it("refuses a blank reason name", async () => {
    await adjustmentRefused({ reason_name: "  " }, "adjustments_reason_name_ck");
  });

  it("refuses a line adjustment missing its snapshot, stage or a quantity within the line", async () => {
    await adjustmentRefused({ line_name: null }, "adjustments_line_level_ck");
    await adjustmentRefused({ line_quantity: null }, "adjustments_line_level_ck");
    await adjustmentRefused({ line_list_unit_price: null }, "adjustments_line_level_ck");
    await adjustmentRefused({ line_list_unit_price: -1 }, "adjustments_line_level_ck");
    await adjustmentRefused({ stage: null }, "adjustments_line_level_ck");
    await adjustmentRefused({ quantity: null }, "adjustments_line_level_ck");
    await adjustmentRefused({ quantity: 0 }, "adjustments_line_level_ck");
    await adjustmentRefused({ quantity: 3000 }, "adjustments_line_level_ck");
  });

  it("refuses a bill-level row that carries a line's snapshot, a split, or a line action", async () => {
    await adjustmentRefused({ ...BILL_LEVEL, line_name: "Steak" }, "adjustments_bill_level_ck");
    await adjustmentRefused({ ...BILL_LEVEL, line_quantity: 1000 }, "adjustments_bill_level_ck");
    await adjustmentRefused(
      { ...BILL_LEVEL, line_list_unit_price: 1 },
      "adjustments_bill_level_ck",
    );
    await adjustmentRefused(
      { ...BILL_LEVEL, credited_to: randomUUID() },
      "adjustments_bill_level_ck",
    );
    await adjustmentRefused({ ...BILL_LEVEL, quantity: 1000 }, "adjustments_bill_level_ck");
    await adjustmentRefused({ ...BILL_LEVEL, stage: "fired" }, "adjustments_bill_level_ck");
    await adjustmentRefused(
      { ...BILL_LEVEL, split_line_ids: JSON.stringify([randomUUID()]) },
      "adjustments_bill_level_ck",
    );
    await adjustmentRefused({ ...BILL_LEVEL, action: "comp" }, "adjustments_bill_level_ck");
  });

  it("refuses a working order or a reason that does not exist", async () => {
    const order = await captureError(async () =>
      insertAdjustment(await adjustmentRow({ working_order_id: randomUUID() })),
    );
    expect(isRefusal(order, FOREIGN_KEY_VIOLATION)).toBe(true);
    const reason = await captureError(async () =>
      insertAdjustment(await adjustmentRow({ reason_id: randomUUID() })),
    );
    expect(isRefusal(reason, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("is append-only: an update and a delete are both refused", async () => {
    const row = await adjustmentRow();
    await insertAdjustment(row);
    const update = await captureError(() =>
      db.execute(sql`update adjustments set reduction = 0 where id = ${row.id as string}`),
    );
    expect(triggerRaised(update, "adjustments is append-only")).toBe(true);
    const remove = await captureError(() =>
      db.execute(sql`delete from adjustments where id = ${row.id as string}`),
    );
    expect(triggerRaised(remove, "adjustments is append-only")).toBe(true);
  });
});
