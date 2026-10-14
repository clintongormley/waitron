import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import { attendanceOperationFacts, attendanceSourceState } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";

function attemptPrefix(orderId: string, provider: string): string {
  return `integrated:${JSON.stringify([orderId, provider])}:`;
}

function pendingAttempt(orderId: string, provider: string) {
  return and(
    eq(attendanceOperationFacts.source, "whole-payment"),
    eq(attendanceOperationFacts.outcome, "pending"),
    sql`instr(${attendanceOperationFacts.key}, ${attemptPrefix(orderId, provider)}) = 1`,
  );
}

export async function beginIntegratedAttendance(
  tx: Transaction,
  attendance: AttendanceRecorder | undefined,
  order: { id: string; provider: string; personId?: string },
  at: () => Date,
): Promise<string | undefined> {
  if (attendance === undefined) return;
  // Recovery needs a single pending snapshot per order and provider.
  const abandoned = await tx
    .select()
    .from(attendanceOperationFacts)
    .where(pendingAttempt(order.id, order.provider));
  for (const fact of abandoned) await attendance(tx, { ...fact, outcome: "refused" });
  if (order.personId === undefined) return;
  const [stored] = await tx
    .select({ locationId: workingOrders.locationId })
    .from(workingOrders)
    .where(eq(workingOrders.id, order.id));
  const key = `${attemptPrefix(order.id, order.provider)}${randomUUID()}`;
  await attendance(tx, {
    source: "whole-payment",
    key,
    personId: order.personId,
    locationId: stored!.locationId,
    kind: "payment",
    at: at().toISOString(),
    offsetMinutes: 0,
    outcome: "pending",
  });
  const { rows: previous } = await tx.execute<{ paymentRef: string }>(
    sql`select payment_ref as paymentRef from payments where working_order_id = ${order.id} and provider = ${order.provider} and bill_payment_id is null`,
  );
  await tx.insert(attendanceSourceState).values({
    locationId: stored!.locationId,
    source: "whole-payment",
    recordKind: "watch",
    key,
    fingerprint: JSON.stringify({
      orderId: order.id,
      provider: order.provider,
      previousRefs: previous.map((p) => p.paymentRef),
      paymentRef: null,
    }),
    nextDueAt: "1970-01-01T00:00:00.000Z",
  });
  return key;
}

export async function pendingIntegratedAttendanceKey(
  tx: Transaction,
  attendance: AttendanceRecorder | undefined,
  orderId: string,
  provider: string,
): Promise<string | undefined> {
  if (attendance === undefined) return;
  const candidates = await tx
    .select({ key: attendanceOperationFacts.key })
    .from(attendanceOperationFacts)
    .where(pendingAttempt(orderId, provider));
  // A retained charge with no unique request snapshot supplies no worker attribution.
  return candidates.length === 1 ? candidates[0]!.key : undefined;
}

export async function finishIntegratedAttendance(
  tx: Transaction,
  attendance: AttendanceRecorder | undefined,
  key: string | undefined,
  outcome: "qualified" | "refused",
): Promise<void> {
  if (attendance === undefined || key === undefined) return;
  const [fact] = await tx
    .select()
    .from(attendanceOperationFacts)
    .where(
      and(
        eq(attendanceOperationFacts.source, "whole-payment"),
        eq(attendanceOperationFacts.key, key),
      ),
    );
  if (fact !== undefined) await attendance(tx, { ...fact, outcome });
}

export async function discoverIntegratedAttendance(
  tx: Transaction,
  watch: typeof attendanceSourceState.$inferSelect,
  at: Date,
): Promise<void> {
  const [fact] = await tx
    .select()
    .from(attendanceOperationFacts)
    .where(
      and(
        eq(attendanceOperationFacts.source, "whole-payment"),
        eq(attendanceOperationFacts.key, watch.key),
      ),
    );
  if (fact === undefined || fact.outcome !== "pending") {
    await tx
      .update(attendanceSourceState)
      .set({ nextDueAt: null })
      .where(eq(attendanceSourceState.id, watch.id));
    return;
  }
  const snapshot = JSON.parse(watch.fingerprint!) as {
    orderId: string;
    provider: string;
    previousRefs: string[];
    paymentRef: string | null;
  };
  const { rows: candidates } = await tx.execute<{
    paymentRef: string;
    state: string;
    settledAt: string | null;
  }>(sql`
    select payment_ref as paymentRef, state, settled_at as settledAt from payments
    where working_order_id = ${snapshot.orderId} and provider = ${snapshot.provider} and bill_payment_id is null
    and (${snapshot.paymentRef} is null or payment_ref = ${snapshot.paymentRef})
    and payment_ref not in (select value from json_each(${JSON.stringify(snapshot.previousRefs)}))
    limit 2`);
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  let terminal = false;
  if (candidate) {
    snapshot.paymentRef = candidate.paymentRef;
    if (candidate.settledAt !== null) {
      await finishIntegratedAttendance(tx, recordAttendanceFact, watch.key, "qualified");
      terminal = true;
    } else if (candidate.state === "failed" || candidate.state === "declined") {
      await finishIntegratedAttendance(tx, recordAttendanceFact, watch.key, "refused");
      terminal = true;
    }
  }
  await tx
    .update(attendanceSourceState)
    .set({
      fingerprint: JSON.stringify(snapshot),
      nextDueAt: terminal ? null : new Date(at.getTime() + 30_000).toISOString(),
    })
    .where(eq(attendanceSourceState.id, watch.id));
}
