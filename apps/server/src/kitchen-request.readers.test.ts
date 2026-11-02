import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parties, ticketItems, withTransaction, workingOrderLines } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setRoutingCell } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { setReleaseReminderInEveryDepartment } from "./testing/release-reminder.js";
import { OPERATOR } from "./testing/party-venue.js";
import { listOrderGroups, readHeldCounts, readReleaseReminders } from "./order-groups.js";
import { readOrderStateCounts } from "./order-state-counts.js";
import { readRestOfOrder } from "./rest-of-order.js";
import { readPartySignals } from "./table-signals.js";
import type { FamilyBill } from "./parties.js";
import { advanceTicketItem, markServed, type TableParty } from "./working-order.js";
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
type Product = "burger" | "water" | "chips";

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

async function lineOf(tx: Transaction, venue: Venue, product: Product, groupId?: string) {
  const found = await tx
    .select({ id: workingOrderLines.id, itemId: ticketItems.id })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, venue.party.tabId),
        eq(workingOrderLines.productId, venue.products[product]),
        groupId === undefined ? undefined : eq(workingOrderLines.groupId, groupId),
      ),
    );
  expect(found).toHaveLength(1);
  return found[0]!;
}

async function serve(tx: Transaction, venue: Venue, lineId: string) {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, venue.party.partyId));
  await markServed(tx, venue.cfg, venue.party.partyId, [{ lineId, quantity: "1" }], {
    operatorId: OPERATOR,
    submissionId: randomUUID(),
    expectedPartyRevision: party!.revision,
  });
}

async function routeBottledToBar(tx: Transaction, venue: Venue) {
  await setRoutingCell(
    tx,
    venue.cfg,
    { row: { kind: "category", categoryId: venue.folders.bottled }, zoneId: null },
    { kind: "station", stationId: venue.stations.bar },
  );
}

async function fireNow(tx: Transaction, venue: Venue, lineInputs: ReturnType<typeof dish>[]) {
  return placeGroups(tx, venue.cfg, venue.party.partyId, {
    operatorId: OPERATOR,
    groups: [{ lines: lineInputs, release: "fire" }],
  });
}

async function toReady(tx: Transaction, venue: Venue, itemId: string) {
  await advanceTicketItem(tx, venue.cfg, itemId, "preparing");
  await advanceTicketItem(tx, venue.cfg, itemId, "ready");
}

async function counts(tx: Transaction, venue: Venue) {
  return (await readOrderStateCounts(tx, [venue.party.tabId])).get(venue.party.tabId);
}

describe("A773 requested lifecycle: readers", () => {
  it("keeps a group out of ready while one of its parts waits for the pass (D32)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await routeBottledToBar(tx, venue);
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await fireNow(tx, venue, [dish(venue, "burger"), dish(venue, "water")]);
      const groupId = placed.groups[0]!.id;
      const burger = await lineOf(tx, venue, "burger");
      const water = await lineOf(tx, venue, "water");
      await toReady(tx, venue, water.itemId!);

      const before = (await listOrderGroups(tx, venue.party.partyId)).groups;
      const group = before.find((candidate) => candidate.id === groupId)!;
      expect(group).toBeDefined();
      expect(Object.hasOwn(group, "ready")).toBe(false);

      await tx
        .update(ticketItems)
        .set({ firedAt: LATER })
        .where(eq(ticketItems.id, burger.itemId!));
      await toReady(tx, venue, burger.itemId!);
      const after = (await listOrderGroups(tx, venue.party.partyId)).groups;
      expect(after.find((candidate) => candidate.id === groupId)!.ready).toBe(true);
    });
  });

  it("counts a dish waiting for the pass as waiting, not held (D33)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger")]);
      expect(await counts(tx, venue)).toMatchObject({ waiting: 1, held: 0, ready: 0 });
    });
  });

  it("counts a released dish whose extra waits for the pass as waiting (D33)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.fryer]);
      await fireNow(tx, venue, [dish(venue, "burger", true)]);
      expect(await counts(tx, venue)).toMatchObject({ waiting: 1, held: 0, ready: 0 });
    });
  });

  it("counts a dish in a held group as held (D33)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger")], release: "hold" }],
      });
      expect(await counts(tx, venue)).toMatchObject({ waiting: 0, held: 1, ready: 0 });
    });
  });

  it("counts no held line for a party whose group waits for the pass (pin)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await routeBottledToBar(tx, venue);
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger"), dish(venue, "water")]);
      expect(await readHeldCounts(tx, [venue.party.partyId])).toEqual(new Map());
    });
  });

  it("keeps a held group's release reminder undated until a dish waiting for the pass is served (pin)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setReleaseReminderInEveryDepartment(tx, 10);
      await routeBottledToBar(tx, venue);
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [
          { lines: [dish(venue, "burger"), dish(venue, "water")], release: "fire" },
          { lines: [dish(venue, "burger")], release: "hold" },
        ],
      });
      const firedId = placed.groups[0]!.id;
      const heldId = placed.groups[1]!.id;
      const reminder = async () =>
        (await readReleaseReminders(tx, [venue.party.partyId])).get(venue.party.partyId);
      expect(await reminder()).toEqual({ groupId: heldId, dueAt: null });

      await serve(tx, venue, (await lineOf(tx, venue, "water", firedId)).id);
      expect(await reminder()).toEqual({ groupId: heldId, dueAt: null });

      vi.setSystemTime(new Date(LATER));
      await serve(tx, venue, (await lineOf(tx, venue, "burger", firedId)).id);
      expect(await reminder()).toEqual({
        groupId: heldId,
        dueAt: new Date(Date.parse(LATER) + 10 * 60_000).toISOString(),
      });
    });
  });

  it("gives no ready or long-wait floor signal for a dish an hour into waiting for the pass (pin, D33)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger")]);
      const party = {
        id: venue.party.partyId,
        unsentDrafts: [],
        reminder: null,
      } as unknown as TableParty;
      const bill = { workingOrderId: venue.party.tabId, status: "open" } as unknown as FamilyBill;
      const signals = await readPartySignals(
        tx,
        [party],
        new Map([[party.id, { bills: [bill], billRequestedAt: null, openedAt: AT }]]),
        Date.parse(AT) + 60 * 60_000,
      );
      const kinds = signals.get(party.id)!.map((signal) => signal.kind);
      expect(kinds).not.toContain("ready");
      expect(kinds).not.toContain("long_wait");
    });
  });

  it("keeps another station's dish waiting for the pass marked held in the rest of the order (pin, D33)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await routeBottledToBar(tx, venue);
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await fireNow(tx, venue, [dish(venue, "burger"), dish(venue, "water")]);
      const burger = await lineOf(tx, venue, "burger");
      const water = await lineOf(tx, venue, "water");
      const rest = (await readRestOfOrder(tx, [venue.party.tabId])).get(venue.party.tabId)!;
      const heldOf = new Map(rest.map((entry) => [entry.workingOrderLineId, entry.held]));
      expect(heldOf.get(burger.id)).toBe(true);
      expect(heldOf.get(water.id)).toBe(false);
    });
  });
});
