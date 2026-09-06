import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CANVAS_A = "11111111-0000-4000-8000-0000000000a2";
const CANVAS_B = "22222222-0000-4000-8000-0000000000b2";

describe("device_profiles composite canvas FK (tenant_id, canvas_id) → canvases", () => {
  const suite = useTemplateDb({ template: "core" });
  let admin: Database;

  beforeAll(async () => {
    admin = suite.admin;
    await admin.execute(sql`
      insert into tenants (id, country, tax_id, legal_name) values
        (${TENANT_A}, 'ES', 'B00000000', 'Fixture Tenant A'),
        (${TENANT_B}, 'ES', 'B11111111', 'Fixture Tenant B')
      on conflict (id) do nothing`);
    await admin.execute(sql`
      insert into canvases (id, tenant_id, name, definition) values
        (${CANVAS_A}, ${TENANT_A}, 'Canvas A', '{}'::jsonb),
        (${CANVAS_B}, ${TENANT_B}, 'Canvas B', '{}'::jsonb)
      on conflict (id) do nothing`);
  });

  it("rejects a canvas_id naming a DIFFERENT tenant's canvas (composite FK)", async () => {
    // CANVAS_B exists, but under TENANT_A the pair (TENANT_A, CANVAS_B) names no canvas row, so the
    // composite FK device_profiles_canvas_fk is violated.
    const e = await captureError(() =>
      admin.execute(
        sql`insert into device_profiles (tenant_id, name, canvas_id)
            values (${TENANT_A}, 'Cross-tenant canvas', ${CANVAS_B})`,
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });

  it("accepts a same-tenant canvas_id; a NULL canvas_id is unconstrained (MATCH SIMPLE)", async () => {
    const bound = await admin.execute<{ id: string }>(
      sql`insert into device_profiles (tenant_id, name, canvas_id)
          values (${TENANT_A}, 'Bound profile', ${CANVAS_A}) returning id`,
    );
    expect(bound.rows).toHaveLength(1);

    // NULL canvas_id — the composite FK skips the check on any NULL column, and the capabilities
    // default applies ('[]').
    const [row] = (
      await admin.execute<{ canvas_id: string | null; capabilities: unknown }>(
        sql`insert into device_profiles (tenant_id, name)
            values (${TENANT_A}, 'Unbound profile')
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
      insert into canvases (id, tenant_id, name, definition)
      values (${canvasC}, ${TENANT_A}, 'Canvas C', '{}'::jsonb)`);
    await admin.execute(sql`
      insert into device_profiles (tenant_id, name, canvas_id)
      values (${TENANT_A}, 'Restrict profile', ${canvasC})`);
    const e = await captureError(() =>
      admin.execute(sql`delete from canvases where id = ${canvasC}`),
    );
    // ON DELETE RESTRICT raises restrict_violation (23001), which fires immediately on the delete —
    // distinct from the deferred foreign_key_violation (23503) that a plain NO ACTION would give.
    expect(pgErrorCode(e)).toBe("23001");
  });
});
