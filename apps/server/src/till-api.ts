import { Hono } from "hono";
import type { Transaction } from "@waitron/db";
import { createPinThrottle } from "@waitron/identity";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { mountTillClockApi } from "./till-clock-api.js";
import { mountTillAttendanceApi } from "./till-attendance-api.js";
import { mountTillBoxClockApi } from "./till-box-clock-api.js";
import { madeHereAnswer } from "./made-here.js";
import { ensureToday } from "./floor-today-store.js";
import { mountBillPaymentsApi } from "./bill-payments-api.js";
import { mountAdjustmentsApi } from "./adjustments-api.js";
import { mountLineCancelApi } from "./line-cancel-api.js";
import { mountDepartmentTransferApi } from "./department-transfer-api.js";
import { mountFloorTodayApi } from "./floor-today-api.js";
import { mountKeepOpenApi } from "./keep-open-api.js";
import { mountStationTodayApi } from "./station-today-api.js";
import { mountPartyAllergyApi } from "./party-allergy-api.js";
import { mountOrderKitchenNoteApi } from "./order-kitchen-note-api.js";
import { mountMealEndApi } from "./meal-end-api.js";
import { mountUnpaidDepartureApi } from "./unpaid-departure-api.js";
import { mountBillLookupApi } from "./bill-lookup-api.js";
import { mountInvoiceLookupApi } from "./invoice-lookup-api.js";
import { mountFindBillApi } from "./find-bill-api.js";
import { mountTransactionReceiptApi } from "./transaction-receipt-api.js";
import { mountTenderRefundApi } from "./tender-refund-api.js";
import { mountGiveBackApi } from "./give-back-api.js";
import { mountInvoiceCorrectionApi } from "./invoice-correction-api.js";
import { mountDrawerApi } from "./drawer-api.js";
import { mountDeferredCloseApi } from "./deferred-close-api.js";
// Side-effect only: loads this host's errors.ts augmentation.
import "./errors.js";
import { mountGatedWhileDiskFull } from "./disk-full-gate.js";
import { mountTillSessionRoutes } from "./till-session-routes.js";
import { mountTillMenuRoutes } from "./till-menu-routes.js";
import { mountTillWorkingOrderRoutes } from "./till-working-order-routes.js";
import { mountTillKitchenCounterRoutes } from "./till-kitchen-counter-routes.js";
import { mountTillSaleReceiptRoutes } from "./till-sale-receipt-routes.js";
import { mountTillDrawerAndCancelRoutes } from "./till-drawer-and-cancel-routes.js";
import { mountTillTableRoutes } from "./till-table-routes.js";
import { mountTillSetMenuRoutes } from "./till-set-menu-routes.js";
import { mountTillGroupRoutes } from "./till-group-routes.js";
import { mountTillDraftRoutes } from "./till-draft-routes.js";
import { mountTillOrderLineRoutes } from "./till-order-line-routes.js";
import { mountTillBillMoveRoutes } from "./till-bill-move-routes.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { run } from "./till-api-errors.js";
import { overridePinAttempts } from "./till-request-fields.js";

/** Open while a full-disk stop holds; each still fails by itself if its own save does not fit. */
const TILL_OPEN_WHILE_DISK_FULL: ReadonlySet<string> = new Set([
  // A refused sign-out keeps someone signed in on a shared till; a refused sign-in, the next shift out.
  "POST /api/session",
  "DELETE /api/session",
  "PUT /api/session/locale",
  // Refused inside, after their replay checks, the one place a resend is told from a new sale.
  "POST /api/working-orders/:id/payments",
  "POST /api/working-orders/:id/item-payments",
  // Save nothing of their own; a refused send-preview would hide the kitchen send's own refusal.
  "POST /api/dead-ends/sale",
  "POST /api/dead-ends/draft",
  "POST /api/dead-ends/order",
  "POST /api/working-orders/:id/payments/preview",
  "POST /api/working-orders/:id/item-payments/preview",
  "POST /api/working-orders/:id/payments/:submissionId/cancel",
  "POST /api/working-orders/:id/adjustments/preview",
  "POST /api/parties/:id/allergy/send-preview",
  "POST /api/bills/:id/move/allergy-preview",
]);

/** Mount the till routes with the shared error boundary. */
export function mountTillApi(root: Hono, deps: TillApiDeps, log: Logger): void {
  const app = new Hono();
  const pinThrottle = deps.pinThrottle ?? createPinThrottle();
  const catchUpFloor = (tx: Transaction) =>
    ensureToday(tx, deps.tableRemovals ?? [], deps.clock.now().instant);
  app.use("/api/*", madeHereAnswer(deps.db));
  if (deps.boxClock !== undefined)
    mountTillBoxClockApi(
      app,
      {
        db: deps.db,
        backend: deps.backend,
        clock: deps.clock,
        devMode: deps.devMode === true,
        deviceChooserEnabled: deps.deviceChooserEnabled,
        attemptsFor: (deviceId) => overridePinAttempts(pinThrottle, deviceId),
        boxClock: deps.boxClock,
      },
      log,
    );
  if (deps.workforceEnabled === true)
    mountTillClockApi(
      app,
      {
        db: deps.db,
        devMode: deps.devMode === true,
        deviceChooserEnabled: deps.deviceChooserEnabled,
        cfg: deps.cfg,
        now: () => deps.clock.now().instant,
      },
      log,
    );
  if (deps.workforceEnabled === true && deps.attendanceResponsesEnabled !== false)
    mountTillAttendanceApi(
      app,
      {
        db: deps.db,
        devMode: deps.devMode === true,
        deviceChooserEnabled: deps.deviceChooserEnabled,
        cfg: deps.cfg,
        now: () => deps.clock.now().instant,
        attemptsFor: (deviceId) => overridePinAttempts(pinThrottle, deviceId),
        exporter: deps.exporter,
      },
      log,
    );
  // What a write that leaves a bill fully paid issues its invoice with (bill payments design §7).
  const fiscal = {
    db: deps.db,
    backend: deps.backend,
    admission: deps.admission,
    clock: deps.clock,
    log,
  };
  mountBillPaymentsApi(app, deps, log, run, pinThrottle);
  mountAdjustmentsApi(app, deps, log, run, pinThrottle);
  mountLineCancelApi(app, deps, log, run, pinThrottle);
  mountUnpaidDepartureApi(app, deps, log, run, pinThrottle);
  mountMealEndApi(app, deps, log, run);
  mountStationTodayApi(app, deps, log, run, pinThrottle);
  mountOrderKitchenNoteApi(app, deps, log, run);
  mountPartyAllergyApi(app, deps, log, run);
  mountKeepOpenApi(app, deps, log, run, pinThrottle);
  mountDepartmentTransferApi(app, deps, log, run);
  mountFloorTodayApi(app, deps, log, run);
  mountBillLookupApi(app, deps, log, run);
  mountInvoiceLookupApi(app, deps, log, run);
  mountFindBillApi(app, deps, log, run);
  mountTransactionReceiptApi(app, deps, log, run);
  mountTenderRefundApi(app, deps, log, pinThrottle);
  mountInvoiceCorrectionApi(app, deps, log, pinThrottle);
  mountGiveBackApi(app, deps, log, pinThrottle);
  mountDeferredCloseApi(app, deps, log, run);
  mountDrawerApi(app, deps, log, run);

  mountTillSessionRoutes(app, deps, log, pinThrottle);

  mountTillMenuRoutes(app, deps, log);

  /** For a read: a failed check reads as no mail. */
  const readEmailTransport = async (tx: Transaction): Promise<boolean> =>
    (await deps.invoiceEmailAvailable?.(tx).catch((error: unknown) => {
      log("warn", "invoice_delivery.email_check_failed", { errorCode: codeOf(error) });
      return false;
    })) === true;

  mountTillWorkingOrderRoutes(app, deps, log, pinThrottle, fiscal, readEmailTransport);

  mountTillKitchenCounterRoutes(app, deps, log);

  mountTillSaleReceiptRoutes(app, deps, log, readEmailTransport);

  mountTillDrawerAndCancelRoutes(app, deps, log, pinThrottle);

  mountTillTableRoutes(app, deps, log, pinThrottle, catchUpFloor, fiscal);

  mountTillSetMenuRoutes(app, deps, log);

  mountTillGroupRoutes(app, deps, log, pinThrottle);

  mountTillDraftRoutes(app, deps, log, pinThrottle, fiscal);

  mountTillOrderLineRoutes(app, deps, log, pinThrottle, fiscal);

  mountTillBillMoveRoutes(app, deps, log, fiscal);
  mountGatedWhileDiskFull(root, app, { disk: deps.disk, log, open: TILL_OPEN_WHILE_DISK_FULL });
}
