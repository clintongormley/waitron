// Side-effect only: registers this package's error codes (./errors.ts).
import "./errors.js";
import { eq } from "drizzle-orm";
import { isUniqueViolation, saleVoids, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { NodeId, SaleId, TillId } from "@waitron/shared";
import type { FiscalBackend, FiscalRecordRef } from "@waitron/fiscal";
import { authorize, type AuthzInput } from "@waitron/identity";
import { recordIncident } from "./incidents.js";

/**
 * Voids a sale by appending, never by editing: a `sale_voids` row here, then the module's own
 * record through `backend.recordVoid`. `sales` and `sale_voids` are both append-only.
 *
 * The gate is intrinsic: this call demands `sale.void` itself, from the session operator's role or
 * a supervisor `override`, and the authorizer is written to `sale_voids.voided_by` at insert, the
 * only moment it can be recorded. It runs after the sale lookup, so a missing sale is
 * `sale.not_found` rather than an authorization error, and before any fiscal work.
 */
export async function recordVoid(
  tx: Transaction,
  backend: FiscalBackend,
  saleId: SaleId,
  reason: string,
  authz: AuthzInput,
): Promise<{ fiscal: FiscalRecordRef }> {
  const [sale] = await tx
    .select({ tillId: sales.tillId, nodeId: sales.nodeId })
    .from(sales)
    .where(eq(sales.id, saleId));

  if (sale === undefined) {
    throw new AppError("sale.not_found", { saleId });
  }

  const authorization = await authorize(tx, {
    sessionId: authz.sessionId,
    permission: "sale.void",
    override: authz.override,
  });

  // Verification runs before every new record, and an annulment is one. Nothing branches on
  // `verification.ok`: a failed check records an incident and the void proceeds anyway.
  //
  // No clock-degradation incident: this path takes no `TrustedClock`.
  const verification = await backend.checkIntegrity(tx, sale.nodeId as NodeId);
  // One incident per failed check, carrying every issue in `params.issues`.
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

  // No number is allocated. The annulment carries the ANNULLED invoice's own identity
  // (`IDFacturaAnulada`), not an identity of its own — allocating here would burn a number for a
  // record with nowhere to put it, leaving a permanent series gap per void.

  const now = new Date();

  for (const incident of pending) {
    await recordIncident(tx, {
      tillId: sale.tillId as TillId,
      saleId,
      detectedAt: now,
      ...incident,
    });
  }

  // The unique `sale_voids.sale_id` is what refuses a second void. Inserted before
  // `backend.recordVoid`, so a refused void writes no fiscal record.
  try {
    await tx.insert(saleVoids).values({
      saleId,
      reason,
      voidedAt: now.toISOString(),
      voidedBy: authorization.authorizedBy,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("sale.already_voided", { saleId });
    }
    throw error;
  }

  // Only the sale id: a fiscal identity passed through here would give that fact a second source
  // of truth in the generic layer.
  const fiscal = await backend.recordVoid(tx, saleId, reason);

  return { fiscal };
}
