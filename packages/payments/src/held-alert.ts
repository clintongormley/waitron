import type { Transaction } from "@waitron/db";
import { AppError, jobOrigin } from "@waitron/shared";
import type { Origin } from "@waitron/shared";
import "./errors.js";
import { listOpenHolds } from "./holds.js";
import type { OpenHold } from "./holds.js";
import type { IncidentSink } from "./reconcile.js";

const HELD = "payment.reconcile_held";
const PAYMENT_CHECK = jobOrigin("payment_check");

interface HeldAlertIncident {
  id: string;
  params: unknown;
  acknowledgedAt: Date | null;
}

/** Typed structurally so this package keeps `@waitron/core` a DEV dependency; `recordIncidentOnce`,
 * `currentIncidentsOf` and `markIncidentHandled` are assignable to it verbatim. */
export interface HeldAlertSink {
  raise: IncidentSink;
  current(
    tx: Transaction,
    input: { origin: Origin; code: string },
  ): Promise<{ open: HeldAlertIncident | null; lastHandled: HeldAlertIncident | null }>;
  handle(
    tx: Transaction,
    input: { id: string; personId: string | null; handledAt: Date },
  ): Promise<void>;
}

/**
 * Keeps one open `payment.reconcile_held` alert naming every held payment. An open alert's params
 * never change, so a changed set replaces it. A handled alert comes back at the first call of the
 * next UTC day after it was handled, or at once when a payment it did not name is held. Returns
 * whether a new alert was raised.
 */
export async function refreshHeldAlert(
  tx: Transaction,
  sink: HeldAlertSink,
  input: { now: Date; by: string | null },
): Promise<boolean> {
  const held = await listOpenHolds(tx);
  const { open, lastHandled } = await sink.current(tx, { origin: PAYMENT_CHECK, code: HELD });
  const heldRefs = new Set(held.map((hold) => hold.paymentRef));

  if (held.length === 0) {
    if (open !== null) await handle(tx, sink, open, input);
    return false;
  }
  if (open !== null) {
    if (sameSet(namedRefs(open), heldRefs)) return false;
    await handle(tx, sink, open, input);
    return raise(tx, sink, held, input.now);
  }
  if (
    lastHandled === null ||
    // Non-null: `current` answers a handled incident as `lastHandled`.
    lastHandled.acknowledgedAt! < utcDayStart(input.now) ||
    [...heldRefs].some((ref) => !namedRefs(lastHandled).has(ref))
  ) {
    return raise(tx, sink, held, input.now);
  }
  return false;
}

function handle(
  tx: Transaction,
  sink: HeldAlertSink,
  incident: HeldAlertIncident,
  input: { now: Date; by: string | null },
): Promise<void> {
  return sink.handle(tx, { id: incident.id, personId: input.by, handledAt: input.now });
}

function raise(
  tx: Transaction,
  sink: HeldAlertSink,
  held: OpenHold[],
  now: Date,
): Promise<boolean> {
  return sink.raise(tx, {
    origin: PAYMENT_CHECK,
    error: new AppError(HELD, {
      count: held.length,
      payments: held.map((hold) => ({
        paymentRef: hold.paymentRef,
        workingOrderId: hold.workingOrderId,
        amount: hold.amount,
        providerAmount: hold.providerAmount,
      })),
    }),
    severity: "error",
    detectedAt: now,
  });
}

function namedRefs(incident: HeldAlertIncident): Set<string> {
  const { payments } = incident.params as AppError<typeof HELD>["params"];
  return new Set(payments.map((payment) => payment.paymentRef));
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((ref) => b.has(ref));
}

function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
