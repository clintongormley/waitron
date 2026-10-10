import type { Transaction } from "@waitron/db";
import { AppError, type LocationId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";

export type InvoiceEmailContactSource =
  { kind: "order"; orderId: string } | { kind: "sale"; saleId: string };

export async function resolveInvoiceEmailContact(
  tx: Transaction,
  cfg: { locationId: LocationId },
  source: InvoiceEmailContactSource,
): Promise<{ email: string; phone?: string } | null> {
  const departmentId =
    source.kind === "sale"
      ? await VENUE_SERVICE.receiptDepartmentForSale(tx, cfg, source.saleId)
      : await VENUE_SERVICE.receiptDepartmentForOrder(tx, cfg, source.orderId);
  const contact = async (id: string | null) => {
    if (id === null) return null;
    try {
      const receipt = await VENUE_SERVICE.readDepartmentReceipt(
        tx,
        { ...cfg, receiptLanguages: [] },
        id,
      );
      return receipt.email
        ? { email: receipt.email, ...(receipt.phone ? { phone: receipt.phone } : {}) }
        : null;
    } catch (error) {
      if (error instanceof AppError && error.code === "department.not_found") return null;
      throw error;
    }
  };
  const selected = await contact(departmentId);
  if (selected !== null) return selected;
  const fallback = await VENUE_SERVICE.receiptDefaultDepartment(tx, cfg);
  return fallback === departmentId ? null : contact(fallback);
}
