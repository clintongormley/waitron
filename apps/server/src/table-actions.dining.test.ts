import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, orderDiningLocked } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { Dining } from "@waitron/shared";
import {
  createDepartment,
  createServiceZone,
  departments,
  setDepartmentSalePolicyField,
} from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { insertPartyBill } from "./parties.js";
import {
  inTx,
  provisionBillVenue,
  send,
  seatedWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { joinTables, moveGuests } from "./testing/table-action-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";

// A whole table moved into another department: every bill keeps its way, whatever the department
// sells (the owner, 2026-11-24).
let venue: BillVenue;
/** A table zone of a department that sells only eaten here. */
let eatInZone: string;
/** A table zone of a department that sells only takeaway. */
let takeawayZone: string;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    await inTx(venue, async (tx) => {
      for (const { id } of await tx.select({ id: departments.id }).from(departments))
        await setDepartmentSalePolicyField(tx, id, "dining", "till_choice");
      const department = await createDepartment(tx, { name: "Dining room", orderStart: "table" });
      await setDepartmentSalePolicyField(tx, department.id, "dining", "eat_in");
      const zone = await createServiceZone(tx, {
        name: "Dining room",
        departmentId: department.id,
      });
      eatInZone = (await offerProducts(tx, { zone: { zoneId: zone.id }, orderStart: "table" }))
        .zoneId;
      const shop = await createDepartment(tx, { name: "Takeaway shop", orderStart: "table" });
      await setDepartmentSalePolicyField(tx, shop.id, "dining", "takeaway");
      const shopZone = await createServiceZone(tx, {
        name: "Takeaway shop",
        departmentId: shop.id,
      });
      takeawayZone = (
        await offerProducts(tx, { zone: { zoneId: shopZone.id }, orderStart: "table" })
      ).zoneId;
    });
  },
});

function diningOf(id: string): Dining {
  return venue.db.all<{ dining: Dining }>(
    sql`select dining from working_orders where id = ${id}`,
  )[0]!.dining;
}

function zoneOf(id: string): string {
  return venue.db.all<{ zone_id: string }>(
    sql`select zone_id from working_orders where id = ${id}`,
  )[0]!.zone_id;
}

function revisionOf(partyId: string): number {
  return venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  )[0]!.revision;
}

describe("a whole table moved into another department", () => {
  it("keeps a sent takeaway bill and an unsent takeaway bill takeaway at the new table", async () => {
    const seated = await seatedWith(venue);
    venue.db.run(sql`update working_orders set dining = 'takeaway' where id = ${seated.tabId}`);
    const ordered = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/parties/${seated.partyId}/groups`,
      {
        expectedEdit: await inTx(venue, (tx) => readBillEditState(tx, seated.tabId)),
        submissionId: randomUUID(),
        expectedPartyRevision: revisionOf(seated.partyId),
        groups: [
          { lines: [{ menuItemId: venue.offerFor("Croquettes"), quantity: "1" }], release: "fire" },
        ],
      },
    );
    expect(ordered.status).toBe(200);
    expect(await inTx(venue, (tx) => orderDiningLocked(tx, seated.tabId))).toBe("sent");
    const unsent = await inTx(venue, (tx) => insertPartyBill(tx, venue.cfg, seated.partyId));
    venue.db.run(sql`update working_orders set dining = 'takeaway' where id = ${unsent}`);
    expect(await inTx(venue, (tx) => orderDiningLocked(tx, unsent))).toBeNull();
    const table = await inTx(venue, (tx) =>
      createTable(tx, { label: `Table ${randomUUID().slice(0, 8)}`, zoneId: eatInZone }),
    );

    await inTx(venue, async (tx) =>
      moveGuests(tx, venue.cfg, seated.partyId, table.id, {
        expectedPartyRevision: revisionOf(seated.partyId),
        operatorId: venue.operatorId,
      }),
    );

    expect(zoneOf(seated.tabId)).toBe(eatInZone);
    expect(zoneOf(unsent)).toBe(eatInZone);
    expect(diningOf(seated.tabId)).toBe("takeaway");
    expect(diningOf(unsent)).toBe("takeaway");
  });
});

describe("an eaten-in bill whose table moves into a takeaway-only department", () => {
  async function eatenInParty() {
    const seated = await seatedWith(venue);
    venue.db.run(sql`update working_orders set dining = 'eat_in' where id = ${seated.tabId}`);
    expect(await inTx(venue, (tx) => orderDiningLocked(tx, seated.tabId))).toBeNull();
    return seated;
  }
  const shopTable = () =>
    inTx(venue, (tx) =>
      createTable(tx, { label: `Shop ${randomUUID().slice(0, 8)}`, zoneId: takeawayZone }),
    );

  it("stays eaten in when its guests move to a free table there", async () => {
    const seated = await eatenInParty();
    const table = await shopTable();

    await inTx(venue, (tx) =>
      moveGuests(tx, venue.cfg, seated.partyId, table.id, {
        expectedPartyRevision: revisionOf(seated.partyId),
        operatorId: venue.operatorId,
      }),
    );

    expect(zoneOf(seated.tabId)).toBe(takeawayZone);
    expect(diningOf(seated.tabId)).toBe("eat_in");
  });

  it("stays eaten in when its guests move onto a table another party holds there", async () => {
    const seated = await eatenInParty();
    const table = await shopTable();
    const held = await send(venue.app, venue.cookie, "POST", `/api/tables/${table.id}/seat`, {});
    expect(held.status).toBe(200);
    const holder = held.json.partyId as string;

    await inTx(venue, (tx) =>
      moveGuests(tx, venue.cfg, seated.partyId, table.id, {
        expectedPartyRevision: revisionOf(seated.partyId),
        otherPartyId: holder,
        expectedOtherPartyRevision: revisionOf(holder),
        operatorId: venue.operatorId,
      }),
    );

    expect(zoneOf(seated.tabId)).toBe(takeawayZone);
    expect(diningOf(seated.tabId)).toBe("eat_in");
  });

  it("is refused joining a table there, and stays eaten in", async () => {
    const seated = await eatenInParty();
    const table = await shopTable();

    const error = await captureError(() =>
      inTx(venue, (tx) =>
        joinTables(tx, venue.cfg, seated.partyId, table.id, {
          expectedPartyRevision: revisionOf(seated.partyId),
          operatorId: venue.operatorId,
        }),
      ),
    );

    expect(error).toMatchObject({ code: "service_zone.join_mismatch" });
    expect(zoneOf(seated.tabId)).toBe(venue.zoneId);
    expect(diningOf(seated.tabId)).toBe("eat_in");
  });
});
