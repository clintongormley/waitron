// Side-effect only: registers this package's `sif.*` codes on the shared `ErrorParams` registry by
// declaration merging. See ./errors.ts for the code and the reasoning, and
// ./errors.reachability.test.ts for the mechanical check that keeps errors.ts reachable from this
// package's own public barrel (index.ts). Mirrors packages/db/src/allocate-number.ts's identical
// convention of importing from the file that documents the code a module throws.
import "./errors.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { NodeId, TenantId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { cadenas } from "./schema/cadenas.js";
import { contadoresInstalacion, registroSif } from "./schema/sif.js";

/**
 * AEAT caps `IdSistemaInformatico` at two characters (`packages/verifactu`'s `ID_SISTEMA_LENGTH`).
 *
 * Exported because the rule is defined once for the whole package: `registro_sif` carries no CHECK
 * on the column, so the bound is applied in code. Both LOCAL write primitives apply it —
 * `registerSif` and `writeReservedSif` below each open with `assertUsableIdSistema` — so no caller
 * of either can put an unusable id into the column. `./provisioning.ts`'s `parseReservedState`
 * applies the same bound EARLIER on the wire path, reporting `sif.reservation_invalid` for a
 * malformed bundle before `writeReservedSif` is reached. The sync APPLY lane is the one write into
 * the column that reaches neither primitive: `registro_sif` is enrolled as a watermark-upsert
 * (./enrolment.ts), so a replica copies the value the primary already validated, verbatim.
 */
export const ID_SISTEMA_MAX_LENGTH = 2;

/**
 * The database does not enforce this: `registro_sif` carries no CHECK on the column, and every
 * registro copies the value onto a record that can only be superseded by re-registering onto a
 * fresh chain. So it is checked HERE, before the registration writes anything.
 */
function assertUsableIdSistema(value: string): void {
  if (value.length === 0 || value.length > ID_SISTEMA_MAX_LENGTH) {
    throw new AppError("sif.id_sistema_invalid", { value, maxLength: ID_SISTEMA_MAX_LENGTH });
  }
}

export interface RegisterSifParams {
  tenantId: TenantId;
  nodeId: NodeId;
  /** The obligado tributario's NIF. Half of the SIF identity, with IdSIF and NºInstalación. */
  nif: string;
  idSistemaInformatico: string;
}

export interface SifRegistration {
  id: string;
  tenantId: TenantId;
  nodeId: NodeId;
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: number;
  registradoEn: Date;
  revocadoEn: Date | null;
}

/**
 * Allocates the next installation number for (NIF, IdSIF) — the upstream node's counter.
 *
 * `insert … on conflict … do update … returning` is a single statement, so the row lock is taken
 * and released by Postgres without a read-then-write window for a second registration to slip
 * into. Reproduces `allocateInvoiceNumber`'s locking approach (packages/db/src/allocate-number.ts,
 * Task 6) for the same reason: at READ COMMITTED, a second concurrent allocator blocks on the row
 * lock and, once the first commits, re-evaluates `proximo_numero + 1` against the FIRST
 * allocator's committed value rather than proceeding from its own stale snapshot — which is
 * exactly the guarantee a read-then-write cannot make.
 *
 * The UNIQUE index `registro_sif_instalacion_uq` on `registro_sif` (nif, id_sistema_informatico,
 * numero_instalacion) remains the actual never-reused guarantee — this is the allocator, not the
 * guard. That distinction matters because a manual INSERT, a data-fix script, or a second,
 * differently-written implementation of this function all bypass the allocator, and none of them
 * bypass the index.
 *
 * PGlite cannot exercise the concurrent-contention case at all: every query against one PGlite
 * instance serialises onto a single backend, so a naive read-then-write implementation would pass
 * there by accident (see allocate-number.test.ts's identical `it.runIf(target.name ===
 * "postgres")` gate). It is covered on real PostgreSQL instead, and directly:
 * `chain.concurrency.test.ts`'s "registerSif's installation-number counter under real contention"
 * fires 20 concurrent registrations across 20 distinct nodes of one obligado and asserts they mint
 * 1..20 exactly once each. That suite runs on a clone of the shared container's `manifest`
 * template (`src/testing/global-setup.ts`), like every other real-Postgres suite in this package.
 */
async function mintNumeroInstalacion(
  tx: Transaction,
  nif: string,
  idSistemaInformatico: string,
): Promise<number> {
  const [row] = await tx
    .insert(contadoresInstalacion)
    .values({ nif, idSistemaInformatico, proximoNumero: 2 })
    .onConflictDoUpdate({
      target: [contadoresInstalacion.nif, contadoresInstalacion.idSistemaInformatico],
      set: { proximoNumero: sql`${contadoresInstalacion.proximoNumero} + 1` },
    })
    .returning({ proximoNumero: contadoresInstalacion.proximoNumero });

  // `INSERT ... ON CONFLICT ... DO UPDATE` always inserts or updates exactly one row and always
  // returns it — unlike allocate-number.ts's plain UPDATE, there is no "no such row" case here to
  // report as a domain error. Guarded only so `row.proximoNumero` type-checks without a cast.
  /* v8 ignore start */
  if (row === undefined) {
    throw new Error("contadores_instalacion: mint returned no row");
  }
  /* v8 ignore stop */

  // RETURNING yields the row AFTER the increment, so the number this caller may use is the one
  // before it.
  return row.proximoNumero - 1;
}

/**
 * Reserve — but do not register — the next installation number for (NIF, IdSIF). The single-writer
 * counter bump `registerSif` performs, exposed on its own so the PRIMARY can allocate a standby's
 * number and hand it down in the adopt bundle (design §4: the primary is the sole allocator per NIF;
 * a standby's DB is a copy and must never mint). The standby persists the returned number via
 * `writeReservedSif` on ITS database — it never touches `contadores_instalacion`. Returns the number
 * the caller may use (the pre-increment value); the counter is advanced and the number is permanently
 * consumed (a never-promoted standby simply burns one cheap sequential number — gaps are permitted,
 * design §7).
 */
export function reserveInstallationNumber(
  tx: Transaction,
  params: { nif: string; idSistemaInformatico: string },
): Promise<number> {
  return mintNumeroInstalacion(tx, params.nif, params.idSistemaInformatico);
}

/**
 * Reset a node's `cadenas` head to a fresh, empty chain — a distinct chain, never a resume of
 * anyone's (findings §1; CLAUDE.md §5). Upserts the (tenant, node) row to a both-null pointer
 * (`ultimoRegistroId`/`ultimaHuella`), so the next append is treated as the chain's first record.
 * `secuencia` is deliberately left OUT of the SET clause: it is OUR outbox ordering aid, never
 * AEAT's, and resetting it would collide with UNIQUE (tenant_id, node_id, secuencia) on the very
 * next append.
 *
 * Shared verbatim by `registerSif` (a new installation number is a new SIF identity, hence a new
 * chain) and `writeReservedSif` (a reserved node is brand-new, with no prior identity to retire).
 */
function resetChainHead(tx: Transaction, tenantId: TenantId, nodeId: NodeId): Promise<unknown> {
  return tx
    .insert(cadenas)
    .values({ tenantId, nodeId })
    .onConflictDoUpdate({
      target: [cadenas.tenantId, cadenas.nodeId],
      set: { ultimoRegistroId: null, ultimaHuella: null, actualizadoEn: sql`now()` },
    });
}

/**
 * Persist a DORMANT reserved SIF on a standby's own database (design §6 R2), keyed to the standby's
 * OWN nodeId with the number the PRIMARY allocated (`numeroInstalacion`) — NOT re-allocated here. It
 * is inert because no sale resolves this node (`config.till.nodeId` stays the primary's until a
 * promotion), and `currentSif` gates on `(tenant, node)`. A fresh empty `cadenas` head (both-null
 * pointer) makes it a brand-new chain, never a resume of anyone's (CLAUDE.md §5). No prior identity to
 * retire — a reserved node is new. The `registro_sif_instalacion_uq` unique on
 * (nif, id_sistema_informatico, numero_instalacion) is the never-reuse backstop; a duplicate number
 * raises 23505.
 *
 * Opens with `assertUsableIdSistema`, exactly as `registerSif` does: this is the OTHER write path
 * into `registro_sif.id_sistema_informatico`, the column carries no CHECK, and applying the bound in
 * both primitives is what makes it an invariant no caller can skip.
 */
export async function writeReservedSif(
  tx: Transaction,
  params: {
    tenantId: TenantId;
    nodeId: NodeId;
    nif: string;
    idSistemaInformatico: string;
    numeroInstalacion: number;
  },
): Promise<{ id: string }> {
  assertUsableIdSistema(params.idSistemaInformatico);

  const [inserted] = await tx
    .insert(registroSif)
    .values({
      tenantId: params.tenantId,
      nodeId: params.nodeId,
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      numeroInstalacion: params.numeroInstalacion,
    })
    .returning({ id: registroSif.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("registro_sif: reserved insert returned no row");
  }
  /* v8 ignore stop */

  await resetChainHead(tx, params.tenantId, params.nodeId);

  return { id: inserted.id };
}

/**
 * Register a node, or re-register a reimaged one. Always mints a fresh number.
 *
 * Re-registration is IMPLICIT rather than gated behind an `allowReRegistration` flag. A wiped node
 * has no local state to distinguish itself with, so it cannot pass such a flag truthfully, and
 * upstream cannot tell a reimaged node from a mistakenly-duplicated one. Since minting a fresh
 * number is always safe and reusing one never is, the safe branch is the only branch — which is
 * what "correct by construction" means here. A flag would move the decision to a caller who does
 * not have the information to make it. (Node-id rekey, 2026-08-03: the SIF is the node — #33 — so
 * this registers a node rather than a till.)
 *
 * Runs against the upstream node's database, where `contadores_instalacion`'s single writer
 * lives — this is the concrete meaning of "a node cannot be provisioned offline" (spec's stated
 * limitation, not an oversight): provisioning is an admin action performed once, not a
 * mid-service event, so requiring connectivity for it costs nothing a restaurant will ever
 * notice, and nothing here weakens spec §4 — an already-registered node still sells indefinitely
 * offline.
 */
export async function registerSif(
  tx: Transaction,
  params: RegisterSifParams,
): Promise<SifRegistration> {
  assertUsableIdSistema(params.idSistemaInformatico);

  // Retire any live identity for this node first, so the partial unique index
  // (registro_sif_activo_uq) has room for the new one. The old row is never updated beyond this
  // timestamp: its registros are immutable and must keep pointing at the identity that actually
  // generated them.
  await tx
    .update(registroSif)
    .set({ revocadoEn: sql`now()` })
    .where(
      and(
        eq(registroSif.tenantId, params.tenantId),
        eq(registroSif.nodeId, params.nodeId),
        isNull(registroSif.revocadoEn),
      ),
    );

  const numeroInstalacion = await mintNumeroInstalacion(
    tx,
    params.nif,
    params.idSistemaInformatico,
  );

  const [inserted] = await tx
    .insert(registroSif)
    .values({
      tenantId: params.tenantId,
      nodeId: params.nodeId,
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      numeroInstalacion,
    })
    .returning({ id: registroSif.id, registradoEn: registroSif.registradoEn });

  // Always exactly one row: this INSERT carries no WHERE clause and RLS's WITH CHECK, not its
  // USING clause, governs an insert — a mismatched app.tenant_id fails the check with an error,
  // it does not silently insert zero rows the way a filtered UPDATE/SELECT would.
  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("registro_sif: insert returned no row");
  }
  /* v8 ignore stop */

  // A new installation number is a new SIF identity, therefore a NEW CHAIN (findings §1).
  await resetChainHead(tx, params.tenantId, params.nodeId);

  return {
    id: inserted.id,
    tenantId: params.tenantId,
    nodeId: params.nodeId,
    nif: params.nif,
    idSistemaInformatico: params.idSistemaInformatico,
    numeroInstalacion,
    registradoEn: inserted.registradoEn,
    revocadoEn: null,
  };
}

/**
 * The node's live SIF identity. Throws `sif.not_registered` rather than returning null — every
 * caller needs one, and the concrete encoding of "a node cannot be provisioned offline": an
 * unprovisioned node gets a structured refusal that reaches a screen translatable, never a
 * locally invented number. (Node-id rekey, 2026-08-03: keyed per node.)
 */
export async function currentSif(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<SifRegistration> {
  const [row] = await tx
    .select({
      id: registroSif.id,
      nif: registroSif.nif,
      idSistemaInformatico: registroSif.idSistemaInformatico,
      numeroInstalacion: registroSif.numeroInstalacion,
      registradoEn: registroSif.registradoEn,
      revocadoEn: registroSif.revocadoEn,
    })
    .from(registroSif)
    .where(
      and(
        eq(registroSif.tenantId, tenantId),
        eq(registroSif.nodeId, nodeId),
        isNull(registroSif.revocadoEn),
      ),
    )
    .limit(1);

  if (row === undefined) {
    throw new AppError("sif.not_registered", { tenantId, nodeId });
  }

  return { ...row, tenantId, nodeId };
}

/**
 * Whether the next record on this node's chain carries `PrimerRegistro="S"`.
 *
 * DERIVED from local state — the node's own chain being empty — never from a flag anyone sets.
 * AEAT returns a non-rejecting warning when it is claimed and records already exist for that
 * SIF+NIF; that warning is a useful re-provisioning signal only because this value reports what
 * the database holds rather than what a caller believes. No chain row at all is also a first
 * record — a node registered but never sold — and a chain row whose pointer was just reset by
 * `registerSif` reports the same thing, which is the point: re-registration begins a new chain.
 */
export async function esPrimerRegistro(
  tx: Transaction,
  tenantId: TenantId,
  nodeId: NodeId,
): Promise<boolean> {
  const [row] = await tx
    .select({ ultimaHuella: cadenas.ultimaHuella })
    .from(cadenas)
    .where(and(eq(cadenas.tenantId, tenantId), eq(cadenas.nodeId, nodeId)))
    .limit(1);

  return (row?.ultimaHuella ?? null) === null;
}
