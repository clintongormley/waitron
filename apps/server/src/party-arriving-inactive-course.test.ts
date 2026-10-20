import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orderGroups, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { deleteCourse } from "./course-delete.js";
import { createCourse, updateCourse } from "./kitchen.js";
import { moveBill } from "./testing/move-bill-fixture.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import {
  inTx,
  OPERATOR,
  revisionOf,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

let venue: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await setupPartyVenue(db);
  },
});

describe("arriving dishes whose course no longer holds them", () => {
  it.each(["inactive", "unheld", "none"] as const)(
    "fires a moved %s course without changing the charged food",
    async (kind) => {
      const source = await seat(venue, await venue.table(`Source ${kind}`));
      const tableId = await venue.table(`Destination ${kind}`);
      const target = await seat(venue, tableId);
      const [starter, course] = await inTx(venue, async (tx) => [
        await createCourse(tx, venue.cfg, { name: `Starter ${kind}`, displayOrder: 1 }),
        await createCourse(tx, venue.cfg, { name: `Later ${kind}`, displayOrder: 2 }),
      ]);
      await inTx(venue, (tx) =>
        addTabRound(tx, venue.cfg, source.tabId, [
          { menuItemId: venue.item("Burger"), quantity: "1", courseId: starter!.id },
          {
            menuItemId: venue.item("Flan"),
            quantity: "2",
            ...(kind === "none" ? { hold: true } : { courseId: course!.id }),
          },
        ]),
      );
      const before = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, source.tabId));
      const later = before.find((line) => line.lineNo === 2)!;
      expect(
        (
          await venue.db
            .select()
            .from(ticketItems)
            .where(eq(ticketItems.workingOrderLineId, later.id))
        )[0]!.firedAt,
      ).toBeNull();
      if (kind === "inactive") await inTx(venue, (tx) => deleteCourse(tx, venue.cfg, course!.id));
      if (kind === "unheld")
        await inTx(venue, (tx) =>
          updateCourse(tx, venue.cfg, course!.id, { heldUntilFired: false }),
        );

      await inTx(venue, (tx) =>
        moveBill(
          tx,
          venue.cfg,
          source.tabId,
          { tableId },
          {
            bills: "separate",
            operatorId: OPERATOR,
            expectedPartyRevision: source.revision,
            otherPartyId: target.partyId,
            expectedOtherPartyRevision: target.revision,
          },
        ),
      );

      const groups = await venue.db
        .select()
        .from(orderGroups)
        .where(eq(orderGroups.partyId, target.partyId));
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ state: "fired", position: 1, firedBy: OPERATOR });
      const after = await venue.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, source.tabId));
      for (const line of before) {
        expect(after.find((row) => row.id === line.id)).toEqual({
          ...line,
          groupId: groups[0]!.id,
          sentAt: line.sentAt ?? expect.any(String),
        });
      }
      const ticket = (
        await venue.db
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, later.id))
      )[0]!;
      expect(ticket).toMatchObject({
        firedAt: expect.any(String),
        state: "queued",
        quantity: 2000,
      });
      expect(await revisionOf(venue, target.partyId)).toBe(target.revision + 1);
    },
  );
});
