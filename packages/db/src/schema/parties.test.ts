import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { checkFailed, refusalOn } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { diningTables } from "./dining-tables.js";
import { workingOrders } from "./orders.js";
import { parties, partyTables, serviceCommands } from "./parties.js";
import { locations, tenants, tills } from "./tenants.js";

const LOCATION = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL = "bbbbbbbb-1111-4000-8000-000000000001";
/** An order opened from the dashboard at `LOCATION`, needing no device. */
const DASHBOARD = { source: "dashboard", deviceId: null, locationId: LOCATION } as const;
const OPERATOR = "bbbbbbbb-2222-4000-8000-000000000001";

describe("parties, party_tables and service_commands", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let nodeId = "";
  let orderSeq = 0;

  const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(suite.db, fn);

  beforeAll(async () => {
    const db = suite.db;
    await db.insert(tenants).values({ id: 1, country: "ES", taxId: "B00000000", legalName: "T" });
    await db.insert(locations).values({
      id: LOCATION,
      name: "Room",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
    await db.insert(tills).values({ id: TILL, locationId: LOCATION, name: "Till" });
    nodeId = await seedNode(db, brandLocationId(LOCATION));
  });

  async function table(label: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(diningTables)
        .values({ locationId: LOCATION, label })
        .returning({ id: diningTables.id });
      return row!.id;
    });
  }

  async function party(): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(parties)
        .values({ openedBy: OPERATOR })
        .returning({ id: parties.id });
      return row!.id;
    });
  }

  it("opens a party with its defaults: open, revision 0, no guest count", async () => {
    const id = await party();
    const [row] = await inTx((tx) => tx.select().from(parties).where(eq(parties.id, id)));
    expect(row).toMatchObject({
      state: "open",
      revision: 0,
      guestCount: null,
      closedAt: null,
      closedBy: null,
      mergedIntoPartyId: null,
      billRequestedAt: null,
      openedBy: OPERATOR,
    });
  });

  it("refuses a second ACTIVE membership for one table by the partial unique index", async () => {
    const table4 = await table("Table 4");
    const first = await party();
    const second = await party();
    await inTx((tx) => tx.insert(partyTables).values({ partyId: first, tableId: table4 }));

    const error = await captureError(() =>
      inTx((tx) => tx.insert(partyTables).values({ partyId: second, tableId: table4 })),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "party_tables", columns: ["table_id"] }),
    ).toBe(true);
  });

  it("accepts a new active membership once the old one has ended", async () => {
    const table5 = await table("Table 5");
    const first = await party();
    const second = await party();
    await inTx((tx) =>
      tx
        .insert(partyTables)
        .values({ partyId: first, tableId: table5, leftAt: new Date().toISOString() }),
    );
    await inTx((tx) => tx.insert(partyTables).values({ partyId: second, tableId: table5 }));
    const rows = await inTx((tx) =>
      tx.select().from(partyTables).where(eq(partyTables.tableId, table5)),
    );
    expect(rows).toHaveLength(2);
  });

  it("refuses a guest count below one", async () => {
    const error = await captureError(() =>
      inTx((tx) => tx.insert(parties).values({ openedBy: OPERATOR, guestCount: 0 })),
    );
    expect(checkFailed(error, "parties_guest_count_ck")).toBe(true);
  });

  it("refuses a state outside the vocabulary", async () => {
    const id = await party();
    const error = await captureError(() =>
      inTx(async (tx) => {
        await tx.execute(sql`update parties set state = 'paid' where id = ${id}`);
      }),
    );
    expect(checkFailed(error, "parties_state_ck")).toBe(true);
  });

  it("refuses the party state needs_clearing, which is now a table's condition only, and accepts closed", async () => {
    const id = await party();
    const closedAt = new Date().toISOString();
    const error = await captureError(() =>
      inTx(async (tx) => {
        await tx.execute(
          sql`update parties set state = 'needs_clearing', closed_at = ${closedAt} where id = ${id}`,
        );
      }),
    );
    expect(checkFailed(error, "parties_state_ck")).toBe(true);
    await inTx(async (tx) => {
      await tx.execute(
        sql`update parties set state = 'closed', closed_at = ${closedAt} where id = ${id}`,
      );
    });
    const [row] = await inTx((tx) =>
      tx.select({ state: parties.state }).from(parties).where(eq(parties.id, id)),
    );
    expect(row!.state).toBe("closed");
  });

  it("refuses a party that has left open without a closing time, and an open one that has one", async () => {
    const id = await party();
    const leftOpen = await captureError(() =>
      inTx((tx) => tx.update(parties).set({ state: "closed" }).where(eq(parties.id, id))),
    );
    expect(checkFailed(leftOpen, "parties_closed_at_ck")).toBe(true);
    const stamped = await captureError(() =>
      inTx((tx) =>
        tx.update(parties).set({ closedAt: new Date().toISOString() }).where(eq(parties.id, id)),
      ),
    );
    expect(checkFailed(stamped, "parties_closed_at_ck")).toBe(true);
  });

  it("refuses a merge into itself, and a merged party that is not closed", async () => {
    const id = await party();
    const other = await party();
    const self = await captureError(() =>
      inTx((tx) =>
        tx
          .update(parties)
          .set({ state: "closed", closedAt: new Date().toISOString(), mergedIntoPartyId: id })
          .where(eq(parties.id, id)),
      ),
    );
    expect(checkFailed(self, "parties_merged_into_ck")).toBe(true);
    const stillOpen = await captureError(() =>
      inTx((tx) => tx.update(parties).set({ mergedIntoPartyId: other }).where(eq(parties.id, id))),
    );
    expect(checkFailed(stillOpen, "parties_merged_into_ck")).toBe(true);
    // Control: a closed party merged into another is accepted.
    await inTx((tx) =>
      tx
        .update(parties)
        .set({ state: "closed", closedAt: new Date().toISOString(), mergedIntoPartyId: other })
        .where(eq(parties.id, id)),
    );
  });

  it("keys a working order to its party", async () => {
    const id = await party();
    orderSeq += 1;
    const [order] = await inTx((tx) =>
      tx
        .insert(workingOrders)
        .values({ ...DASHBOARD, nodeId, orderNumber: orderSeq, partyId: id })
        .returning({ partyId: workingOrders.partyId }),
    );
    expect(order!.partyId).toBe(id);
    const keys = suite.db.all<{ table: string; from: string; to: string }>(
      sql.raw(`select "table", "from", "to" from pragma_foreign_key_list('working_orders')`),
    );
    expect(keys.filter((key) => key.from === "party_id")).toEqual([
      { table: "parties", from: "party_id", to: "id" },
    ]);
  });

  it("refuses the same submission id twice in one scope, and accepts it in another", async () => {
    const scopeId = randomUUID();
    const row = {
      scopeKind: "party" as const,
      scopeId,
      submissionId: "sub-1",
      kind: "k",
      fingerprint: "f",
      result: { value: null },
    };
    await inTx((tx) => tx.insert(serviceCommands).values(row));
    const error = await captureError(() => inTx((tx) => tx.insert(serviceCommands).values(row)));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "service_commands",
        columns: ["scope_kind", "scope_id", "submission_id"],
      }),
    ).toBe(true);
    await inTx((tx) => tx.insert(serviceCommands).values({ ...row, scopeKind: "bill" }));
    await inTx((tx) => tx.insert(serviceCommands).values({ ...row, scopeId: randomUUID() }));
  });

  it("refuses the command scope visit and accepts party", async () => {
    const error = await captureError(() =>
      inTx(async (tx) => {
        await tx.execute(sql`
          insert into service_commands (id, scope_kind, scope_id, submission_id, kind, fingerprint, result, created_at)
          values (${randomUUID()}, 'visit', ${randomUUID()}, 'sub-v', 'k', 'f', '{}', ${new Date().toISOString()})
        `);
      }),
    );
    expect(checkFailed(error, "service_commands_scope_kind_ck")).toBe(true);
    const scopeId = randomUUID();
    await inTx((tx) =>
      tx.insert(serviceCommands).values({
        scopeKind: "party",
        scopeId,
        submissionId: "sub-p",
        kind: "k",
        fingerprint: "f",
        result: { value: null },
      }),
    );
    const rows = await inTx((tx) =>
      tx
        .select({ scopeKind: serviceCommands.scopeKind })
        .from(serviceCommands)
        .where(eq(serviceCommands.scopeId, scopeId)),
    );
    expect(rows).toEqual([{ scopeKind: "party" }]);
  });

  it("names visit in no object of the migrated database", () => {
    const named = suite.db.all<{ type: string; name: string }>(sql`
      select type, name from sqlite_master
      where lower(name) like '%visit%' or lower(sql) like '%visit%'
      order by name
    `);
    expect(named).toEqual([]);
  });
});
