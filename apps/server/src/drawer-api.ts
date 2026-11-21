import type { Context, Hono } from "hono";
import {
  finishDrawerClose,
  readDrawerClose,
  recountDrawer,
  saveDrawerCount,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { authorize } from "@waitron/identity";
import { readJsonBody } from "@waitron/server-kit";
import { AppError, decimal, deviceOrigin } from "@waitron/shared";
import "./errors.js";
import type { Logger } from "./logger.js";
import { printerLookup, resolveDrawerAssignment } from "./receipt-print.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { assertStillSignedIn, canonicaliseUuid, requireSession } from "./till-session.js";

const DRAWER_CLOSE = "/api/drawer/close";

function invalidField(field: string): never {
  throw new AppError("drawer.close_invalid_field", { field });
}

function amount(value: unknown, field: string) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))
    return invalidField(field);
  return decimal(value);
}

function sequence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return invalidField(field);
  return value;
}

function firstCountId(c: Context) {
  const id = canonicaliseUuid(c.req.param("firstCountId"));
  if (id === null) throw new AppError("drawer.close_not_found", {});
  return id;
}

type Actor = Parameters<typeof saveDrawerCount>[1];

export function mountDrawerApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  function onDrawer<T extends object>(
    c: Context,
    act: (tx: Transaction, actor: Actor, body: Record<string, unknown>) => Promise<T>,
  ) {
    return run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "open-cash-drawer" });
      const body = c.req.method === "GET" ? {} : await readJsonBody<Record<string, unknown>>(c);
      const result = await withTransaction(deps.db, async (tx) => {
        await assertStillSignedIn(tx, session);
        await authorize(tx, { sessionId: session.sessionId, permission: "cash.drawer" });
        const printer = await resolveDrawerAssignment(
          printerLookup(tx, deviceOrigin(session.deviceId)),
        );
        if (printer === undefined)
          throw new AppError("drawer.no_printer", { deviceId: session.deviceId });
        const answer = await act(
          tx,
          {
            printerId: printer.id,
            nodeId: deps.cfg.nodeId,
            personId: session.personId,
            deviceId: session.deviceId,
            recordedAt: deps.clock.now().instant.toISOString(),
          },
          body,
        );
        return { ...answer, printerId: printer.id };
      });
      return c.json(result);
    });
  }

  app.get(DRAWER_CLOSE, (c) => onDrawer(c, (tx, actor) => readDrawerClose(tx, actor.printerId)));
  app.post(`${DRAWER_CLOSE}/count`, (c) =>
    onDrawer(c, (tx, actor, body) => {
      const printerId = canonicaliseUuid(body.printerId) ?? invalidField("printerId");
      if (printerId !== actor.printerId) throw new AppError("drawer.close_changed", {});
      return saveDrawerCount(tx, actor, {
        counted: amount(body.counted, "counted"),
        startSequence: sequence(body.startSequence, "startSequence"),
      });
    }),
  );

  app.post(`${DRAWER_CLOSE}/:firstCountId/recount`, (c) =>
    onDrawer(c, (tx, actor, body) => {
      return recountDrawer(tx, actor, {
        firstCountId: firstCountId(c),
        counted: amount(body.counted, "counted"),
        startSequence: sequence(body.startSequence, "startSequence"),
      });
    }),
  );

  app.post(`${DRAWER_CLOSE}/:firstCountId/finish`, (c) =>
    onDrawer(c, (tx, actor, body) => {
      return finishDrawerClose(tx, actor, {
        firstCountId: firstCountId(c),
        amountLeft: amount(body.amountLeft, "amountLeft"),
        confirmSequence: sequence(body.confirmSequence, "confirmSequence"),
      });
    }),
  );
}
