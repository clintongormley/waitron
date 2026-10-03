import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { ADJUSTMENT_ACTIONS, listAdjustmentReasons } from "@waitron/adjustments";
import { withTransaction, type Database } from "@waitron/db";
import {
  listActivePersonsAtOrAboveRole,
  personRole,
  persons,
  type PersonRoleValue,
  type PinThrottle,
} from "@waitron/identity";
import { requireNullableBodyUuid, requireBodyUuid, readRawJsonBody } from "@waitron/server-kit";
import { decimal } from "@waitron/shared";
import {
  applyAdjustment,
  planAdjustment,
  previewAdjustment,
  reasonNameIn,
  type AdjustmentAsk,
} from "./adjustments-apply.js";
import { invalid } from "./bill-allocation.js";
import { issueIfFullyPaid } from "./bill-payments.js";
import { madeHereSinkFor, replayPrepayMadeHere } from "./made-here.js";
import {
  asObject,
  optionalMoney,
  submissionIdOf,
  withSaleTillWhenIssuing,
} from "./bill-payments-api.js";
import type { Logger } from "./logger.js";
import { withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { partyRevisionOfOrder } from "./parties.js";
import {
  overridePinAttempts,
  parseDrawerOverride,
  requireRevision,
  requireTabParam,
  type Run,
  type TillApiDeps,
} from "./till-api.js";
import { requireSession } from "./till-session.js";
import "./errors.js";

const NOTE_LIMIT = 500;

/** A non-UUID names no open bill, so it gets `tab.not_open`. */
function requireBill(id: string): string {
  return requireTabParam(id).toLowerCase();
}

/** The body an apply and a preview share, screened field by field as `management.request_invalid`. */
function parseAsk(
  orderId: string,
  operatorId: string,
  body: Record<string, unknown>,
): AdjustmentAsk {
  const { action, quantity, percentBp, note } = body;
  const expectedRevision = requireRevision(body.expectedRevision, "expectedRevision");
  if (typeof action !== "string" || !(ADJUSTMENT_ACTIONS as readonly string[]).includes(action)) {
    throw invalid("action");
  }
  if (body.lineId === undefined) throw invalid("lineId");
  const lineId = requireNullableBodyUuid(body.lineId, "lineId");
  if (quantity !== undefined && typeof quantity !== "string") throw invalid("quantity");
  if (percentBp !== undefined && typeof percentBp !== "number") throw invalid("percentBp");
  const amount = optionalMoney(body.amount, "amount");
  if (
    note !== undefined &&
    note !== null &&
    (typeof note !== "string" || note.length > NOTE_LIMIT)
  ) {
    throw invalid("note");
  }
  return {
    orderId,
    expectedRevision,
    lineId: lineId === null ? null : lineId.toLowerCase(),
    reasonId: requireBodyUuid(body.reasonId, "reasonId").toLowerCase(),
    action: action as AdjustmentAsk["action"],
    ...(quantity === undefined ? {} : { quantity }),
    ...(percentBp === undefined ? {} : { percentBp }),
    ...(amount === undefined ? {} : { amount: decimal(amount) }),
    note: typeof note === "string" ? note : null,
    operatorId,
  };
}

function requireRole(value: string | undefined): PersonRoleValue {
  if (value === undefined || !(personRole.enumValues as readonly string[]).includes(value)) {
    throw invalid("role");
  }
  return value as PersonRoleValue;
}

/**
 * The approver whose PIN the transaction will check: the plan, read now, needs an approver. A plan
 * that cannot be made is refused inside the transaction, so it names no one here.
 */
async function approverToCheck(
  db: Database,
  ask: AdjustmentAsk,
  approver: { personId: string; pin: string } | undefined,
  venueLocale: string,
): Promise<{ personId: string; pin: string } | undefined> {
  if (approver === undefined) return undefined;
  let approverRole;
  try {
    ({ approverRole } = await planAdjustment(db, ask, venueLocale));
  } catch {
    return undefined;
  }
  return approverRole === null ? undefined : approver;
}

/**
 * The till's adjustment routes (service plan Task 11, spec §7), behind the till session: apply a
 * cancel, comp or discount to an open bill, a table's or a counter order, preview what it would
 * do, and the reasons and approvers the till offers.
 */
export function mountAdjustmentsApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
  pinThrottle: PinThrottle,
): void {
  const fiscal = { db: deps.db, backend: deps.backend, clock: deps.clock, log };

  // One that leaves the bill exactly paid files its invoice on the requesting device's till.
  app.post("/api/working-orders/:id/adjustments", (c) =>
    run(c, log, async () => {
      const { personId, tillId } = await requireSession(deps, c);
      const id = requireBill(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const ask = parseAsk(id, personId, body);
      const submissionId = submissionIdOf(body);
      const parsedApprover = parseDrawerOverride(
        body.approver as { personId?: unknown; pin?: unknown } | undefined,
      );
      const attempts = overridePinAttempts(pinThrottle, tillId);
      const toCheck = await approverToCheck(deps.db, ask, parsedApprover, deps.venueLocale);
      const answer = await withPinCheckAhead(deps.db, toCheck, attempts, (checked) => {
        const approver = withCheck(parsedApprover, checked);
        return withSaleTillWhenIssuing(deps, c, (saleCfg) =>
          withTransaction(deps.db, async (tx) => {
            const applied = await applyAdjustment(
              tx,
              deps.cfg,
              { ...ask, submissionId, ...(approver === undefined ? {} : { approver }) },
              deps.venueLocale,
              attempts,
            );
            await issueIfFullyPaid(tx, fiscal, saleCfg, id, personId);
            await replayPrepayMadeHere(tx, { madeHereSink: madeHereSinkFor(c) }, id);
            return { ...applied, party: await partyRevisionOfOrder(tx, id) };
          }),
        );
      });
      return c.json(answer);
    }),
  );

  app.post("/api/working-orders/:id/adjustments/preview", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const id = requireBill(c.req.param("id"));
      const ask = parseAsk(id, personId, asObject(await readRawJsonBody<unknown>(c)));
      const preview = await withTransaction(deps.db, (tx) =>
        previewAdjustment(tx, ask, deps.venueLocale),
      );
      return c.json(preview);
    }),
  );

  // The active reasons, named in the operator's language.
  app.get("/api/adjustment-reasons", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const reasons = await withTransaction(deps.db, async (tx) => {
        const [person] = await tx
          .select({ locale: persons.locale })
          .from(persons)
          .where(eq(persons.id, personId));
        return (await listAdjustmentReasons(tx)).map((reason) => ({
          id: reason.id,
          name: reasonNameIn(reason, person?.locale ?? null, deps.venueLocale),
          actions: reason.actions,
          noteRequired: reason.noteRequired,
          maxPercentBp: reason.maxPercentBp,
          maxAmount: reason.maxAmount,
          applyRole: reason.applyRole,
          approverRole: reason.approverRole,
        }));
      });
      return c.json(reasons);
    }),
  );

  // Session-gated only, like the drawer's authorizers: any operator may see who could approve.
  app.get("/api/adjustment-approvers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const role = requireRole(c.req.query("role"));
      const approvers = await withTransaction(deps.db, (tx) =>
        listActivePersonsAtOrAboveRole(tx, role),
      );
      return c.json(approvers);
    }),
  );
}
