import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { printJobs, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { listStationNotices, writePrintHeldWork } from "@waitron/venue-service";
import { placeGroups } from "./order-groups.js";
import { cancelLine } from "./testing/cancel-line.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { OPERATOR } from "./testing/party-venue.js";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { addTabRound, recallLines } from "./working-order.js";
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

function dish(venue: Venue, product: "burger" | "water", quantity = "1", chips = 1) {
  return {
    menuItemId: venue.tables.offerFor(venue.products[product]),
    quantity,
    extras: [
      {
        listId: venue.lists[product],
        picks: [{ productId: venue.products.chips, quantity: chips }],
      },
    ],
  };
}

async function lines(tx: Transaction, tabId: string) {
  return tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId))
    .orderBy(workingOrderLines.lineNo);
}

async function records(tx: Transaction, tabId: string) {
  return tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      firedAt: ticketItems.firedAt,
      quantity: ticketItems.quantity,
      state: ticketItems.state,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, tabId));
}

async function jobs(tx: Transaction, printerId: string) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
      .orderBy(sql`rowid`)
  ).map((job) => decodeTicket(job.payload));
}

async function actionOutput(tx: Transaction, venue: Venue, act: () => Promise<void>) {
  const before = {
    grill: (await jobs(tx, venue.printers.grill)).length,
    fryer: (await jobs(tx, venue.printers.fryer)).length,
    grillNotices: (await listStationNotices(tx, venue.cfg, venue.stations.grill)).length,
    fryerNotices: (await listStationNotices(tx, venue.cfg, venue.stations.fryer)).length,
  };
  await act();
  return {
    grill: (await jobs(tx, venue.printers.grill)).slice(before.grill),
    fryer: (await jobs(tx, venue.printers.fryer)).slice(before.fryer),
    grillNotices: (await listStationNotices(tx, venue.cfg, venue.stations.grill)).slice(
      before.grillNotices,
    ),
    fryerNotices: (await listStationNotices(tx, venue.cfg, venue.stations.fryer)).slice(
      before.fryerNotices,
    ),
  };
}

describe("cancelling and recalling split-off extras", () => {
  it("voids a fired burger and its chips at their own stations", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger")]);
      const output = await actionOutput(tx, venue, () =>
        cancelLine(tx, venue.cfg, venue.party.tabId, 1).then(() => {}),
      );
      expect(output.grill).toHaveLength(1);
      expect(output.grill[0]).toContain("VOID");
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("VOID");
      expect(output.fryer[0]).toContain("CHIPS");
      expect(output.grillNotices).toEqual([expect.objectContaining({ kind: "void" })]);
      expect(output.fryerNotices).toEqual([
        expect.objectContaining({ kind: "void", lineName: "CHIPS" }),
      ]);
      expect(await records(tx, venue.party.tabId)).toEqual([]);
    });
  });

  it("marks the chips VOID started when Fryer has begun preparing them", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger")]);
      const child = (await lines(tx, venue.party.tabId)).find((line) => line.parentId !== null)!;
      const item = (await records(tx, venue.party.tabId)).find((row) => row.lineId === child.id)!;
      await tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, item.id));
      const output = await actionOutput(tx, venue, () =>
        cancelLine(tx, venue.cfg, venue.party.tabId, 1).then(() => {}),
      );
      expect(output.fryerNotices).toEqual([
        expect.objectContaining({ kind: "void", wasStarted: true }),
      ]);
    });
  });

  it("voids two chips when one of two burgers is cancelled, and reduces the remaining record", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger", "2", 2)]);
      const output = await actionOutput(tx, venue, () =>
        cancelLine(tx, venue.cfg, venue.party.tabId, 1, "1").then(() => {}),
      );
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("2.000 x CHIPS");
      const child = (await lines(tx, venue.party.tabId)).find((line) => line.parentId !== null)!;
      expect(child.quantity).toBe(2000);
      expect(
        (await records(tx, venue.party.tabId)).find((item) => item.lineId === child.id)?.quantity,
      ).toBe(2000);
    });
  });

  it("cancels both queued HOLD tickets when the held burger is cancelled", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await writePrintHeldWork(tx, true);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      const output = await actionOutput(tx, venue, () =>
        cancelLine(tx, venue.cfg, placed.tabId, 1).then(() => {}),
      );
      expect(output.grill).toHaveLength(1);
      expect(output.grill[0]).toContain("HOLD CANCELLED");
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("HOLD CANCELLED");
      expect(output.fryer[0]).toContain("CHIPS");
    });
  });

  it("voids only the chips at Fryer and tells Grill which extra was removed", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger")]);
      const child = (await lines(tx, venue.party.tabId)).find((line) => line.parentId !== null)!;
      const output = await actionOutput(tx, venue, () =>
        cancelLine(tx, venue.cfg, venue.party.tabId, child.lineNo).then(() => {}),
      );
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("VOID");
      expect(output.fryer[0]).toContain("CHIPS");
      expect(output.grill).toHaveLength(1);
      expect(output.grill[0]).toContain("CAMBIADO");
      expect(output.grill[0]).toContain("QUITAR: Chips");
    });
  });

  it("recalls a burger and chips at their own stations", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger")]);
      const output = await actionOutput(tx, venue, () =>
        recallLines(tx, venue.cfg, venue.party.tabId, [1]),
      );
      expect(output.grill).toHaveLength(1);
      expect(output.grill[0]).toContain("RECALLED");
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("RECALLED");
      expect(output.fryerNotices).toEqual([
        expect.objectContaining({ kind: "recalled", lineName: "CHIPS" }),
      ]);
      expect((await records(tx, venue.party.tabId)).map((item) => item.firedAt)).toEqual([
        null,
        null,
      ]);
    });
  });

  it("refuses recall when the chips have started, naming their record", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "burger")]);
      const child = (await lines(tx, venue.party.tabId)).find((line) => line.parentId !== null)!;
      const item = (await records(tx, venue.party.tabId)).find((row) => row.lineId === child.id)!;
      await tx.update(ticketItems).set({ state: "preparing" }).where(eq(ticketItems.id, item.id));
      const before = await records(tx, venue.party.tabId);
      await expect(recallLines(tx, venue.cfg, venue.party.tabId, [1])).rejects.toMatchObject({
        code: "ticket.already_started",
        params: { ticketItemId: item.id },
      });
      expect(await records(tx, venue.party.tabId)).toEqual(before);
    });
  });

  it("voids fired chips on a water with no dish record", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "water")]);
      expect(await records(tx, venue.party.tabId)).toHaveLength(1);
      const output = await actionOutput(tx, venue, () =>
        cancelLine(tx, venue.cfg, venue.party.tabId, 1).then(() => {}),
      );
      expect(output.grill).toEqual([]);
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("VOID");
      expect(await records(tx, venue.party.tabId)).toEqual([]);
    });
  });

  it("partly cancels water without a dish record and rescales its chips record", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "water", "2", 2)]);
      const output = await actionOutput(tx, venue, () =>
        cancelLine(tx, venue.cfg, venue.party.tabId, 1, "1").then(() => {}),
      );
      expect(output.grill).toEqual([]);
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("2.000 x CHIPS");
      expect((await records(tx, venue.party.tabId))[0]?.quantity).toBe(2000);
    });
  });

  it("recalls only the chips record on water without a dish record", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [dish(venue, "water")]);
      const output = await actionOutput(tx, venue, () =>
        recallLines(tx, venue.cfg, venue.party.tabId, [1]),
      );
      expect(output.grill).toEqual([]);
      expect(output.fryer).toHaveLength(1);
      expect(output.fryer[0]).toContain("RECALLED");
      expect((await records(tx, venue.party.tabId))[0]?.firedAt).toBeNull();
    });
  });
});
