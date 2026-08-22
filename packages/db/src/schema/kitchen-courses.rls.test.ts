import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: RLS as the non-owner app role is a false pass on
// PGlite, which connects as superuser and bypasses FORCE (CLAUDE.md §4). The hand-written
// (tenant_id, course_id) → kitchen_courses FKs and that the app role can write the new course_id
// columns are proven here too — RLS/grant/FK behaviour as the non-owner role is a false pass on
// PGlite's superuser connection. Scaffolding ported from kitchen-stations.rls.test.ts /
// routing-station.rls.test.ts — useTemplateDb + withTenant + asAppUser (the shared-container tier).
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_A2 = "aaaaaaaa-0000-4000-8000-000000000002";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const RANDOM_UUID = "99999999-9999-4999-8999-999999999999";

class RollbackSignal extends Error {}
async function rollBackAfter(
  admin: Database,
  tenant: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("kitchen_courses schema (RLS + grants + course FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  // Seeded once in beforeAll: a product of tenant A (for the products.course_id FK proof) and a course
  // per tenant (course A is own-tenant, course B is the foreign one a tenant-consistent FK must reject).
  let productA = "";
  let courseA = "";
  let courseB = "";

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location per tenant (plus a second for A): kitchen_courses carries a tenant-consistent
    // (tenant_id, location_id) FK, so every course insert needs a real owning location. Seeded as the
    // superuser admin (bypasses RLS). operation_description is Spanish test DATA, not a schema
    // identifier, exactly as the sibling routing-station test uses 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_A2}, ${TENANT_A}, 'Loc A2', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    courseA = await seedCourse(TENANT_A, LOCATION_A, "Entrantes");
    courseB = await seedCourse(TENANT_B, LOCATION_B, "Entrantes");
    // A catalogue + product of tenant A, so the products.course_id FK proof has an own-tenant product
    // to route. Seeded as admin (a catalogue fixture, not the thing under test) — same as routing-station.
    const [cat] = await suite.admin
      .insert(catalogues)
      .values({ tenantId: TENANT_A, name: "Deli A" })
      .returning({ id: catalogues.id });
    const [prod] = await suite.admin
      .insert(products)
      .values({
        tenantId: TENANT_A,
        catalogueId: cat!.id,
        descriptions: { es: "Café solo" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = prod!.id;
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedCourse(
    tenant: string,
    location: string,
    name: string,
    displayOrder = 0,
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into kitchen_courses (tenant_id, location_id, name, display_order)
            values (${tenant}, ${location}, ${name}, ${displayOrder}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("permits SELECT/INSERT/UPDATE as the non-owner app role (the control)", async () => {
    const id = await seedCourse(TENANT_A, LOCATION_A, "Principales", 1);
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update kitchen_courses set display_order = 5 where id = ${id}`),
    );
    // Read back through the Drizzle `kitchenCourses` export (not raw SQL) — exercises the produced
    // table export and its column mapping under the app role.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(kitchenCourses)
        .where(sql`id = ${id}`),
    );
    expect(row!.displayOrder).toBe(5);
    expect(row!.name).toBe("Principales");
    expect(row!.active).toBe(true);
  });

  it("app_user has no DELETE on kitchen_courses (deactivate, never delete)", async () => {
    const id = await seedCourse(TENANT_A, LOCATION_A, "Postres", 2);
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) => tx.execute(sql`delete from kitchen_courses where id = ${id}`)),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("isolates INSERT between tenants (WITH CHECK rejects a foreign tenant_id)", async () => {
    // The WITH-CHECK deletion-proof target: weakening WITH CHECK to (true) makes this foreign-tenant_id
    // INSERT succeed instead of raising 42501, flipping this test red.
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into kitchen_courses (tenant_id, location_id, name)
              values (${TENANT_A}, ${LOCATION_A}, 'Foreign')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("42501");
  });

  it("tenant isolation is the policy PREDICATE's doing (proof by deletion of the tenant predicate)", async () => {
    // A's row is committed before the policy is weakened, so it is genuinely there to leak. Weakening
    // the predicate to `true` in a ROLLED-BACK tx makes B suddenly see it. A full DROP POLICY is the
    // WRONG deletion: FORCE RLS with no policy denies ALL rows, so B would see zero for the opposite
    // reason. Mirrors kitchen-stations.rls.test.ts.
    const id = await seedCourse(TENANT_A, LOCATION_A, "Leak-probe", 9);
    expect(id).toBeDefined();
    // Control in the other direction (§4): under the REAL policy tenant B sees ZERO of A's rows, so the
    // `> 0` after weakening is attributable to the weakening rather than to B having read A all along.
    const foreignUnderRealPolicy = await asApp(TENANT_B, (tx) =>
      tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from kitchen_courses`,
        )
        .then((r) => r.rows[0]!.n),
    );
    expect(foreignUnderRealPolicy).toBe(0);
    await rollBackAfter(suite.admin, TENANT_B, async (tx) => {
      await tx.execute(
        sql`alter policy kitchen_courses_tenant_isolation on kitchen_courses using (true) with check (true)`,
      );
      await tx.execute(sql`set local role app_user`);
      const foreign = await tx
        .execute<{ n: number }>(
          sql`select (count(*) filter (where tenant_id = ${TENANT_A}))::int as n from kitchen_courses`,
        )
        .then((r) => r.rows[0]!.n);
      expect(foreign).toBeGreaterThan(0); // A's rows now leak to B — the predicate was the guard.
    });
  });

  it("requires ENABLE and FORCE ROW LEVEL SECURITY (the inmutabilidad guard's structural target)", async () => {
    // Silently inert without ENABLE; the table OWNER bypasses without FORCE (the reason the migration
    // hand-writes FORCE on top of .enableRLS()'s ENABLE). Deletion-proof: removing the FORCE line from
    // 0058_kds2_courses_fire_rls.sql leaves relforcerowsecurity false and flips THIS assertion red
    // (verified by deletion during development, CLAUDE.md §4). The inmutabilidad suite asserts the same
    // flag repo-wide off the tenant_id column; this pins it locally for kitchen_courses.
    const found = await suite.admin.execute<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'kitchen_courses'`,
    );
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]!.relrowsecurity).toBe(true);
    expect(found.rows[0]!.relforcerowsecurity).toBe(true);
  });

  it("exposes locations.fire_control to the app role, defaulting to 'waiter' (the new venue setting)", async () => {
    // The additive fire_control column lands NOT NULL DEFAULT 'waiter' and is readable under the app
    // role (locations' existing policy + SELECT grant cover it). Writing it is a config verb (Task 3),
    // not exercised here.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ fire_control: string }>(
          sql`select fire_control from locations where id = ${LOCATION_A}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.fire_control).toBe("waiter");
  });

  it("lets the app role route a product to an own-tenant course and rejects a foreign or missing one", async () => {
    // The app role writes and reads back products.course_id (the additive column, under products'
    // existing grant + policy) …
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update products set course_id = ${courseA} where id = ${productA}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ course_id: string | null }>(
          sql`select course_id from products where id = ${productA}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.course_id).toBe(courseA);

    // … a course that names no row at all is refused (FK existence) …
    const eRandom = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update products set course_id = ${RANDOM_UUID} where id = ${productA}`),
      ),
    );
    expect(pgErrorCode(eRandom)).toBe("23503");

    // … and the case a SINGLE-column FK would let through: a course that EXISTS but belongs to another
    // tenant. The composite (tenant_id, course_id) requires a kitchen_courses row with (TENANT_A,
    // B's id), which does not exist — so it is 23503, proving the FK is tenant-consistent.
    const eForeign = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update products set course_id = ${courseB} where id = ${productA}`),
      ),
    );
    expect(pgErrorCode(eForeign)).toBe("23503");
  });

  it("wires all three course columns with the tenant-consistent composite FK to kitchen_courses", async () => {
    // The heavy behavioural proof above covers products.course_id; working_order_lines.course_id and
    // ticket_items.course_id use the IDENTICAL hand-written DDL. Asserting each of the three FK
    // definitions structurally (pg_get_constraintdef reads the LIVE catalog, not source) catches a
    // copy-paste error in the target or the column list — e.g. a course FK that points at
    // kitchen_stations, or omits tenant_id — that the single behavioural test would not reach.
    const defs = await suite.admin.execute<{ conname: string; def: string }>(
      sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conname in ('products_course_fk', 'working_order_lines_course_fk', 'ticket_items_course_fk')
          order by conname`,
    );
    const byName = new Map(defs.rows.map((r) => [r.conname, r.def]));
    expect(byName.size).toBe(3);
    for (const name of [
      "products_course_fk",
      "working_order_lines_course_fk",
      "ticket_items_course_fk",
    ]) {
      const def = byName.get(name);
      expect(def, `${name} must exist`).toBeDefined();
      expect(def).toContain("FOREIGN KEY (tenant_id, course_id)");
      expect(def).toContain("kitchen_courses(tenant_id, id)");
    }
  });
});
