import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { kitchenStations, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { computeOverdueOrders } from "@waitron/reporting";
import { createStation } from "./kitchen.js";
import { fireGroup } from "./order-groups.js";
import { readBillSignals } from "./table-signals.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  commandFor,
  floorRow,
  inTx,
  OPERATOR,
  order,
  seat,
  seatWithNoAllergies,
  setupPartyVenue,
} from "./testing/party-venue.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { listExpoQueue, listStationQueue } from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
afterEach(() => vi.restoreAllMocks());

describe("each station's own minutes across consumers", () => {
  it.each([
    [1, "fresh", "fresh"],
    [2, "warm", "fresh"],
    [4, "overdue", "warm"],
    [6, "forgotten", "overdue"],
    [7, "forgotten", "forgotten"],
  ] as const)(
    "classifies age %i by each station's own minutes, including an inactive station's work",
    async (age, kitchenBand, barBand) => {
      const v = await setupPartyVenue(suite.db);
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const { kitchenId, barId } = await inTx(v, async (tx) => {
        const [kitchen] = await tx
          .select({ id: kitchenStations.id })
          .from(kitchenStations)
          .where(eq(kitchenStations.isDefault, true));
        await tx
          .update(kitchenStations)
          .set({ warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 })
          .where(eq(kitchenStations.id, kitchen!.id));
        const bar = await createStation(tx, v.cfg, { name: "Bar" });
        await tx
          .update(kitchenStations)
          .set({ warmAfterMinutes: 3, overdueAfterMinutes: 5, forgottenAfterMinutes: 7 })
          .where(eq(kitchenStations.id, bar.id));
        await routeProductTo(tx, v.cfg, v.productId("Caña"), bar.id);
        return { kitchenId: kitchen!.id, barId: bar.id };
      });
      const first = await v.table("Kitchen table");
      const second = await v.table("Bar table");
      const a = await seat(v, first);
      const b = await seat(v, second);
      await order(v, a.tabId, "Burger");
      await order(v, b.tabId, "Caña");
      await inTx(v, async (tx) => {
        await tx.update(ticketItems).set({ queuedAt: new Date(now - age * 60_000).toISOString() });
        await tx
          .update(kitchenStations)
          .set({ active: false })
          .where(eq(kitchenStations.id, barId));
        for (const [stationId, billId, band, thresholds] of [
          [
            kitchenId,
            a.tabId,
            kitchenBand,
            { warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 },
          ],
          [
            barId,
            b.tabId,
            barBand,
            { warmAfterMinutes: 3, overdueAfterMinutes: 5, forgottenAfterMinutes: 7 },
          ],
        ] as const) {
          const [queue] = await listStationQueue(tx, stationId);
          expect.soft(queue!.thresholds).toEqual(thresholds);
          expect.soft(queue!.items[0]!.band).toBe(band);
          const expo = (await listExpoQueue(tx, v.cfg)).find((row) => row.orderId === billId)!;
          expect.soft(expo.worstBand).toBe(band);
          expect.soft(expo.groups[0]!.items[0]!.thresholds).toEqual(thresholds);
          const signals = await readBillSignals(tx, [billId], now);
          expect
            .soft(signals.get(billId))
            .toEqual(band === "fresh" ? [] : [{ kind: "long_wait", band }]);
        }
        const overdue = await computeOverdueOrders(tx, { nodeId: v.cfg.nodeId });
        expect.soft(overdue.map((row) => ({ id: row.orderId, band: row.band }))).toEqual(
          [
            [a.tabId, kitchenBand],
            [b.tabId, barBand],
          ]
            .filter(([, band]) => band === "overdue" || band === "forgotten")
            .map(([id, band]) => ({ id, band })),
        );
      });
      for (const [tableId, band] of [
        [first, kitchenBand],
        [second, barBand],
      ] as const) {
        const row = await floorRow(v, tableId);
        expect.soft(row.timingBand).toBe(band);
        expect.soft(row.signals).toEqual(band === "fresh" ? [] : [{ kind: "long_wait", band }]);
      }
    },
  );

  it("a change to a station's minutes reclassifies its live work in every reader", async () => {
    const v = await setupPartyVenue(suite.db);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const tableId = await v.table("Own minutes");
    const { tabId } = await seat(v, tableId);
    const [station] = await inTx(v, (tx) =>
      tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true)),
    );
    await order(v, tabId, "Burger");
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ queuedAt: new Date(now - 6 * 60_000).toISOString() }),
    );
    const reads = async () => {
      const readers = await inTx(v, async (tx) => ({
        queue: (await listStationQueue(tx, station!.id))[0]!.items[0]!.band,
        pass: (await listExpoQueue(tx, v.cfg)).find((row) => row.orderId === tabId)!.worstBand,
        signals: (await readBillSignals(tx, [tabId], now)).get(tabId),
        overdue: (await computeOverdueOrders(tx, { nodeId: v.cfg.nodeId })).map((row) => ({
          id: row.orderId,
          band: row.band,
        })),
      }));
      return { ...readers, floor: (await floorRow(v, tableId)).timingBand };
    };
    expect(await reads()).toEqual({
      queue: "warm",
      pass: "warm",
      signals: [{ kind: "long_wait", band: "warm" }],
      overdue: [],
      floor: "warm",
    });
    await inTx(v, (tx) =>
      tx
        .update(kitchenStations)
        .set({ warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 })
        .where(eq(kitchenStations.id, station!.id)),
    );
    expect(await reads()).toEqual({
      queue: "forgotten",
      pass: "forgotten",
      signals: [{ kind: "long_wait", band: "forgotten" }],
      overdue: [{ id: tabId, band: "forgotten" }],
      floor: "forgotten",
    });
  });

  it("ages a released held group's dish from its release on the kitchen's boards and the overdue report", async () => {
    const v = await setupPartyVenue(suite.db);
    const { partyId, tabId } = await seatWithNoAllergies(v, await v.table("Held"));
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [{ menuItemId: v.item("Burger"), quantity: "1" }], release: "hold" }],
        operatorId: OPERATOR,
      }),
    );
    const heldAt = new Date(Date.now() - 20 * 60_000).toISOString();
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ queuedAt: heldAt }).where(eq(ticketItems.workingOrderId, tabId)),
    );
    const fire = { submissionId: randomUUID(), ...(await commandFor(v, partyId)) };
    await inTx(v, (tx) => fireGroup(tx, v.cfg, partyId, placed.groups[0]!.id, fire));

    await inTx(v, async (tx) => {
      const [kitchen] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true));
      const [card] = await listStationQueue(tx, kitchen!.id);
      expect(card!.queuedAt > heldAt).toBe(true);
      expect(card!.items.map((item) => item.band)).toEqual(["fresh"]);
      expect((await listExpoQueue(tx, v.cfg)).map((row) => row.worstBand)).toEqual(["fresh"]);
      expect(await computeOverdueOrders(tx, { nodeId: v.cfg.nodeId })).toEqual([]);
    });
  });
});
