import { withTransaction } from "@waitron/db";
import type { DeviceRequestConfig } from "../till-config.js";
import type { TillSaleDeps } from "../working-order.js";
import { issueUnpaidInvoice, priceForIssuance } from "../working-order.js";

/** Seed an issued bill independently of the zone's payment timing. */
export async function issueOrderInvoice(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operatorId: string,
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    const invoice = await priceForIssuance(tx, deps.clock, cfg, id);
    await issueUnpaidInvoice(tx, deps.backend, cfg, invoice, operatorId);
  });
}
