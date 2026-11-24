import { withTransaction } from "@waitron/db";
import type { DeviceRequestConfig } from "../trading-context.js";
import type { TillSaleDeps } from "../working-order-context.js";
import { markOrderPlaced } from "../working-order-counter.js";
import { issueUnpaidInvoice, priceForIssuance } from "../working-order-invoice.js";

/** Seed an issued bill independently of the zone's payment timing. */
export async function issueOrderInvoice(
  deps: TillSaleDeps,
  cfg: DeviceRequestConfig,
  id: string,
  operatorId: string,
): Promise<void> {
  await withTransaction(deps.db, async (tx) => {
    const invoice = await priceForIssuance(tx, deps.clock, deps.backend, cfg, id, deps.log);
    await issueUnpaidInvoice(tx, deps.backend, cfg, invoice, operatorId, deps.admission);
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
    const invoice = await priceForIssuance(tx, deps.clock, deps.backend, cfg, id, deps.log);
    await issueUnpaidInvoice(tx, deps.backend, cfg, invoice, operatorId, deps.admission);
    await markOrderPlaced(tx, deps.clock, cfg, id, operatorId);
  });
}
