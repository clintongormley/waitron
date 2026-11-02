import { venueLocationId, type Transaction } from "@waitron/db";
import { AppError, locationId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";

export type InvoiceEmailContactSource =
  { kind: "order"; orderId: string } | { kind: "sale"; saleId: string };

export async function resolveInvoiceEmailContact(
  tx: Transaction,
  source: InvoiceEmailContactSource,
): Promise<{ email: string; phone?: string } | null> {
  const cfg = { locationId: locationId(await venueLocationId(tx)) };
  const departmentId =
    source.kind === "sale"
      ? await VENUE_SERVICE.receiptDepartmentForSale(tx, cfg, source.saleId)
      : await VENUE_SERVICE.receiptDepartmentForOrder(tx, cfg, source.orderId);
  const contact = async (id: string | null) => {
    if (id === null) return null;
    try {
      const receipt = await VENUE_SERVICE.readRetainedDepartmentReceipt(
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

/**
 * Whether this sale's invoice can be emailed now: the caller's mail transport check, and a contact
 * for the sale's department, which staging an email choice also requires.
 */
export async function canEmailInvoice(
  tx: Transaction,
  saleId: string,
  transport: boolean,
): Promise<boolean> {
  if (!transport) return false;
  const contact = await resolveInvoiceEmailContact(tx, { kind: "sale", saleId });
  return contact !== null;
}
