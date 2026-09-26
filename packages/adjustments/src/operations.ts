import { and, asc, eq, max, ne } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { roleAtLeast, type PersonRoleValue } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  decimal,
  decimalToCents,
  type Decimal,
} from "@waitron/shared";
import type { AdjustmentAction, AdjustmentReason } from "./policy.js";
import { adjustmentReasons } from "./schema/reasons.js";
import "./errors.js";
// The registry of `management.request_invalid`, which this file throws.
import "@waitron/server-kit";

/** Everything an owner edits on a reason; `active` and `position` have operations of their own. */
export interface AdjustmentReasonInput {
  name: string;
  names: Record<string, string>;
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: Decimal | null;
  applyRole: PersonRoleValue;
  approverRole: PersonRoleValue;
  noteRequired: boolean;
}

type ReasonRow = typeof adjustmentReasons.$inferSelect;

function toReason(row: ReasonRow): AdjustmentReason {
  return {
    id: row.id,
    name: row.name,
    names: row.names,
    actions: row.actions,
    maxPercentBp: row.maxPercent,
    maxAmount: row.maxAmount === null ? null : centsToDecimal(row.maxAmount),
    applyRole: row.applyRole,
    approverRole: row.approverRole,
    noteRequired: row.noteRequired,
    active: row.active,
    position: row.position,
  };
}

function invalid(field: string): AppError {
  return new AppError("management.request_invalid", { field });
}

/** The row values for `input`, refused field by field where the policy would be meaningless. */
function reasonValues(input: AdjustmentReasonInput) {
  const name = input.name.trim();
  if (name === "") throw invalid("name");
  if (input.actions.length === 0 || new Set(input.actions).size !== input.actions.length) {
    throw invalid("actions");
  }
  const percent = input.maxPercentBp;
  if (percent !== null && (!Number.isInteger(percent) || percent <= 0 || percent > 10000)) {
    throw invalid("maxPercentBp");
  }
  const amount = input.maxAmount;
  if (
    amount !== null &&
    (compareDecimal(amount, decimal("0")) <= 0 ||
      compareDecimal(centsToDecimal(decimalToCents(amount)), amount) !== 0)
  ) {
    throw invalid("maxAmount");
  }
  // An approver below the applying role could allow what they may not do themselves.
  if (!roleAtLeast(input.approverRole, input.applyRole)) throw invalid("approverRole");
  return {
    name,
    names: input.names,
    actions: input.actions,
    maxPercent: percent,
    maxAmount: amount === null ? null : decimalToCents(amount),
    applyRole: input.applyRole,
    approverRole: input.approverRole,
    noteRequired: input.noteRequired,
  };
}

/** Only active names are unique, so an inactive reason's name is never "taken". */
async function assertNameFree(tx: Transaction, name: string, except: string | null) {
  const [clash] = await tx
    .select({ id: adjustmentReasons.id })
    .from(adjustmentReasons)
    .where(
      and(
        eq(adjustmentReasons.name, name),
        eq(adjustmentReasons.active, true),
        except === null ? undefined : ne(adjustmentReasons.id, except),
      ),
    );
  if (clash) throw new AppError("adjustment_reason.name_taken", { name });
}

async function findReason(tx: Transaction, reasonId: string): Promise<ReasonRow> {
  const [row] = await tx.select().from(adjustmentReasons).where(eq(adjustmentReasons.id, reasonId));
  if (row === undefined) throw new AppError("adjustment_reason.not_found", { reasonId });
  return row;
}

/** Reasons in the order staff see them: by position, then name. Active ones only unless asked. */
export async function listAdjustmentReasons(
  tx: Transaction,
  opts: { includeInactive?: boolean } = {},
): Promise<AdjustmentReason[]> {
  const rows = await tx
    .select()
    .from(adjustmentReasons)
    .where(opts.includeInactive === true ? undefined : eq(adjustmentReasons.active, true))
    .orderBy(
      asc(adjustmentReasons.position),
      asc(adjustmentReasons.name),
      asc(adjustmentReasons.id),
    );
  return rows.map(toReason);
}

/** Adds an active reason after every existing one. */
export async function createAdjustmentReason(
  tx: Transaction,
  input: AdjustmentReasonInput,
): Promise<AdjustmentReason> {
  const values = reasonValues(input);
  await assertNameFree(tx, values.name, null);
  const [last] = await tx
    .select({ position: max(adjustmentReasons.position) })
    .from(adjustmentReasons);
  const position = (last?.position ?? -1) + 1;
  const [row] = await tx
    .insert(adjustmentReasons)
    .values({ ...values, position })
    .returning();
  return toReason(row!);
}

/** Replaces every field an owner edits; `active` and `position` are left as they are. */
export async function updateAdjustmentReason(
  tx: Transaction,
  reasonId: string,
  input: AdjustmentReasonInput,
): Promise<AdjustmentReason> {
  const values = reasonValues(input);
  const existing = await findReason(tx, reasonId);
  if (existing.active) await assertNameFree(tx, values.name, reasonId);
  const [row] = await tx
    .update(adjustmentReasons)
    .set(values)
    .where(eq(adjustmentReasons.id, reasonId))
    .returning();
  return toReason(row!);
}

/** Kept, never deleted, so anything naming the reason by id can still read it. */
export async function deactivateAdjustmentReason(tx: Transaction, reasonId: string): Promise<void> {
  await findReason(tx, reasonId);
  await tx
    .update(adjustmentReasons)
    .set({ active: false })
    .where(eq(adjustmentReasons.id, reasonId));
}

/**
 * Puts the active reasons in the order given. `ids` must name every active reason exactly once, so
 * a screen working from a stale list is refused rather than half-applied.
 */
export async function reorderAdjustmentReasons(
  tx: Transaction,
  ids: readonly string[],
): Promise<void> {
  const active = new Set(
    (
      await tx
        .select({ id: adjustmentReasons.id })
        .from(adjustmentReasons)
        .where(eq(adjustmentReasons.active, true))
    ).map((row) => row.id),
  );
  const unknown = ids.find((reasonId) => !active.has(reasonId));
  if (unknown !== undefined)
    throw new AppError("adjustment_reason.not_found", { reasonId: unknown });
  if (new Set(ids).size !== ids.length || ids.length !== active.size) throw invalid("ids");
  for (const [position, reasonId] of ids.entries()) {
    await tx.update(adjustmentReasons).set({ position }).where(eq(adjustmentReasons.id, reasonId));
  }
}
