import { CORE_MIGRATIONS } from "../migrations.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { usePgliteDb } from "../testing/lifecycle.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const CANVAS_A = "11111111-0000-4000-8000-0000000000a2";

describe("device_profiles canvas FK (canvas_id) → canvases", () => {
  const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });
  let admin: Database;

  beforeAll(async () => {
    admin = suite.db;
    await admin.execute(sql`
      insert into tenants (id, country, tax_id, legal_name) values
        (${TENANT_A}, 'ES', 'B00000000', 'Fixture Tenant A')
      on conflict (id) do nothing`);
    await admin.execute(sql`
      insert into canvases (id, name, definition) values (${CANVAS_A}, 'Canvas A', '{}'::jsonb)
      on conflict (id) do nothing`);
  });

  afterEach(async () => {
    await suite.db.execute(sql`delete from device_profiles`);
    await suite.db.execute(sql`delete from canvases where id <> ${CANVAS_A}`);
  });

  it("accepts a same-tenant canvas_id; a NULL canvas_id is unconstrained (MATCH SIMPLE)", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into device_profiles (name, form_factor, canvas_id) values ('Bound profile', 'till', ${CANVAS_A}) returning id`,
    );
    expect(bound.rows).toHaveLength(1);

    // NULL canvas_id — the composite FK skips the check on any NULL column, and the capabilities
    // default applies ('[]').
    const [row] = (
      await admin.execute<{ canvas_id: string | null; capabilities: unknown }>(
        sql`insert into device_profiles (name, form_factor) values ('Unbound profile', 'till')
            returning canvas_id, capabilities`,
      )
    ).rows;
    expect(row!.canvas_id).toBeNull();
    expect(row!.capabilities).toEqual([]);
  });

  it("refuses to delete a canvas a profile references (ON DELETE RESTRICT)", async () => {
    // Bind a profile to a fresh canvas, then try to hard-delete that canvas: RESTRICT blocks it.
    const canvasC = "11111111-0000-4000-8000-0000000000c2";
    await admin.execute(sql`
      insert into canvases (id, name, definition) values (${canvasC}, 'Canvas C', '{}'::jsonb)`);
    await admin.execute(sql`
      insert into device_profiles (name, form_factor, canvas_id) values ('Restrict profile', 'till', ${canvasC})`);
    const e = await captureError(() =>
      admin.execute(sql`delete from canvases where id = ${canvasC}`),
    );
    // ON DELETE RESTRICT raises restrict_violation (23001), which fires immediately on the delete —
    // distinct from the deferred foreign_key_violation (23503) that a plain NO ACTION would give.
    expect(pgErrorCode(e)).toBe("23001");
  });
});
