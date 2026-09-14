import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { stationPrinters } from "./station-printers.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("station_printers schema (KDS-4 mapping — PK + composite FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    void tenant;
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedStation(tenant: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into kitchen_stations (tenant_id, location_id, name)
            values (${tenant}, ${LOCATION_A}, ${name}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // A cloud_poll printer (needs only poll_id — no agent, so no print_agents fixture) satisfies the
  // printers transport CHECK, keeping this suite to the two tables the mapping actually references.
  async function seedPrinter(tenant: string, name: string, pollId: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into printers (tenant_id, location_id, name, transport, poll_id)
            values (${tenant}, ${LOCATION_A}, ${name}, 'cloud_poll', ${pollId}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  async function seedMapping(tenant: string, station: string, printer: string): Promise<void> {
    await asApp(tenant, (tx) =>
      tx.execute(
        sql`insert into station_printers (tenant_id, station_id, printer_id)
            values (${tenant}, ${station}, ${printer})`,
      ),
    );
  }

  it("maps every column through the Drizzle export and detaches by DELETE … RETURNING", async () => {
    const station = await seedStation(TENANT_A, "Cocina");
    const printer = await seedPrinter(TENANT_A, "Impresora Cocina", "poll-control");
    await seedMapping(TENANT_A, station, printer);
    // Read back through the Drizzle `stationPrinters` export (not raw SQL) — exercises the produced
    // table export and its column mapping under the app role.
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(stationPrinters)
        .where(sql`station_id = ${station}`),
    );
    expect(row!.tenantId).toBe(TENANT_A);
    expect(row!.stationId).toBe(station);
    expect(row!.printerId).toBe(printer);
    // A mapping row is REMOVED via DELETE (app_user holds DELETE — detach in §3a).
    const deleted = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ printer_id: string }>(
          sql`delete from station_printers where station_id = ${station} and printer_id = ${printer}
              returning printer_id`,
        )
        .then((r) => r.rows),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.printer_id).toBe(printer);
  });

  it("the primary key rejects a duplicate (tenant_id, station_id, printer_id) mapping (23505)", async () => {
    const station = await seedStation(TENANT_A, "Barra");
    const printer = await seedPrinter(TENANT_A, "Impresora Barra", "poll-dup");
    await seedMapping(TENANT_A, station, printer);
    const e = await captureError(() => seedMapping(TENANT_A, station, printer));
    expect(pgErrorCode(e)).toBe("23505"); // unique_violation on the composite PK
  });
});
