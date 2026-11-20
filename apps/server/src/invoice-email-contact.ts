import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";

export type InvoiceEmailContactSource =
  | { kind: "order"; orderId: string }
  | { kind: "sale"; saleId: string }
  /** A bill with no row yet: the department of the zone saving it would open it in. */
  | { kind: "new-order"; zoneId: string | undefined; profileId: string };

async function departmentOf(
  tx: Transaction,
  source: InvoiceEmailContactSource,
): Promise<string | null> {
  switch (source.kind) {
    case "sale":
      return VENUE_SERVICE.receiptDepartmentForSale(tx, source.saleId);
    case "order":
      return VENUE_SERVICE.receiptDepartmentForOrder(tx, source.orderId);
    case "new-order":
      return (
        await VENUE_SERVICE.resolveNewOrderZone(tx, {
          zoneId: source.zoneId,
          profileId: source.profileId,
        })
      ).departmentId;
  }
}

export async function resolveInvoiceEmailContact(
  tx: Transaction,
  source: InvoiceEmailContactSource,
): Promise<{ email: string; phone?: string } | null> {
  const departmentId = await departmentOf(tx, source);
  const contact = async (id: string | null) => {
    if (id === null) return null;
    try {
      const receipt = await VENUE_SERVICE.readRetainedDepartmentReceipt(
        tx,
        { receiptLanguages: [] },
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
  const fallback = await VENUE_SERVICE.receiptDefaultDepartment(tx);
  return fallback === departmentId ? null : contact(fallback);
}

/**
 * Whether this bill's invoice can be emailed now: the caller's mail transport check, and a contact
 * for the bill's department, which staging an email choice also requires.
 */
export async function canEmailInvoice(
  tx: Transaction,
  source: InvoiceEmailContactSource,
  transport: boolean,
): Promise<boolean> {
  if (!transport) return false;
  const contact = await resolveInvoiceEmailContact(tx, source);
  return contact !== null;
}
