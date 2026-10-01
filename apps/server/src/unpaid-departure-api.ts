import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { listActivePersonsWithPermission, type PinThrottle } from "@waitron/identity";
import { readRawJsonBody } from "@waitron/server-kit";
import { asObject } from "./bill-payments-api.js";
import { requireSaleTillId } from "./device-session.js";
import type { Logger } from "./logger.js";
import {
  overridePinAttempts,
  parseOverrideField,
  parseReason,
  requirePartyParam,
  requireRevision,
  type Run,
  type TillApiDeps,
} from "./till-api.js";
import { requireSession } from "./till-session.js";
import {
  listUnpaidDepartures,
  recordUnpaidDeparture,
  type UnpaidDepartureRequest,
} from "./unpaid-departure.js";
import "./errors.js";

/** The body, refused field by field as `management.request_invalid`, as a bill refund's is. */
function parseDeparture(body: Record<string, unknown>): UnpaidDepartureRequest {
  const expectedPartyRevision = requireRevision(
    body.expectedPartyRevision,
    "expectedPartyRevision",
  );
  const reason = parseReason(body.reason);
  const override = parseOverrideField(body.override);
  return { expectedPartyRevision, reason, ...(override === undefined ? {} : { override }) };
}

/**
 * Record unpaid departure (spec §8), behind the till session: the departure itself, who may
 * authorise one, and the departures still owed. The invoices a departure issues are filed on the
 * device's own till, as a bill payment's are.
 */
export function mountUnpaidDepartureApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
  pinThrottle: PinThrottle,
): void {
  app.post("/api/parties/:id/unpaid-departure", (c) =>
    run(c, log, async () => {
      const { personId, sessionId, tillId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const request = parseDeparture(asObject(await readRawJsonBody<unknown>(c)));
      const saleTillId = await requireSaleTillId(deps, c);
      const result = await withTransaction(deps.db, (tx) =>
        recordUnpaidDeparture(tx, { ...deps, log }, deps.cfg, saleTillId, partyId, request, {
          personId,
          sessionId,
          attempts: overridePinAttempts(pinThrottle, tillId),
        }),
      );
      return c.json(result);
    }),
  );

  // Like the refund's list: any operator may see who could approve their departure.
  app.get("/api/unpaid-departure-authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(
        await withTransaction(deps.db, (tx) =>
          listActivePersonsWithPermission(tx, "sale.void"),
        ),
      );
    }),
  );

  app.get("/api/unpaid-departures", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(await withTransaction(deps.db, listUnpaidDepartures));
    }),
  );
}
