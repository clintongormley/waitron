import { readVenueClock, type Transaction } from "@waitron/db";
import { AppError, businessDayAt, jobOrigin } from "@waitron/shared";
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
  ): Promise<unknown>;
}

/**
 * Keeps one open `payment.reconcile_held` alert naming every held payment. An open alert's params
 * never change, so a changed set replaces it.
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
  if (lastHandled === null) return raise(tx, sink, held, input.now);
  const handledRefs = namedRefs(lastHandled);
  if ([...heldRefs].some((ref) => !handledRefs.has(ref))) return raise(tx, sink, held, input.now);

  const clock = await readVenueClock(tx);
  // `current` answers a handled incident as `lastHandled`.
  if (businessDayAt(clock, lastHandled.acknowledgedAt!) < businessDayAt(clock, input.now)) {
    return raise(tx, sink, held, input.now);
  }
  return false;
}

async function handle(
  tx: Transaction,
  sink: HeldAlertSink,
  incident: HeldAlertIncident,
  input: { now: Date; by: string | null },
): Promise<void> {
  await sink.handle(tx, { id: incident.id, personId: input.by, handledAt: input.now });
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
