import type { Transaction } from "@waitron/db";
import { AppError, type LocationId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import "./errors.js";

export async function readSaleOperationDescription(
  tx: Transaction,
  cfg: { locationId: LocationId; operationDescriptionRequired?: boolean },
  source: { kind: "order"; orderId: string } | { kind: "sale"; saleId: string },
): Promise<string> {
  if (cfg.operationDescriptionRequired === false) {
    if (
      source.kind === "order" &&
      (await VENUE_SERVICE.findOrderContext(tx, cfg, source.orderId)) === null
    ) {
      throw new AppError("order.service_context_missing", { workingOrderId: source.orderId });
    }
    return "";
  }
  let departmentId: string | null;
  if (source.kind === "sale") {
    departmentId = await VENUE_SERVICE.receiptDepartmentForSale(tx, cfg, source.saleId);
  } else {
    const context = await VENUE_SERVICE.findOrderContext(tx, cfg, source.orderId);
    departmentId =
      context === null
        ? null
        : (await VENUE_SERVICE.resolveSalePolicy(tx, cfg, context.zoneId)).departmentId;
  }
  if (departmentId === null) {
    throw new AppError("sale.department_missing", {});
  }
  const scope = { ...cfg, receiptLanguages: [] };
  const receipt =
    source.kind === "sale"
      ? await VENUE_SERVICE.readRetainedDepartmentReceipt(tx, scope, departmentId)
      : await VENUE_SERVICE.readDepartmentReceipt(tx, scope, departmentId);
  if (receipt.operationDescription === undefined || receipt.operationDescription.trim() === "") {
    throw new AppError("department.operation_description_required", { departmentId });
  }
  return receipt.operationDescription;
}
