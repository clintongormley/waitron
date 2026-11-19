import { withTransaction } from "@waitron/db";
import type { DeviceRequestConfig } from "../trading-context.js";
import type { TillSaleDeps } from "../working-order.js";
import { issueUnpaidInvoice, markOrderPlaced, priceForIssuance } from "../working-order.js";

/** Seed an issued bill independently of the zone's payment timing. */
export async function issueOrderInvoice(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operatorId: string,
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    const invoice = await priceForIssuance(tx, deps.clock, deps.backend, cfg, id);
    await issueUnpaidInvoice(tx, deps.backend, cfg, invoice, operatorId, deps.admission, deps.log);
  });
}

/** An open bill's ticket issued for its whole total and the bill placed, unpaid, in one transaction. */
export async function printOrderForTest(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operatorId: string,
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    const invoice = await priceForIssuance(tx, deps.clock, deps.backend, cfg, id);
    await issueUnpaidInvoice(tx, deps.backend, cfg, invoice, operatorId, deps.admission, deps.log);
    await markOrderPlaced(tx, deps.clock, cfg, id, operatorId);
  });
}
