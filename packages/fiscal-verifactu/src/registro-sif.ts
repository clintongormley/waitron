// Side-effect only: registers this package's `sif.*` code on the shared `ErrorParams` registry by
// declaration merging. See ./errors.ts for the code and the reasoning, and
// ./errors.reachability.test.ts for the mechanical check that keeps errors.ts reachable from this
// package's own public barrel (index.ts). Mirrors packages/db/src/allocate-number.ts's identical
// convention of importing from the file that documents the code a module throws.
import "./errors.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { TenantId, TillId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { cadenas } from "./schema/cadenas.js";
import { contadoresInstalacion, registroSif } from "./schema/sif.js";

export interface RegisterSifParams {
  tenantId: TenantId;
  tillId: TillId;
  /** The obligado tributario's NIF. Half of the SIF identity, with IdSIF and NºInstalación. */
  nif: string;
  idSistemaInformatico: string;
}

export interface SifRegistration {
  id: string;
  tenantId: TenantId;
  tillId: TillId;
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
 * "postgres")` gate). This package does have real-Postgres suites — they reach a container through
 * `@waitron/db/testing/postgres.js` — but none of them exercises THIS function's concurrent case
 * directly; it is covered structurally instead, by using the exact same single-statement
 * shape `allocate-number.ts` uses, proven under real contention there.
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
 * Register a till, or re-register a reimaged one. Always mints a fresh number.
 *
 * Re-registration is IMPLICIT rather than gated behind an `allowReRegistration` flag. A wiped till
 * has no local state to distinguish itself with, so it cannot pass such a flag truthfully, and
 * upstream cannot tell a reimaged till from a mistakenly-duplicated one. Since minting a fresh
 * number is always safe and reusing one never is, the safe branch is the only branch — which is
 * what "correct by construction" means here. A flag would move the decision to a caller who does
 * not have the information to make it.
 *
 * Runs against the upstream node's database, where `contadores_instalacion`'s single writer
 * lives — this is the concrete meaning of "a till cannot be provisioned offline" (spec's stated
 * limitation, not an oversight): provisioning is an admin action performed once, not a
 * mid-service event, so requiring connectivity for it costs nothing a restaurant will ever
 * notice, and nothing here weakens spec §4 — an already-registered till still sells indefinitely
 * offline.
 */
export async function registerSif(
  tx: Transaction,
  params: RegisterSifParams,
): Promise<SifRegistration> {
  // Retire any live identity for this till first, so the partial unique index
  // (registro_sif_activo_uq) has room for the new one. The old row is never updated beyond this
  // timestamp: its registros are immutable and must keep pointing at the identity that actually
  // generated them.
  await tx
    .update(registroSif)
    .set({ revocadoEn: sql`now()` })
    .where(
      and(
        eq(registroSif.tenantId, params.tenantId),
        eq(registroSif.tillId, params.tillId),
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
      tillId: params.tillId,
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

  // A new installation number is a new SIF identity, therefore a NEW CHAIN (findings §1). Break
  // the pointer. `secuencia` is deliberately untouched by leaving it out of the SET clause: it is
  // OUR ordering aid for the outbox, never AEAT's, and resetting it would collide with
  // UNIQUE (tenant_id, till_id, secuencia) on the very next append.
  await tx
    .insert(cadenas)
    .values({ tenantId: params.tenantId, tillId: params.tillId })
    .onConflictDoUpdate({
      target: [cadenas.tenantId, cadenas.tillId],
      set: { ultimoRegistroId: null, ultimaHuella: null, actualizadoEn: sql`now()` },
    });

  return {
    id: inserted.id,
    tenantId: params.tenantId,
    tillId: params.tillId,
    nif: params.nif,
    idSistemaInformatico: params.idSistemaInformatico,
    numeroInstalacion,
    registradoEn: inserted.registradoEn,
    revocadoEn: null,
  };
}

/**
 * The till's live SIF identity. Throws `sif.not_registered` rather than returning null — every
 * caller needs one, and the concrete encoding of "a till cannot be provisioned offline": an
 * unprovisioned till gets a structured refusal that reaches a screen translatable, never a
 * locally invented number.
 */
export async function currentSif(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
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
        eq(registroSif.tillId, tillId),
        isNull(registroSif.revocadoEn),
      ),
    )
    .limit(1);

  if (row === undefined) {
    throw new AppError("sif.not_registered", { tenantId, tillId });
  }

  return { ...row, tenantId, tillId };
}

/**
 * Whether the next record on this till's chain carries `PrimerRegistro="S"`.
 *
 * DERIVED from local state — the till's own chain being empty — never from a flag anyone sets.
 * AEAT returns a non-rejecting warning when it is claimed and records already exist for that
 * SIF+NIF; that warning is a useful re-provisioning signal only because this value reports what
 * the database holds rather than what a caller believes. No chain row at all is also a first
 * record — a till registered but never sold — and a chain row whose pointer was just reset by
 * `registerSif` reports the same thing, which is the point: re-registration begins a new chain.
 */
export async function esPrimerRegistro(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
): Promise<boolean> {
  const [row] = await tx
    .select({ ultimaHuella: cadenas.ultimaHuella })
    .from(cadenas)
    .where(and(eq(cadenas.tenantId, tenantId), eq(cadenas.tillId, tillId)))
    .limit(1);

  return (row?.ultimaHuella ?? null) === null;
}
