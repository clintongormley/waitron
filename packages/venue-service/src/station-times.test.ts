import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  kitchenStations,
  locations,
  tenants,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { readHolidayFacts } from "./holidays.js";
import { saveSpecialDate } from "./hours.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import type { VenueScope } from "./operations.js";
import { routingModel } from "./routing-store.js";
import * as stationTimes from "./station-times.js";
import { stationDayStates } from "./schema/station-times.js";
import { setStationToday, venueMoment } from "./station-times.js";
import { clockChangeAfter } from "./testing/clock-change.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function fixture(tx: Transaction) {
  const [location] = await tx
    .insert(locations)
    .values({
      name: "Venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
    })
    .returning();
  const cfg = { locationId: locationId(location!.id) };
  const [other] = await tx
    .insert(locations)
    .values({ name: "Other", invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning();
  const stations = await tx
    .insert(kitchenStations)
    .values([
      { ...cfg, name: "Upstairs bar" },
      { ...cfg, name: "Downstairs bar" },
      { ...cfg, name: "Kitchen", isDefault: true },
      { ...cfg, name: "Retired", active: false },
      { locationId: locationId(other!.id), name: "Other station" },
    ])
    .returning();
  return {
    cfg,
    upstairs: stations[0]!.id,
    downstairs: stations[1]!.id,
    kitchen: stations[2]!.id,
    retired: stations[3]!.id,
    otherStation: stations[4]!.id,
  };
}

describe("station times", () => {
  it("shows an empty routing model before the venue adds its first prep station", async () => {
    await db.transaction(async (tx) => {
      const [venue] = await tx
        .insert(locations)
        .values({
          name: "New venue",
          invoiceLocales: ["en-GB"],
          operationDescription: "Hospitality",
          timeZone: "Europe/Madrid",
          dayCutover: "06:00:00",
        })
        .returning();
      const model = await routingModel(
        tx,
        { locationId: locationId(venue!.id) },
        new Date("2026-10-02T18:00:00Z"),
      );
      expect(model.stations).toEqual([]);
      expect(model.stationTimes).toEqual([]);
      expect(model.defaultStationId).toBeNull();
    });
  });

  it("keeps an active non-default station open", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const row = (
        await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))
      ).stationTimes.find((s) => s.stationId === f.upstairs);
      expect(row?.status).toEqual(openState);
    });
  });

  it("reports an open station without an hours field", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const row = (
        await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))
      ).stationTimes.find((station) => station.stationId === f.upstairs);
      expect(row).not.toHaveProperty("hours");
      expect(row).not.toHaveProperty("fallbackStationId");
      expect(row?.status).toEqual({ open: true, why: "open" });
    });
  });

  it("sends active and switched-off stations to the default when closed", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const view = async () =>
        (await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).stationTimes;
      const ignored = async (id: string, active: boolean) => {
        expect((await view()).find((s) => s.stationId === id)).toMatchObject({
          closedSendsTo: f.kitchen,
          status: active ? { open: true, why: "open" } : { open: false, why: "switched_off" },
        });
      };
      await ignored(f.upstairs, true);
      await ignored(f.upstairs, true);
      await ignored(f.downstairs, true);
      await ignored(f.retired, false);
    });
  });

  it("keeps a by-hand close until cutover and then reopens", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-03T03:59:00Z"))).stationTimes.find(
          (s) => s.stationId === f.upstairs,
        )?.status,
      ).toEqual({ open: false, why: "closed_by_hand" });
      expect(
        (await routingModel(tx, f.cfg, new Date("2026-10-03T04:00:00Z"))).stationTimes.find(
          (s) => s.stationId === f.upstairs,
        )?.status,
      ).toEqual({ open: true, why: "open" });
    });
  });

  it("clears earlier by-hand days when explicitly reopened", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T21:00:00Z"));
      await setStationToday(tx, f.cfg, f.upstairs, "open", new Date("2026-10-03T10:00:00Z"));
      expect(await tx.select().from(stationDayStates)).toHaveLength(0);
      await setStationToday(tx, f.cfg, f.upstairs, null, new Date("2026-10-03T10:00:00Z"));
      expect(await tx.select().from(stationDayStates)).toHaveLength(0);
    });
  });

  it("refuses a by-hand change when the venue clock is unreadable", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      await expect(
        setStationToday(tx, f.cfg, f.upstairs, "closed", new Date("2026-10-02T18:00:00Z")),
      ).rejects.toMatchObject({ code: "time_zone.unreadable" });
      expect(await venueMoment(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).toBeNull();
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"))).clockReadable).toBe(
        false,
      );
    });
  });

  it("shows the closed destination and the end of today's change", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const model = await routingModel(tx, f.cfg, new Date("2026-10-02T18:00:00Z"));
      expect(model.stationTimes.find((s) => s.stationId === f.upstairs)?.closedSendsTo).toBe(
        f.kitchen,
      );
      expect(model.stationTimes.find((s) => s.stationId === f.downstairs)?.closedSendsTo).toBe(
        f.kitchen,
      );
      expect(model.todayEnds).toEqual({ timeOfDay: "06:00", tomorrow: true });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-02T23:30:00Z"))).todayEnds).toEqual({
        timeOfDay: "06:00",
        tomorrow: false,
      });
      expect((await routingModel(tx, f.cfg, new Date("2026-10-03T04:00:00Z"))).todayEnds).toEqual({
        timeOfDay: "06:00",
        tomorrow: true,
      });
    });
  });
});

const SAVED_AT = new Date("2026-10-01T10:00:00Z");

async function saveDate(tx: Transaction, cfg: VenueScope, date: string, closeWholeVenue = false) {
  return saveSpecialDate(
    tx,
    cfg,
    null,
    { date, name: `Special ${date}`, closeWholeVenue },
    SAVED_AT,
  );
}

async function statusAt(tx: Transaction, cfg: VenueScope, id: string, instant: Date | string) {
  return (await routingModel(tx, cfg, new Date(instant))).stationTimes.find(
    (row) => row.stationId === id,
  )?.status;
}

const openState = { open: true, why: "open" };

describe("station status on named dates and calendar boundaries", () => {
  // Madrid is two hours ahead of UTC until 25 October 2026, one hour after it.
  it("keeps a station open across midnight and named dates", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const tuesdayHalfPastMidnight = "2026-10-05T22:30:00Z";
      expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(openState);
      await saveDate(tx, f.cfg, "2026-10-06");
      expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T00:00:00Z")).toEqual(openState);
      await saveDate(tx, f.cfg, "2026-10-05");
      expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(openState);
    });
  });

  it("keeps active stations open across month and year boundaries", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-12-31");
      await saveDate(tx, f.cfg, "2027-01-01");
      await saveDate(tx, f.cfg, "2026-10-31");
      await tx
        .update(kitchenStations)
        .set({ active: true })
        .where(eq(kitchenStations.id, f.retired));
      await saveDate(tx, f.cfg, "2026-10-11");

      expect(await statusAt(tx, f.cfg, f.upstairs, "2027-01-01T01:30:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2027-01-01T02:00:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-31T23:30:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-11-01T00:00:00Z")).toEqual({
        open: true,
        why: "open",
      });
      // Monday 12 October at 01:00 and 02:00 in Madrid.
      expect(await statusAt(tx, f.cfg, f.retired, "2026-10-11T23:00:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.retired, "2026-10-12T00:00:00Z")).toEqual(openState);
    });
  });

  it("keeps stations open throughout ordinary and named dates", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-08");
      // Tuesday 6 October from 00:00 to 23:59 in Madrid, then Wednesday.
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-05T22:00:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T21:59:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T22:00:00Z")).toEqual(openState);
      // Thursday 8 October is a named date.
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-08T12:00:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-08T22:00:00Z")).toEqual(openState);
    });
  });

  it("keeps both active non-default stations open", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T10:00:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "open",
      });
    });
  });

  it("keeps a by-hand close until cutover and ignores an explicit open row", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-06");
      const afternoon = new Date("2026-10-06T13:00:00Z");
      expect(await statusAt(tx, f.cfg, f.upstairs, afternoon)).toEqual(openState);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", afternoon);
      expect(await statusAt(tx, f.cfg, f.upstairs, afternoon)).toEqual({
        open: false,
        why: "closed_by_hand",
      });
      // Wednesday 05:59 is still Tuesday's business day; 06:00 is the cutover.
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-07T03:59:00Z")).toEqual({
        open: false,
        why: "closed_by_hand",
      });
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-07T04:00:00Z")).toEqual({
        open: true,
        why: "open",
      });

      await setStationToday(tx, f.cfg, f.downstairs, "open", afternoon);
      expect(await statusAt(tx, f.cfg, f.downstairs, afternoon)).toEqual({
        open: true,
        why: "open",
      });
      await setStationToday(tx, f.cfg, f.downstairs, null, afternoon);
      expect(await statusAt(tx, f.cfg, f.downstairs, afternoon)).toEqual(openState);
    });
  });

  it("keeps the default station open through a closed day, and an inactive default unavailable", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-06", true);
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.kitchen));
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.downstairs));
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "default",
      });
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T10:00:00Z")).toEqual(openState);
      await tx
        .update(kitchenStations)
        .set({ active: false })
        .where(eq(kitchenStations.id, f.downstairs));
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: false,
        why: "switched_off",
      });
    });
  });

  it("makes an open station the default on a named date", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-06");
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-13T10:00:00Z")).toEqual(openState);
      await tx
        .update(kitchenStations)
        .set({ isDefault: false })
        .where(eq(kitchenStations.id, f.kitchen));
      await tx
        .update(kitchenStations)
        .set({ isDefault: true })
        .where(eq(kitchenStations.id, f.downstairs));
      expect(await statusAt(tx, f.cfg, f.downstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "default",
      });
    });
  });

  it("keeps active stations open while the venue clock cannot be read", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await saveDate(tx, f.cfg, "2026-10-06", true);
      await tx
        .update(locations)
        .set({ timeZone: "Mars/Base" })
        .where(eq(locations.id, f.cfg.locationId));
      expect(await statusAt(tx, f.cfg, f.upstairs, "2026-10-06T10:00:00Z")).toEqual({
        open: true,
        why: "open",
      });
    });
  });

  it.each(["00:00:00", "06:00:00"])(
    "keeps stations open across midnight with a %s cutover",
    async (dayCutover) => {
      await db.transaction(async (tx) => {
        const f = await fixture(tx);
        await tx.update(locations).set({ dayCutover }).where(eq(locations.id, f.cfg.locationId));
        const tuesdayHalfPastMidnight = "2026-10-05T22:30:00Z";
        expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(openState);
        expect(await statusAt(tx, f.cfg, f.downstairs, tuesdayHalfPastMidnight)).toEqual(openState);
        await saveDate(tx, f.cfg, "2026-10-05");
        expect(await statusAt(tx, f.cfg, f.upstairs, tuesdayHalfPastMidnight)).toEqual(openState);
      });
    },
  );
});

describe("station status across clock changes", () => {
  const zone = "Europe/Madrid";
  const forward = clockChangeAfter(zone, "2027-01-01T00:00:00Z", "forward");
  const backward = clockChangeAfter(zone, "2027-07-01T00:00:00Z", "backward");
  const minute = 60_000;

  it("keeps a station open across skipped clock minutes", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const before = new Date(forward.instant.getTime() - 30 * minute);
      expect(await statusAt(tx, f.cfg, f.upstairs, before)).toEqual(openState);
      expect(
        (await routingModel(tx, f.cfg, before)).stationTimes.find(
          (row) => row.stationId === f.upstairs,
        ),
      ).not.toHaveProperty("nextTransition");
      expect(await statusAt(tx, f.cfg, f.upstairs, forward.instant)).toEqual(openState);
    });
  });

  it("keeps a station open immediately before and after skipped clock minutes", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      expect(
        await statusAt(tx, f.cfg, f.upstairs, new Date(forward.instant.getTime() - minute)),
      ).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, forward.instant)).toEqual(openState);
      expect(
        (
          await routingModel(tx, f.cfg, new Date(forward.instant.getTime() - 30 * minute))
        ).stationTimes.find((row) => row.stationId === f.upstairs),
      ).not.toHaveProperty("nextTransition");
    });
  });

  it("keeps a station open in both occurrences of a repeated minute", async () => {
    await db.transaction(async (tx) => {
      const f = await fixture(tx);
      const repeat = backward.deltaMinutes * minute;
      // The first pass through the repeated hour, then the second.
      const first = (minutes: number) =>
        new Date(backward.instant.getTime() - repeat + minutes * minute);
      const second = (minutes: number) => new Date(backward.instant.getTime() + minutes * minute);
      expect(await statusAt(tx, f.cfg, f.upstairs, first(15))).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, second(15))).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, first(45))).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, second(45))).toEqual(openState);
    });
  });
});

describe("station times on a public holiday", () => {
  // The file shares one taxpayer row; put back whatever it held before a case placed it in Spain.
  let tenantBefore: (typeof tenants.$inferSelect)[] = [];
  beforeAll(async () => {
    tenantBefore = await db.transaction((tx) => tx.select().from(tenants));
  });
  afterEach(async () => {
    await db.transaction(async (tx) => {
      await tx.delete(tenants);
      if (tenantBefore.length > 0) await tx.insert(tenants).values(tenantBefore);
    });
  });

  /** The fixture's venue, in Seville, Spain. */
  async function sevilleVenue(tx: Transaction) {
    const f = await fixture(tx);
    await tx
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "X0000000", legalName: "Invented SL" })
      .onConflictDoUpdate({ target: tenants.id, set: { country: "ES" } });
    await tx
      .update(locations)
      .set({ province: "Sevilla", city: "Sevilla" })
      .where(eq(locations.id, f.cfg.locationId));
    return f;
  }

  // Monday 12 October 2026, Spain's national day, against the ordinary Monday a week before, at
  // 12:00, 18:00, 22:59 and 23:00 in Seville (two hours ahead of UTC).
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";
  const TIMES = ["10:00", "16:00", "20:59", "21:00"];

  it("keeps station status the same on a Spanish national holiday and an ordinary Monday", async () => {
    await db.transaction(async (tx) => {
      const f = await sevilleVenue(tx);
      expect(await readHolidayFacts(tx, f.cfg, HOLIDAY, HOLIDAY)).toEqual([
        expect.objectContaining({ date: HOLIDAY, scope: "national" }),
      ]);
      expect(await readHolidayFacts(tx, f.cfg, ORDINARY, ORDINARY)).toEqual([]);

      const times = async (date: string, time: string) =>
        (await routingModel(tx, f.cfg, new Date(`${date}T${time}:00Z`))).stationTimes;
      for (const time of TIMES)
        expect(await times(HOLIDAY, time)).toEqual(await times(ORDINARY, time));
      expect(await statusAt(tx, f.cfg, f.upstairs, `${HOLIDAY}T18:00:00Z`)).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, `${HOLIDAY}T10:00:00Z`)).toEqual(openState);
      expect(
        (await times(HOLIDAY, "18:00")).find((row) => row.stationId === f.upstairs),
      ).not.toHaveProperty("specialDateRestricts");
    });
  });

  it("a saved named holiday does not close a prep station", async () => {
    await db.transaction(async (tx) => {
      const f = await sevilleVenue(tx);
      await saveDate(tx, f.cfg, HOLIDAY);
      expect(await statusAt(tx, f.cfg, f.upstairs, `${HOLIDAY}T18:00:00Z`)).toEqual(openState);
      expect(await statusAt(tx, f.cfg, f.upstairs, `${ORDINARY}T18:00:00Z`)).toEqual(openState);
    });
  });
});

describe("station today controls", () => {
  const at = new Date("2026-10-02T18:00:00Z");

  async function todayRows(stationId: string) {
    return db.transaction((tx) =>
      tx.select().from(stationDayStates).where(eq(stationDayStates.stationId, stationId)),
    );
  }

  it("closes with a destination and replaces the destination on a later close", async () => {
    const f = await db.transaction(fixture);
    await db.transaction((tx) =>
      stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at),
    );
    expect(await todayRows(f.upstairs)).toEqual([
      expect.objectContaining({
        businessDay: "2026-10-02",
        open: false,
        sendsToStationId: f.downstairs,
      }),
    ]);
    await db.transaction((tx) =>
      stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.kitchen, at),
    );
    expect(await todayRows(f.upstairs)).toEqual([
      expect.objectContaining({
        businessDay: "2026-10-02",
        open: false,
        sendsToStationId: f.kitchen,
      }),
    ]);
  });

  it.each([
    ["missing", "station.not_found"],
    ["otherStation", "station.not_found"],
    ["retired", "route.station_inactive"],
    ["kitchen", "station.always_open"],
  ] as const)(
    "refuses to close the %s source before validating the destination",
    async (key, code) => {
      const f = await db.transaction(fixture);
      const source = key === "missing" ? randomUUID() : f[key];
      await expect(
        db.transaction((tx) => stationTimes.closeStationForToday(tx, f.cfg, source, source, at)),
      ).rejects.toMatchObject({ code, params: { stationId: source } });
      expect(await todayRows(source)).toEqual([]);
    },
  );

  it.each([
    ["upstairs", "self"],
    ["retired", "inactive"],
    ["otherStation", "unknown"],
    ["missing", "unknown"],
    ["downstairs", "closed"],
  ] as const)("refuses the %s destination and retains the previous close", async (key, reason) => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", at);
      await setStationToday(tx, f.cfg, f.downstairs, "closed", at);
      return f;
    });
    const destination = key === "missing" ? randomUUID() : f[key];
    const before = await todayRows(f.upstairs);
    await expect(
      db.transaction((tx) =>
        stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, destination, at),
      ),
    ).rejects.toMatchObject({
      code: "station.destination_invalid",
      params: { stationId: f.upstairs, sendsToStationId: destination, reason },
    });
    expect(await todayRows(f.upstairs)).toEqual(before);
  });

  it("accepts an active destination and records the close", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      return f;
    });
    await db.transaction((tx) =>
      stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at),
    );
    expect(await todayRows(f.upstairs)).toEqual([
      {
        id: expect.any(String),
        stationId: f.upstairs,
        businessDay: "2026-10-02",
        open: false,
        sendsToStationId: f.downstairs,
      },
    ]);
    const model = await db.transaction((tx) => routingModel(tx, f.cfg, at));
    expect(model.stationTimes.find((row) => row.stationId === f.upstairs)).toMatchObject({
      status: { open: false, why: "closed_by_hand" },
      today: "closed",
      closedSendsTo: f.downstairs,
    });
  });

  it("offers the default first, then display order and name, leaving out unusable destinations", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.downstairs, "closed", at);
      await tx.insert(kitchenStations).values([
        { ...f.cfg, name: "Beta", displayOrder: 2, id: "00000000-0000-4000-8000-000000000003" },
        { ...f.cfg, name: "Zulu", displayOrder: 1, id: "00000000-0000-4000-8000-000000000001" },
        { ...f.cfg, name: "Alpha", displayOrder: 2, id: "00000000-0000-4000-8000-000000000002" },
      ]);
      await tx
        .update(kitchenStations)
        .set({ displayOrder: 9 })
        .where(eq(kitchenStations.id, f.kitchen));
      return f;
    });
    expect(
      await db.transaction((tx) => stationTimes.stationDestinations(tx, f.cfg, f.upstairs, at)),
    ).toEqual([
      { id: f.kitchen, name: "Kitchen", isDefault: true },
      { id: "00000000-0000-4000-8000-000000000001", name: "Zulu", isDefault: false },
      { id: "00000000-0000-4000-8000-000000000002", name: "Alpha", isDefault: false },
      { id: "00000000-0000-4000-8000-000000000003", name: "Beta", isDefault: false },
    ]);
  });

  it("offers an active destination across cutover", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.downstairs, "open", at);
      return f;
    });
    expect(
      await db.transaction((tx) => stationTimes.stationDestinations(tx, f.cfg, f.upstairs, at)),
    ).toEqual([
      { id: f.kitchen, name: "Kitchen", isDefault: true },
      { id: f.downstairs, name: "Downstairs bar", isDefault: false },
    ]);
    expect(
      await db.transaction((tx) =>
        stationTimes.stationDestinations(tx, f.cfg, f.upstairs, new Date("2026-10-03T04:00:00Z")),
      ),
    ).toEqual([
      { id: f.kitchen, name: "Kitchen", isDefault: true },
      { id: f.downstairs, name: "Downstairs bar", isDefault: false },
    ]);
  });

  it("reopens by removing today's row and stays open later", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      await setStationToday(tx, f.cfg, f.upstairs, "closed", at);
      return f;
    });
    await db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at));
    expect(await todayRows(f.upstairs)).toEqual([]);
    const model = await db.transaction((tx) =>
      routingModel(tx, f.cfg, new Date("2026-10-02T19:00:00Z")),
    );
    expect(model.stationTimes.find((row) => row.stationId === f.upstairs)?.status).toEqual({
      open: true,
      why: "open",
    });
  });

  it("reopens by deleting its closure and destination", async () => {
    const f = await db.transaction(async (tx) => {
      const f = await fixture(tx);
      return f;
    });
    await db.transaction((tx) =>
      stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at),
    );
    await db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at));
    expect(await todayRows(f.upstairs)).toEqual([]);
    const model = await db.transaction((tx) => routingModel(tx, f.cfg, at));
    expect(model.stationTimes.find((row) => row.stationId === f.upstairs)?.status).toEqual({
      open: true,
      why: "open",
    });
  });

  it.each([
    ["missing", "station.not_found"],
    ["otherStation", "station.not_found"],
    ["retired", "route.station_inactive"],
  ] as const)("refuses to open the %s source", async (key, code) => {
    const f = await db.transaction(fixture);
    const source = key === "missing" ? randomUUID() : f[key];
    await expect(
      db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, source, at)),
    ).rejects.toMatchObject({ code, params: { stationId: source } });
    expect(await todayRows(source)).toEqual([]);
  });

  it("reopens by removing the by-hand close", async () => {
    const f = await db.transaction(fixture);
    await db.transaction((tx) => setStationToday(tx, f.cfg, f.upstairs, "closed", at));
    await db.transaction((tx) => stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at));
    expect(await todayRows(f.upstairs)).toEqual([]);
  });

  it.each(["close", "open"] as const)(
    "refuses %s when the clock is unreadable without changing the previous row",
    async (action) => {
      const f = await db.transaction(async (tx) => {
        const f = await fixture(tx);
        await setStationToday(tx, f.cfg, f.upstairs, "closed", at);
        await tx
          .update(locations)
          .set({ timeZone: "Mars/Base" })
          .where(eq(locations.id, f.cfg.locationId));
        return f;
      });
      const before = await todayRows(f.upstairs);
      await expect(
        db.transaction((tx) =>
          action === "close"
            ? stationTimes.closeStationForToday(tx, f.cfg, f.upstairs, f.downstairs, at)
            : stationTimes.openStationForToday(tx, f.cfg, f.upstairs, at),
        ),
      ).rejects.toMatchObject({ code: "time_zone.unreadable" });
      expect(await todayRows(f.upstairs)).toEqual(before);
    },
  );
});
