// Registers a NODE as a Veri*Factu SIF, so it can actually sell (node-id rekey, 2026-08-03: the SIF
// is the compute node, #33, so provisioning registers a node, not a till). The file name is kept
// `provision-till.ts`; a first-class `provision node` CLI rename is the deferred follow-up the
// node-rekey design (§8/§10) leaves out of scope.
//
// `waitron-provision venue` now registers a node's SIF as part of standing a venue up (2026-08-04,
// retiring `sql/bootstrap-tenant.sql`), so this module is the STANDALONE registration path — a node
// with no `registro_sif` row, or a reimaged node getting a fresh chain.
//
// `VerifactuBackend.recordSale` reads the node's identity through `currentSif`, which throws
// `sif.not_registered` when no live `registro_sif` row exists, so a node with no SIF cannot record
// anything until this runs. `registerSif` has existed and been exported since the chain was built;
// until this module there was no production caller anywhere, only tests.
//
// This lives in `src/`, not beside its CLI in `scripts/`, because `vitest.config.ts` excludes
// `scripts/**` from coverage as build tooling and provisioning a node is behaviour this host owns.
// `scripts/register-till.ts` is the argv/stdout shim over it.
//
// Deliberately NOT raw SQL: `registerSif` mints the installation number through
// `contadores_instalacion`'s single-statement allocator (proven under 20 concurrent writers in
// `chain.concurrency.test.ts`) and resets the chain head, because a new installation number is a
// new SIF identity and therefore a new chain. A hand-written INSERT produces a row that looks right
// and chains wrong.
import { and, eq } from "drizzle-orm";
import { nodes, tenants, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { registerSif } from "@waitron/fiscal-verifactu";
import type { SifRegistration } from "@waitron/fiscal-verifactu";
import { AppError } from "@waitron/shared";
import type { NodeId, TenantId } from "@waitron/shared";
import "./errors.js";

export interface ProvisionNodeParams {
  tenantId: TenantId;
  nodeId: NodeId;
  /** Waitron's own AEAT-registered software identifier, at most `ID_SISTEMA_MAX_LENGTH` characters.
   * Half of the (NIF, IdSistemaInformatico) key `registerSif`'s installation counter is scoped by. */
  idSistemaInformatico: string;
}

/** `packages/verifactu`'s `validate` rule `ID_SISTEMA_LENGTH`, duplicated because that validator has
 * no caller on the production path — see `sif.id_sistema_invalid`. */
const ID_SISTEMA_MAX_LENGTH = 2;

/**
 * Rejects an unusable `IdSistemaInformatico` before anything is written.
 *
 * The only moment a human types this value, and the last moment it is correctable: `registerSif`
 * copies it into `registro_sif`, and from there `buildSistemaInformatico` puts it on every registro
 * the till files. Nothing downstream re-checks it — not `registerSif` (a bare `string` parameter),
 * not the schema (no CHECK on the column), and not `validate`, which nothing in the production path
 * calls.
 */
function assertUsableIdSistema(value: string): void {
  if (value.length === 0 || value.length > ID_SISTEMA_MAX_LENGTH) {
    throw new AppError("sif.id_sistema_invalid", { value, maxLength: ID_SISTEMA_MAX_LENGTH });
  }
}

/**
 * The obligado tributario's NIF, read from the tenant that owns the till. Since the country + tax_id
 * reshape it is read from `tenants.tax_id` (the column that used to be `nif`); for an ES tenant that
 * column IS the NIF, so the value and this function's meaning are unchanged.
 *
 * NOT an argument, unlike every fixture that calls `registerSif` (those mint the tenant in the same
 * breath and already hold its NIF). It is written to `registro_sif.nif`, from where it reaches
 * `registros_facturacion.id_emisor_factura` and, through that, `ObligadoEmision.NIF` on every
 * registro the till ever files (`drain.ts`/`reconcile.ts` build that element; `backend.ts`'s
 * `buildSistemaInformatico` separately uses the same value for the SOFTWARE producer's NIF, which
 * is its own open question — see the compliance record). So an operator-supplied NIF is a way to
 * file a real tenant's sales under someone else's, with nothing in the database disagreeing. The
 * certificate makes the same distinction the other way round: it identifies a natural person as
 * *representante*, and the filing is still the company's.
 *
 * `registerSif` still takes `nif` as a parameter, so this invariant holds for this caller and not
 * for the function itself — see the follow-up recorded in the plan.
 */
async function obligadoNif(tx: Transaction, tenantId: TenantId): Promise<string> {
  const [row] = await tx
    .select({ taxId: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (row === undefined) {
    throw new AppError("tenant.not_found", { id: tenantId });
  }
  return row.taxId;
}

/**
 * Refuses a node this tenant does not own.
 *
 * `registro_sif` carries separate foreign keys onto `tenants` and `nodes` and no composite one, so
 * a row naming tenant A and a node of tenant B satisfies both — and RLS's WITH CHECK only
 * constrains the `tenant_id` column, which such a row gets right. Matching on `nodes.tenant_id`
 * explicitly rather than leaning on RLS to hide the foreign row is what makes this hold for a
 * superuser too, and the first node of a deployment is provisioned by whoever just ran the
 * bootstrap SQL — a superuser by that file's own instructions.
 *
 * The predicate is `record-sale.ts`'s, which checks the same ownership the same way.
 */
async function assertNodeBelongsToTenant(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<void> {
  const [row] = await tx
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.tenantId, tenantId)));
  if (row === undefined) {
    throw new AppError("node.not_found", { id: nodeId, tenantId });
  }
}

/**
 * Registers `nodeId` as a SIF of `tenantId` and returns the identity it minted.
 *
 * One transaction: a registration that validated its target and then failed to write, or wrote
 * without resetting the chain head, would leave a node that looks provisioned and chains from a
 * previous identity's huella.
 *
 * Re-running this against an already-registered node is meaningful, not an error — `registerSif`
 * revokes the live identity, mints a fresh installation number and starts a new chain, which is
 * what a reimaged node needs. The caller decides; nothing here guards against it.
 *
 * `async` rather than returning `withTenant`'s promise directly: the argument check below runs
 * before any transaction is opened, and a function whose type says `Promise` must not throw
 * synchronously — a caller holding it as `provisionNode(…).catch(…)` would never see the rejection.
 */
export async function provisionNode(
  db: Database,
  params: ProvisionNodeParams,
): Promise<SifRegistration> {
  assertUsableIdSistema(params.idSistemaInformatico);

  return withTenant(db, params.tenantId, async (tx) => {
    const nif = await obligadoNif(tx, params.tenantId);
    await assertNodeBelongsToTenant(tx, params.tenantId, params.nodeId);

    return registerSif(tx, {
      tenantId: params.tenantId,
      nodeId: params.nodeId,
      nif,
      idSistemaInformatico: params.idSistemaInformatico,
    });
  });
}
