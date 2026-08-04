// Side-effect only: registers this package's `sale.*` codes on the shared `ErrorParams` registry
// by declaration merging. See ./errors.ts for why, and ./errors.reachability.test.ts for the
// mechanical check that keeps errors.ts reachable from this package's own public barrel
// (index.ts). Mirrors ./record-sale.ts's identical convention.
import "./errors.js";
import { eq } from "drizzle-orm";
import { isUniqueViolation, saleVoids, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { NodeId, SaleId, TenantId, TillId } from "@waitron/shared";
import type { FiscalBackend, FiscalRecordRef } from "@waitron/fiscal";
import { authorize, type Override } from "@waitron/identity";
import { recordIncident } from "./incidents.js";

/**
 * Voids a sale by asking the module for a NEW record that references it (spec §4, findings §7).
 *
 * Once chained, records are never edited. Voiding a sale is not an UPDATE on `sales` (which has no
 * UPDATE privilege at all — `packages/db/src/schema/sales.ts`) and not an UPDATE on anything this
 * package owns either: the generic-layer projection of "this sale was voided" is an APPENDED row
 * in `sale_voids`, and the module's own anulación is an APPENDED record in its own chain, taking
 * the next `secuencia` in generation order — not a reset, and not the position of the alta it
 * annuls (`FiscalBackend.recordVoid`'s own doc comment, `packages/fiscal/src/backend.ts`).
 *
 * The gate is INTRINSIC: this call itself demands `sale.void`, so a void cannot be performed
 * without a credential `authorize` accepts — either the session operator's own role holds the
 * permission, or a supervisor `override` (a second person's PIN) supplies it. `authorize` returns
 * the authorizing person, which is written to `sale_voids.voided_by` at insert. That column is on an
 * append-only table with no UPDATE grant, so the authorizer MUST be supplied here, at the append, and
 * can never be back-filled. `authorize` runs AFTER the sale-exists lookup (so a cross-tenant or
 * missing sale still returns `sale.not_found`, never an authz leak) and BEFORE any chain work, so a
 * rejected void consumes none.
 */
export async function recordVoid(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  reason: string,
  authz: { sessionId: string; override?: Override },
): Promise<{ fiscal: FiscalRecordRef }> {
  const [sale] = await tx
    .select({ tenantId: sales.tenantId, tillId: sales.tillId, nodeId: sales.nodeId })
    .from(sales)
    .where(eq(sales.id, saleId));

  if (sale === undefined) {
    // Also the cross-tenant case: RLS filters the row out, so a sale belonging to another tenant
    // is genuinely not found rather than forbidden — which is the right answer to leak. An
    // OPERATIONAL failure, not a fiscal one: there is nothing here to void, which is a different
    // condition from a chain that failed to verify, and NO FISCAL CONDITION BLOCKS a void does not
    // extend to it.
    throw new AppError("sale.not_found", { saleId });
  }

  // The gate. Placed after the sale is confirmed to exist (so a cross-tenant or missing sale still
  // returns sale.not_found above, not an authz leak) and before any chain work below, so a rejected
  // void consumes none. `authorization.authorizedBy` is the person to record on the append.
  const authorization = await authorize(tx, {
    sessionId: authz.sessionId,
    permission: "sale.void",
    override: authz.override,
  });

  // Art. 7.i, exactly as for an alta (spec §4 steps 1-2 in `./record-sale.ts`): the duty is
  // "before generating each new record", not "before each sale", and an anulación is a registro de
  // facturación like any other. Nothing branches on `verification.ok` — a failed check records an
  // incident (below) and the void proceeds anyway, because a staff member correcting the very sale
  // an incident concerns must never be blocked by it («NUNCA debe interrumpirse»).
  //
  // No clock-degradation incident here: unlike `recordSale`, `recordVoid` takes no `TrustedClock`
  // at all (its own `new Date()` a few lines down is not a `TrustedReading`), so there is no
  // `.warning` to forward.
  const verification = await backend.checkIntegrity(
    tx,
    sale.tenantId as TenantId,
    sale.nodeId as NodeId,
  );
  // ONE incident aggregating all of this call's issues, never one per issue — the table-wide
  // `incidents_open_dedup` index holds at most one open incident per (tenant, till, code, sale), so
  // one row per issue (all sharing this sale + `chain.verification_failed`) would collapse to a
  // single row and drop every issue after the first. `params.issues` carries them all. Mirrors
  // `./record-sale.ts`'s identical aggregation.
  const pending =
    verification.issues.length > 0
      ? [
          {
            error: new AppError("chain.verification_failed", {
              tillId: sale.tillId,
              issues: verification.issues.map((issue) => ({
                issueCode: issue.code,
                recordId: issue.recordId ?? null,
                issueParams: issue.params,
              })),
            }),
            severity: "error" as const,
          },
        ]
      : [];

  // No number is allocated. The anulación carries the ANNULLED invoice's own identity
  // (IDFacturaAnulada), not an identity of its own — allocating here would burn a number for a
  // record with nowhere to put it, leaving a permanent series gap per void.

  // One reading, reused for both the void's own timestamp and any incident detected alongside it —
  // the same "one clock reading for the whole transaction" discipline `./record-sale.ts` follows,
  // applied here to a plain `Date` since this path carries no `TrustedClock`.
  const now = new Date();

  for (const incident of pending) {
    await recordIncident(tx, {
      tenantId: sale.tenantId as TenantId,
      tillId: sale.tillId as TillId,
      saleId,
      detectedAt: now,
      ...incident,
    });
  }

  // Append-only, and this runs BEFORE the module is asked for a record. The UNIQUE constraint on
  // sale_id — not this insert's success — is what makes double-voiding impossible: two concurrent
  // transactions both pass a SELECT-then-INSERT check, and only one passes this. Ordering it before
  // `backend.recordVoid` is what keeps a rejected second void from having consumed any chain work
  // at all — lock order stays chain-then-everything-else, matching `./record-sale.ts`.
  try {
    await tx.insert(saleVoids).values({
      tenantId: sale.tenantId,
      saleId,
      reason,
      voidedAt: now.toISOString(),
      // The seam, now filled: recorded at INSERT because `sale_voids` is append-only (no UPDATE
      // grant), so there is no later moment to attribute the void.
      voidedBy: authorization.authorizedBy,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A translation, not a recovery: the transaction is already aborted by Postgres and must
      // roll back. Catching here only ensures the caller gets a structured code instead of a raw
      // driver error string on screen.
      throw new AppError("sale.already_voided", { saleId });
    }
    throw error;
  }

  // The module already holds the annulled invoice's identity in its own registro, keyed by
  // sale_id. Passing NumSerieFactura/FechaExpedicionFactura back through here would put a fiscal
  // fact in the generic layer and give it two sources of truth.
  const fiscal = await backend.recordVoid(tx, saleId, reason);

  return { fiscal };
}
