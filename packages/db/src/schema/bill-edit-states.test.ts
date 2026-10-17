import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkFailed } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, NOT_NULL_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { isRefusal } from "../unique-violation.js";
import { workingOrders } from "./orders.js";
import { locations } from "./tenants.js";

const ANA = "cccccccc-2222-4000-8000-000000000001";
const LUIS = "cccccccc-2222-4000-8000-000000000002";

describe("bill editing state", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  async function bill() {
    return withTransaction(suite.db, async (tx) => {
      const [location] = await tx
        .insert(locations)
        .values({
          name: "Dining room",
          invoiceLocales: ["en"],
          operationDescription: "Restaurant",
        })
        .returning();
      const [row] = await tx
        .insert(workingOrders)
        .values({
          source: "dashboard",
          locationId: location!.id,
          orderNumber: 1,
        })
        .returning();
      return row!;
    });
  }

  const read = (billId: string) =>
    suite.db.execute(sql`
    select bill_id, editor_id, editor_version from bill_edit_states where bill_id = ${billId}
  `);
  const insert = (billId: string, editorId: string | null = null, version = 0) =>
    withTransaction(suite.db, (tx) =>
      tx.execute(sql`
      insert into bill_edit_states (bill_id, editor_id, editor_version)
      values (${billId}, ${editorId}, ${version})
    `),
    );

  it("defaults an unowned bill to version zero without changing the financial row", async () => {
    const tables = await suite.db.execute(sql`
      select name from sqlite_master where type = 'table' and name = 'bill_edit_states'
    `);
    expect(tables.rows).toEqual([{ name: "bill_edit_states" }]);
    const row = await bill();
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
      insert into bill_edit_states (bill_id) values (${row.id})
    `),
    );
    expect((await read(row.id)).rows).toEqual([
      { bill_id: row.id, editor_id: null, editor_version: 0 },
    ]);
    expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, row.id))).toEqual(
      [row],
    );
  });

  it("retains the version through release and reacquisition independently of another bill", async () => {
    const first = await bill(),
      second = await bill();
    await insert(first.id, ANA, 1);
    await insert(second.id, LUIS, 7);
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update bill_edit_states set editor_id = null, editor_version = 2 where bill_id = ${first.id}`,
      );
    });
    expect((await read(first.id)).rows).toEqual([
      { bill_id: first.id, editor_id: null, editor_version: 2 },
    ]);
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update bill_edit_states set editor_id = ${LUIS}, editor_version = 3 where bill_id = ${first.id}`,
      );
    });
    expect((await read(first.id)).rows).toEqual([
      { bill_id: first.id, editor_id: LUIS, editor_version: 3 },
    ]);
    expect((await read(second.id)).rows).toEqual([
      { bill_id: second.id, editor_id: LUIS, editor_version: 7 },
    ]);
  });

  it("refuses a negative ownership version", async () => {
    const row = await bill();
    const error = await captureError(() => insert(row.id, ANA, -1));
    expect(checkFailed(error, "bill_edit_states_version_ck")).toBe(true);
    expect((await read(row.id)).rows).toEqual([]);
  });

  it("refuses updating a retained version to a negative value", async () => {
    const row = await bill();
    await insert(row.id, ANA, 4);
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.execute(sql`
      update bill_edit_states set editor_version = -1 where bill_id = ${row.id}
    `),
      ),
    );
    expect(checkFailed(error, "bill_edit_states_version_ck")).toBe(true);
    expect((await read(row.id)).rows).toEqual([
      { bill_id: row.id, editor_id: ANA, editor_version: 4 },
    ]);
  });

  it("refuses an explicitly null ownership version", async () => {
    const row = await bill();
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.execute(sql`
      insert into bill_edit_states (bill_id, editor_version) values (${row.id}, null)
    `),
      ),
    );
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
  });

  it("refuses state for a bill that does not exist", async () => {
    const error = await captureError(() => insert(randomUUID(), ANA, 1));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("refuses a second version row for one bill", async () => {
    const row = await bill();
    await insert(row.id, ANA, 1);
    const error = await captureError(() => insert(row.id, LUIS, 2));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
    expect((await read(row.id)).rows).toEqual([
      { bill_id: row.id, editor_id: ANA, editor_version: 1 },
    ]);
  });

  it("deletes only the deleted bill's state", async () => {
    const first = await bill(),
      second = await bill();
    await insert(first.id, ANA, 1);
    await insert(second.id, LUIS, 7);
    await withTransaction(suite.db, (tx) =>
      tx.delete(workingOrders).where(eq(workingOrders.id, first.id)),
    );
    expect((await read(first.id)).rows).toEqual([]);
    expect((await read(second.id)).rows).toEqual([
      { bill_id: second.id, editor_id: LUIS, editor_version: 7 },
    ]);
  });
});
