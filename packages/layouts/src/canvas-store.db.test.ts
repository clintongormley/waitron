import { CORE_MIGRATIONS, captureError, deviceProfiles, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CANVASES } from "./default-canvases.js";
import type { CanvasDef } from "./canvas.js";
import {
  createCanvas,
  deleteCanvas,
  getCanvas,
  getCanvasForFormFactor,
  listCanvases,
  updateCanvas,
} from "./canvas-store.js";

// One real migrated SQLite database, carrying the core and identity sets in that order: the core
// set creates `canvases`, and the identity set creates the `persons`/`management_sessions` tables
// `authorizeManager` reads. Every store call below runs inside `withTransaction`, the shape the
// management routes use.
//
// What it does NOT show: no assertion here is about who may write `canvases`. This engine has no
// roles and no grants — one process opens one file — so there is no such property left for a suite
// to assert, and the store's own gates are the only refusal. Every assertion below is the store's
// behaviour, which the engine does not touch.

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

/** Run `fn` in one transaction — the shape the management routes wrap every store call in. */
function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Seed a person of `role` and an open management session for them. Returns the session id the
 * store's authorizeManager gate resolves. Through drizzle rather than raw SQL: `persons.id` and
 * `created_at` take their value from the table's `$defaultFn`, which is not a SQL DEFAULT, so a raw
 * insert naming neither is refused `NOT NULL constraint failed: persons.id`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.id;
}

/** The AppError code a rejected store call threw, or a describing string when it was not an AppError
 * (so a call that DID NOT throw — e.g. an authorizeManager gate deleted — reports plainly). */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

/** Rows counted outside the store's own reads, so a refused or rolled-back write is visible here
 * as an absence. No `::int` cast: SQLite's `count(*)` already arrives as a number. */
async function rowCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(sql`select count(*) as n from canvases`);
  return rows.rows[0]!.n;
}

/** A valid phone canvas with a distinguishing title, so a stored row is never mistaken for a default. */
function phoneCanvas(title: string): CanvasDef {
  const base = DEFAULT_CANVASES["phone-portrait"];
  return { ...base, tabs: [{ ...base.tabs[0]!, title }, ...base.tabs.slice(1)] };
}

describe("layout canvas store against a real migrated database", () => {
  let managerSession: string;

  beforeAll(async () => {
    await seedTenant(suite.db);
    managerSession = await seedSession("manager");
  });

  it("round-trips a manager-authored canvas through create → get", async () => {
    const definition = phoneCanvas("Floor A");
    const { id } = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: managerSession,
        name: "Front counter",
        definition,
      }),
    );
    const row = await inTx((tx) => getCanvas(tx, id));
    expect(row).toEqual({ id, name: "Front counter", definition });
  });

  it("lists a tenant's canvases", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const first = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "P1",
        definition: phoneCanvas("One"),
      }),
    );
    const second = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "P2",
        definition: phoneCanvas("Two"),
      }),
    );
    const listed = await inTx((tx) => listCanvases(tx));
    expect(listed.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    expect(listed.map((p) => p.name).sort()).toEqual(["P1", "P2"]);
  });

  it("returns undefined for an unknown canvas id", async () => {
    const missing = await inTx((tx) => getCanvas(tx, "00000000-0000-4000-8000-000000000000"));
    expect(missing).toBeUndefined();
  });

  it("updates a canvas's name and definition in place", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const { id } = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "Original",
        definition: phoneCanvas("Before"),
      }),
    );
    const nextDef = phoneCanvas("After");
    await inTx((tx) =>
      updateCanvas(tx, {
        managementSessionId: session,
        id,
        name: "Renamed",
        definition: nextDef,
      }),
    );
    const row = await inTx((tx) => getCanvas(tx, id));
    expect(row).toEqual({ id, name: "Renamed", definition: nextDef });
    expect(await rowCount()).toBe(1); // update, never insert a duplicate
  });

  it("deletes a canvas", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const { id } = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "Doomed",
        definition: phoneCanvas("Gone"),
      }),
    );
    await inTx((tx) => deleteCanvas(tx, { managementSessionId: session, id }));
    expect(await inTx((tx) => getCanvas(tx, id))).toBeUndefined();
    expect(await rowCount()).toBe(0);
  });

  it("translates a delete of a profile-referenced canvas to canvas.in_use (23001 → 409), canvas survives", async () => {
    // A device profile's FK device_profiles_canvas_fk → canvases(id) is ON DELETE RESTRICT, so
    // deleting a canvas a profile still references trips a restrict refusal (errcode 1811), which
    // deleteCanvas translates (via translateWriteError) into the domain canvas.in_use — a clean
    // 409, not the raw DB error a 500 would surface. Proof-by-deletion: remove the try/catch in
    // deleteCanvas and this fails with the raw refusal. RESTRICT means the canvas survives.
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const { id } = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "Referenced canvas",
        definition: phoneCanvas("Bound"),
      }),
    );
    // Seed a device profile that binds the canvas — setup, not the thing under test. Through
    // drizzle, for the `$defaultFn` reason `seedSession` states.
    await suite.db
      .insert(deviceProfiles)
      .values({ name: "Binding profile", formFactor: "till", canvasId: id, capabilities: [] });
    const code = await codeOf(() =>
      inTx((tx) => deleteCanvas(tx, { managementSessionId: session, id })),
    );
    expect(code).toBe("canvas.in_use");
    expect(await rowCount()).toBe(1); // the canvas survived the refused delete (RESTRICT)
  });

  it("throws canvas.not_found when updating an absent id", async () => {
    // The write-path no-row guard: `.returning({ id })` comes back empty, so updateCanvas throws
    // rather than reporting a silent success. Proof-by-deletion: drop the `updated.length === 0` check
    // and this call resolves, failing the assertion. A well-formed uuid that names no row hits it.
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const code = await codeOf(() =>
      inTx((tx) =>
        updateCanvas(tx, {
          managementSessionId: session,
          id: "00000000-0000-4000-8000-000000000000",
          name: "Ghost",
          definition: phoneCanvas("None"),
        }),
      ),
    );
    expect(code).toBe("canvas.not_found");
  });

  it("throws canvas.not_found when deleting an absent id", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const code = await codeOf(() =>
      inTx((tx) =>
        deleteCanvas(tx, {
          managementSessionId: session,
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    );
    expect(code).toBe("canvas.not_found");
  });

  it("returns the built-in default for a form factor with no stored canvas", async () => {
    const result = await inTx((tx) => getCanvasForFormFactor(tx, "kds"));
    expect(result).toEqual(DEFAULT_CANVASES.kds);
  });

  it("returns the first stored canvas of a form factor over the built-in default", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const stored = phoneCanvas("Custom floor");
    await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "My phone",
        definition: stored,
      }),
    );
    const result = await inTx((tx) => getCanvasForFormFactor(tx, "phone-portrait"));
    expect(result).toEqual(stored);
    expect(result).not.toEqual(DEFAULT_CANVASES["phone-portrait"]);
  });

  it("refuses a create from a staff-role session — the authorizeManager gate (differential)", async () => {
    // The by-deletion proof: staff holds no layout.configure, so authorizeManager throws
    // authorization.not_permitted BEFORE any write. Deleting the authorizeManager call from
    // createCanvas makes this succeed → codeOf returns "did not throw…" and a row lands, failing both
    // assertions.
    await seedTenant(suite.db);
    const staffSession = await seedSession("staff");
    const code = await codeOf(() =>
      inTx((tx) =>
        createCanvas(tx, {
          managementSessionId: staffSession,
          name: "Nope",
          definition: phoneCanvas("Denied"),
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount()).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid definition with canvas.invalid before any INSERT", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    // authorize FIRST (manager is permitted), THEN validate — so an invalid definition from an
    // AUTHORISED actor is what proves validate runs before the write. `{}` has no formFactor.
    const code = await codeOf(() =>
      inTx((tx) =>
        createCanvas(tx, {
          managementSessionId: session,
          name: "Bad",
          definition: {} as unknown,
        }),
      ),
    );
    expect(code).toBe("canvas.invalid");
    expect(await rowCount()).toBe(0); // validate threw before the INSERT
  });

  it("translates a duplicate name to canvas.name_taken (23505 → clean 409), no second row", async () => {
    // The per-tenant `canvases_tenant_name_key` unique fires on the SECOND create with the same
    // name; canvas-store catches the driver's 23505 and re-throws it as the domain canvas.name_taken
    // — a duplicate must not surface as a raw 500. Here that runs against the real constraint;
    // canvas-store.test.ts pins the translator's own branches on crafted errors instead.
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "Twin",
        definition: phoneCanvas("First"),
      }),
    );
    const code = await codeOf(() =>
      inTx((tx) =>
        createCanvas(tx, {
          managementSessionId: session,
          name: "Twin",
          definition: phoneCanvas("Second"),
        }),
      ),
    );
    expect(code).toBe("canvas.name_taken");
    expect(await rowCount()).toBe(1); // the duplicate never landed
  });

  it("translates a duplicate name on UPDATE to canvas.name_taken", async () => {
    // Renaming one canvas onto another's name trips the same unique on the UPDATE path.
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "Keep",
        definition: phoneCanvas("A"),
      }),
    );
    const { id: second } = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "Move",
        definition: phoneCanvas("B"),
      }),
    );
    const code = await codeOf(() =>
      inTx((tx) =>
        updateCanvas(tx, {
          managementSessionId: session,
          id: second,
          name: "Keep", // collides with the first canvas's name
          definition: phoneCanvas("B2"),
        }),
      ),
    );
    expect(code).toBe("canvas.name_taken");
  });
});

/**
 * The property `translateWriteError`'s restrict branch rests on, read off the real migrated schema.
 *
 * It used to match a CONSTRAINT NAME, so a refusal from some other foreign key re-threw. SQLite
 * reports every foreign-key refusal as the identical `FOREIGN KEY constraint failed` — no table,
 * no column, no name (`packages/db/src/constraint-target.ts`) — so the branch can only ask the
 * CLASS, and what keeps `canvas.in_use` honest is that no other key can raise 1811 inside the one
 * statement each writer wraps: `canvases` declares no foreign key of its own to trip, and exactly
 * one key references it.
 *
 * That is a fact about the SCHEMA, which is why it is checked here rather than in the crafted-error
 * unit suite — where the two refusals are byte-for-byte identical and no assertion can separate
 * them. Add a second key into `canvases`, or a key out of it, and this fails; `canvas.in_use`
 * would then be reported for a refusal the store never read.
 *
 * The "no key OUT of it" half needs its own control, because an empty answer is also what a broken
 * query returns: the same disjunct over `device_profiles`, in the twin of this case in
 * `device-profile-store.db.test.ts`, DOES return that table's outgoing `canvas_id` key. So the
 * query finds outgoing keys where there are any, and `canvases` has none.
 */
describe("what can refuse a write to canvases", () => {
  it("has device_profiles.canvas_id as the ONLY key into canvases, and no key out of it", async () => {
    const { rows } = await suite.db.execute<{
      child: string;
      column: string;
      parent: string;
      on_delete: string;
    }>(sql`
      select m.name as child, f."from" as column, f."table" as parent, f.on_delete
      from sqlite_master m join pragma_foreign_key_list(m.name) f
      where m.type = 'table' and (f."table" = 'canvases' or m.name = 'canvases')
      order by child, column`);
    expect(rows).toEqual([
      { child: "device_profiles", column: "canvas_id", parent: "canvases", on_delete: "RESTRICT" },
    ]);
  });
});
