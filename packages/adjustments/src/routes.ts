import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Transaction } from "@waitron/db";
import { authorizeManager, type PersonRoleValue } from "@waitron/identity";
import type { ModuleRouteContext, ModuleRoutes } from "@waitron/module";
import {
  createErrorBoundary,
  readJsonBody,
  requireEnum,
  requireManagementSession,
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "@waitron/server-kit";
import { AppError, decimal, isUuid } from "@waitron/shared";
import {
  createAdjustmentReason,
  deactivateAdjustmentReason,
  listAdjustmentReasons,
  reorderAdjustmentReasons,
  updateAdjustmentReason,
  type AdjustmentReasonInput,
} from "./operations.js";
import { ADJUSTMENTS_PERMISSIONS } from "./permissions.js";
import type { AdjustmentAction } from "./policy.js";
import "./errors.js";

const [{ permission: MANAGE_ADJUSTMENTS }] = ADJUSTMENTS_PERMISSIONS;
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "adjustment_reason.not_found": 404,
  "adjustment_reason.name_taken": 409,
};
const run = createErrorBoundary(STATUS, "adjustments.failed");

const ACTIONS: readonly AdjustmentAction[] = [
  "cancel",
  "comp",
  "discount_percent",
  "discount_amount",
];
const ROLES: readonly PersonRoleValue[] = ["staff", "supervisor", "manager", "admin"];
/** Whole cents at most: a third decimal place would be rounded away at the row. */
const AMOUNT = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;

function invalid(field: string): AppError {
  return new AppError("management.request_invalid", { field });
}

function requireNames(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("names");
  const names = value as Record<string, unknown>;
  if (Object.values(names).some((text) => typeof text !== "string")) throw invalid("names");
  return names as Record<string, string>;
}

function requireActions(value: unknown): AdjustmentAction[] {
  if (!Array.isArray(value)) throw invalid("actions");
  return value.map((action) => requireEnum(action, "actions", ACTIONS));
}

function requireMaxPercent(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number") throw invalid("maxPercentBp");
  return value;
}

function requireMaxAmount(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !AMOUNT.test(value)) throw invalid("maxAmount");
  return decimal(value);
}

function requireFlag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw invalid(field);
  return value;
}

/** Every field is required; a limit is cleared by an explicit `null`, never by leaving it out. */
function requireReasonInput(body: Record<string, unknown>): AdjustmentReasonInput {
  return {
    name: requireString(body.name, "name"),
    names: requireNames(body.names),
    actions: requireActions(body.actions),
    maxPercentBp: requireMaxPercent(body.maxPercentBp),
    maxAmount: requireMaxAmount(body.maxAmount),
    applyRole: requireEnum(body.applyRole, "applyRole", ROLES),
    approverRole: requireEnum(body.approverRole, "approverRole", ROLES),
    noteRequired: requireFlag(body.noteRequired, "noteRequired"),
  };
}

function requireIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !isUuid(id))) {
    throw invalid("ids");
  }
  return value as string[];
}

export const ADJUSTMENTS_ROUTES: ModuleRoutes = {
  mount(app, ctx: ModuleRouteContext, log: Logger): void {
    const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
      withTransaction(ctx.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: MANAGE_ADJUSTMENTS,
        });
        return fn(tx);
      });

    app.get("/management-api/adjustments/reasons", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const includeInactive = c.req.query("includeInactive") === "true";
        const reasons = await gated(sessionId, (tx) =>
          listAdjustmentReasons(tx, { includeInactive }),
        );
        return c.json({ reasons });
      }),
    );

    app.post("/management-api/adjustments/reasons", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const reason = await gated(sessionId, (tx) =>
          createAdjustmentReason(tx, requireReasonInput(body)),
        );
        return c.json(reason, 201);
      }),
    );

    app.put("/management-api/adjustments/reasons/:reasonId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const reasonId = requireUuidParam(c.req.param("reasonId"), "AdjustmentReasonId");
        const body = await readJsonBody<Record<string, unknown>>(c);
        const reason = await gated(sessionId, (tx) =>
          updateAdjustmentReason(tx, reasonId, requireReasonInput(body)),
        );
        return c.json(reason);
      }),
    );

    app.delete("/management-api/adjustments/reasons/:reasonId", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const reasonId = requireUuidParam(c.req.param("reasonId"), "AdjustmentReasonId");
        await gated(sessionId, (tx) => deactivateAdjustmentReason(tx, reasonId));
        return c.body(null, 204);
      }),
    );

    app.put("/management-api/adjustments/reason-order", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        await gated(sessionId, (tx) => reorderAdjustmentReasons(tx, requireIds(body.ids)));
        return c.body(null, 204);
      }),
    );
  },
};
