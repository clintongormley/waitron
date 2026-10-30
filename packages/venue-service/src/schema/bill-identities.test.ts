import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  captureError,
  checkFailed,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  locations,
  parties,
  refusalOn,
  triggerRaised,
  UNIQUE_VIOLATION,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { VENUE_SERVICE_MIGRATIONS } from "../migrations.js";
import { billIdentities, billNumberAllocations } from "./bill-identities.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const actor = randomUUID();
let locationId: string;
let partyId: string;
let nextOrderNumber = 1;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Sala",
      invoiceLocales: ["en"],
      operationDescription: "Restaurant",
      timeZone: "UTC",
    })
    .returning();
  locationId = location!.id;
  partyId = await newParty();
});

async function newParty(): Promise<string> {
  const [party] = await suite.db.insert(parties).values({ openedBy: actor }).returning();
  return party!.id;
}

async function newBill(party: string | null = partyId): Promise<string> {
  const [order] = await suite.db
    .insert(workingOrders)
    .values({ locationId, partyId: party, orderNumber: nextOrderNumber++, source: "dashboard" })
    .returning();
  return order!.id;
}

function identify(values: typeof billIdentities.$inferInsert) {
  return captureError(() => suite.db.insert(billIdentities).values(values));
}

describe("A803 bill identities", () => {
  it("A803 bill identities: a second row for one bill is refused", async () => {
    const bill = await newBill();
    await suite.db.insert(billIdentities).values({ workingOrderId: bill, partyId, number: 1 });
    const error = await identify({ workingOrderId: bill, partyId, number: 2 });
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "bill_identities",
        columns: ["working_order_id"],
      }),
    ).toBe(true);
  });

  it("A803 bill identities: two bills of one party with one number are refused, and two counter-order rows with no number are not", async () => {
    const first = await newBill();
    const second = await newBill();
    await suite.db.insert(billIdentities).values({ workingOrderId: first, partyId, number: 1 });
    const error = await identify({ workingOrderId: second, partyId, number: 1 });
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "bill_identities",
        columns: ["party_id", "number"],
      }),
    ).toBe(true);

    const counterA = await newBill(null);
    const counterB = await newBill(null);
    await suite.db.insert(billIdentities).values([
      { workingOrderId: counterA, name: "Clint" },
      { workingOrderId: counterB, name: "Ana" },
    ]);
    const rows = await suite.db
      .select({ id: billIdentities.workingOrderId })
      .from(billIdentities)
      .where(sql`${billIdentities.partyId} is null`);
    expect(rows.map((r) => r.id).sort()).toEqual([counterA, counterB].sort());
  });

  it("A803 bill identities: a number without a party, or a party without a number, is refused", async () => {
    const bill = await newBill();
    expect(
      checkFailed(await identify({ workingOrderId: bill, number: 1 }), "bill_identities_scope_ck"),
    ).toBe(true);
    expect(
      checkFailed(await identify({ workingOrderId: bill, partyId }), "bill_identities_scope_ck"),
    ).toBe(true);
  });

  it("A803 bill identities: a number below 1, or not a whole number, is refused", async () => {
    const bill = await newBill();
    expect(
      checkFailed(
        await identify({ workingOrderId: bill, partyId, number: 0 }),
        "bill_identities_number_ck",
      ),
    ).toBe(true);
    expect(
      checkFailed(
        await captureError(() =>
          suite.db.run(
            sql`insert into bill_identities (working_order_id, party_id, number) values (${bill}, ${partyId}, 1.5)`,
          ),
        ),
        "bill_identities_number_ck",
      ),
    ).toBe(true);
  });

  it("A803 bill identities: a name of 41 characters, an empty name or one with a leading or trailing space is refused, and one of 40 is kept", async () => {
    const bill = await newBill();
    for (const name of ["a".repeat(41), "", " Clint", "Clint "]) {
      expect(
        checkFailed(
          await identify({ workingOrderId: bill, partyId, number: 1, name }),
          "bill_identities_name_ck",
        ),
      ).toBe(true);
    }
    const forty = "a".repeat(40);
    await suite.db
      .insert(billIdentities)
      .values({ workingOrderId: bill, partyId, number: 1, name: forty });
    const [row] = await suite.db
      .select({ name: billIdentities.name })
      .from(billIdentities)
      .where(eq(billIdentities.workingOrderId, bill));
    expect(row!.name).toBe(forty);
  });

  it("A803 bill identities: a row naming a missing bill or party is refused", async () => {
    const bill = await newBill();
    expect(
      isRefusal(
        await identify({ workingOrderId: randomUUID(), partyId, number: 1 }),
        FOREIGN_KEY_VIOLATION,
      ),
    ).toBe(true);
    expect(
      isRefusal(
        await identify({ workingOrderId: bill, partyId: randomUUID(), number: 1 }),
        FOREIGN_KEY_VIOLATION,
      ),
    ).toBe(true);
  });

  it("A803 bill identities: deleting a bill or a party that has a row is refused", async () => {
    const bill = await newBill();
    await suite.db.insert(billIdentities).values({ workingOrderId: bill, partyId, number: 1 });
    expect(
      isRefusal(
        await captureError(() => suite.db.delete(workingOrders).where(eq(workingOrders.id, bill))),
        FOREIGN_KEY_VIOLATION,
      ),
    ).toBe(true);
    const other = await newParty();
    const counter = await newBill(null);
    await suite.db
      .insert(billIdentities)
      .values({ workingOrderId: counter, partyId: other, number: 1 });
    expect(
      isRefusal(
        await captureError(() => suite.db.delete(parties).where(eq(parties.id, other))),
        FOREIGN_KEY_VIOLATION,
      ),
    ).toBe(true);

    await suite.db.delete(billIdentities).where(eq(billIdentities.workingOrderId, bill));
    await suite.db.delete(workingOrders).where(eq(workingOrders.id, bill));
    const left = await suite.db
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(eq(workingOrders.id, bill));
    expect(left).toEqual([]);
  });

  it("A803 bill identities: an allocation row refuses update, delete and insert-or-replace", async () => {
    const bill = await newBill();
    const [row] = await suite.db
      .insert(billNumberAllocations)
      .values({ partyId, number: 1, workingOrderId: bill })
      .returning({ id: billNumberAllocations.id });
    const raised = "bill_number_allocations is append-only";
    const update = await captureError(() =>
      suite.db.run(sql`update bill_number_allocations set number = 2 where id = ${row!.id}`),
    );
    expect(triggerRaised(update, raised)).toBe(true);
    const remove = await captureError(() =>
      suite.db.run(sql`delete from bill_number_allocations where id = ${row!.id}`),
    );
    expect(triggerRaised(remove, raised)).toBe(true);
    const replace = await captureError(() =>
      suite.db.run(
        sql`insert or replace into bill_number_allocations select * from bill_number_allocations where id = ${row!.id}`,
      ),
    );
    expect(triggerRaised(replace, raised)).toBe(true);
  });

  it("A803 bill identities: an allocation number below 1, or not a whole number, is refused", async () => {
    const bill = await newBill();
    const zero = await captureError(() =>
      suite.db.insert(billNumberAllocations).values({ partyId, number: 0, workingOrderId: bill }),
    );
    expect(checkFailed(zero, "bill_number_allocations_number_ck")).toBe(true);
    const fraction = await captureError(() =>
      suite.db.run(
        sql`insert into bill_number_allocations (id, party_id, number, working_order_id, allocated_at) values (${randomUUID()}, ${partyId}, 1.5, ${bill}, '2026-10-30T10:00:00.000Z')`,
      ),
    );
    expect(checkFailed(fraction, "bill_number_allocations_number_ck")).toBe(true);
  });

  it("A803 bill identities: a party cannot be given one number twice in the allocation history", async () => {
    const first = await newBill();
    const second = await newBill();
    await suite.db
      .insert(billNumberAllocations)
      .values({ partyId, number: 1, workingOrderId: first });
    const error = await captureError(() =>
      suite.db.insert(billNumberAllocations).values({ partyId, number: 1, workingOrderId: second }),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "bill_number_allocations",
        columns: ["party_id", "number"],
      }),
    ).toBe(true);
    const other = await newParty();
    await suite.db
      .insert(billNumberAllocations)
      .values({ partyId: other, number: 1, workingOrderId: second });
  });
});
