import "./errors.js";
import { randomUUID } from "node:crypto";
import type { Transaction } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { recordStaffActivity } from "@waitron/workforce";
import type { ActivityKind, AttendanceFact, AttendanceSource } from "@waitron/workforce";

export type AttendanceRecorder = (
  tx: Transaction,
  fact: AttendanceFact & {
    outcome: "pending" | "qualified" | "refused";
  },
) => Promise<void>;

export async function captureKitchenActivity(
  tx: Transaction,
  attendance: { recorder: AttendanceRecorder; clock: TrustedClock } | undefined,
  personId: string | null | undefined,
  orderIds: readonly string[],
  commandKey: string = randomUUID(),
): Promise<void> {
  if (attendance === undefined || !personId || orderIds.length === 0) return;
  const at = attendance.clock.now().instant.toISOString();
  for (const id of new Set(orderIds)) {
    await attendance.recorder(tx, {
      source: "order",
      key: `service:${id}:${commandKey}`,
      personId,
      kind: "order",
      at,
      offsetMinutes: 0,
      outcome: "qualified",
    });
  }
}
const sourceKinds: Record<AttendanceSource, ActivityKind> = {
  session: "sign-in",
  draft: "order",
  order: "order",
  "whole-payment": "payment",
  "bill-payment": "payment",
  refund: "payment",
  clock: "break",
};

export const recordAttendanceFact: AttendanceRecorder = async (tx, fact) => {
  const instant = new Date(fact.at);
  if (
    !fact.key ||
    !fact.personId ||
    !Number.isFinite(instant.getTime()) ||
    sourceKinds[fact.source] !== fact.kind ||
    !["pending", "qualified", "refused"].includes(fact.outcome)
  ) {
    throw new AppError("attendance.invalid", { reason: "operation evidence" });
  }
  await recordStaffActivity(tx, fact.personId, instant);
};
