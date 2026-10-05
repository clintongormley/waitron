import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { kitchenStations, ticketItems, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { computeOverdueOrders } from "@waitron/reporting";
import { createStation, deactivateStation, updateStation } from "./kitchen.js";
import { setKitchenTimingDefaults } from "./kitchen-timing.js";
import { readBillSignals } from "./table-signals.js";
import { floorRow, inTx, order, seat, setupPartyVenue } from "./testing/party-venue.js";
import { serveLine } from "./testing/serve-line.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { listExpoQueue, listStationQueue } from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
afterEach(() => vi.restoreAllMocks());

// Reading the original station columns instead of effective values must change these bands.
describe("effective kitchen timing across consumers", () => {
  it.each([
    [1, "fresh", "fresh"],
    [2, "warm", "fresh"],
    [4, "overdue", "warm"],
    [6, "forgotten", "overdue"],
    [7, "forgotten", "forgotten"],
  ] as const)(
    "classifies age %i consistently, including retained disabled-station work",
    async (age, inheritedBand, overriddenBand) => {
      const v = await setupPartyVenue(suite.db);
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);
      const { inherited, overridden } = await inTx(v, async (tx) => {
        await setKitchenTimingDefaults(tx, v.cfg, {
          warmAfterMinutes: 2,
          overdueAfterMinutes: 4,
          forgottenAfterMinutes: 6,
        });
        const [kitchen] = await tx
          .select({ id: kitchenStations.id })
          .from(kitchenStations)
          .where(eq(kitchenStations.isDefault, true));
        const bar = await createStation(tx, v.cfg, {
          name: "Bar",
          thresholds: { warmAfterMinutes: 3, overdueAfterMinutes: 5, forgottenAfterMinutes: 7 },
        });
        await routeProductTo(tx, v.cfg, v.productId("Caña"), bar.id);
        return { inherited: kitchen!.id, overridden: bar.id };
      });
      const first = await v.table("Inherited");
      const second = await v.table("Overridden");
      const a = await seat(v, first);
      const b = await seat(v, second);
      await order(v, a.tabId, "Burger");
      await order(v, b.tabId, "Caña");
      await inTx(v, async (tx) => {
        await tx.update(ticketItems).set({ queuedAt: new Date(now - age * 60_000).toISOString() });
        await deactivateStation(tx, v.cfg, overridden);
        for (const [stationId, billId, band, thresholds] of [
          [
            inherited,
            a.tabId,
            inheritedBand,
            { warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 },
          ],
          [
            overridden,
            b.tabId,
            overriddenBand,
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
            [a.tabId, inheritedBand],
            [b.tabId, overriddenBand],
          ]
            .filter(([, band]) => band === "overdue" || band === "forgotten")
            .map(([id, band]) => ({ id, band })),
        );
      });
      for (const [tableId, band] of [
        [first, inheritedBand],
        [second, overriddenBand],
      ] as const) {
        const row = await floorRow(v, tableId);
        expect.soft(row.timingBand).toBe(band);
        expect.soft(row.signals).toEqual(band === "fresh" ? [] : [{ kind: "long_wait", band }]);
      }
    },
  );

  it("reclassifies inherited fields on a default edit and preserves explicit fields", async () => {
    const v = await setupPartyVenue(suite.db);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const [station] = await inTx(v, (tx) =>
      tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true)),
    );
    const { tabId } = await seat(v, await v.table("Defaults"));
    await order(v, tabId, "Burger");
    await inTx(v, async (tx) => {
      await tx.update(ticketItems).set({ queuedAt: new Date(now - 4 * 60_000).toISOString() });
      await updateStation(tx, v.cfg, station!.id, { warmAfterMinutes: 3 });
      expect.soft((await listStationQueue(tx, station!.id))[0]!.items[0]!.band).toBe("warm");
      await setKitchenTimingDefaults(tx, v.cfg, {
        warmAfterMinutes: 1,
        overdueAfterMinutes: 4,
        forgottenAfterMinutes: 6,
      });
      const [queue] = await listStationQueue(tx, station!.id);
      expect
        .soft(queue!.thresholds)
        .toEqual({ warmAfterMinutes: 3, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 });
      expect.soft(queue!.items[0]!.band).toBe("overdue");
      await tx.update(ticketItems).set({ madeHere: true });
      expect.soft(await listStationQueue(tx, station!.id)).toEqual([]);
      expect.soft(await listExpoQueue(tx, v.cfg)).toEqual([]);
      expect.soft(await computeOverdueOrders(tx, { nodeId: v.cfg.nodeId })).toEqual([]);
      expect.soft((await readBillSignals(tx, [tabId], now)).get(tabId)).toEqual([]);
      await tx.update(ticketItems).set({ madeHere: false });
      await tx
        .update(workingOrders)
        .set({ collectedAt: new Date(now).toISOString() })
        .where(eq(workingOrders.id, tabId));
      expect.soft(await listStationQueue(tx, station!.id)).toEqual([]);
      expect.soft(await listExpoQueue(tx, v.cfg)).toEqual([]);
      expect.soft(await computeOverdueOrders(tx, { nodeId: v.cfg.nodeId })).toEqual([]);
    });
  });
  it("a venue edit reclassifies inherited live work but leaves a fully overridden station alone", async () => {
    const v = await setupPartyVenue(suite.db);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const inheritedTable = await v.table("Inherited edit");
    const overrideTable = await v.table("Override edit");
    const a = await seat(v, inheritedTable);
    const b = await seat(v, overrideTable);
    const [kitchen] = await inTx(v, (tx) =>
      tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(eq(kitchenStations.isDefault, true)),
    );
    const bar = await inTx(v, async (tx) => {
      const station = await createStation(tx, v.cfg, {
        name: "Overrides",
        thresholds: { warmAfterMinutes: 3, overdueAfterMinutes: 8, forgottenAfterMinutes: 12 },
      });
      await routeProductTo(tx, v.cfg, v.productId("Caña"), station.id);
      return station;
    });
    await order(v, a.tabId, "Burger");
    await order(v, b.tabId, "Caña");
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ queuedAt: new Date(now - 5 * 60_000).toISOString() }),
    );
    const bands = async () => {
      const readers = await inTx(v, async (tx) => {
        const queues = [];
        for (const id of [kitchen!.id, bar.id])
          queues.push((await listStationQueue(tx, id))[0]!.items[0]!.band);
        const expo = await listExpoQueue(tx, v.cfg);
        const signals = await readBillSignals(tx, [a.tabId, b.tabId], now);
        return {
          queues,
          expo: [a.tabId, b.tabId].map((id) => expo.find((row) => row.orderId === id)!.worstBand),
          signals: [a.tabId, b.tabId].map((id) => signals.get(id)),
        };
      });
      return {
        ...readers,
        floor: [
          (await floorRow(v, inheritedTable)).timingBand,
          (await floorRow(v, overrideTable)).timingBand,
        ],
      };
    };
    expect(await bands()).toEqual({
      queues: ["warm", "warm"],
      expo: ["warm", "warm"],
      signals: [[{ kind: "long_wait", band: "warm" }], [{ kind: "long_wait", band: "warm" }]],
      floor: ["warm", "warm"],
    });
    await inTx(v, (tx) =>
      setKitchenTimingDefaults(tx, v.cfg, {
        warmAfterMinutes: 1,
        overdueAfterMinutes: 3,
        forgottenAfterMinutes: 6,
      }),
    );
    expect(await bands()).toEqual({
      queues: ["overdue", "warm"],
      expo: ["overdue", "warm"],
      signals: [[{ kind: "long_wait", band: "overdue" }], [{ kind: "long_wait", band: "warm" }]],
      floor: ["overdue", "warm"],
    });
    expect(await inTx(v, (tx) => computeOverdueOrders(tx, { nodeId: v.cfg.nodeId }))).toEqual([
      expect.objectContaining({ orderId: a.tabId, band: "overdue" }),
    ]);
    await inTx(v, (tx) => serveLine(tx, v.cfg, a.tabId, 1));
    expect((await floorRow(v, inheritedTable)).timingBand).toBe("fresh");
    expect((await floorRow(v, inheritedTable)).signals).toEqual([]);
    await inTx(v, async (tx) => {
      expect(
        (await listExpoQueue(tx, v.cfg)).find((row) => row.orderId === a.tabId)!.worstBand,
      ).toBe("fresh");
      expect((await readBillSignals(tx, [a.tabId], now)).get(a.tabId)).toEqual([]);
      expect(await computeOverdueOrders(tx, { nodeId: v.cfg.nodeId })).toEqual([]);
    });
  });
});
