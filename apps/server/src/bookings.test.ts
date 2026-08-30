import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, bookings, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import {
  cancelBooking,
  completeBooking,
  createBooking,
  getBooking,
  listBookings,
  markNoShow,
  updateBooking,
  type BookingConfig,
} from "./bookings.js";
import "./errors.js";

// PGlite, not real Postgres: these verbs are plain CRUD + a conditional-UPDATE state machine over one
// table — no privilege, RLS-as-app_user or concurrency behaviour that needs a genuine non-superuser
// backend (that is proven against real Postgres in the *.rls.test.ts). Every read/write still runs
// through `withTenant` + `asAppUser`, so the tenant scope and the `party_size > 0` CHECK are exercised
// exactly as production does, not bypassed. `TESTCONTAINERS_RYUK_DISABLED` is irrelevant here — no
// container is started.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let db: Database;

beforeAll(() => {
  db = suite.db;
});

interface Venue {
  cfg: BookingConfig;
  /** A fixture person id for `created_by` (no FK — the drawer_opens.person_id seam). */
  createdBy: string;
}

/** Stand up a fresh tenant + location and a `BookingConfig` scoped to them. Each test gets its own. */
async function setupVenue(): Promise<Venue> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  return {
    cfg: { tenantId: brandTenantId(tenantId), locationId: brandLocationId(locationId) },
    createdBy: randomUUID(),
  };
}

/** Insert an ACTIVE dining table for the venue and return its id (for the optional table-link path). */
async function makeTable(cfg: BookingConfig, active = true): Promise<string> {
  const row = await db.execute<{ id: string }>(sql`
    insert into dining_tables (tenant_id, location_id, label, active)
    values (${cfg.tenantId}, ${cfg.locationId}, '12', ${active}) returning id`);
  return row.rows[0]!.id;
}

/** Run `fn` inside the venue's tenant scope as `app_user`, exactly as production routes do. */
function scoped<T>(cfg: BookingConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Insert a booking directly at an arbitrary status (to reach `seated`, which only Task 4's seat sets). */
async function seedBooking(
  cfg: BookingConfig,
  createdBy: string,
  status: "booked" | "seated" | "completed" | "no_show" | "cancelled",
): Promise<string> {
  return scoped(cfg, async (tx) => {
    const [row] = await tx
      .insert(bookings)
      .values({
        tenantId: cfg.tenantId,
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

    // Postgres `time` round-trips as HH:MM:SS, so the stored values are "13:30:00"/"20:00:00"; the
    // point of the assertion is the booking_time ORDERING (13:30 before 20:00), not the seconds.
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
