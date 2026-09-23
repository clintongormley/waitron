import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { newId, nowIso, withTransaction } from "@waitron/db";
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

/** A venue's booking config plus its tenant, which the core parent rows (locations, dining_tables,
 * tills, working_orders) still carry. */
type VenueCfg = BookingConfig;

// A real migrated SQLite venue database, which is the only target there is now. These verbs are
// plain CRUD plus a conditional-UPDATE state machine over one table, and every read and write below
// runs through `withTransaction`, the shape production uses, so the `party_size > 0` CHECK is
// exercised rather than bypassed.
//
// WHAT IT DOES NOT SHOW, in two parts. There are no roles and no grants on this engine, so nothing
// here is a claim about a privilege. And the CAS race is not proven anywhere: the two-backend case `bookings-cas.test.ts` used to stage was
// DELETED rather than moved, because one write transaction runs on the venue file at a time — that
// file's header carries the reasoning and the pointer to recover the deleted case.
//
// Fixtures apply the whole manifest (BOOKINGS_TEST_MIGRATIONS): bookings FKs into core, so it lands
// on top of the shared ordered set.
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

/**
 * Inserts one location and returns its id.
 *
 * Two things this raw statement supplies that the PostgreSQL one did not.
 *
 * `id` comes from a JavaScript `$defaultFn` generator now (`newId`,
 * `packages/db/src/schema/columns.ts:270`) and the generated DDL declares no SQL DEFAULT for it, so
 * a raw insert that omits it is refused `NOT NULL constraint failed: locations.id` — the same
 * reason `packages/workforce/src/migrations.test.ts:43-50` supplies its own.
 *
 * `invoice_locales` is one TEXT column holding a JSON array (`labelList`,
 * `packages/db/src/schema/columns.ts:255`) where it used to be `text[]`. The `array['es-ES']`
 * literal this replaces was refused at PREPARE, so every case in the file died in setup: running
 * this suite before the change printed `Error: near "['es-ES']": syntax error` from
 * `packages/store/src/node-sqlite-adapter.ts:64`. The JSON text `'["es-ES"]'` is what the column's
 * own CHECK counts with `json_array_length` (`packages/db/src/schema/tenants.ts:197`).
 */
async function insertLocation(name: string): Promise<string> {
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (id, name, invoice_locales, operation_description)
    values (${newId()}, ${name}, '["es-ES"]', 'Venta en establecimiento')
    returning id`);
  return loc.rows[0]!.id;
}

/**
 * Inserts one dining table and returns its id.
 *
 * `id` and `created_at` are `$defaultFn` generators here too (`newId` / `nowIso`), so both are
 * supplied — see {@link insertLocation}. `active` is passed as 1 or 0 rather than a JavaScript
 * boolean: `flag` is an INTEGER column now and `node:sqlite` refuses to bind a boolean at all.
 * Measured on node v26.7.0 — `db.prepare("insert into t (id, active) values (?, ?)").run("a", true)`
 * against a `create table t (id text primary key, active integer not null)` throws
 * `TypeError: Provided value cannot be bound to SQLite parameter 2`. What says 1 MEANS true is the
 * `flag` column's read mapping, which every assertion below reads the row back through.
 */
async function insertDiningTable(
  locationId: string,
  label: string,
  active = true,
): Promise<string> {
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (id, created_at, location_id, label, active)
    values (${newId()}, ${nowIso()}, ${locationId}, ${label}, ${active ? 1 : 0})
    returning id`);
  return row.rows[0]!.id;
}

/** Stand up a fresh tenant + location and a `BookingConfig` scoped to them. Each test gets its own. */
async function setupVenue(): Promise<Venue> {
  await seedTenant(db);
  const locationId = await insertLocation("Barra");
  return {
    cfg: { locationId: brandLocationId(locationId) },
    createdBy: randomUUID(),
  };
}

/** Insert an ACTIVE dining table for the venue and return its id (for the optional table-link path). */
async function makeTable(cfg: VenueCfg, active = true): Promise<string> {
  return insertDiningTable(cfg.locationId, "12", active);
}

/**
 * Insert an ACTIVE dining table in a SECOND location, and return its id. This
 * cross-LOCATION table exists in the same
 * database — the exact shape the location-scope guard must refuse (a booking in location A must
 * not be assigned a table in location B).
 */
async function makeTableInOtherLocation(): Promise<string> {
  const otherLocationId = await insertLocation("Terraza");
  return insertDiningTable(otherLocationId, "B-1");
}

/** Run `fn` in one transaction, the shape production routes use. */
function scoped<T>(cfg: VenueCfg, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(db, async (tx) => {
    return fn(tx);
  });
}

/** Insert a booking directly at an arbitrary status (to reach `seated`, which only Task 4's seat sets). */
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

    // Two things at once: the booking_time ORDERING (13:30 before 20:00), and the seconds. The
    // seconds used to be PostgreSQL's — a `time` column normalised `20:00` on the way in — and are
    // now `storedTime`'s, in `./bookings.ts`, since `timeOfDay` is plain `text` here and normalises
    // nothing. Deleting that call reddens this line and `./routes.test.ts`'s happy path.
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

  it("rejects an edit of a non-booked booking with booking.not_found", async () => {
    const { cfg, createdBy } = await setupVenue();
    const id = await seedBooking(cfg, createdBy, "cancelled");
    await expect(
      scoped(cfg, (tx) => updateBooking(tx, cfg, id, { partySize: 3 })),
    ).rejects.toMatchObject({ code: "booking.not_found" });
  });

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
    // Task 4 owns seat (booked→seated via a tab); here the seated row is inserted directly as a fixture
    // so this task can prove the seated→completed leg without depending on the unbuilt seat verb.
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

// `seatBooking` opens a real TS-1 tab through `core.openTab` — the boundary the module reaches core's
// tab verb across. In production boot binds the venue's full `TillConfig` into `core`; here `fakeCore`
// stands in (testing/fake-core.ts), reproducing `openTab`'s observable behaviour (FOR UPDATE lock,
// table/tab guards, the working_orders insert + back-pointer) so the assertions below are unchanged.
// The seat cfg is a plain `BookingConfig`; the till + node the tab row needs are captured by `fakeCore`.
describe("seatBooking", () => {
  async function setupTillVenue(): Promise<{
    cfg: VenueCfg;
    core: CoreServices;
    createdBy: string;
  }> {
    await seedTenant(db);
    const locationId = await insertLocation("Barra");
    // `tills.id` and `tills.created_at` are `$defaultFn` generators too — see `insertLocation`.
    // `created_at` here is a `ts` column (read back as a Date), which stores the same ISO string
    // `nowIso` produces (`packages/db/src/schema/columns.ts:263-272`).
    const till = await db.execute<{ id: string }>(sql`
      insert into tills (id, created_at, location_id, name)
      values (${newId()}, ${nowIso()}, ${locationId}, 'Caja 1')
      returning id`);
    const nodeId = await seedNode(db, brandLocationId(locationId));
    return {
      cfg: { locationId: brandLocationId(locationId) },
      core: fakeCore({ tillId: till.rows[0]!.id, nodeId }),
      createdBy: randomUUID(),
    };
  }

  it("seats a booking: opens a tab on the assigned table and links it", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
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
    const { tabId } = await scoped(cfg, (tx) => seatBooking(tx, cfg, id, {}, core));
    expect(tabId).toEqual(expect.any(String));
    const b = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(b).toMatchObject({ status: "seated", tabId, tableId });
  });

  it("uses req.tableId when the booking has no table, and stores it", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
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
    const { tabId } = await scoped(cfg, (tx) => seatBooking(tx, cfg, id, { tableId }, core));
    const b = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(b).toMatchObject({ status: "seated", tabId, tableId });
  });

  it("rejects a req.tableId in ANOTHER location of the same tenant with table.not_found", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
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
      scoped(cfg, (tx) => seatBooking(tx, cfg, id, { tableId: otherTableId }, core)),
    ).rejects.toMatchObject({ code: "table.not_found" });
  });

  it("requires a table: booking.table_required when neither the booking nor req has one", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
    const { id } = await scoped(cfg, (tx) =>
      createBooking(tx, cfg, {
        bookingDate: "2026-08-20",
        bookingTime: "20:00",
        partySize: 2,
        contactName: "Ruiz",
        createdBy,
      }),
    );
    await expect(scoped(cfg, (tx) => seatBooking(tx, cfg, id, {}, core))).rejects.toMatchObject({
      code: "booking.table_required",
    });
  });

  it("refuses a non-booked booking with booking.invalid_transition", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
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
    await expect(scoped(cfg, (tx) => seatBooking(tx, cfg, id, {}, core))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
  });

  // The terminal write is a compare-and-swap on the `booked` predecessor (matching `advanceStatus`),
  // not a bare id write — the concurrency backstop for the window between the lock-free `getBooking`
  // read and the write. No test stages that window as a real race: one write transaction runs on the
  // venue file at a time, so a cancel cannot land between the read and the write (the reasoning is in
  // `bookings-cas.test.ts`'s header). This pins the guard directly instead, the way `advanceStatus`'s
  // tests do: a booking that is no longer `booked` is refused
  // with `booking.invalid_transition`, stays `cancelled`, and leaves NO open tab behind. (Removing the
  // pre-`openTab` `booked` check leaves this green: the CAS then opens a tab, matches nothing on the
  // predecessor, throws, and the tx rollback undoes the tab — proven by deletion, 2026-08-30.)
  it("CAS guard: seating a no-longer-booked booking throws invalid_transition and opens no tab", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
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
    await expect(scoped(cfg, (tx) => seatBooking(tx, cfg, id, {}, core))).rejects.toMatchObject({
      code: "booking.invalid_transition",
    });
    const b = await scoped(cfg, (tx) => getBooking(tx, cfg, id));
    expect(b).toMatchObject({ status: "cancelled", tabId: null });
    // No `::int`: the cast only flattened PostgreSQL's bigint `count` to something the driver
    // handed back as a number, and this engine returns a plain JavaScript number already —
    // measured on node v26.7.0, `select count(*) as n` over a one-row table gives `{ n: 1 }` with
    // `typeof n === "number"`.
    const tabs = await db.execute<{ n: number }>(sql`select count(*) as n from working_orders`);
    expect(tabs.rows[0]!.n).toBe(0);
  });

  it("refuses an absent booking with booking.not_found", async () => {
    const { cfg, core } = await setupTillVenue();
    await expect(
      scoped(cfg, (tx) => seatBooking(tx, cfg, randomUUID(), {}, core)),
    ).rejects.toMatchObject({
      code: "booking.not_found",
    });
  });

  it("bubbles tab.already_open when the target table already has an open tab", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
    const tableId = await seedTable(cfg, "5");
    // Open a tab directly on the table first, then a booking that would seat onto the same table.
    await scoped(cfg, (tx) => core.openTab(tx, { tableId }));
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
    await expect(scoped(cfg, (tx) => seatBooking(tx, cfg, id, {}, core))).rejects.toMatchObject({
      code: "tab.already_open",
    });
  });

  it("seats then completes end-to-end (booked → seated → completed)", async () => {
    const { cfg, core, createdBy } = await setupTillVenue();
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
    await scoped(cfg, (tx) => seatBooking(tx, cfg, id, {}, core));
    await scoped(cfg, (tx) => completeBooking(tx, cfg, id));
    expect((await scoped(cfg, (tx) => getBooking(tx, cfg, id)))!.status).toBe("completed");
  });
});
