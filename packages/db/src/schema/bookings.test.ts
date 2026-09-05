import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { bookings } from "./bookings.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// constraints themselves would fire on either target — a candidate for the PGlite tier once the
// suites are re-tagged.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
// A dining_tables row per tenant — the composite-FK target for bookings.(tenant_id, table_id).
const TABLE_A = "aaaaaaaa-0000-4000-8000-000000000009";
const TABLE_B = "bbbbbbbb-0000-4000-8000-000000000009";
// The identity person recorded in created_by — a plain uuid, no FK (the drawer_opens.person_id seam).
const CREATED_BY = "cccccccc-0000-4000-8000-000000000001";

describe("bookings schema (staff reservations — columns, CHECK, composite FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location per tenant — the owning location a booking references. Seeded as the superuser admin
    // (bypasses RLS). operation_description is Spanish test DATA, not a schema identifier, exactly as
    // the sibling location-catalogues test uses 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    // A dining_table per tenant — the (tenant_id, table_id) composite-FK target. Seeded as admin.
    await suite.admin.execute(sql`
      insert into dining_tables (id, tenant_id, location_id, label)
      values
        (${TABLE_A}, ${TENANT_A}, ${LOCATION_A}, 'A1'),
        (${TABLE_B}, ${TENANT_B}, ${LOCATION_B}, 'B1')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  // Insert a booking under the app role, scoped to `tenant` — the path the real routes take.
  async function seedBooking(
    tenant: string,
    location: string,
    time: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const cols: Record<string, unknown> = {
        tenant_id: tenant,
        location_id: location,
        booking_date: "2026-09-01",
        booking_time: time,
        party_size: 2,
        contact_name: "Ana",
        created_by: CREATED_BY,
        ...extra,
      };
      const keys = Object.keys(cols);
      const r = await tx.execute<{ id: string }>(
        sql`insert into bookings (${sql.join(
          keys.map((k) => sql.identifier(k)),
          sql`, `,
        )}) values (${sql.join(
          keys.map((k) => sql`${cols[k]}`),
          sql`, `,
        )}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  it("exposes every column through the Drizzle export, with the status default", async () => {
    const id = await seedBooking(TENANT_A, LOCATION_A, "20:00");
    // Read back through the Drizzle `bookings` export (not raw SQL) — exercises the produced table
    // export, its column mapping, the `status` default and `booking_time`'s rendering.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(bookings)
        .where(sql`id = ${id}`),
    );
    expect(row!.tenantId).toBe(TENANT_A);
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.bookingDate).toBe("2026-09-01");
    expect(row!.bookingTime).toBe("20:00:00");
    expect(row!.partySize).toBe(2);
    expect(row!.contactName).toBe("Ana");
    expect(row!.status).toBe("booked");
    expect(row!.createdBy).toBe(CREATED_BY);
    // A booking is edited and moved through its lifecycle: move it to a terminal state and read the
    // change back, so the mapping covers a written value as well as a default.
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update bookings set status = 'cancelled' where id = ${id}`),
    );
    const after = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ status: string }>(sql`select status from bookings where id = ${id}`)
        .then((r) => r.rows[0]!.status),
    );
    expect(after).toBe("cancelled");
  });

  it("rejects a non-positive party_size (CHECK party_size > 0)", async () => {
    const e = await captureError(() =>
      seedBooking(TENANT_A, LOCATION_A, "22:00", { party_size: 0 }),
    );
    expect(pgErrorCode(e)).toBe("23514"); // check_violation on bookings_party_size_ck
  });

  it("the table binding is tenant-consistent (composite FK to dining_tables)", async () => {
    // Tenant A cannot assign its booking to tenant B's table: the (tenant_id, table_id) composite FK
    // has no (A, TABLE_B) row → foreign_key_violation, independently of RLS. The insert is A's own
    // tenant_id (WITH CHECK passes) and (A, LOCATION_A) exists, isolating the table FK.
    const e = await captureError(() =>
      seedBooking(TENANT_A, LOCATION_A, "19:00", { table_id: TABLE_B }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, table_id)
  });

  it("the tab binding has a composite FK (a non-existent tab_id is rejected)", async () => {
    // Proves bookings_tab_fk fires: a tab_id with no matching working_orders(tenant_id, id) row →
    // foreign_key_violation. Cross-tenant seeding of a working_order (which needs a till + node) is
    // exercised in the TS-1/server suites; here a non-existent tab is enough to prove the constraint.
    const e = await captureError(() =>
      seedBooking(TENANT_A, LOCATION_A, "18:00", {
        tab_id: "dddddddd-0000-4000-8000-000000000001",
      }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, tab_id)
  });
});
