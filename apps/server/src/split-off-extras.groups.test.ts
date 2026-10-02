import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { parties, printJobs, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writePrintHeldWork } from "@waitron/venue-service";
import { decodeTicket } from "./testing/decode-ticket.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { OPERATOR } from "./testing/party-venue.js";
import {
  bumpGroupReady,
  listOrderGroups,
  markGroupAway,
  moveLinesToGroup,
  placeGroups,
} from "./order-groups.js";
import { readBillSignals } from "./table-signals.js";
import { advanceTicketItem } from "./working-order.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});
type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;
const line = (v: Venue, product: "burger" | "water", chips = 2, quantity = "1") => ({
  menuItemId: v.tables.offerFor(v.products[product]),
  quantity,
  extras: [{ listId: v.lists[product], picks: [{ productId: v.products.chips, quantity: chips }] }],
});
async function command(tx: Transaction, v: Venue) {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, v.party.partyId));
  return {
    operatorId: OPERATOR,
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
  };
}
async function records(tx: Transaction, tabId: string) {
  return tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      awayAt: ticketItems.awayAt,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, tabId));
}
async function slips(tx: Transaction, printerId: string) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
  ).map((job) => decodeTicket(job.payload));
}

describe("groups with split-off extras", () => {
  it("reads ready only after both stations finish and the pass readies and sends both records away", async () => {
    const v = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const first = await placeGroups(tx, v.cfg, v.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(v, "burger")], release: "fire" }],
      });
      const items = await records(tx, first.tabId);
      const grill = items.find((item) => item.stationId === v.stations.grill)!;
      const fryer = items.find((item) => item.stationId === v.stations.fryer)!;
      await advanceTicketItem(tx, v.cfg, grill.id, "preparing");
      await advanceTicketItem(tx, v.cfg, grill.id, "ready");
      expect(
        (await listOrderGroups(tx, v.party.partyId)).groups.find(
          (group) => group.id === first.groups[0]!.id,
        )?.ready,
      ).toBeUndefined();
      await advanceTicketItem(tx, v.cfg, fryer.id, "preparing");
      await advanceTicketItem(tx, v.cfg, fryer.id, "ready");
      expect(
        (await listOrderGroups(tx, v.party.partyId)).groups.find(
          (group) => group.id === first.groups[0]!.id,
        )?.ready,
      ).toBe(true);

      const second = await placeGroups(tx, v.cfg, v.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(v, "burger")], release: "fire" }],
      });
      await bumpGroupReady(tx, v.cfg, v.party.partyId, second.groups[0]!.id, await command(tx, v));
      expect(
        (await records(tx, second.tabId))
          .filter((item) => item.lineId !== grill.lineId && item.lineId !== fryer.lineId)
          .map((item) => item.state),
      ).toEqual(["ready", "ready"]);
      await markGroupAway(tx, v.cfg, v.party.partyId, second.groups[0]!.id, await command(tx, v));
      expect(
        (await listOrderGroups(tx, v.party.partyId)).groups.find(
          (group) => group.id === second.groups[0]!.id,
        )?.away,
      ).toBe(true);
      expect(
        (await records(tx, second.tabId))
          .filter((item) => item.lineId !== grill.lineId && item.lineId !== fryer.lineId)
          .every((item) => item.awayAt !== null),
      ).toBe(true);
    });
  });

  it.each(["burger", "water"] as const)(
    "moves held %s and corrects each queued station by its own quantity",
    async (product) => {
      const v = await setupSplitExtrasVenue();
      await withTransaction(db, async (tx) => {
        await writePrintHeldWork(tx, true);
        const placed = await placeGroups(tx, v.cfg, v.party.partyId, {
          operatorId: OPERATOR,
          groups: [
            { lines: [line(v, product)], release: "hold" },
            { lines: [line(v, "burger", 1)], release: "hold" },
          ],
        });
        const [dish] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.groupId, placed.groups[0]!.id),
              isNull(workingOrderLines.parentLineId),
            ),
          );
        const grillBefore = (await slips(tx, v.printers.grill)).length;
        const fryerBefore = (await slips(tx, v.printers.fryer)).length;
        await moveLinesToGroup(
          tx,
          v.cfg,
          v.party.partyId,
          [{ lineId: dish!.id, quantity: "1" }],
          { groupId: placed.groups[1]!.id },
          await command(tx, v),
        );
        const fryer = (await slips(tx, v.printers.fryer)).slice(fryerBefore);
        expect(fryer).toHaveLength(2);
        expect(fryer[0]).toContain("-2.000 x CHIPS");
        expect(fryer[1]).toContain("+2.000 x CHIPS");
        const grill = (await slips(tx, v.printers.grill)).slice(grillBefore);
        if (product === "burger") {
          expect(grill).toHaveLength(2);
          expect(grill[0]).toContain("-1.000 x BURG");
          expect(grill[1]).toContain("+1.000 x BURG");
        } else expect(grill).toHaveLength(0);
      });
    },
  );

  it("corrects the Fryer when a two-chip burger joins a queued held group", async () => {
    const v = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      const held = await placeGroups(tx, v.cfg, v.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(v, "burger", 1)], release: "hold" }],
      });
      const fryerBefore = (await slips(tx, v.printers.fryer)).length;
      const grillBefore = (await slips(tx, v.printers.grill)).length;
      await placeGroups(tx, v.cfg, v.party.partyId, {
        ...(await command(tx, v)),
        joinGroupId: held.groups[0]!.id,
        groups: [{ lines: [line(v, "burger")], release: "hold" }],
      });
      expect((await slips(tx, v.printers.fryer)).slice(fryerBefore)).toEqual([
        expect.stringContaining("+2.000 x CHIPS"),
      ]);
      expect((await slips(tx, v.printers.grill)).slice(grillBefore)).toEqual([
        expect.stringContaining("+1.000 x BURG"),
      ]);
    });
  });

  it("names Fryer as ready and counts plates rather than the extra's pieces", async () => {
    const v = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const placed = await placeGroups(tx, v.cfg, v.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [line(v, "burger", 2, "2")], release: "fire" }],
      });
      const fryer = (await records(tx, placed.tabId)).find(
        (item) => item.stationId === v.stations.fryer,
      )!;
      await advanceTicketItem(tx, v.cfg, fryer.id, "preparing");
      await advanceTicketItem(tx, v.cfg, fryer.id, "ready");
      expect(
        (await readBillSignals(tx, [placed.tabId], Date.now())).get(placed.tabId),
      ).toContainEqual({
        kind: "ready",
        byStation: [{ stationId: v.stations.fryer, stationName: "Fryer", count: 2 }],
      });
      await tx
        .update(ticketItems)
        .set({ queuedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString() })
        .where(eq(ticketItems.id, fryer.id));
      expect(
        (await readBillSignals(tx, [placed.tabId], Date.now())).get(placed.tabId),
      ).toContainEqual({ kind: "long_wait", band: "forgotten" });
    });
  });
});
