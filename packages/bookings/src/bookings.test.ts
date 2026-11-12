import { randomUUID } from "node:crypto";
import { inArray, sql, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  floorPlanSets,
  floorPlanTables,
  floorPlans,
  newId,
  nowIso,
  venueLocationId,
  withTransaction,
  diningTables,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { CoreServices } from "@waitron/module";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { bookings } from "./schema/bookings.js";
import { BOOKINGS_TEST_MIGRATIONS } from "./testing/migrations.js";
import { fakeCore } from "./testing/fake-core.js";
import {
  cancelBooking,
  completeBooking,
  createBooking,
  bookingsOnDay,
  getBooking,
  listBookings,
  markNoShow,
  seatBooking,
  updateBooking,
} from "./bookings.js";
import "./errors.js";

interface VenueCfg {
  locationId: string;
}

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

/** Raw inserts supply the id and timestamp; the helper optionally gives the table a today row. */
async function insertDiningTable(label: string, active = true): Promise<string> {
  const zone = await seedZone(db, { name: label });
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (id, created_at, zone_id, label)
    values (${newId()}, ${nowIso()}, ${zone!.id}, ${label})
    returning id`);
  if (active)
    await db
      .update(diningTables)
      .set({ onFloor: true })
      .where(eq(diningTables.id, row.rows[0]!.id));
  return row.rows[0]!.id;
}

async function setupVenue(): Promise<Venue> {
  await seedVenue(db, {
    name: "Front counter",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurant service",
  });
  const locationId = await venueLocationId(db);
  return {
    cfg: { locationId: locationId },
    createdBy: randomUUID(),
  };
}

async function makeTable(active = true): Promise<string> {
  return insertDiningTable("12", active);
}

function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Insert a booking directly at an arbitrary status, bypassing the lifecycle verbs. */
async function seedBooking(
  createdBy: string,
  status: "booked" | "seated" | "completed" | "no_show" | "cancelled",
): Promise<string> {
  return scoped(async (tx) => {
    const [row] = await tx
      .insert(bookings)
      .values({
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
    const { createdBy } = await setupVenue();

    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        createdBy,
      }),
    );
    await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "13:30",
        partySize: 2,
        contactName: "Brown",
        createdBy,
      }),
    );

    // The seconds come from `storedTime` (`./bookings.ts`): the column is plain text.
    const listed = await scoped((tx) => listBookings(tx, { date: "2026-08-20" }));
    expect(listed.map((b) => b.bookingTime)).toEqual(["13:30:00", "20:00:00"]);

    await expect(
      scoped((tx) =>
        createBooking(tx, {
          bookingDate: "2026-08-20",
          bookingTime: "20:00",
          partySize: 0,
          contactName: "X",
          createdBy,
        }),
      ),
    ).rejects.toMatchObject({ code: "booking.invalid" });

    await scoped((tx) => cancelBooking(tx, id));
    await expect(scoped((tx) => completeBooking(tx, id))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  it("filters listBookings to the requested date only", async () => {
    const { createdBy } = await setupVenue();
    await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Today",
        createdBy,
      }),
    );
    await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-21",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Tomorrow",
        createdBy,
      }),
    );
    const listed = await scoped((tx) => listBookings(tx, { date: "2026-08-20" }));
    expect(listed).toHaveLength(1);
    expect(listed[0]!.contactName).toBe("Today");
  });

  it("stores the optional fields and status='booked'", async () => {
    const { createdBy } = await setupVenue();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        contactPhone: "600123456",
        notes: "Window seat",
        createdBy,
      }),
    );
    const row = await scoped((tx) => getBooking(tx, id));
    expect(row).toMatchObject({
      status: "booked",
      contactPhone: "600123456",
      notes: "Window seat",
      tabId: null,
      tableId: null,
    });
  });

  // The OTHER side of `storedTime`: `routes.ts`'s `TIME_HHMM` accepts `HH:MM:SS` as well as `HH:MM`,
  // so a caller can hand the write path a time already in the stored form, and both spellings of one
  // wall-clock time must land on one stored value.
  it("stores an already-HH:MM:SS time unchanged, so one wall-clock time has one stored value", async () => {
    const { createdBy } = await setupVenue();
    for (const [time, name] of [
      ["18:15:00", "Sent with seconds"],
      ["18:15", "Sent without"],
    ] as const) {
      await scoped((tx) =>
        createBooking(tx, {
          bookingDate: "2026-08-21",
          bookingTime: time,
          partySize: 2,
          contactName: name,
          createdBy,
        }),
      );
    }
    const listed = await scoped((tx) => listBookings(tx, { date: "2026-08-21" }));
    expect(listed.map((b) => b.bookingTime)).toEqual(["18:15:00", "18:15:00"]);
  });

  it("plans the day list on the date index, not a scan", async () => {
    await setupVenue();
    const plan = await withTransaction(db, async (tx) => {
      const emitted = bookingsOnDay(tx, "2026-08-21").toSQL();
      const parts = emitted.sql.split("?");
      const statement = sql.raw(`explain query plan ${parts[0]}`);
      emitted.params.forEach((param, i) => {
        statement.append(sql`${param}`);
        statement.append(sql.raw(parts[i + 1]!));
      });
      return tx.execute<{ detail: string }>(statement);
    });
    const details = plan.rows.map((row) => row.detail);
    expect(details.some((d) => d.includes("USING INDEX bookings_date_idx"))).toBe(true);
    expect(details.some((d) => d.includes("SCAN bookings"))).toBe(false);
  });
});

describe("createBooking — optional table link", () => {
  it("accepts an ACTIVE table id", async () => {
    const { createdBy } = await setupVenue();
    const tableId = await makeTable();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Taylor",
        tableId,
        createdBy,
      }),
    );
    const row = await scoped((tx) => getBooking(tx, id));
    expect(row!.tableId).toBe(tableId);
  });

  it("rejects an absent table with table.not_found", async () => {
    const { createdBy } = await setupVenue();
    await expect(
      scoped((tx) =>
        createBooking(tx, {
          bookingDate: "2026-08-20",
          bookingTime: "20:00",
          partySize: 2,
          contactName: "Taylor",
          tableId: randomUUID(),
          createdBy,
        }),
      ),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });

  it("rejects an INACTIVE table with table.not_found", async () => {
    const { createdBy } = await setupVenue();
    const tableId = await makeTable(false);
    await expect(
      scoped((tx) =>
        createBooking(tx, {
          bookingDate: "2026-08-20",
          bookingTime: "20:00",
          partySize: 2,
          contactName: "Taylor",
          tableId,
          createdBy,
        }),
      ),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });
});

describe("updateBooking", () => {
  it("edits fields while booked", async () => {
    const { createdBy } = await setupVenue();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        createdBy,
      }),
    );
    await scoped((tx) =>
      updateBooking(tx, id, { partySize: 6, contactName: "Taylor (6)", notes: "large" }),
    );
    const row = await scoped((tx) => getBooking(tx, id));
    expect(row).toMatchObject({ partySize: 6, contactName: "Taylor (6)", notes: "large" });
  });

  it("rejects an absent id with booking.not_found", async () => {
    await setupVenue();
    await expect(
      scoped((tx) => updateBooking(tx, randomUUID(), { partySize: 3 })),
    ).rejects.toMatchObject({ code: "booking.not_found" });
  });

  it.each(["seated", "completed", "no_show", "cancelled"] as const)(
    "rejects an edit of a %s booking with booking.invalid_transition",
    async (status) => {
      const { createdBy } = await setupVenue();
      const id = await seedBooking(createdBy, status);
      const before = await scoped((tx) => getBooking(tx, id));
      await expect(scoped((tx) => updateBooking(tx, id, { partySize: 3 }))).rejects.toMatchObject({
        code: "booking.invalid_transition",
        params: { bookingId: id },
      });
      expect(await scoped((tx) => getBooking(tx, id))).toEqual(before);
    },
  );

  it("rejects a non-positive party size with booking.invalid", async () => {
    const { createdBy } = await setupVenue();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        createdBy,
      }),
    );
    await expect(scoped((tx) => updateBooking(tx, id, { partySize: 0 }))).rejects.toMatchObject({
      code: "booking.invalid",
    });
  });

  it("assigns an ACTIVE table on edit", async () => {
    const { createdBy } = await setupVenue();
    const tableId = await makeTable();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        createdBy,
      }),
    );
    await scoped((tx) => updateBooking(tx, id, { tableId }));
    expect((await scoped((tx) => getBooking(tx, id)))!.tableId).toBe(tableId);
  });

  it("rejects an edit that assigns an absent table with table.not_found", async () => {
    const { createdBy } = await setupVenue();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        createdBy,
      }),
    );
    await expect(
      scoped((tx) => updateBooking(tx, id, { tableId: randomUUID() })),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });
});

describe("lifecycle verbs", () => {
  it("cancelBooking: booked → cancelled, and seated → cancelled", async () => {
    const { createdBy } = await setupVenue();
    const bookedId = await seedBooking(createdBy, "booked");
    await scoped((tx) => cancelBooking(tx, bookedId));
    expect((await scoped((tx) => getBooking(tx, bookedId)))!.status).toBe("cancelled");

    const seatedId = await seedBooking(createdBy, "seated");
    await scoped((tx) => cancelBooking(tx, seatedId));
    expect((await scoped((tx) => getBooking(tx, seatedId)))!.status).toBe("cancelled");
  });

  it("markNoShow: booked → no_show; illegal from another state → booking.invalid_transition", async () => {
    const { createdBy } = await setupVenue();
    const id = await seedBooking(createdBy, "booked");
    await scoped((tx) => markNoShow(tx, id));
    expect((await scoped((tx) => getBooking(tx, id)))!.status).toBe("no_show");

    const seatedId = await seedBooking(createdBy, "seated");
    await expect(scoped((tx) => markNoShow(tx, seatedId))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  it("completeBooking: seated → completed; illegal from booked → booking.invalid_transition", async () => {
    const { createdBy } = await setupVenue();
    const seatedId = await seedBooking(createdBy, "seated");
    await scoped((tx) => completeBooking(tx, seatedId));
    expect((await scoped((tx) => getBooking(tx, seatedId)))!.status).toBe("completed");

    const bookedId = await seedBooking(createdBy, "booked");
    await expect(scoped((tx) => completeBooking(tx, bookedId))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  it("distinguishes an absent id (booking.not_found) from a wrong-state one (invalid_transition)", async () => {
    const { createdBy } = await setupVenue();
    await expect(scoped((tx) => cancelBooking(tx, randomUUID()))).rejects.toMatchObject({
      code: "booking.not_found",
    });
    await expect(scoped((tx) => markNoShow(tx, randomUUID()))).rejects.toMatchObject({
      code: "booking.not_found",
    });
    await expect(scoped((tx) => completeBooking(tx, randomUUID()))).rejects.toMatchObject({
      code: "booking.not_found",
    });

    const completedId = await seedBooking(createdBy, "completed");
    await expect(scoped((tx) => cancelBooking(tx, completedId))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });
});

describe("getBooking", () => {
  it("returns undefined for an absent id", async () => {
    await setupVenue();
    expect(await scoped((tx) => getBooking(tx, randomUUID()))).toBeUndefined();
  });
});

/** Insert an ACTIVE dining table for the venue and return its id (createTable's raw equivalent — the
 * verb lives in apps/server, which a module cannot import). */
async function seedTable(label: string): Promise<string> {
  return insertDiningTable(label);
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
    await seedVenue(db, {
      name: "Front counter",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant service",
    });
    const locationId = await venueLocationId(db);
    const nodeId = await seedNode(db);
    return {
      cfg: { locationId: locationId },
      core: fakeCore({ locationId, nodeId }),
      createdBy: randomUUID(),
      seatedBy: randomUUID(),
    };
  }

  it("seats a booking: opens a tab on the assigned table and links it", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("4");
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        tableId,
        createdBy,
      }),
    );
    const { tabId } = await scoped((tx) => seatBooking(tx, id, { seatedBy }, core));
    expect(tabId).toEqual(expect.any(String));
    const b = await scoped((tx) => getBooking(tx, id));
    expect(b).toMatchObject({ status: "seated", tabId, tableId });
  });

  it("seats the party for the booking's size, as the person who seated it", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("8");
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 5,
        contactName: "Reed",
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
    await scoped((tx) => seatBooking(tx, id, { seatedBy }, recording));
    expect(asked).toEqual([{ tableId, guestCount: 5, operatorId: seatedBy }]);
  });

  it("uses req.tableId when the booking has no table, and stores it", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("7");
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Brown",
        createdBy,
      }),
    );
    const { tabId } = await scoped((tx) => seatBooking(tx, id, { tableId, seatedBy }, core));
    const b = await scoped((tx) => getBooking(tx, id));
    expect(b).toMatchObject({ status: "seated", tabId, tableId });
  });

  it("refuses a req.tableId that names no table with table.not_found and leaves the booking booked", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Brown",
        createdBy,
      }),
    );
    const tableId = randomUUID();
    await expect(
      scoped((tx) => seatBooking(tx, id, { tableId, seatedBy }, core)),
    ).rejects.toMatchObject({ code: "table.not_found", params: { tableId } });
    const b = await scoped((tx) => getBooking(tx, id));
    expect(b).toMatchObject({ status: "booked", tableId: null, tabId: null });
  });

  it("requires a table: booking.table_required when neither the booking nor req has one", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Brown",
        createdBy,
      }),
    );
    await expect(scoped((tx) => seatBooking(tx, id, { seatedBy }, core))).rejects.toMatchObject({
      code: "booking.table_required",
    });
  });

  it("refuses a non-booked booking with booking.invalid_transition", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("9");
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Brown",
        tableId,
        createdBy,
      }),
    );
    await scoped((tx) => cancelBooking(tx, id));
    await expect(scoped((tx) => seatBooking(tx, id, { seatedBy }, core))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  // Refused by the check before `seatTable`. Deleting that check leaves this green: the
  // compare-and-swap then refuses it and the rollback removes the tab.
  it("seating a no-longer-booked booking throws invalid_transition and opens no tab", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("3");
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Morgan",
        tableId,
        createdBy,
      }),
    );
    await scoped((tx) => cancelBooking(tx, id));
    await expect(scoped((tx) => seatBooking(tx, id, { seatedBy }, core))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
    const b = await scoped((tx) => getBooking(tx, id));
    expect(b).toMatchObject({ status: "cancelled", tabId: null });
    const tabs = await db.execute<{ n: number }>(sql`select count(*) as n from working_orders`);
    expect(tabs.rows[0]!.n).toBe(0);
  });

  // Cancels INSIDE `seatTable`, after the pre-`seatTable` check has passed, so only the final write's
  // compare-and-swap can refuse it. The rollback must take the tab and the cancel with it.
  it("CAS guard: a booking that leaves `booked` during seatTable is refused and the tab rolled back", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("3b");
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Morgan",
        tableId,
        createdBy,
      }),
    );
    const cancellingCore: CoreServices = {
      ...core,
      async seatTable(tx, req) {
        await cancelBooking(tx, id);
        return core.seatTable(tx, req);
      },
    };
    await expect(
      scoped((tx) => seatBooking(tx, id, { seatedBy }, cancellingCore)),
    ).rejects.toMatchObject({ code: "booking.invalid_transition" });
    const b = await scoped((tx) => getBooking(tx, id));
    expect(b).toMatchObject({ status: "booked", tabId: null, tableId });
    const tabs = await db.execute<{ n: number }>(sql`select count(*) as n from working_orders`);
    expect(tabs.rows[0]!.n).toBe(0);
  });

  it("refuses an absent booking with booking.not_found", async () => {
    const { core, seatedBy } = await setupTillVenue();
    await expect(
      scoped((tx) => seatBooking(tx, randomUUID(), { seatedBy }, core)),
    ).rejects.toMatchObject({
      code: "booking.not_found",
    });
  });

  it("bubbles tab.already_open when the target table already has an open tab", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("5");
    await scoped((tx) => core.seatTable(tx, { tableId, guestCount: null, operatorId: seatedBy }));
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Taylor",
        tableId,
        createdBy,
      }),
    );
    await expect(scoped((tx) => seatBooking(tx, id, { seatedBy }, core))).rejects.toMatchObject({
      code: "tab.already_open",
    });
  });

  it("seats then completes end-to-end (booked → seated → completed)", async () => {
    const { core, createdBy, seatedBy } = await setupTillVenue();
    const tableId = await seedTable("6");
    const { id } = await scoped((tx) =>
      createBooking(tx, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 3,
        contactName: "Clark",
        tableId,
        createdBy,
      }),
    );
    await scoped((tx) => seatBooking(tx, id, { seatedBy }, core));
    await scoped((tx) => completeBooking(tx, id));
    expect((await scoped((tx) => getBooking(tx, id)))!.status).toBe("completed");
  });
});

it("refuses booking a table with no today's row", async () => {
  const { createdBy } = await setupVenue();
  const tableId = await makeTable(false);
  await expect(
    scoped((tx) =>
      createBooking(tx, {
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

describe("a part of a joined table on a layout", () => {
  /** Long table (10 seats) made of Counter 3 (2), 4 (6) and 5 (4) on a layout, each with a live table on today's plan. */
  async function longTable(): Promise<Record<"long" | "c3" | "c4" | "c5", string>> {
    const zone = await seedZone(db, { name: "Counter" });
    const [set] = await db
      .insert(floorPlanSets)
      .values({ departmentId: zone.departmentId, name: "Standard", isDefault: true })
      .returning({ id: floorPlanSets.id });
    await db.insert(floorPlans).values({ zoneId: zone!.id, setId: set!.id, savedAt: nowIso() });
    const seats = { long: 10, c3: 2, c4: 6, c5: 4 } as const;
    const labels = { long: "Long table", c3: "Counter 3", c4: "Counter 4", c5: "Counter 5" };
    const master = {} as Record<keyof typeof seats, string>;
    const live = {} as Record<keyof typeof seats, string>;
    for (const key of ["long", "c3", "c4", "c5"] as const) {
      const [row] = await db
        .insert(floorPlanTables)
        .values({ zoneId: zone!.id, label: labels[key], seats: seats[key] })
        .returning({ id: floorPlanTables.id });
      master[key] = row!.id;
      const table = await db.execute<{ id: string }>(sql`
        insert into dining_tables (id, created_at, zone_id, label, plan_table_id)
        values (${newId()}, ${nowIso()}, ${zone!.id}, ${labels[key]}, ${row!.id})
        returning id`);
      live[key] = table.rows[0]!.id;
      await db.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, live[key]));
    }
    await db
      .update(floorPlanTables)
      .set({ partOfTableId: master.long })
      .where(inArray(floorPlanTables.id, [master.c3, master.c4, master.c5]));
    return live;
  }

  function book(createdBy: string, bookingDate: string, tableId: string) {
    return scoped((tx) =>
      createBooking(tx, {
        bookingDate,
        bookingTime: "20:00",
        partySize: 4,
        contactName: "Taylor",
        tableId,
        createdBy,
      }),
    );
  }

  it("books a saved group's member for today or a future date", async () => {
    const { createdBy } = await setupVenue();
    const table = await longTable();
    for (const date of ["2026-08-20", "2027-01-15"]) {
      const { id } = await book(createdBy, date, table.c4);
      expect((await scoped((tx) => getBooking(tx, id)))!).toMatchObject({
        tableId: table.c4,
        bookingDate: date,
      });
    }
    const count = await db.execute<{ n: number }>(sql`select count(*) as n from bookings`);
    expect(count.rows[0]!.n).toBe(2);
  });

  it("moves a booking between saved members and changes its date", async () => {
    const { createdBy } = await setupVenue();
    const table = await longTable();
    const { id } = await book(createdBy, "2026-08-20", table.c3);
    await scoped((tx) => updateBooking(tx, id, { tableId: table.c5 }));
    expect((await scoped((tx) => getBooking(tx, id)))!.tableId).toBe(table.c5);
    await scoped((tx) => updateBooking(tx, id, { bookingDate: "2027-01-15" }));
    expect((await scoped((tx) => getBooking(tx, id)))!).toMatchObject({
      bookingDate: "2027-01-15",
      tableId: table.c5,
    });
  });
});
