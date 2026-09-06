import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { drawerOpens } from "./drawer-opens.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// constraints themselves would fire on either target — a candidate for the PGlite tier once the
// suites are re-tagged.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A = "aaaaaaaa-0000-4000-8000-000000000011";
const TILL_B = "bbbbbbbb-0000-4000-8000-000000000011";
const PRINTER_A = "aaaaaaaa-0000-4000-8000-000000000021";
const PRINTER_B = "bbbbbbbb-0000-4000-8000-000000000021";
// The acting operator recorded in `person_id` — an identity person id, plain uuid, no FK (the person
// schema is a separate slice; a raw uuid keeps this audit table independent of it).
const PERSON = "cccccccc-0000-4000-8000-000000000001";
// The authorizer recorded in `authorized_by` (a supervisor who authorized the open) — same shape as
// PERSON: a raw identity person id, plain uuid, no FK.
const AUTHORIZER = "cccccccc-0000-4000-8000-000000000002";

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

describe("drawer_opens schema (cash-drawer audit — columns, defaults, CHECK, composite FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
    await suite.admin.execute(sql`
      insert into tills (id, tenant_id, location_id, name)
      values
        (${TILL_A}, ${TENANT_A}, ${LOCATION_A}, 'Till A'),
        (${TILL_B}, ${TENANT_B}, ${LOCATION_B}, 'Till B')
      on conflict (id) do nothing`);
    await suite.admin.execute(sql`
      insert into printers (id, tenant_id, location_id, name, transport, poll_id)
      values
        (${PRINTER_A}, ${TENANT_A}, ${LOCATION_A}, 'Impresora A', 'cloud_poll', 'poll-a'),
        (${PRINTER_B}, ${TENANT_B}, ${LOCATION_B}, 'Impresora B', 'cloud_poll', 'poll-b')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  function tillOf(tenant: string): string {
    return tenant === TENANT_A ? TILL_A : TILL_B;
  }

  async function seedOpen(
    tenant: string,
    reason: "cash_sale" | "manual",
    saleId: string | null = null,
  ): Promise<void> {
    await asApp(tenant, (tx) =>
      tx.execute(
        sql`insert into drawer_opens (tenant_id, till_id, person_id, reason, sale_id)
            values (${tenant}, ${tillOf(tenant)}, ${PERSON}, ${reason}, ${saleId})`,
      ),
    );
  }

  it("writes and reads back a manual open (the column list, and the authorized_by/via_override defaults)", async () => {
    // The positive control for the CHECK and FK rejections below: without a write that SUCCEEDS, a
    // rejection could equally mean the row was malformed some other way. A manual open has no sale
    // (sale_id NULL), which is the common accountability case. Read back through the
    // Drizzle `drawerOpens` export (not raw SQL) — exercises the produced table export and its column
    // mapping under the app role.
    await seedOpen(TENANT_A, "manual");
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(drawerOpens)
        .where(sql`person_id = ${PERSON} and reason = 'manual'`),
    );
    expect(row!.tenantId).toBe(TENANT_A);
    expect(row!.tillId).toBe(TILL_A);
    expect(row!.personId).toBe(PERSON);
    expect(row!.reason).toBe("manual");
    expect(row!.saleId).toBeNull();
    expect(row!.openedAt).toBeInstanceOf(Date); // defaultNow() populated the server-clock timestamp
    // The new audit columns on their DEFAULT path: this insert supplied neither, so authorized_by is NULL
    // — as the automatic `cash_sale` drawer kick leaves it (a MANUAL open always sets authorized_by) — and
    // via_override took its NOT NULL DEFAULT false. Exercises the produced column mapping for both.
    expect(row!.authorizedBy).toBeNull();
    expect(row!.viaOverride).toBe(false);
  });

  it("records authorized_by and via_override on an authorized open (new audit columns present + writable)", async () => {
    // The new audit columns written by the app role: a gated open a supervisor (AUTHORIZER) authorized on
    // behalf of an operator (PERSON) who lacks cash.drawer — authorized_by set, via_override true. app_user
    // holds INSERT (append-only), so this exercises the write grant AND the produced column mapping when
    // both are populated. Read back through the Drizzle `drawerOpens` export.
    await asApp(TENANT_A, (tx) =>
      tx.execute(
        sql`insert into drawer_opens (tenant_id, till_id, person_id, reason, authorized_by, via_override)
            values (${TENANT_A}, ${TILL_A}, ${PERSON}, 'manual', ${AUTHORIZER}, true)`,
      ),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(drawerOpens)
        .where(sql`person_id = ${PERSON} and authorized_by = ${AUTHORIZER}`),
    );
    expect(row!.authorizedBy).toBe(AUTHORIZER);
    expect(row!.viaOverride).toBe(true);
  });

  it("the reason CHECK accepts 'cash_sale' and rejects an unknown reason (23514)", async () => {
    // 'manual' is exercised by the positive control above; this pins that 'cash_sale' is also accepted
    // and that the closed vocabulary bites — an unknown reason is refused by drawer_opens_reason_ck.
    await seedOpen(TENANT_A, "cash_sale"); // accepted (reason CHECK allows it; sale_id is optional)
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into drawer_opens (tenant_id, till_id, person_id, reason)
              values (${TENANT_A}, ${TILL_A}, ${PERSON}, 'refund')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23514"); // check_violation on drawer_opens_reason_ck
  });

  it("the till binding is tenant-consistent (composite FK to tills)", async () => {
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into drawer_opens (tenant_id, till_id, person_id, reason)
              values (${TENANT_A}, ${TILL_B}, ${PERSON}, 'manual')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, till_id)
  });

  it("the sale binding is enforced (composite FK to sales)", async () => {
    // Proves the (tenant_id, sale_id) → sales composite FK exists and bites: a non-existent sale_id for
    // A's own tenant → foreign_key_violation. A's tenant_id + (A, TILL_A) isolate the sale FK. A full
    // cross-tenant sale fixture is disproportionate for a schema task (a sale needs a series + node +
    // ~15 columns); a non-existent id proves the composite FK is wired all the same, and NULL (the
    // manual case) is proven to skip it by the positive control above.
    const missingSale = "dddddddd-0000-4000-8000-0000000000ff";
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into drawer_opens (tenant_id, till_id, person_id, reason, sale_id)
              values (${TENANT_A}, ${TILL_A}, ${PERSON}, 'cash_sale', ${missingSale})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, sale_id)
  });

  it("the app role can set and read tills.receipt_printer_id (new column, composite FK to printers)", async () => {
    // The new bare column on tills, visible + writable under the app role (app_user holds UPDATE on
    // tills), and its hand-written (tenant_id, receipt_printer_id) → printers composite FK accepts a
    // printer of the same tenant. Rolled back so the shared template clone is untouched.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`update tills set receipt_printer_id = ${PRINTER_A} where id = ${TILL_A}`,
      );
      const r = await tx.execute<{ receipt_printer_id: string }>(
        sql`select receipt_printer_id from tills where id = ${TILL_A}`,
      );
      expect(r.rows[0]!.receipt_printer_id).toBe(PRINTER_A);
    });
  });

  it("tills.receipt_printer_id is tenant-consistent (rejects a foreign-tenant printer, 23503)", async () => {
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(sql`update tills set receipt_printer_id = ${PRINTER_B} where id = ${TILL_A}`),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503");
  });

  it("locations.receipt_print_mode defaults to 'auto' and is settable under the app role", async () => {
    // The new enum column: the seeded locations carry no explicit value, so they take the DEFAULT
    // 'auto'; and the app role (app_user holds UPDATE on locations) can move it. Rolled back so the
    // shared template clone keeps its default.
    const mode = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ receipt_print_mode: string }>(
          sql`select receipt_print_mode from locations where id = ${LOCATION_A}`,
        )
        .then((r) => r.rows[0]!.receipt_print_mode),
    );
    expect(mode).toBe("auto");
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`update locations set receipt_print_mode = 'on_request' where id = ${LOCATION_A}`,
      );
      const r = await tx.execute<{ receipt_print_mode: string }>(
        sql`select receipt_print_mode from locations where id = ${LOCATION_A}`,
      );
      expect(r.rows[0]!.receipt_print_mode).toBe("on_request");
    });
  });

  it("locations.drawer_open_policy defaults to 'gated' (the SECURE default) and is settable under the app role", async () => {
    // The new per-venue enum column: the seeded locations carry no explicit value, so they take the
    // DEFAULT 'gated' — the SECURE default (an unconfigured venue gets cash accountability, not an open
    // drawer), deliberately unlike receipt_print_mode's inert 'auto'. The app role (app_user holds UPDATE
    // on locations) can move it to 'open'. Rolled back so the shared template clone keeps its default.
    const policy = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ drawer_open_policy: string }>(
          sql`select drawer_open_policy from locations where id = ${LOCATION_A}`,
        )
        .then((r) => r.rows[0]!.drawer_open_policy),
    );
    expect(policy).toBe("gated");
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(
        sql`update locations set drawer_open_policy = 'open' where id = ${LOCATION_A}`,
      );
      const r = await tx.execute<{ drawer_open_policy: string }>(
        sql`select drawer_open_policy from locations where id = ${LOCATION_A}`,
      );
      expect(r.rows[0]!.drawer_open_policy).toBe("open");
    });
  });
});
