import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";

type SaleDocument =
  | "enqueueSaleReceipt"
  | "enqueueCorrectiveReceipt"
  | "reserveStagedInvoiceDelivery"
  | "refreshWaitingOriginal";

/** A payment slip can come before the sale exists, so it names the order. */
export type OptionalDocumentDiagnostic = (
  | { operation: SaleDocument; saleId: string }
  | { operation: "enqueueRequestedPaymentSlip"; workingOrderId: string }
) & {
  code: AppError["code"] | "receipt.document_failed";
  field?: "operatorId";
};

export function reportOptionalDocumentFailure(event: OptionalDocumentDiagnostic): void {
  console.warn("receipt.optional_document_failed", event);
}

/**
 * Only a body failure whose savepoint was rolled back may be omitted; when the engine ended the
 * transaction the store throws a different error, and that one escapes.
 */
export async function optionalDocument<T>(
  tx: Transaction,
  operation: OptionalDocumentDiagnostic["operation"],
  id: string,
  body: () => Promise<T>,
): Promise<T | undefined> {
  let failed = false;
  let bodyError: unknown;
  try {
    return await tx.transaction(async () => {
      try {
        return await body();
      } catch (error) {
        failed = true;
        bodyError = error;
        throw error;
      }
    });
  } catch (error) {
    if (!failed || error !== bodyError) throw error;
    try {
      reportOptionalDocumentFailure({
        ...(operation === "enqueueRequestedPaymentSlip"
          ? { operation, workingOrderId: id }
          : { operation, saleId: id }),
        code: error instanceof AppError ? error.code : "receipt.document_failed",
        ...(error instanceof AppError &&
        error.code === "management.request_invalid" &&
        error.params.field === "operatorId"
          ? { field: "operatorId" as const }
          : {}),
      });
    } catch {
      // Reporting must not turn a rolled-back optional document into a sale failure.
    }
    return undefined;
  }
}
