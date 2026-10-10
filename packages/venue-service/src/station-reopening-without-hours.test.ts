import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import { loadRoutingRules, routingAt, routingModel, stationStates } from "./routing-store.js";
import { stationDayStates } from "./schema/station-times.js";
import { openStationForToday, setStationToday } from "./station-times.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const at = new Date("2026-10-09T12:00:00Z");

async function fixture(tx: Transaction) {
  const [venue] = await tx
    .insert(locations)
    .values({
      name: "Reopening venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning();
  const cfg = { locationId: locationId(venue!.id) };
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
      await setStationToday(tx, f.cfg, f.bar, "closed", at, f.kitchen);
      await setStationToday(tx, f.cfg, f.grill, "closed", at, f.kitchen);
      return f;
    });
    await withTransaction(suite.db, async (tx) => {
      const session = (
        tx as unknown as { session: { prepareQuery: (...args: never[]) => unknown } }
      ).session;
      const prepared = vi.spyOn(session, "prepareQuery");
      let queries: string[];
      try {
        await openStationForToday(tx, f.cfg, f.bar, at);
        queries = prepared.mock.calls.map(([query]) => (query as unknown as { sql: string }).sql);
      } finally {
        prepared.mockRestore();
      }
      expect(
        queries.filter(
          (query) =>
            /^select\b/i.test(query) &&
            /"(?:routing_cells|categories|category_details|station_day_states|hours_week_cells|hours_week_periods|special_dates|special_date_hours|special_date_hours_periods|station_fallbacks)"/.test(
              query,
            ),
        ),
      ).toEqual([]);
      expect(
        await tx.select().from(stationDayStates).where(eq(stationDayStates.stationId, f.bar)),
      ).toEqual([]);
      expect(
        await tx.select().from(stationDayStates).where(eq(stationDayStates.stationId, f.grill)),
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
      await setStationToday(tx, f.cfg, f.bar, "closed", at, f.kitchen);
      await setStationToday(tx, f.cfg, f.bar, "open", at);
      expect(
        await tx.select().from(stationDayStates).where(eq(stationDayStates.stationId, f.bar)),
      ).toEqual([]);
      expect((await stationStates(tx, f.cfg, at)).get(f.bar)).toEqual({
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
    "%s treats a stored open row as no override, including a stray destination",
    async (read) => {
      await withTransaction(suite.db, async (tx) => {
        const f = await fixture(tx);
        await tx.insert(stationDayStates).values({
          stationId: f.bar,
          businessDay: "2026-10-09",
          open: true,
          sendsToStationId: f.grill,
        });
        await setStationToday(tx, f.cfg, f.grill, "closed", at, f.kitchen);
        if (read === "rules") {
          const rules = await loadRoutingRules(tx, f.cfg, "2026-10-09");
          expect(rules.timing.get(f.bar)).toMatchObject({ today: null, todaySendsTo: null });
          expect(rules.timing.get(f.grill)).toMatchObject({
            today: "closed",
            todaySendsTo: f.kitchen,
          });
        } else if (read === "model") {
          const model = await routingModel(tx, f.cfg, at);
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
              ? await stationStates(tx, f.cfg, at)
              : await (await routingAt(tx, f.cfg, at)).stations();
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
