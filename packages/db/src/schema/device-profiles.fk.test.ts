import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { RESTRICT_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { canvases } from "./canvases.js";
import { deviceProfiles } from "./device-profiles.js";
import { tenants } from "./tenants.js";

const CANVAS_A = "11111111-0000-4000-8000-0000000000a2";

describe("device_profiles canvas FK (canvas_id) → canvases", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  // Drizzle rather than raw SQL: the `$defaultFn` columns are JavaScript generators, not SQL
  // DEFAULTs, and drizzle encodes `definition` as the JSON text the column holds.
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
    // Drizzle also for the `capabilities` read below: a raw read hands back the stored text `[]`,
    // not the array.
    const bound = await admin
      .insert(deviceProfiles)
      .values({ name: "Bound profile", formFactor: "till", canvasId: CANVAS_A })
      .returning({ id: deviceProfiles.id });
    expect(bound).toHaveLength(1);

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
    const canvasC = "11111111-0000-4000-8000-0000000000c2";
    await admin.insert(canvases).values({ id: canvasC, name: "Canvas C", definition: {} });
    await admin
      .insert(deviceProfiles)
      .values({ name: "Restrict profile", formFactor: "till", canvasId: canvasC });
    const e = await captureError(() =>
      admin.execute(sql`delete from canvases where id = ${canvasC}`),
    );
    // RESTRICT refuses with a code distinct from the `FOREIGN_KEY_VIOLATION` a plain NO ACTION
    // gives.
    expect(isRefusal(e, RESTRICT_VIOLATION)).toBe(true);
    // The message half matters: this schema's `raise(abort, …)` triggers report the same code
    // (`../sql-state.ts`), so the class alone cannot tell a trigger refusal from a RESTRICT one.
    expect(engineErrorMessage(e)).toBe("FOREIGN KEY constraint failed");
    // Control: the refusal names no key, so show an identical canvas no profile references deletes
    // cleanly.
    const canvasD = "11111111-0000-4000-8000-0000000000d2";
    await admin.insert(canvases).values({ id: canvasD, name: "Canvas D", definition: {} });
    await admin.execute(sql`delete from canvases where id = ${canvasD}`);
    const { rows } = await admin.execute<{ n: number }>(
      sql`select count(*) as n from canvases where id = ${canvasD}`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});
