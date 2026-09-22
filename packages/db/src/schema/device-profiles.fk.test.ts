import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { canvases } from "./canvases.js";
import { deviceProfiles } from "./device-profiles.js";
import { tenants } from "./tenants.js";

const CANVAS_A = "11111111-0000-4000-8000-0000000000a2";

describe("device_profiles canvas FK (canvas_id) → canvases", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  // Drizzle rather than raw SQL for the two fixture rows, for two reasons measured on this suite.
  // The `'{}'::jsonb` cast is refused at prepare here — `unrecognized token: ":"` (node v26.7.0,
  // `node:sqlite`) — because SQLite has no cast operator. And both tables carry `$defaultFn`
  // timestamps (`tenants.created_at`, `canvases.created_at`/`updated_at`), which are JavaScript
  // generators rather than SQL DEFAULTs, so a raw insert that omits them reaches nothing to fill
  // them: before this change the whole suite died in `beforeAll` with
  // `NOT NULL constraint failed: tenants.created_at` and both cases reported `skipped`. Going
  // through drizzle calls the generators and encodes `definition` as the JSON text the column
  // holds.
  beforeAll(async () => {
    admin = suite.db;
    await admin
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" })
      .onConflictDoNothing({ target: tenants.id });
    await admin
      .insert(canvases)
      .values({ id: CANVAS_A, name: "Canvas A", definition: {} })
      .onConflictDoNothing({ target: canvases.id });
  });

  afterEach(async () => {
    await suite.db.execute(sql`delete from device_profiles`);
    await suite.db.execute(sql`delete from canvases where id <> ${CANVAS_A}`);
  });

  it("accepts a real canvas_id; a NULL canvas_id is unconstrained (MATCH SIMPLE)", async () => {
    // Drizzle for the inserts, for the reason the `beforeAll` records — `device_profiles.id` is a
    // `$defaultFn` generator, so a raw insert omitting it is refused `NOT NULL constraint failed:
    // device_profiles.id` (measured on this suite). It also matters for the `capabilities` read
    // below: that column is `json(...)`, stored as TEXT, so a RAW read hands back the string `[]`
    // and only a drizzle read decodes it to the array this case asserts on.
    const bound = await admin
      .insert(deviceProfiles)
      .values({ name: "Bound profile", formFactor: "till", canvasId: CANVAS_A })
      .returning({ id: deviceProfiles.id });
    expect(bound).toHaveLength(1);

    // NULL canvas_id — a foreign key does not check a NULL, and the capabilities default applies.
    const [row] = await admin
      .insert(deviceProfiles)
      .values({ name: "Unbound profile", formFactor: "till" })
      .returning({
        canvasId: deviceProfiles.canvasId,
        capabilities: deviceProfiles.capabilities,
      });
    expect(row!.canvasId).toBeNull();
    expect(row!.capabilities).toEqual([]);
  });

  it("refuses to delete a canvas a profile references (ON DELETE RESTRICT)", async () => {
    // Bind a profile to a fresh canvas, then try to hard-delete that canvas: RESTRICT blocks it.
    const canvasC = "11111111-0000-4000-8000-0000000000c2";
    // Drizzle for the same two reasons the `beforeAll` above records.
    await admin.insert(canvases).values({ id: canvasC, name: "Canvas C", definition: {} });
    await admin
      .insert(deviceProfiles)
      .values({ name: "Restrict profile", formFactor: "till", canvasId: canvasC });
    const e = await captureError(() =>
      admin.execute(sql`delete from canvases where id = ${canvasC}`),
    );
    // ON DELETE RESTRICT raises restrict_violation (23001), which fires immediately on the delete —
    // distinct from the deferred foreign_key_violation (23503) that a plain NO ACTION would give.
    expect(pgErrorCode(e)).toBe("23001");
  });
});
