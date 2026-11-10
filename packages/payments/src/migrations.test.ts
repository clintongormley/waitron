import { randomUUID } from "node:crypto";
import { decimal, deviceOrigin } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  captureError,
  isRefusal,
  engineErrorMessage,
  type Database,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "../test/seed.js";
import { insertCapturedPayment } from "./store.js";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;
beforeAll(() => {
  db = suite.db;
});

/** A `type` rather than an `interface` so it satisfies `db.execute`'s `Record<string, unknown>`
 * row constraint. */
type ColumnRow = {
  name: string;
  type: string;
  notnull: number;
};

/** A `type` for the reason {@link ColumnRow} gives. */
type IndexRow = {
  name: string;
  unique: number;
  origin: string;
};

async function columnsOf(table: string): Promise<ColumnRow[]> {
  const rows = await db.execute<ColumnRow>(
    sql`select name, type, "notnull" from pragma_table_info(${table})`,
  );
  return rows.rows;
}

async function columnOf(table: string, column: string): Promise<ColumnRow | undefined> {
  return (await columnsOf(table)).find((c) => c.name === column);
}

/**
 * The values `payments_state_ck` accepts, read from its stored text:
 * `CONSTRAINT "payments_state_ck" CHECK("payments"."state" in ('attempting', 'captured', …))`.
 * Throws rather than returning an empty list, so a renamed or dropped constraint fails loudly
 * instead of passing the `toContain` assertions vacuously.
 */
async function acceptedPaymentStates(): Promise<string[]> {
  const rows = await db.execute<{ sql: string }>(
    sql`select sql from sqlite_master where type = 'table' and name = 'payments'`,
  );
  const ddl = rows.rows[0]?.sql;
  if (ddl === undefined) throw new Error("no `payments` table in sqlite_master");
  const match = /CONSTRAINT "payments_state_ck" CHECK\([^)]*\bin \(([^)]*)\)\)/.exec(ddl);
  if (match === null) {
    throw new Error(`no payments_state_ck \`in (…)\` list found in:\n${ddl}`);
  }
  return match[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, ""));
}

describe("payments migrations", () => {
  it("apply cleanly after core", async () => {
    const rows = await db.execute<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'payments'`,
    );
    expect(rows.rows.map((r) => r.name)).toEqual(["payments"]);
  });

  it("adds a nullable external_ref column to payments", async () => {
    expect(await columnOf("payments", "external_ref")).toEqual({
      name: "external_ref",
      type: "TEXT",
      notnull: 0,
    });
  });

  it("accepts 'attempting' as a payment state", async () => {
    expect(await acceptedPaymentStates()).toContain("attempting");
  });

  it("accepts exactly the seven payment states", async () => {
    expect(await acceptedPaymentStates()).toEqual([
      "attempting",
      "captured",
      "voided",
      "refunded",
      "partially_refunded",
      "failed",
      "initiated",
    ]);
  });

  it.each(["accepted_offline", "settled", "declined"])(
    "refuses a payment moved to the retired state %s",
    async (state) => {
      const seeded = await seedWorkingOrder(db);
      const paymentRef = randomUUID();
      await withTransaction(db, (tx) =>
        insertCapturedPayment(tx, {
          origin: deviceOrigin(seeded.deviceId),
          workingOrderId: seeded.workingOrderId,
          nodeId: seeded.nodeId,
          provider: "simulator",
          paymentRef,
          amount: decimal("10.00"),
          settledAt: new Date(),
        }),
      );
      const error = await captureError(async () => {
        await db.execute(
          sql`update payments set state = ${state} where payment_ref = ${paymentRef}`,
        );
      });
      expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
      expect(engineErrorMessage(error)).toMatch(/payments_state_ck/);
      expect(
        (await db.execute(sql`select state from payments where payment_ref = ${paymentRef}`)).rows,
      ).toEqual([{ state: "captured" }]);
    },
  );

  it("still accepts a captured payment moving to refunded", async () => {
    const seeded = await seedWorkingOrder(db);
    const paymentRef = randomUUID();
    await withTransaction(db, (tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        nodeId: seeded.nodeId,
        provider: "simulator",
        paymentRef,
        amount: decimal("10.00"),
        settledAt: new Date(),
      }),
    );
    await db.execute(sql`update payments set state = 'refunded' where payment_ref = ${paymentRef}`);
    expect(
      (await db.execute(sql`select state from payments where payment_ref = ${paymentRef}`)).rows,
    ).toEqual([{ state: "refunded" }]);
  });

  it("accepts 'initiated' as a payment state", async () => {
    expect(await acceptedPaymentStates()).toContain("initiated");
  });

  it("adds a nullable reconcile_remediated_at column to payments", async () => {
    expect(await columnOf("payments", "reconcile_remediated_at")).toEqual({
      name: "reconcile_remediated_at",
      type: "TEXT",
      notnull: 0,
    });
  });

  it("creates the reconcile sweep index on payments", async () => {
    const indexes = await db.execute<IndexRow>(sql`pragma index_list('payments')`);
    const reconcile = indexes.rows.filter((r) => r.name === "payments_reconcile_idx");
    expect(reconcile).toHaveLength(1);
    // NON-UNIQUE: a unique one would refuse two payments sharing a provider and settlement time.
    expect(reconcile[0]!.unique).toBe(0);
    const columns = await db.execute<{ name: string }>(
      sql`select name from pragma_index_info('payments_reconcile_idx')`,
    );
    expect(columns.rows.map((r) => r.name)).toEqual(["provider", "settled_at"]);
  });

  it("leaves every money column a count of whole cents", async () => {
    // Nothing in the schema refuses a fractional value in these columns; only
    // `packages/shared/src/cents.ts` does, above the row.
    const money = [
      ["payment_refunds", "amount"],
      ["payments", "amount"],
    ] as const;
    const found = [];
    for (const [table_name, column_name] of money) {
      found.push({ table_name, column: await columnOf(table_name, column_name) });
    }
    expect(found).toEqual([
      { table_name: "payment_refunds", column: { name: "amount", type: "INTEGER", notnull: 1 } },
      { table_name: "payments", column: { name: "amount", type: "INTEGER", notnull: 1 } },
    ]);
  });

  it("carries no tenant_id column on any table in the set", async () => {
    const found: string[] = [];
    for (const table of ["payments", "payment_refunds", "card_readers", "device_card_readers"]) {
      for (const column of await columnsOf(table)) {
        if (column.name === "tenant_id") found.push(`${table}.${column.name}`);
      }
    }
    expect(found).toEqual([]);
  });
});
