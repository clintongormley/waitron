import { incidents, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import { AppError, jobOrigin } from "@waitron/shared";
import "./errors.js";
import type { HeldAlertSink } from "./held-alert.js";

export type CaptureMismatchSink = Pick<HeldAlertSink, "raise" | "handle">;
export type CaptureMismatch = AppError<"payment.capture_mismatch">["params"]["payments"][number];

const CODE = "payment.capture_mismatch";

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
  const [order] = await tx
    .select({ orderNumber: workingOrders.orderNumber })
    .from(workingOrders)
    .where(eq(workingOrders.id, input.workingOrderId));
  const evidence = { ...input, ...(order === undefined ? {} : { orderNumber: order.orderNumber }) };
  const rows = await tx.select().from(incidents).where(eq(incidents.code, CODE));
  const open = rows.find((row) => row.acknowledgedAt === null);
  const payments = open === undefined ? [] : entries(open.params);
  if (open !== undefined) await sink.handle(tx, { id: open.id, personId: null, handledAt: now });
  return sink.raise(tx, {
    origin: jobOrigin("payment_check"),
    error: new AppError(CODE, { payments: [...payments, evidence] }),
    severity: "error",
    detectedAt: now,
  });
}

function entries(params: Record<string, unknown>): CaptureMismatch[] {
  return params.payments as CaptureMismatch[];
}

export async function findCaptureWarning(
  tx: Transaction,
  filter: { orderIds: readonly string[] } | { payment: { provider: string; paymentRef: string } },
): Promise<CaptureMismatch | undefined> {
  const rows = await tx
    .select({ params: incidents.params })
    .from(incidents)
    .where(eq(incidents.code, CODE));
  return rows
    .flatMap((row) => entries(row.params))
    .find((entry) =>
      "orderIds" in filter
        ? filter.orderIds.includes(entry.workingOrderId)
        : entry.provider === filter.payment.provider &&
          entry.paymentRef === filter.payment.paymentRef,
    );
}
