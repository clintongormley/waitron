import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  orderDraftRecalledLines,
  orderDrafts,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { adjustments } from "@waitron/adjustments";
import { AppError } from "@waitron/shared";
import { kitchenNotices, setRoutingCell } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setChangesAfterSending } from "./testing/changes-after-sending.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { submitDraft, type Draft } from "./order-drafts.js";
import { VENUE_SERVICE } from "./modules.js";
import { advanceTicketItem, fireOrderLines, markGroupServed } from "./working-order.js";
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
afterEach(() => {
  vi.useRealTimers();
});

const AT = "2026-03-14T12:00:00.000Z";
const LATER = "2026-03-14T12:05:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

const dish = (venue: Venue, product: "burger" | "water", chips = false) => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity: "1",
  ...(chips
    ? {
        extras: [
          {
            listId: venue.lists[product],
            picks: [{ productId: venue.products.chips, quantity: 1 }],
          },
        ],
      }
    : {}),
});

async function partyRevision(tx: Transaction, partyId: string): Promise<number> {
  const [row] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

async function args(tx: Transaction, venue: Venue) {
  return {
    operatorId: OPERATOR,
    submissionId: randomUUID(),
    expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
  };
}

async function jobCounts(tx: Transaction, venue: Venue) {
  const counts: Record<string, number> = {};
  for (const [name, id] of Object.entries(venue.printers))
    counts[name] = (
      await tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, id))
    ).length;
  return counts;
}

async function placeFireNow(tx: Transaction, venue: Venue, lines: ReturnType<typeof dish>[]) {
  return placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines, release: "fire" }],
  });
}

async function lineOf(tx: Transaction, venue: Venue, product: "burger" | "water" | "chips") {
  const found = await tx
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, venue.party.tabId));
  const matching = found.filter((line) => line.productId === venue.products[product]);
  expect(matching).toHaveLength(1);
  return matching[0]!;
}

async function itemsOf(tx: Transaction, lineId: string) {
  return tx.select().from(ticketItems).where(eq(ticketItems.workingOrderLineId, lineId));
}

async function recall(tx: Transaction, venue: Venue, lineId: string) {
  return recallToDraft(tx, venue.cfg, venue.party.partyId, lineId, {
    ...(await args(tx, venue)),
    expectedEdit: await readBillEditState(tx, venue.party.tabId),
  });
}

/** Every row a recall could write, read whole. */
async function frozen(tx: Transaction) {
  return {
    bills: await tx.select().from(workingOrders).orderBy(workingOrders.id),
    lines: await tx.select().from(workingOrderLines).orderBy(workingOrderLines.id),
    items: await tx.select().from(ticketItems).orderBy(ticketItems.id),
    drafts: await tx.select().from(orderDrafts).orderBy(orderDrafts.id),
    sources: await tx.select().from(orderDraftRecalledLines).orderBy(orderDraftRecalledLines.id),
    notices: await tx.select().from(kitchenNotices).orderBy(kitchenNotices.id),
    jobs: await tx.select().from(printJobs).orderBy(printJobs.id),
    adjustments: await tx.select().from(adjustments).orderBy(adjustments.id),
  };
}

/** Run a recall that must refuse `code` inside its own transaction, and show it wrote nothing. */
async function refusedRecall(venue: Venue, lineId: string, code: string) {
  const before = await withTransaction(db, (tx) => frozen(tx));
  const error = await withTransaction(db, (tx) => recall(tx, venue, lineId)).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  expect(await withTransaction(db, (tx) => frozen(tx))).toEqual(before);
}

const requestedAtGrill = (venue: Venue, at: string) => ({
  stationId: venue.stations.grill,
  requestedAt: at,
  firedAt: null,
  passControlled: true,
});

describe("A773 requested lifecycle: recall", () => {
  it("recalls a Requested dish into the draft with no slip, no notice and its charge unchanged", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeFireNow(tx, venue, [dish(venue, "burger")]);
      const burger = await lineOf(tx, venue, "burger");
      expect(await itemsOf(tx, burger.id)).toEqual([
        expect.objectContaining(requestedAtGrill(venue, AT)),
      ]);
      const before = await frozen(tx);
      const allergyBefore = await VENUE_SERVICE.readPartyAllergy(tx, venue.party.partyId);
      const counts = await jobCounts(tx, venue);

      const recalled = await recall(tx, venue, burger.id);

      expect(recalled.draft.lines).toEqual([expect.objectContaining({ sourceLineId: burger.id })]);
      expect(await itemsOf(tx, burger.id)).toEqual([]);
      expect(
        await tx
          .select({ sourceLineId: orderDraftRecalledLines.sourceLineId })
          .from(orderDraftRecalledLines)
          .where(eq(orderDraftRecalledLines.draftId, recalled.draft.id)),
      ).toEqual([{ sourceLineId: burger.id }]);
      const after = await frozen(tx);
      expect(after.lines).toEqual(before.lines);
      expect(after.adjustments).toEqual(before.adjustments);
      expect((await VENUE_SERVICE.readPartyAllergy(tx, venue.party.partyId)).ticks).toEqual(
        allergyBefore.ticks,
      );
      expect(await jobCounts(tx, venue)).toEqual(counts);
      expect(after.jobs).toEqual(before.jobs);
      expect(
        await tx
          .select()
          .from(kitchenNotices)
          .where(eq(kitchenNotices.workingOrderId, venue.party.tabId)),
      ).toEqual([]);
    });
  });

  it("resends a recalled Requested source with Fire now as Requested again, printing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeFireNow(tx, venue, [dish(venue, "burger")]);
      const burger = await lineOf(tx, venue, "burger");
      const recalled = await recall(tx, venue, burger.id);
      vi.setSystemTime(new Date(LATER));
      const counts = await jobCounts(tx, venue);
      const draft: Draft = recalled.draft;

      await submitDraft(tx, venue.cfg, venue.party.partyId, draft.id, {
        ...(await args(tx, venue)),
        draftRevision: draft.revision,
        expectedEdit: recalled.edit,
        groups: [{ lineIds: [draft.lines[0]!.id], release: "fire" }],
      });

      expect(await itemsOf(tx, burger.id)).toEqual([
        expect.objectContaining({ ...requestedAtGrill(venue, LATER), state: "queued" }),
      ]);
      const now = await jobCounts(tx, venue);
      expect(now.grill).toBe(counts.grill);
      expect(now.pass).toBe(counts.pass);
      expect(
        await tx
          .select()
          .from(orderDraftRecalledLines)
          .where(eq(orderDraftRecalledLines.sourceLineId, burger.id)),
      ).toEqual([]);
    });
  });

  it("refuses to recall a Requested dish whose extra has started, writing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const burgerId = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeFireNow(tx, venue, [dish(venue, "burger", true)]);
      const burger = await lineOf(tx, venue, "burger");
      const chips = await lineOf(tx, venue, "chips");
      expect(await itemsOf(tx, burger.id)).toEqual([
        expect.objectContaining(requestedAtGrill(venue, AT)),
      ]);
      const [chipsItem] = await itemsOf(tx, chips.id);
      expect(chipsItem).toMatchObject({ stationId: venue.stations.fryer, firedAt: AT });
      await advanceTicketItem(tx, venue.cfg, chipsItem!.id, "preparing");
      return burger.id;
    });
    await refusedRecall(venue, burgerId, "ticket.already_started");
  });

  it("refuses to recall a Requested dish on a paid bill, writing nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const burgerId = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeFireNow(tx, venue, [dish(venue, "burger")]);
      const burger = await lineOf(tx, venue, "burger");
      expect(await itemsOf(tx, burger.id)).toEqual([
        expect.objectContaining(requestedAtGrill(venue, AT)),
      ]);
      await tx
        .update(workingOrders)
        .set({ status: "settled", settledAt: AT })
        .where(eq(workingOrders.id, venue.party.tabId));
      return burger.id;
    });
    await refusedRecall(venue, burgerId, "bill.paid");
  });

  it("reads a Requested dish as held for a station's changes after sending", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const burgerId = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await placeFireNow(tx, venue, [dish(venue, "burger")]);
      const burger = await lineOf(tx, venue, "burger");
      expect(await itemsOf(tx, burger.id)).toEqual([
        expect.objectContaining(requestedAtGrill(venue, AT)),
      ]);
      return burger.id;
    });
    await withTransaction(db, (tx) => setChangesAfterSending(tx, "never", [venue.stations.grill]));
    await refusedRecall(venue, burgerId, "ticket.already_fired");
    await withTransaction(db, async (tx) => {
      await setChangesAfterSending(tx, "held", [venue.stations.grill]);
      const recalled = await recall(tx, venue, burgerId);
      expect(recalled.draft.lines).toEqual([expect.objectContaining({ sourceLineId: burgerId })]);
    });
  });

  it("a recalled Requested source is neither served nor fired by a sent-group action", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
        { kind: "station", stationId: venue.stations.bar },
      );
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeFireNow(tx, venue, [dish(venue, "burger"), dish(venue, "water")]);
      const groupId = placed.groups[0]!.id;
      const burger = await lineOf(tx, venue, "burger");
      const water = await lineOf(tx, venue, "water");
      expect(await itemsOf(tx, burger.id)).toEqual([
        expect.objectContaining(requestedAtGrill(venue, AT)),
      ]);
      expect(await itemsOf(tx, water.id)).toEqual([
        expect.objectContaining({ stationId: venue.stations.bar, firedAt: AT }),
      ]);
      const recalled = await recall(tx, venue, burger.id);
      expect(
        await tx
          .select({ sourceLineId: orderDraftRecalledLines.sourceLineId })
          .from(orderDraftRecalledLines)
          .where(eq(orderDraftRecalledLines.draftId, recalled.draft.id)),
      ).toEqual([{ sourceLineId: burger.id }]);
      const counts = await jobCounts(tx, venue);

      await markGroupServed(tx, venue.cfg, venue.party.partyId, groupId, await args(tx, venue));
      await fireOrderLines(tx, venue.cfg, venue.party.tabId, [burger.id, water.id]);

      expect((await lineOf(tx, venue, "burger")).servedQuantity).toBe(0);
      expect(await itemsOf(tx, burger.id)).toEqual([]);
      expect((await lineOf(tx, venue, "water")).servedQuantity).toBe(1000);
      expect(await jobCounts(tx, venue)).toEqual(counts);
    });
  });
});
