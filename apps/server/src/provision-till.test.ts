import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@waitron/db";
import { freshNif } from "@waitron/db/testing/seed.js";
import { tenantId as brandTenantId, tillId as brandTillId } from "@waitron/shared";
import type { TenantId, TillId } from "@waitron/shared";
import { provisionTill } from "./provision-till.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";

// Waitron's own identifier for this software as registered with AEAT, which an operator passes on
// the command line. Opaque to everything here: nothing derives it, and nothing but the (NIF,
// IdSistemaInformatico) counter reads it.
const ID_SIF = "WTRN01";

// A tenant id that is well-formed but absent — the shape a mistyped argument actually takes, since
// a malformed one never survives `tenantId()`'s brand.
const ABSENT = "00000000-0000-0000-0000-000000000000";

let pg: RealPostgres;
let admin: Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
}, 180_000);

// Guarded: a failed `beforeAll` must not be masked by a teardown that throws first, and the
// container must not leak.
afterAll(async () => {
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
});

interface Bootstrapped {
  tenantId: TenantId;
  tillId: TillId;
  nif: string;
}

/**
 * Exactly what `sql/bootstrap-tenant.sql` leaves behind: tenant → location → till → series, and NO
 * SIF registration. Written out here rather than borrowed from another package's fixtures because
 * that file's output is precisely the state this module has to be able to provision — a fixture
 * that registered a SIF of its own (`@waitron/fiscal-verifactu`'s `seedTill` does) would test the
 * wrong starting point.
 */
async function bootstrapTenant(): Promise<Bootstrapped> {
  const nif = freshNif();
  const tenant = await admin.execute<{ id: string }>(sql`
    insert into tenants (nif, legal_name) values (${nif}, 'Deli SL') returning id`);
  const tenantId = brandTenantId(tenant.rows[0]!.id);

  const location = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Mostrador', array['es-ES'], 'Venta en establecimiento') returning id`);

  const till = await admin.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Caja 1') returning id`);
  const tillId = brandTillId(till.rows[0]!.id);

  await admin.execute(sql`
    insert into invoice_series (tenant_id, till_id, code) values (${tenantId}, ${tillId}, 'A')`);

  return { tenantId, tillId, nif };
}

/** The live SIF identity as the database holds it — the row `currentSif` would read back. */
function liveSif(tenantId: TenantId, tillId: TillId) {
  return admin.execute<{ nif: string; id_sistema_informatico: string; numero_instalacion: number }>(
    sql`select nif, id_sistema_informatico, numero_instalacion from registro_sif
        where tenant_id = ${tenantId} and till_id = ${tillId} and revocado_en is null`,
  );
}

describe("provisioning a till that bootstrap-tenant.sql created", () => {
  it("registers it under the tenant's own NIF, which is never an argument", async () => {
    const { tenantId, tillId, nif } = await bootstrapTenant();

    const registration = await provisionTill(admin, {
      tenantId,
      tillId,
      idSistemaInformatico: ID_SIF,
    });

    // `sif.nif` becomes `ObligadoEmision.NIF` on every registro this till ever files
    // (`backend.ts:475`). Reading it from the tenant row is what makes it impossible to provision a
    // till whose filings would name a different obligado than the tenant that owns it.
    expect(registration.nif).toBe(nif);
    expect(registration.numeroInstalacion).toBe(1);

    const live = await liveSif(tenantId, tillId);
    expect(live.rows).toEqual([{ nif, id_sistema_informatico: ID_SIF, numero_instalacion: 1 }]);
  });

  it("refuses a till belonging to a different tenant, and writes nothing", async () => {
    const mine = await bootstrapTenant();
    const theirs = await bootstrapTenant();

    // Checked explicitly against `tills.tenant_id` rather than left to RLS: `registro_sif` carries
    // separate foreign keys onto `tenants` and `tills` and no composite one, so this row satisfies
    // both — and provisioning is run by whoever holds DATABASE_URL, which for the very first till
    // of a deployment is a superuser, for whom RLS does not apply at all.
    await expect(
      provisionTill(admin, {
        tenantId: mine.tenantId,
        tillId: theirs.tillId,
        idSistemaInformatico: ID_SIF,
      }),
    ).rejects.toMatchObject({
      code: "server.provision_target_missing",
      params: { target: "till", id: theirs.tillId },
    });

    const written = await admin.execute(
      sql`select 1 from registro_sif where till_id = ${theirs.tillId}`,
    );
    expect(written.rows).toEqual([]);
  });

  it("refuses a tenant that does not exist", async () => {
    const { tillId } = await bootstrapTenant();

    await expect(
      provisionTill(admin, {
        tenantId: brandTenantId(ABSENT),
        tillId,
        idSistemaInformatico: ID_SIF,
      }),
    ).rejects.toMatchObject({
      code: "server.provision_target_missing",
      params: { target: "tenant", id: ABSENT },
    });
  });
});
