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

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Through drizzle rather than raw SQL: `persons.id` and `created_at` take their value from the
 * table's `$defaultFn`, which is not a SQL DEFAULT, so a raw insert naming neither is refused
 * `NOT NULL constraint failed: persons.id`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.token;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

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
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    const { id } = await inTx((tx) =>
      createCanvas(tx, {
        managementSessionId: session,
        name: "Referenced canvas",
        definition: phoneCanvas("Bound"),
      }),
    );
    // Through drizzle, for the `$defaultFn` reason `seedSession` states.
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
    // A manager passes the gate, so this refusal is validation's. `{}` has no formFactor.
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
 * The schema half of what `translateWriteError`'s restrict branch rests on (see its doc). An empty
 * "key out of canvases" answer is also what a broken query returns; the control is the same query
 * in device-profile-store.db.test.ts, which does find that table's outgoing `canvas_id` key.
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
