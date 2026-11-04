import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  kitchenStations,
  parties,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { moveDishesToStation } from "./testing/order-writer-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { readBillSignals, readPartySignals } from "./table-signals.js";
import type { FamilyBill } from "./parties.js";
import { listTablesWithState, markServed, type TableParty } from "./working-order.js";
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
const minutes = (n: number) => Date.parse(AT) + n * 60_000;
const iso = (n: number) => new Date(minutes(n)).toISOString();

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

/** A burger fired at Grill (warm 5, overdue 15, forgotten 30) at AT; its ticket item and line. */
async function burgerAtGrill(waitsForPass: boolean) {
  const venue = await setupSplitExtrasVenue();
  return withTransaction(db, async (tx) => {
    await tx
      .update(kitchenStations)
      .set({ warmAfterMinutes: 5, overdueAfterMinutes: 15, forgottenAfterMinutes: 30 })
      .where(eq(kitchenStations.id, venue.stations.grill));
    await setStationsWaitForPass(tx, waitsForPass, [venue.stations.grill]);
    await placeGroups(tx, venue.cfg, venue.party.partyId, {
      operatorId: OPERATOR,
      groups: [
        {
          lines: [
            {
              menuItemId: venue.tables.offerFor(venue.products.burger),
              quantity: "1",
            },
          ],
          release: "fire",
        },
      ],
    });
    const [found] = await tx
      .select({ lineId: workingOrderLines.id, itemId: ticketItems.id })
      .from(workingOrderLines)
      .innerJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
      .where(
        and(
          eq(workingOrderLines.workingOrderId, venue.party.tabId),
          eq(workingOrderLines.productId, venue.products.burger),
        ),
      );
    return { venue, ...found! };
  });
}

async function longWait(tx: Transaction, venue: Venue, nowMs: number) {
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
    nowMs,
  );
  return signals
    .get(party.id)!
    .filter((signal) => signal.kind === "long_wait" || signal.kind === "ready");
}

/** The stamps the pass's Fire writes (`pass-release.ts`), at `at`. */
async function releasedAt(tx: Transaction, itemId: string, at: string) {
  await tx.update(ticketItems).set({ firedAt: at, queuedAt: at }).where(eq(ticketItems.id, itemId));
}

async function floorRow(tx: Transaction, venue: Venue) {
  const rows = await listTablesWithState(tx);
  return rows.find((row) => row.id === venue.party.tableId)!;
}

describe("D65 a dish waiting for the pass ages on the floor", () => {
  it("marks a party waiting long from the station's limits while its dish waits for the pass", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const { venue, itemId } = await burgerAtGrill(true);
    await withTransaction(db, async (tx) => {
      const [item] = await tx.select().from(ticketItems).where(eq(ticketItems.id, itemId));
      expect(item).toMatchObject({ requestedAt: AT, firedAt: null, passControlled: true });

      expect(await longWait(tx, venue, minutes(16))).toEqual([
        { kind: "long_wait", band: "overdue" },
      ]);
      expect(await longWait(tx, venue, minutes(4))).toEqual([]);
    });
  });

  it("keeps measuring a released dish from when it was asked for", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const { venue, itemId } = await burgerAtGrill(true);
    await withTransaction(db, async (tx) => {
      await releasedAt(tx, itemId, iso(14));
      expect(await longWait(tx, venue, minutes(16))).toEqual([
        { kind: "long_wait", band: "overdue" },
      ]);
    });
  });

  it("measures a dish moved between stations that do not wait for the pass from its move, on both readers", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const { venue, lineId } = await burgerAtGrill(false);
    vi.setSystemTime(new Date(minutes(14)));
    await withTransaction(db, (tx) =>
      moveDishesToStation(
        tx,
        venue.cfg,
        venue.party.tabId,
        { submissionId: randomUUID(), lineIds: [lineId], stationId: venue.stations.fryer },
        { deviceId: venue.cfg.origin.deviceId, personId: OPERATOR },
      ),
    );
    await withTransaction(db, async (tx) => {
      const [item] = await tx
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, lineId));
      expect(item).toMatchObject({
        stationId: venue.stations.fryer,
        requestedAt: AT,
        firedAt: AT,
        queuedAt: iso(14),
        passControlled: false,
      });
      expect(await longWait(tx, venue, minutes(16))).toEqual([]);
      vi.setSystemTime(new Date(minutes(16)));
      expect((await floorRow(tx, venue)).timingBand).toBe("fresh");
    });
  });

  it("gives no long wait for a dish waiting for the pass once it is served", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const { venue, lineId } = await burgerAtGrill(true);
    await withTransaction(db, async (tx) => {
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      await markServed(tx, venue.cfg, venue.party.partyId, [{ lineId, quantity: "1" }], {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
      });
      expect(await longWait(tx, venue, minutes(16))).toEqual([]);
    });
  });

  it("gives no long wait for a requested item made here", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const { venue, itemId } = await burgerAtGrill(true);
    await withTransaction(db, async (tx) => {
      await tx.update(ticketItems).set({ madeHere: true }).where(eq(ticketItems.id, itemId));
      expect(await longWait(tx, venue, minutes(16))).toEqual([]);
    });
  });

  it("gives the floor read the same band as the party signals, waiting and released", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const { venue, itemId } = await burgerAtGrill(true);
    await withTransaction(db, async (tx) => {
      vi.setSystemTime(new Date(minutes(16)));
      const waiting = await floorRow(tx, venue);
      expect(waiting.timingBand).toBe("overdue");
      expect(waiting.signals.filter((signal) => signal.kind === "long_wait")).toEqual([
        { kind: "long_wait", band: "overdue" },
      ]);

      await releasedAt(tx, itemId, iso(14));
      const released = await floorRow(tx, venue);
      expect(released.timingBand).toBe("overdue");
      expect(released.signals.filter((signal) => signal.kind === "long_wait")).toEqual([
        { kind: "long_wait", band: "overdue" },
      ]);
    });
  });

  it("marks the counter's tab list waiting long for a bill whose dish waits for the pass", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const { venue } = await burgerAtGrill(true);
    await withTransaction(db, async (tx) => {
      const signals = await readBillSignals(tx, [venue.party.tabId], minutes(16));
      expect(signals.get(venue.party.tabId)).toEqual([{ kind: "long_wait", band: "overdue" }]);
    });
  });
});
