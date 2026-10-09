import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { kitchenNotices } from "@waitron/venue-service";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { listStationsNotices } from "./station-notices.js";
import { setupVenue } from "./testing/venue-fixtures.js";
import { offerProducts } from "./testing/zone-offers.js";
import { parkOrder } from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** A venue whose business day began about 22.5 hours ago, its grill and bar, and one order. */
async function setup() {
  const venue = await setupVenue(suite.db);
  const bar = await withTransaction(suite.db, (tx) =>
    createStation(tx, venue.cfg, { name: "Bar", isDefault: false }),
  );
  const orderId = randomUUID();
  const offers = await withTransaction(suite.db, (tx) => offerProducts(tx, venue.cfg));
  await parkOrder({ db: suite.db }, venue.cfg, {
    id: orderId,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines([{ productId: venue.cafeId, quantity: "1" }]),
    label: "Mesa 7",
  });
  const dayCutover = `${new Date(Date.now() + 90 * 60_000).toISOString().slice(11, 16)}:00`;
  await suite.db
    .update(locations)
    .set({ timeZone: "UTC", dayCutover })
    .where(eq(locations.id, venue.cfg.locationId));
  const notice = async (
    stationId: string,
    createdAt: string,
    values: Partial<typeof kitchenNotices.$inferInsert> = {},
  ) => {
    const [row] = await suite.db
      .insert(kitchenNotices)
      .values({
        stationId,
        workingOrderId: orderId,
        orderLabel: "#1",
        kind: "void",
        lineName: "Burger",
        quantity: 1000,
        createdAt,
        ...values,
      })
      .returning({ id: kitchenNotices.id });
    return row!.id;
  };
  return { venue, grill: venue.defaultStationId, bar: bar.id, notice };
}

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

describe("listStationsNotices", () => {
  it("answers each station exactly what the single-station read answers for it", async () => {
    const f = await setup();
    await f.notice(f.grill, secondsAgo(30), {
      kind: "changed",
      direction: "removed",
      unitName: { en: "glass", es: "copa" },
      soldInEach: true,
      wasStarted: true,
      note: "sin hielo",
      cancelledExtra: "Hielo",
      quantity: 1500,
    });
    await f.notice(f.bar, secondsAgo(20), { kind: "moved", movedTo: "Mesa 3" });
    await f.notice(f.grill, secondsAgo(10), { kind: "rerouted", reroutedTo: "Bar" });
    const acknowledged = await f.notice(f.bar, secondsAgo(5));
    await suite.db
      .update(kitchenNotices)
      .set({ acknowledgedAt: new Date().toISOString() })
      .where(eq(kitchenNotices.id, acknowledged));
    await f.notice(f.bar, "2000-01-01T00:00:00.000Z", { lineName: "Yesterday" });

    const { batched, single } = await withTransaction(suite.db, async (tx) => ({
      batched: await listStationsNotices(tx, f.venue.cfg, [f.grill, f.bar]),
      single: new Map([
        [f.grill, await VENUE_SERVICE.listStationNotices(tx, f.venue.cfg, f.grill)],
        [f.bar, await VENUE_SERVICE.listStationNotices(tx, f.venue.cfg, f.bar)],
      ]),
    }));

    expect(single.get(f.grill)).toHaveLength(2);
    expect(single.get(f.bar)).toHaveLength(1);
    expect(batched).toEqual(single);
  });

  it("keeps each station's newest fifty, oldest first, whatever another station holds", async () => {
    const f = await setup();
    const base = Date.now() - 60 * 60_000;
    for (let index = 0; index < 55; index += 1) {
      await f.notice(f.grill, new Date(base + index * 1000).toISOString(), {
        lineName: `G${index}`,
      });
    }
    // Two notices in the same millisecond: the later insertion is the newer.
    const tied = new Date(base + 100_000).toISOString();
    await f.notice(f.bar, tied, { lineName: "B0" });
    await f.notice(f.bar, tied, { lineName: "B1" });

    const notices = await withTransaction(suite.db, (tx) =>
      listStationsNotices(tx, f.venue.cfg, [f.bar, f.grill]),
    );

    expect(notices.get(f.grill)!.map((n) => n.lineName)).toEqual(
      Array.from({ length: 50 }, (_, index) => `G${index + 5}`),
    );
    expect(notices.get(f.bar)!.map((n) => n.lineName)).toEqual(["B0", "B1"]);
  });

  it("issues the same statements for three stations as for one, and gives a station with none an empty list", async () => {
    const f = await setup();
    const postre = await withTransaction(suite.db, (tx) =>
      createStation(tx, f.venue.cfg, { name: "Postre", isDefault: false }),
    );
    await f.notice(f.grill, secondsAgo(10));
    await f.notice(f.bar, secondsAgo(10));
    const statements = async (stationIds: string[]) =>
      withTransaction(suite.db, async (tx) => {
        const select = vi.spyOn(tx, "select");
        try {
          const notices = await listStationsNotices(tx, f.venue.cfg, stationIds);
          return { calls: select.mock.calls.length, notices };
        } finally {
          select.mockRestore();
        }
      });

    const one = await statements([f.grill]);
    const three = await statements([f.grill, f.bar, postre.id]);

    expect(three.calls).toBe(one.calls);
    expect([...three.notices].map(([id, list]) => [id, list.length])).toEqual([
      [f.grill, 1],
      [f.bar, 1],
      [postre.id, 0],
    ]);
  });

  it("reads nothing for no stations", async () => {
    const f = await setup();
    await withTransaction(suite.db, async (tx) => {
      const select = vi.spyOn(tx, "select");
      try {
        expect(await listStationsNotices(tx, f.venue.cfg, [])).toEqual(new Map());
        expect(select).not.toHaveBeenCalled();
      } finally {
        select.mockRestore();
      }
    });
  });
});
