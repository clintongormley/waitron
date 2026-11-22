import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  appendDrawerEntry,
  drawerEntries,
  finishDrawerClose,
  persons,
  readDrawerClose,
  readHistoryNodes,
  recountDrawer,
  saveDrawerCount,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { authorize } from "@waitron/identity";
import { enqueuePrintJob } from "@waitron/printing";
import { resolveVenueClock } from "@waitron/reporting";
import { readJsonBody } from "@waitron/server-kit";
import {
  AppError,
  decimal,
  decimalToCents,
  deviceOrigin,
  resolveActiveLocale,
} from "@waitron/shared";
import "./errors.js";
import { readDrawerCloseForPrint } from "./drawer-close-report.js";
import { formatDrawerCloseTicket } from "./drawer-close-ticket.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { printerLookup, resolveDrawerAssignment, type PrinterLookup } from "./receipt-print.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { assertStillSignedIn, canonicaliseUuid, requireSession } from "./till-session.js";

const DRAWER_CLOSE = "/api/drawer/close";

function invalidField(field: string): never {
  throw new AppError("drawer.close_invalid_field", { field });
}

function amount(value: unknown, field: string, invalid = invalidField) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))
    return invalid(field);
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

function invalidEntry(field: string): never {
  throw new AppError("drawer.entry_invalid_field", { field });
}

async function recordCashEntry(tx: Transaction, actor: Actor, body: Record<string, unknown>) {
  const printerId = canonicaliseUuid(body.printerId) ?? invalidEntry("printerId");
  if (printerId !== actor.printerId) throw new AppError("drawer.entry_changed", {});
  const id = canonicaliseUuid(body.submissionId) ?? invalidEntry("submissionId");
  const { kind } = body;
  if (kind !== "cash_in" && kind !== "cash_out") return invalidEntry("kind");
  const cents = decimalToCents(amount(body.amount, "amount", invalidEntry));
  if (cents === 0) return invalidEntry("amount");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length === 0 || reason.length > 500) return invalidEntry("reason");
  const signed = kind === "cash_in" ? cents : -cents;

  const [earlier] = await tx.select().from(drawerEntries).where(eq(drawerEntries.id, id));
  if (earlier === undefined) {
    await appendDrawerEntry(tx, { ...actor, id, kind, amount: signed, facts: { reason } });
  } else if (
    earlier.printerId !== printerId ||
    earlier.personId !== actor.personId ||
    earlier.deviceId !== actor.deviceId ||
    earlier.kind !== kind ||
    earlier.amount !== signed ||
    earlier.facts?.reason !== reason
  ) {
    throw new AppError("submission.id_reused", { submissionId: id });
  }
  return { id };
}

export function mountDrawerApi(app: Hono, deps: TillApiDeps, log: Logger, run: Run): void {
  function onDrawer<T extends object>(
    c: Context,
    act: (
      tx: Transaction,
      actor: Actor,
      body: Record<string, unknown>,
      lookup: PrinterLookup,
    ) => Promise<T>,
  ) {
    return run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "open-cash-drawer" });
      const body = c.req.method === "GET" ? {} : await readJsonBody<Record<string, unknown>>(c);
      const result = await withTransaction(deps.db, async (tx) => {
        await assertStillSignedIn(tx, session);
        await authorize(tx, { sessionId: session.sessionId, permission: "cash.drawer" });
        const lookup = printerLookup(tx, deviceOrigin(session.deviceId));
        const printer = await resolveDrawerAssignment(lookup);
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
          lookup,
        );
        return { ...answer, printerId: printer.id };
      });
      return c.json(result);
    });
  }

  app.post("/api/drawer/entries", (c) => onDrawer(c, recordCashEntry));

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
    onDrawer(c, async (tx, actor, body, lookup) => {
      let slip: "queued" | "unavailable" | "already_closed" = "already_closed";
      const finished = await finishDrawerClose(
        tx,
        actor,
        {
          firstCountId: firstCountId(c),
          amountLeft: amount(body.amountLeft, "amountLeft"),
          confirmSequence: sequence(body.confirmSequence, "confirmSequence"),
        },
        async ({ id }) => {
          const printer = await lookup("cash_drawer");
          if (printer === undefined) {
            slip = "unavailable";
            return;
          }
          const nodeIds = await readHistoryNodes(tx, deps.cfg.nodeId);
          const close = await readDrawerCloseForPrint(tx, nodeIds, id);
          if (close === null) throw new AppError("drawer.close_not_found", {});
          const { timeZone } = await resolveVenueClock(tx, deps.cfg.nodeId);
          const [person] = await tx
            .select({ locale: persons.locale })
            .from(persons)
            .where(eq(persons.id, actor.personId));
          const locale = resolveActiveLocale(
            person?.locale,
            resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
          );
          await enqueuePrintJob(
            tx,
            printer.id,
            formatDrawerCloseTicket(close, printer, locale, timeZone),
            "document",
          );
          slip = "queued";
        },
      );
      return { ...finished, slip };
    }),
  );
}
