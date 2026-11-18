import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orderDiningLocked } from "@waitron/db";
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
import { moveGuests } from "./testing/table-action-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";

// A whole table moved into another department: a sent bill keeps its way, and a takeaway bill moved
// to a table stays takeaway, even where the department sells only eaten here (A1522, Decision 6).
let venue: BillVenue;
/** A table zone of a department that sells only eaten here. */
let eatInZone: string;

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
      eatInZone = (
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone.id }, orderStart: "table" })
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
      createTable(tx, venue.cfg, { label: `Table ${randomUUID().slice(0, 8)}`, zoneId: eatInZone }),
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
