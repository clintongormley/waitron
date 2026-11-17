import { withIssuanceTransaction } from "@waitron/core";
import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { devices, deviceProfiles, type Transaction } from "@waitron/db";
import { authorize, canUseDeviceProfile } from "@waitron/identity";
import { requireBodyUuid, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { asObject, submissionIdOf } from "./bill-payments-api.js";
import {
  assertProfileAction,
  deviceBindingColumns,
  deviceProfileJoin,
  toDeviceBinding,
} from "./device-session.js";
import type { Logger } from "./logger.js";
import { endMeal, type EndMealRequest } from "./meal-end.js";
import type { BillEditExpected } from "./order-drafts.js";
import { requestCfg } from "./request-config.js";
import { requirePartyParam, requireRevision, type Run, type TillApiDeps } from "./till-api.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";

/** The body, refused field by field as `management.request_invalid`, as an unpaid departure's is. */
function parseEndMeal(body: Record<string, unknown>): EndMealRequest {
  const expectedPartyRevision = requireRevision(
    body.expectedPartyRevision,
    "expectedPartyRevision",
  );
  const submissionId = submissionIdOf(body);
  if (body.printAnyway !== undefined && typeof body.printAnyway !== "boolean")
    throw new AppError("management.request_invalid", { field: "printAnyway" });
  return {
    billId: requireBodyUuid(body.billId, "billId").toLowerCase(),
    expectedPartyRevision,
    expectedEdits: body.expectedEdits as BillEditExpected[],
    submissionId,
    printAnyway: body.printAnyway ?? false,
  };
}

type Session = Awaited<ReturnType<typeof requireSession>>;

/**
 * Run inside the write, because access may be withdrawn while the request waits in the queue: the
 * session, the active device on an unretired profile that takes orders, the person's admission to
 * that profile and `payment.take`, and the party's zone. Answers the device as it stands now.
 */
async function stillAllowed(tx: Transaction, session: Session, partyId: string) {
  await assertStillSignedIn(tx, session);
  const [row] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(and(eq(devices.id, session.deviceId), isNull(deviceProfiles.retiredAt)));
  if (row === undefined) throw new AppError("device.unauthorized", {});
  const device = toDeviceBinding(session.deviceId, row);
  assertProfileAction(device, "take-orders");
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  await authorize(tx, { sessionId: session.sessionId, permission: "payment.take" });
  await checkZones(tx, { device }, [{ partyId }]);
  return device;
}

/**
 * Print the bill, behind the till session: issuing the ticket is the first step of taking payment,
 * so it needs `payment.take`. The ticket is filed, and printed, as the requesting device's.
 */
export function mountMealEndApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  app.post("/api/parties/:id/end-meal", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, {
        action: "take-orders",
        permission: "payment.take",
      });
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const request = parseEndMeal(asObject(await readRawJsonBody<unknown>(c)));
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          const device = await stillAllowed(tx, session, partyId);
          return endMeal(tx, { ...deps, log }, cfg, partyId, request, session.personId, device);
        },
        log,
      );
      return c.json(result);
    }),
  );
}
