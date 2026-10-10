import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";

export interface OptionalDocumentDiagnostic {
  operation: "enqueueSaleReceipt" | "reserveStagedInvoiceDelivery";
  saleId: string;
  code: AppError["code"] | "receipt.document_failed";
  field?: "operatorId";
}

export function reportOptionalDocumentFailure(event: OptionalDocumentDiagnostic): void {
  console.warn("receipt.optional_document_failed", event);
}

/** Only a body failure whose savepoint was rolled back may be omitted; engine settlement failures escape. */
export async function optionalDocument<T>(
  tx: Transaction,
  operation: OptionalDocumentDiagnostic["operation"],
  saleId: string,
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
        operation,
        saleId,
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
