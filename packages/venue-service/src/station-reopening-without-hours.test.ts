import { eq, and, isNotNull, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  withTransaction,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedActivityActor } from "@waitron/db/testing/seed.js";
import { loadRoutingRules, routingAt, routingModel, stationStates } from "./routing-store.js";
import { openStationForToday, setStationToday } from "./station-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const at = new Date("2026-10-09T12:00:00Z");

async function fixture(tx: Transaction) {
  await seedVenue(tx, {
    name: "Reopening venue",
    invoiceLocales: ["en-GB"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  });
  const venueId = await venueLocationId(tx);
  const cfg = { locationId: venueId };
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Kitchen", isDefault: true },
      { ...cfg, name: "Bar" },
      { ...cfg, name: "Grill" },
    ])
    .returning();
  return { cfg, kitchen: stations[0]!.id, bar: stations[1]!.id, grill: stations[2]!.id };
}

describe("station reopening without hours", () => {
  it("removes the closure without loading routing or the station calendar", async () => {
    const f = await withTransaction(suite.db, async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.bar, "closed", at, await seedActivityActor(tx), f.kitchen);
      await setStationToday(tx, f.grill, "closed", at, await seedActivityActor(tx), f.kitchen);
      return f;
    });
    await withTransaction(suite.db, async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      let queries: string[];
      try {
        await openStationForToday(tx, f.bar, at, await seedActivityActor(tx));
        queries = prepared.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
      } finally {
        prepared.mockRestore();
      }
      expect(
        queries.filter(
          (query) =>
            /^select\b/i.test(query) &&
            /"(?:routing_cells|categories|category_details|hours_week_cells|hours_week_periods|special_date_hours|special_date_hours_periods|station_fallbacks)"/.test(
              query,
            ),
        ),
      ).toEqual([]);
      expect(
        await tx
          .select({
            id: kitchenStations.id,
            stationId: kitchenStations.id,
            businessDay: kitchenStations.closedOnDay,
            open: sql<boolean>`0`.mapWith(Boolean),
            sendsToStationId: kitchenStations.closedSendsToStationId,
          })
          .from(kitchenStations)
          .where(and(isNotNull(kitchenStations.closedOnDay), eq(kitchenStations.id, f.bar))),
      ).toEqual([]);
      expect(
        await tx
          .select({
            id: kitchenStations.id,
            stationId: kitchenStations.id,
            businessDay: kitchenStations.closedOnDay,
            open: sql<boolean>`0`.mapWith(Boolean),
            sendsToStationId: kitchenStations.closedSendsToStationId,
          })
          .from(kitchenStations)
          .where(and(isNotNull(kitchenStations.closedOnDay), eq(kitchenStations.id, f.grill))),
      ).toEqual([
        {
          id: expect.any(String),
          stationId: f.grill,
          businessDay: "2026-10-09",
          open: false,
          sendsToStationId: f.kitchen,
        },
      ]);
    });
  });

  it("an explicit open clears the closure and its destination instead of storing an override", async () => {
    await withTransaction(suite.db, async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.bar, "closed", at, await seedActivityActor(tx), f.kitchen);
      await setStationToday(tx, f.bar, "open", at, await seedActivityActor(tx));
      expect(
        await tx
          .select({
            id: kitchenStations.id,
            stationId: kitchenStations.id,
            businessDay: kitchenStations.closedOnDay,
            open: sql<boolean>`0`.mapWith(Boolean),
            sendsToStationId: kitchenStations.closedSendsToStationId,
          })
          .from(kitchenStations)
          .where(and(isNotNull(kitchenStations.closedOnDay), eq(kitchenStations.id, f.bar))),
      ).toEqual([]);
      expect((await stationStates(tx, at)).get(f.bar)).toEqual({
        name: "Bar",
        active: true,
        isDefault: false,
        open: true,
        byHand: null,
        sendsTo: null,
        why: "open",
      });
    });
  });

  it.each(["rules", "model", "states", "resolver"] as const)(
    "%s ignores yesterday's closure and destination",
    async (read) => {
      await withTransaction(suite.db, async (tx) => {
        const f = await fixture(tx);
        await tx
          .update(kitchenStations)
          .set({ closedOnDay: "2026-10-08", closedSendsToStationId: f.grill })
          .where(eq(kitchenStations.id, f.bar));
        await setStationToday(tx, f.grill, "closed", at, await seedActivityActor(tx), f.kitchen);
        if (read === "rules") {
          const rules = await loadRoutingRules(tx, "2026-10-09");
          expect(rules.timing.get(f.bar)).toMatchObject({ today: null, todaySendsTo: null });
          expect(rules.timing.get(f.grill)).toMatchObject({
            today: "closed",
            todaySendsTo: f.kitchen,
          });
        } else if (read === "model") {
          const model = await routingModel(tx, at);
          expect(model.stationTimes.find((row) => row.stationId === f.bar)).toMatchObject({
            status: { open: true, why: "open" },
            today: null,
            closedSendsTo: f.kitchen,
          });
          expect(model.stationTimes.find((row) => row.stationId === f.grill)).toMatchObject({
            status: { open: false, why: "closed_by_hand" },
            today: "closed",
            closedSendsTo: f.kitchen,
          });
        } else {
          const states =
            read === "states"
              ? await stationStates(tx, at)
              : await (await routingAt(tx, at)).stations();
          expect(states.get(f.bar)).toMatchObject({
            open: true,
            byHand: null,
            sendsTo: null,
            why: "open",
          });
          expect(states.get(f.grill)).toMatchObject({
            open: false,
            byHand: "closed",
            sendsTo: f.kitchen,
            why: "closed_by_hand",
          });
        }
      });
    },
  );
});
