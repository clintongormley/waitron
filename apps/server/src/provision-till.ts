// Registers a till as a Veri*Factu SIF — the one provisioning step between `sql/bootstrap-tenant.sql`
// and a till that can actually sell.
//
// `VerifactuBackend.recordSale` reads the till's identity through `currentSif`, which throws
// `sif.not_registered` when no live `registro_sif` row exists, so a till created by the bootstrap
// SQL cannot record anything until this runs. `registerSif` has existed and been exported since the
// chain was built; until this module there was no production caller anywhere, only tests.
//
// This lives in `src/`, not beside its CLI in `scripts/`, because provisioning a till is behaviour
// this host owns rather than build tooling — `vitest.config.ts` excludes `scripts/**` from coverage
// on exactly that distinction. `scripts/register-till.ts` is the thin argv/stdout shim over it.
//
// Deliberately NOT raw SQL: `registerSif` mints the installation number through
// `contadores_instalacion`'s single-statement allocator (proven under 20 concurrent writers in
// `chain.concurrency.test.ts`) and resets the chain head, because a new installation number is a
// new SIF identity and therefore a new chain. A hand-written INSERT produces a row that looks right
// and chains wrong.
import { sql } from "drizzle-orm";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { registerSif } from "@waitron/fiscal-verifactu";
import type { SifRegistration } from "@waitron/fiscal-verifactu";
import { AppError } from "@waitron/shared";
import type { TenantId, TillId } from "@waitron/shared";
import "./errors.js";

export interface ProvisionTillParams {
  tenantId: TenantId;
  tillId: TillId;
  /** Waitron's own AEAT-registered software identifier. Opaque here: half of the (NIF,
   * IdSistemaInformatico) key `registerSif`'s installation counter is scoped by. */
  idSistemaInformatico: string;
}

/**
 * The obligado tributario's NIF, read from the tenant that owns the till.
 *
 * NOT an argument, unlike every fixture that calls `registerSif` (those mint the tenant in the same
 * breath and already hold its NIF). This value becomes `ObligadoEmision.NIF` and `IDEmisorFactura`
 * on every registro the till ever files, so an operator-supplied one is a way to file a real tenant's
 * sales under someone else's NIF with nothing in the database disagreeing. The certificate makes the
 * same distinction the other way round: it identifies a natural person as *representante*, and the
 * filing is still the company's.
 */
async function obligadoNif(tx: Transaction, tenantId: TenantId): Promise<string> {
  const found = await tx.execute<{ nif: string }>(
    sql`select nif from tenants where id = ${tenantId}`,
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new AppError("server.provision_target_missing", { target: "tenant", id: tenantId });
  }
  return row.nif;
}

/**
 * Refuses a till this tenant does not own.
 *
 * `registro_sif` carries separate foreign keys onto `tenants` and `tills` and no composite one, so a
 * row naming tenant A and a till of tenant B satisfies both — and RLS's WITH CHECK only constrains
 * the `tenant_id` column, which such a row gets right. Checking `tills.tenant_id` explicitly rather
 * than leaning on RLS to hide the foreign row is what makes this hold for a superuser too, and the
 * first till of a deployment is provisioned by whoever just ran the bootstrap SQL — a superuser by
 * that file's own instructions.
 */
async function assertTillBelongsToTenant(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
): Promise<void> {
  const found = await tx.execute<{ tenant_id: string }>(
    sql`select tenant_id from tills where id = ${tillId}`,
  );
  const row = found.rows[0];
  if (row === undefined || row.tenant_id !== tenantId) {
    throw new AppError("server.provision_target_missing", { target: "till", id: tillId });
  }
}

/**
 * Registers `tillId` as a SIF of `tenantId` and returns the identity it minted.
 *
 * One transaction: a registration that validated its target and then failed to write, or wrote
 * without resetting the chain head, would leave a till that looks provisioned and chains from a
 * previous identity's huella.
 *
 * Re-running this against an already-registered till is meaningful, not an error — `registerSif`
 * revokes the live identity, mints a fresh installation number and starts a new chain, which is what
 * a reimaged till needs. The caller decides; nothing here guards against it.
 */
export function provisionTill(db: Database, params: ProvisionTillParams): Promise<SifRegistration> {
  return withTenant(db, params.tenantId, async (tx) => {
    const nif = await obligadoNif(tx, params.tenantId);
    await assertTillBelongsToTenant(tx, params.tenantId, params.tillId);

    return registerSif(tx, {
      tenantId: params.tenantId,
      tillId: params.tillId,
      nif,
      idSistemaInformatico: params.idSistemaInformatico,
    });
  });
}
