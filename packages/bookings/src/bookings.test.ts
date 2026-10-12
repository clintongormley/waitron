import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  floorPlanTableParts,
  floorPlanTables,
  floorPlans,
  floorTodayTables,
  floorZones,
  newId,
  nowIso,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { CoreServices } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId } from "@waitron/shared";
import { bookings } from "./schema/bookings.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import { fakeCore } from "./testing/fake-core.js";
import {
  cancelBooking,
  completeBooking,
  createBooking,
  getBooking,
  listBookings,
  markNoShow,
  seatBooking,
  updateBooking,
  type BookingConfig,
} from "./bookings.js";
import "./errors.js";

type VenueCfg = BookingConfig;

const suite = useVenueDb({
  migrations: BOOKINGS_TEST_MIGRATIONS,
  timeoutMs: 60_000,
});

let db: Database;

beforeAll(() => {
  db = suite.db;
});

interface Venue {
  cfg: VenueCfg;
  /** A fixture person id for `created_by` (no FK — the drawer_opens.person_id seam). */
  createdBy: string;
}

/** Raw SQL names `id` because it has no SQL default: drizzle's `$defaultFn` fills it for builder
 * inserts only. `invoice_locales` is a JSON array stored as text. */
async function insertLocation(name: string): Promise<string> {
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (id, name, invoice_locales, operation_description)
    values (${newId()}, ${name}, '["es-ES"]', 'Venta en establecimiento')
    returning id`);
  return loc.rows[0]!.id;
}

/** Raw inserts supply the id and timestamp; the helper optionally gives the table a today row. */
async function insertDiningTable(
  locationId: string,
  label: string,
  active = true,
): Promise<string> {
  const [zone] = await db
    .insert(floorZones)
    .values({ locationId, name: label })
    .returning({ id: floorZones.id });
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (id, created_at, location_id, zone_id, label)
    values (${newId()}, ${nowIso()}, ${locationId}, ${zone!.id}, ${label})
    returning id`);
  if (active) await db.insert(floorTodayTables).values({ tableId: row.rows[0]!.id });
  return row.rows[0]!.id;
}

async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  const locationId = await insertLocation("Barra");
  return {
    cfg: { locationId: brandLocationId(locationId) },
    createdBy: randomUUID(),
  };
}

async function makeTable(cfg: VenueCfg, active = true): Promise<string> {
  return insertDiningTable(cfg.locationId, "12", active);
}

/** An active table in a SECOND location: the shape the location-scope guard must refuse. */
async function makeTableInOtherLocation(): Promise<string> {
  const otherLocationId = await insertLocation("Terraza");
  return insertDiningTable(otherLocationId, "B-1");
}

function scoped<T>(cfg: VenueCfg, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Insert a booking directly at an arbitrary status, bypassing the lifecycle verbs. */
async function seedBooking(
  cfg: VenueCfg,
  createdBy: string,
  status: "booked" | "seated" | "completed" | "no_show" | "cancelled",
): Promise<string> {
  return scoped(cfg, async (tx) => {
    const [row] = await tx
      .insert(bookings)
      .values({
        locationId: cfg.locationId,
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Fixture",
        createdBy,
        status,
      })
      .returning({ id: bookings.id });
    return row!.id;
  });
}

describe("createBooking + listBookings", () => {
  it("creates, lists-by-day ordered, rejects a bad party size, and walks the lifecycle", async () => {
    const { cfg, createdBy } = await setupVenue();

    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        createdBy,
      }),
    );
    await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "13:30",
        partySize: 2,
        contactName: "Ruiz",
        createdBy,
      }),
    );

    // The seconds come from `storedTime` (`./bookings.ts`): the column is plain text.
    const listed = await scoped(cfg, (tx) => listBookings(tx, cfg, { date: "2026-08-20" }));
    expect(listed.map((b) => b.bookingTime)).toEqual(["13:30:00", "20:00:00"]);

    await expect(
      scoped(cfg, (tx) =>
        createBooking(tx, cfg, {
          bookingDate: "2026-08-20",
          bookingTime: "20:00",
          partySize: 0,
          contactName: "X",
          createdBy,
        }),
      ),
    ).rejects.toMatchObject({ code: "booking.invalid" });

    await scoped(cfg, (tx) => cancelBooking(tx, cfg, id));
    await expect(scoped(cfg, (tx) => completeBooking(tx, cfg, id))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  it("filters listBookings to the requested date only", async () => {
    const { cfg, createdBy } = await setupVenue();
    await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Today",
        createdBy,
      }),
    );
    await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-21",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Tomorrow",
        createdBy,
      }),
    );
    const listed = await scoped(cfg, (tx) => listBookings(tx, cfg, { date: "2026-08-20" }));
    expect(listed).toHaveLength(1);
    expect(listed[0]!.contactName).toBe("Today");
  });

  it("stores the optional fields and status='booked'", async () => {
    const { cfg, createdBy } = await setupVenue();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        contactPhone: "600123456",
        notes: "ventana",
        createdBy,
      }),
    );
    const row = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(row).toMatchObject({
      status: "booked",
      contactPhone: "600123456",
      notes: "ventana",
      tabId: null,
      tableId: null,
    });
  });

  // The OTHER side of `storedTime`: `routes.ts`'s `TIME_HHMM` accepts `HH:MM:SS` as well as `HH:MM`,
  // so a caller can hand the write path a time already in the stored form, and both spellings of one
  // wall-clock time must land on one stored value.
  it("stores an already-HH:MM:SS time unchanged, so one wall-clock time has one stored value", async () => {
    const { cfg, createdBy } = await setupVenue();
    for (const [time, name] of [
      ["18:15:00", "Sent with seconds"],
      ["18:15", "Sent without"],
    ] as const) {
      await scoped(cfg, (tx) =>
        createBooking(tx, cfg, {
          bookingDate: "2026-08-21",
          bookingTime: time,
          partySize: 2,
          contactName: name,
          createdBy,
        }),
      );
    }
    const listed = await scoped(cfg, (tx) => listBookings(tx, cfg, { date: "2026-08-21" }));
    expect(listed.map((b) => b.bookingTime)).toEqual(["18:15:00", "18:15:00"]);
  });
});

describe("createBooking — optional table link", () => {
  it("accepts an ACTIVE table id", async () => {
    const { cfg, createdBy } = await setupVenue();
    const tableId = await makeTable(cfg);
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "García",
        tableId,
        createdBy,
      }),
    );
    const row = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(row!.tableId).toBe(tableId);
  });

  it("rejects an absent table with table.not_found", async () => {
    const { cfg, createdBy } = await setupVenue();
    await expect(
      scoped(cfg, (tx) =>
        createBooking(tx, cfg, {
          bookingDate: "2026-08-20",
          bookingTime: "20:00",
          partySize: 2,
          contactName: "García",
          tableId: randomUUID(),
          createdBy,
        }),
      ),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });

  it("rejects an INACTIVE table with table.not_found", async () => {
    const { cfg, createdBy } = await setupVenue();
    const tableId = await makeTable(cfg, false);
    await expect(
      scoped(cfg, (tx) =>
        createBooking(tx, cfg, {
          bookingDate: "2026-08-20",
          bookingTime: "20:00",
          partySize: 2,
          contactName: "García",
          tableId,
          createdBy,
        }),
      ),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });

  it("rejects an ACTIVE table in ANOTHER location of the same tenant with table.not_found", async () => {
    const { cfg, createdBy } = await setupVenue();
    const tableId = await makeTableInOtherLocation();
    await expect(
      scoped(cfg, (tx) =>
        createBooking(tx, cfg, {
          bookingDate: "2026-08-20",
          bookingTime: "20:00",
          partySize: 2,
          contactName: "García",
          tableId,
          createdBy,
        }),
      ),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });
});

describe("updateBooking", () => {
  it("edits fields while booked", async () => {
    const { cfg, createdBy } = await setupVenue();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        createdBy,
      }),
    );
    await scoped(cfg, (tx) =>
      updateBooking(tx, cfg, id, { partySize: 6, contactName: "García (6)", notes: "grande" }),
    );
    const row = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(row).toMatchObject({ partySize: 6, contactName: "García (6)", notes: "grande" });
  });

  it("rejects an absent id with booking.not_found", async () => {
    const { cfg } = await setupVenue();
    await expect(
      scoped(cfg, (tx) => updateBooking(tx, cfg, randomUUID(), { partySize: 3 })),
    ).rejects.toMatchObject({ code: "booking.not_found" });
  });

  it.each(["seated", "completed", "no_show", "cancelled"] as const)(
    "rejects an edit of a %s booking with booking.invalid_transition",
    async (status) => {
      const { cfg, createdBy } = await setupVenue();
      const id = await seedBooking(cfg, createdBy, status);
      const before = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
      await expect(
        scoped(cfg, (tx) => updateBooking(tx, cfg, id, { partySize: 3 })),
      ).rejects.toMatchObject({ code: "booking.invalid_transition", params: { bookingId: id } });
      expect(await scoped(cfg, (tx) => getBooking(tx, cfg, id))).toEqual(before);
    },
  );

  it("rejects a non-positive party size with booking.invalid", async () => {
    const { cfg, createdBy } = await setupVenue();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        createdBy,
      }),
    );
    await expect(
      scoped(cfg, (tx) => updateBooking(tx, cfg, id, { partySize: 0 })),
    ).rejects.toMatchObject({ code: "booking.invalid" });
  });

  it("assigns an ACTIVE table on edit", async () => {
    const { cfg, createdBy } = await setupVenue();
    const tableId = await makeTable(cfg);
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        createdBy,
      }),
    );
    await scoped(cfg, (tx) => updateBooking(tx, cfg, id, { tableId }));
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, id)))!.tableId).toBe(tableId);
  });

  it("rejects an edit that assigns an absent table with table.not_found", async () => {
    const { cfg, createdBy } = await setupVenue();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        createdBy,
      }),
    );
    await expect(
      scoped(cfg, (tx) => updateBooking(tx, cfg, id, { tableId: randomUUID() })),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });

  it("rejects an edit that assigns a table in ANOTHER location with table.not_found", async () => {
    const { cfg, createdBy } = await setupVenue();
    const tableId = await makeTableInOtherLocation();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        createdBy,
      }),
    );
    await expect(
      scoped(cfg, (tx) => updateBooking(tx, cfg, id, { tableId })),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });
});

describe("lifecycle verbs", () => {
  it("cancelBooking: booked → cancelled, and seated → cancelled", async () => {
    const { cfg, createdBy } = await setupVenue();
    const bookedId = await seedBooking(cfg, createdBy, "booked");
    await scoped(cfg, (tx) => cancelBooking(tx, cfg, bookedId));
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, bookedId)))!.status).toBe("cancelled");

    const seatedId = await seedBooking(cfg, createdBy, "seated");
    await scoped(cfg, (tx) => cancelBooking(tx, cfg, seatedId));
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, seatedId)))!.status).toBe("cancelled");
  });

  it("markNoShow: booked → no_show; illegal from another state → booking.invalid_transition", async () => {
    const { cfg, createdBy } = await setupVenue();
    const id = await seedBooking(cfg, createdBy, "booked");
    await scoped(cfg, (tx) => markNoShow(tx, cfg, id));
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, id)))!.status).toBe("no_show");

    const seatedId = await seedBooking(cfg, createdBy, "seated");
    await expect(scoped(cfg, (tx) => markNoShow(tx, cfg, seatedId))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  it("completeBooking: seated → completed; illegal from booked → booking.invalid_transition", async () => {
    const { cfg, createdBy } = await setupVenue();
    const seatedId = await seedBooking(cfg, createdBy, "seated");
    await scoped(cfg, (tx) => completeBooking(tx, cfg, seatedId));
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, seatedId)))!.status).toBe("completed");

    const bookedId = await seedBooking(cfg, createdBy, "booked");
    await expect(scoped(cfg, (tx) => completeBooking(tx, cfg, bookedId))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  it("distinguishes an absent id (booking.not_found) from a wrong-state one (invalid_transition)", async () => {
    const { cfg, createdBy } = await setupVenue();
    await expect(scoped(cfg, (tx) => cancelBooking(tx, cfg, randomUUID()))).rejects.toMatchObject({
      code: "booking.not_found",
    });
    await expect(scoped(cfg, (tx) => markNoShow(tx, cfg, randomUUID()))).rejects.toMatchObject({
      code: "booking.not_found",
    });
    await expect(scoped(cfg, (tx) => completeBooking(tx, cfg, randomUUID()))).rejects.toMatchObject(
      { code: "booking.not_found" },
    );

    const completedId = await seedBooking(cfg, createdBy, "completed");
    await expect(scoped(cfg, (tx) => cancelBooking(tx, cfg, completedId))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });
});

describe("getBooking", () => {
  it("returns undefined for an absent id", async () => {
    const { cfg } = await setupVenue();
    expect(await scoped(cfg, (tx) => getBooking(tx, cfg, randomUUID()))).toBeUndefined();
  });
});

/** Insert an ACTIVE dining table for the venue and return its id (createTable's raw equivalent — the
 * verb lives in apps/server, which a module cannot import). */
async function seedTable(cfg: VenueCfg, label: string): Promise<string> {
  return insertDiningTable(cfg.locationId, label);
}

// `core.seatTable` is `fakeCore` (`./testing/fake-core.ts`): the real verb lives in apps/server. It
// still writes a real working_orders row.
describe("seatBooking", () => {
  async function setupTillVenue(): Promise<{
    cfg: VenueCfg;
    core: CoreServices;
    createdBy: string;
    seatedBy: string;
  }> {
    await seedTenant(db);
    const locationId = await insertLocation("Barra");
    const nodeId = await seedNode(db, brandLocationId(locationId));
    return {
      cfg: { locationId: brandLocationId(locationId) },
      core: fakeCore({ locationId, nodeId }),
      createdBy: randomUUID(),
      seatedBy: randomUUID(),
    };
  }

  it("seats a booking: opens a tab on the assigned table and links it", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "4");
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        tableId,
        createdBy,
      }),
    );
    const { tabId } = await scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, core));
    expect(tabId).toEqual(expect.any(String));
    const b = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(b).toMatchObject({ status: "seated", tabId, tableId });
  });

  it("seats the party for the booking's size, as the person who seated it", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "8");
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 5,
        contactName: "Vidal",
        tableId,
        createdBy,
      }),
    );
    const asked: unknown[] = [];
    const recording: CoreServices = {
      ...core,
      async seatTable(tx, req) {
        asked.push(req);
        return core.seatTable(tx, req);
      },
    };
    await scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, recording));
    expect(asked).toEqual([{ tableId, guestCount: 5, operatorId: seatedBy }]);
  });

  it("uses req.tableId when the booking has no table, and stores it", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "7");
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Ruiz",
        createdBy,
      }),
    );
    const { tabId } = await scoped(cfg, (tx) =>
      seatBooking(tx, cfg, id, { tableId, seatedBy }, core),
    );
    const b = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(b).toMatchObject({ status: "seated", tabId, tableId });
  });

  it("rejects a req.tableId in ANOTHER location of the same tenant with table.not_found", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const otherTableId = await makeTableInOtherLocation();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Ruiz",
        createdBy,
      }),
    );
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, id, { tableId: otherTableId, seatedBy }, core)),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });

  it("requires a table: booking.table_required when neither the booking nor req has one", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Ruiz",
        createdBy,
      }),
    );
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, core)),
    ).rejects.toMatchObject({
      code: "booking.table_required",
    });
  });

  it("refuses a non-booked booking with booking.invalid_transition", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "9");
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Ruiz",
        tableId,
        createdBy,
      }),
    );
    await scoped(cfg, (tx) => cancelBooking(tx, cfg, id));
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, core)),
    ).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  // Refused by the check before `seatTable`. Deleting that check leaves this green: the
  // compare-and-swap then refuses it and the rollback removes the tab.
  it("seating a no-longer-booked booking throws invalid_transition and opens no tab", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "3");
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Núñez",
        tableId,
        createdBy,
      }),
    );
    await scoped(cfg, (tx) => cancelBooking(tx, cfg, id));
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, core)),
    ).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
    const b = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(b).toMatchObject({ status: "cancelled", tabId: null });
    const tabs = await db.execute<{ n: number }>(sql`select count(*) as n from working_orders`);
    expect(tabs.rows[0]!.n).toBe(0);
  });

  // Cancels INSIDE `seatTable`, after the pre-`seatTable` check has passed, so only the final write's
  // compare-and-swap can refuse it. The rollback must take the tab and the cancel with it.
  it("CAS guard: a booking that leaves `booked` during seatTable is refused and the tab rolled back", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "3b");
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Núñez",
        tableId,
        createdBy,
      }),
    );
    const cancellingCore: CoreServices = {
      ...core,
      async seatTable(tx, req) {
        await cancelBooking(tx, cfg, id);
        return core.seatTable(tx, req);
      },
    };
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, cancellingCore)),
    ).rejects.toMatchObject({ code: "booking.invalid_transition" });
    const b = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(b).toMatchObject({ status: "booked", tabId: null, tableId });
    const tabs = await db.execute<{ n: number }>(sql`select count(*) as n from working_orders`);
    expect(tabs.rows[0]!.n).toBe(0);
  });

  it("refuses an absent booking with booking.not_found", async () => {
    const { cfg, core, seatedBy } = await setupTillVenue();
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, randomUUID(), { seatedBy }, core)),
    ).rejects.toMatchObject({
      code: "booking.not_found",
    });
  });

  it("bubbles tab.already_open when the target table already has an open tab", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "5");
    await scoped(cfg, (tx) =>
      core.seatTable(tx, { tableId, guestCount: null, operatorId: seatedBy }),
    );
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "García",
        tableId,
        createdBy,
      }),
    );
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, core)),
    ).rejects.toMatchObject({
      code: "tab.already_open",
    });
  });

  it("seats then completes end-to-end (booked → seated → completed)", async () => {
    const { cfg, core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "6");
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 3,
        contactName: "Díaz",
        tableId,
        createdBy,
      }),
    );
    await scoped(cfg, (tx) => seatBooking(tx, cfg, id, { seatedBy }, core));
    await scoped(cfg, (tx) => completeBooking(tx, cfg, id));
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, id)))!.status).toBe("completed");
  });
});

it("refuses booking a table with no today's row", async () => {
  const { cfg, createdBy } = await setupVenue();
  const tableId = await makeTable(cfg, false);
  await expect(
    scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Guest",
        createdBy,
        tableId,
      }),
    ),
  ).rejects.toMatchObject({ code: "table.not_found", params: { tableId } });
});

describe("a part of a joined table on the saved plan", () => {
  /** Long table (10 seats) made of Counter 3 (2), 4 (6) and 5 (4) on a saved plan, each with a live table on today's plan. */
  async function longTable(
    locationId: string,
  ): Promise<Record<"long" | "c3" | "c4" | "c5", string>> {
    const [zone] = await db
      .insert(floorZones)
      .values({ locationId, name: "Counter" })
      .returning({ id: floorZones.id });
    const [plan] = await db
      .insert(floorPlans)
      .values({ zoneId: zone!.id, savedAt: nowIso() })
      .returning({ id: floorPlans.id });
    const seats = { long: 10, c3: 2, c4: 6, c5: 4 } as const;
    const labels = { long: "Long table", c3: "Counter 3", c4: "Counter 4", c5: "Counter 5" };
    const master = {} as Record<keyof typeof seats, string>;
    const live = {} as Record<keyof typeof seats, string>;
    for (const key of ["long", "c3", "c4", "c5"] as const) {
      const [row] = await db
        .insert(floorPlanTables)
        .values({ planId: plan!.id, label: labels[key], seats: seats[key] })
        .returning({ id: floorPlanTables.id });
      master[key] = row!.id;
      const table = await db.execute<{ id: string }>(sql`
        insert into dining_tables (id, created_at, location_id, zone_id, label, plan_table_id)
        values (${newId()}, ${nowIso()}, ${locationId}, ${zone!.id}, ${labels[key]}, ${row!.id})
        returning id`);
      live[key] = table.rows[0]!.id;
      await db.insert(floorTodayTables).values({ tableId: live[key] });
    }
    await db.insert(floorPlanTableParts).values(
      (["c3", "c4", "c5"] as const).map((key) => ({
        joinedTableId: master.long,
        partTableId: master[key],
      })),
    );
    return live;
  }

  function book(cfg: VenueCfg, createdBy: string, bookingDate: string, tableId: string) {
    return scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate,
        bookingTime: "20:00",
        partySize: 4,
        contactName: "García",
        tableId,
        createdBy,
      }),
    );
  }

  it("refuses a booking at Counter 4, for any date", async () => {
    const { cfg, createdBy } = await setupVenue();
    const table = await longTable(cfg.locationId);
    for (const date of ["2026-08-20", "2027-01-15"]) {
      await expect(book(cfg, createdBy, date, table.c4)).rejects.toMatchObject({
        code: "table.in_joined_table",
        params: { tableId: table.c4, field: "tableId" },
      });
    }
    const count = await db.execute<{ n: number }>(sql`select count(*) as n from bookings`);
    expect(count.rows[0]!.n).toBe(0);
  });

  it("books Long table", async () => {
    const { cfg, createdBy } = await setupVenue();
    const table = await longTable(cfg.locationId);
    const { id } = await book(cfg, createdBy, "2026-08-20", table.long);
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, id)))!.tableId).toBe(table.long);
  });

  it("refuses an edit that moves a booking to Counter 5", async () => {
    const { cfg, createdBy } = await setupVenue();
    const table = await longTable(cfg.locationId);
    const { id } = await book(cfg, createdBy, "2026-08-20", table.long);
    await expect(
      scoped(cfg, (tx) => updateBooking(tx, cfg, id, { tableId: table.c5 })),
    ).rejects.toMatchObject({
      code: "table.in_joined_table",
      params: { tableId: table.c5, field: "tableId" },
    });
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, id)))!.tableId).toBe(table.long);
  });
});
