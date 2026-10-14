import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { newId, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { readLocationClock } from "@waitron/reporting";
import { AppError, businessDayAt, businessDayBounds } from "@waitron/shared";
import { offsetMinutes } from "@waitron/venue-service";
import {
  attendanceDayWork,
  attendanceOperationFacts,
  enqueueAttendanceDay,
} from "@waitron/workforce";
import type { ActivityKind, AttendanceFact, AttendanceSource } from "@waitron/workforce";

export type AttendanceRecorder = (
  tx: Transaction,
  fact: AttendanceFact & { outcome: "pending" | "qualified" | "refused" },
) => Promise<void>;

export async function captureKitchenActivity(
  tx: Transaction,
  attendance: { recorder: AttendanceRecorder; clock: TrustedClock } | undefined,
  personId: string | null | undefined,
  orderIds: readonly string[],
  commandKey: string = newId(),
): Promise<void> {
  if (attendance === undefined || !personId || orderIds.length === 0) return;
  const at = attendance.clock.now().instant.toISOString();
  for (const id of new Set(orderIds)) {
    const [order] = await tx
      .select({ locationId: workingOrders.locationId })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    await attendance.recorder(tx, {
      source: "order",
      key: `service:${id}:${commandKey}`,
      personId,
      locationId: order!.locationId,
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
    !fact.locationId ||
    !Number.isFinite(instant.getTime()) ||
    sourceKinds[fact.source] !== fact.kind ||
    !["pending", "qualified", "refused"].includes(fact.outcome)
  ) {
    throw new AppError("attendance.invalid", { reason: "operation evidence" });
  }
  const [existing] = await tx
    .select()
    .from(attendanceOperationFacts)
    .where(
      and(
        eq(attendanceOperationFacts.source, fact.source),
        eq(attendanceOperationFacts.key, fact.key),
      ),
    );
  const outcome = fact.outcome === "qualified" ? "qualifying" : fact.outcome;
  if (existing) {
    if (
      existing.outcome === outcome ||
      existing.outcome === "qualifying" ||
      (existing.outcome === "refused" && outcome === "pending")
    )
      return;
    await tx
      .update(attendanceOperationFacts)
      .set({ outcome })
      .where(eq(attendanceOperationFacts.sequence, existing.sequence));
    const scope = and(
      eq(attendanceDayWork.locationId, existing.locationId),
      eq(attendanceDayWork.businessDay, existing.businessDay),
    );
    const [work] = await tx.select().from(attendanceDayWork).where(scope);
    if (work) {
      await tx
        .update(attendanceDayWork)
        .set({ dirtyRevision: sql`${attendanceDayWork.dirtyRevision} + 1` })
        .where(scope);
    } else {
      const clock = await readLocationClock(tx, existing.locationId);
      await enqueueAttendanceDay(tx, {
        locationId: existing.locationId,
        businessDay: existing.businessDay,
        ...businessDayBounds(clock, existing.businessDay),
      });
    }
    return;
  }
  const at = new Date(Math.floor(instant.getTime() / 1000) * 1000);
  const clock = await readLocationClock(tx, fact.locationId);
  const businessDay = businessDayAt(clock, at);
  await tx.insert(attendanceOperationFacts).values({
    source: fact.source,
    key: fact.key,
    personId: fact.personId,
    locationId: fact.locationId,
    kind: fact.kind,
    at: at.toISOString(),
    offsetMinutes: offsetMinutes(at.getTime(), clock.timeZone),
    businessDay,
    outcome,
  });
  await enqueueAttendanceDay(tx, {
    locationId: fact.locationId,
    businessDay,
    ...businessDayBounds(clock, businessDay),
  });
};
