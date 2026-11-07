import { incidents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { AppError, jobOrigin } from "@waitron/shared";
import "./errors.js";
import type { HeldAlertSink } from "./held-alert.js";

export type CaptureMismatchSink = Pick<HeldAlertSink, "raise" | "handle">;
export interface CaptureMismatch {
  provider: string;
  paymentRef: string;
  workingOrderId: string;
  externalRef: string;
  requestedAmount: string;
  reportedAmount: string;
}
const CODE = "payment.capture_mismatch";

// Acknowledging the alert does not resolve the charge; older snapshots retain its evidence.
export async function hasCaptureMismatch(
  tx: Transaction,
  key: { provider: string; paymentRef: string },
): Promise<boolean> {
  const rows = await tx
    .select({ params: incidents.params })
    .from(incidents)
    .where(eq(incidents.code, CODE));
  return rows.some((row) =>
    entries(row.params).some(
      (entry) => entry.provider === key.provider && entry.paymentRef === key.paymentRef,
    ),
  );
}

export async function recordCaptureMismatch(
  tx: Transaction,
  sink: CaptureMismatchSink,
  input: CaptureMismatch,
  now: Date,
): Promise<boolean> {
  if (await hasCaptureMismatch(tx, input)) return false;
  const rows = await tx.select().from(incidents).where(eq(incidents.code, CODE));
  const open = rows.find((row) => row.acknowledgedAt === null);
  const payments = open === undefined ? [] : entries(open.params);
  if (open !== undefined) await sink.handle(tx, { id: open.id, personId: null, handledAt: now });
  return sink.raise(tx, {
    origin: jobOrigin("payment_check"),
    error: new AppError(CODE, { payments: [...payments, input] }),
    severity: "error",
    detectedAt: now,
  });
}

function entries(params: Record<string, unknown>): CaptureMismatch[] {
  return params.payments as CaptureMismatch[];
}
