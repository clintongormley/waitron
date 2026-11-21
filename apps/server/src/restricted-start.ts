import type { startReturnRecordsDuty } from "./return-records.js";
import { restrictedBackgroundDuties, stopBackgroundDuties } from "./background-duties.js";
import type { Hono, MiddlewareHandler } from "hono";
import type { SignedMembershipDocument } from "@waitron/membership";
import type { StartedServer } from "./boot.js";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { steppingDownResponse } from "./handover-gate.js";
import { mountNodeApi } from "./node-api.js";

export interface RestrictedStartDeps {
  /** The shared app, already serving `/health`. */
  app: Hono;
  nodeId: string;
  environment: DeploymentEnvironment;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  /** The venue's cross-origin layer for `/api/*`, as the full start has. */
  cors: MiddlewareHandler;
  /** Routes later handover steps add to the restricted box. */
  routes: ((app: Hono) => void)[];
  log: Logger;
  /** Binds the listeners and uses stopWork before closing the stores. */
  returnRecords?: ReturnType<typeof startReturnRecordsDuty>;
  listen: (app: Hono, stopWork: () => Promise<void>) => StartedServer;
}

export const MONEY_AND_DRAWER_WRITES = [
  "/api/pay",
  "/api/working-orders/:id/payments",
  "/api/working-orders/:id/payments/:paymentId/refunds",
  "/api/working-orders/:id/collect",
  "/api/transactions/:saleId/refunds",
  "/api/tender-refunds/:refundId/retry",
  "/api/invoice-corrections/:id/cash",
  "/api/drawer/open",
];

/**
 * The start of a box that has handed over or been superseded: it answers the role probe so tills
 * move to the successor. Only the return sender runs; it never sells, files or writes venue data.
 * It answers the writes in `MONEY_AND_DRAWER_WRITES` with the handover code; any other route it does
 * not serve stays a 404 (handover-refusal-words plan, step 5: "no new unknown-route case or blanket
 * middleware"), except the till's and the dashboard's pages, which show the restricted page (A1558
 * plan, PR 4, overrules step 5 for those GET pages only).
 */
export function startRestricted(deps: RestrictedStartDeps): StartedServer {
  deps.app.use("/api/*", deps.cors);
  for (const path of MONEY_AND_DRAWER_WRITES) deps.app.post(path, steppingDownResponse);
  mountNodeApi(
    deps.app,
    {
      nodeId: deps.nodeId,
      acceptingSales: false,
      environment: deps.environment,
      readMembership: deps.readMembership,
    },
    deps.log,
  );
  for (const mount of deps.routes) mount(deps.app);
  const duties = restrictedBackgroundDuties(deps.returnRecords);
  return deps.listen(deps.app, () => stopBackgroundDuties(duties));
}
