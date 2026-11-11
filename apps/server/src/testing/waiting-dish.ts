import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { deploymentEnvironment } from "../config.js";
import { parkOrder } from "../working-order.js";
import { placeOrder } from "./order-writer-fixture.js";
import { deviceRequestCfg } from "./session-device.js";
import { testTradingAdmission } from "./trading-admission.js";
import type { Venue } from "./venue-fixtures.js";
import { offerProducts } from "./zone-offers.js";

/** Places a one-coffee counter order at `at`, then puts its dish on `stationId`, fired at `firedAt`. */
export async function waitingDish(
  db: Database,
  venue: Venue,
  stationId: string,
  firedAt: string,
  at: Date,
): Promise<string> {
  const orderId = randomUUID();
  const offers = await withTransaction(db, (tx) => offerProducts(tx, venue.cfg));
  await parkOrder({ db }, venue.cfg, {
    id: orderId,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines([{ productId: venue.coffeeId, quantity: "1" }]),
    label: "Mesa 7",
  });
  const clock = {
    now: () => ({
      instant: at,
      offsetMinutes: 0,
      confident: true,
      confidence: "anchored" as const,
      anchorAgeSeconds: 0,
    }),
    anchor: () => {
      throw new Error("unused");
    },
    currentAnchor: () => null,
  };
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("unused")),
  });
  await placeOrder(
    { admission: testTradingAdmission(), db, backend, clock },
    await deviceRequestCfg(db, venue.cfg),
    orderId,
    randomUUID(),
  );
  await db.execute(
    sql`update ticket_items set station_id = ${stationId}, fired_at = ${firedAt} where working_order_id = ${orderId}`,
  );
  return orderId;
}
