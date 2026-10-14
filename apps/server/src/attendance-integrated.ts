import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { workingOrders, type Transaction } from "@waitron/db";
import { attendanceOperationFacts } from "@waitron/workforce";
import type { AttendanceRecorder } from "./attendance-capture.js";

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
