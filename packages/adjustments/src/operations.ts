import { and, asc, eq, max, ne } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PersonRoleValue } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  compareDecimal,
  contentLanguageCode,
  decimal,
  decimalToCents,
  type Decimal,
  type DeleteImpact,
} from "@waitron/shared";
import { reasonShapeFault, type AdjustmentAction, type AdjustmentReason } from "./policy.js";
import { adjustmentReasons, type ReasonKind } from "./schema/reasons.js";
import "./errors.js";

/** Everything an owner edits on a reason; `position` has an operation of its own. */
export interface AdjustmentReasonInput {
  name: string;
  names: Record<string, string>;
  kind: ReasonKind;
  actions: AdjustmentAction[];
  maxPercentBp: number | null;
  maxAmount: Decimal | null;
  applyRoles: PersonRoleValue[];
  approverRoles: PersonRoleValue[];
  noteRequired: boolean;
}

type ReasonRow = typeof adjustmentReasons.$inferSelect;

/** The order staff see reasons in: by position, then name. */
const STAFF_ORDER = [
  asc(adjustmentReasons.position),
  asc(adjustmentReasons.name),
  asc(adjustmentReasons.id),
];

function toReason(row: ReasonRow): AdjustmentReason {
  return {
    id: row.id,
    name: row.name,
    names: row.names,
    kind: row.kind,
    actions: row.actions,
    maxPercentBp: row.maxPercent,
    maxAmount: row.maxAmount === null ? null : centsToDecimal(row.maxAmount),
    applyRoles: row.applyRoles,
    approverRoles: row.approverRoles,
    noteRequired: row.noteRequired,
    position: row.position,
  };
}

function invalid(field: string): AppError {
  return new AppError("adjustment_reason.invalid", { field });
}

/**
 * Each key must be a language; a blank text is no name in that language, so it is left out. A bad
 * key is reported against `names`, because `contentLanguageCode`'s own refusal names no field.
 */
function nonBlankNames(names: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [language, text] of Object.entries(names)) {
    try {
      contentLanguageCode(language);
    } catch {
      throw invalid("names");
    }
    if (text.trim() !== "") kept[language] = text;
  }
  return kept;
}

/** The row values for `input`, refused field by field where the policy would be meaningless. */
function reasonValues(input: AdjustmentReasonInput) {
  const name = input.name.trim();
  if (name === "") throw invalid("name");
  const fault = reasonShapeFault(input);
  if (fault !== null) throw invalid(fault);
  const amount = input.maxAmount;
  if (
    amount !== null &&
    (compareDecimal(amount, decimal("0")) <= 0 ||
      compareDecimal(centsToDecimal(decimalToCents(amount)), amount) !== 0)
  ) {
    throw invalid("maxAmount");
  }
  return {
    name,
    names: nonBlankNames(input.names),
    kind: input.kind,
    actions: input.actions,
    maxPercent: input.maxPercentBp,
    maxAmount: amount === null ? null : decimalToCents(amount),
    applyRoles: input.applyRoles,
    approverRoles: input.approverRoles,
    noteRequired: input.noteRequired,
  };
}

/**
 * The fault in a change to a Void reason that would leave the venue no Void reason, or none that
 * asks for a note (A758 D27): `withNote` says which. `after` is the reason's state once changed,
 * `null` once deleted. Returns null when there is no fault.
 */
export async function voidKeptFault(
  tx: Transaction,
  before: ReasonRow,
  after: { kind: ReasonKind; noteRequired: boolean } | null,
): Promise<{ withNote: boolean } | null> {
  if (before.kind !== "void") return null;
  const others = await tx
    .select({ noteRequired: adjustmentReasons.noteRequired })
    .from(adjustmentReasons)
    .where(and(eq(adjustmentReasons.kind, "void"), ne(adjustmentReasons.id, before.id)));
  const remaining = after !== null && after.kind === "void" ? [...others, after] : others;
  if (remaining.length === 0) return { withNote: false };
  if (before.noteRequired && !remaining.some((reason) => reason.noteRequired)) {
    return { withNote: true };
  }
  return null;
}

async function assertVoidKept(
  tx: Transaction,
  before: ReasonRow,
  after: { kind: ReasonKind; noteRequired: boolean } | null,
): Promise<void> {
  const fault = await voidKeptFault(tx, before, after);
  if (fault !== null) throw new AppError("adjustment_reason.void_required", fault);
}

async function assertNameFree(tx: Transaction, name: string, except: string | null) {
  const [clash] = await tx
    .select({ id: adjustmentReasons.id })
    .from(adjustmentReasons)
    .where(
      and(
        eq(adjustmentReasons.name, name),
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

/** One reason by its id; `adjustment_reason.not_found` when none has it. */
export async function findAdjustmentReason(
  tx: Transaction,
  reasonId: string,
): Promise<AdjustmentReason> {
  return toReason(await findReason(tx, reasonId));
}

/** Every reason, in the order staff see them. */
export async function listAdjustmentReasons(tx: Transaction): Promise<AdjustmentReason[]> {
  const rows = await tx
    .select()
    .from(adjustmentReasons)
    .orderBy(...STAFF_ORDER);
  return rows.map(toReason);
}

/** Adds a reason after every existing one. */
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

/** Replaces every field an owner edits; `position` is left as it is. */
export async function updateAdjustmentReason(
  tx: Transaction,
  reasonId: string,
  input: AdjustmentReasonInput,
): Promise<AdjustmentReason> {
  const values = reasonValues(input);
  const existing = await findReason(tx, reasonId);
  await assertNameFree(tx, values.name, reasonId);
  await assertVoidKept(tx, existing, values);
  const [row] = await tx
    .update(adjustmentReasons)
    .set(values)
    .where(eq(adjustmentReasons.id, reasonId))
    .returning();
  return toReason(row!);
}

/** What deleting a reason would do: only the Void guard can refuse it, and it ends or removes nothing. */
export async function readAdjustmentReasonDeleteImpact(
  tx: Transaction,
  reasonId: string,
): Promise<DeleteImpact> {
  const existing = await findReason(tx, reasonId);
  const fault = await voidKeptFault(tx, existing, null);
  return {
    target: { id: existing.id, name: existing.name },
    refusals:
      fault === null
        ? []
        : [
            {
              code: "adjustment_reason.void_required",
              params: { withNote: Number(fault.withNote) },
              targets: [],
            },
          ],
    ends: [],
    removes: [],
  };
}

/** An adjustment keeps the reason's id and name it was recorded under, so none is touched. */
export async function deleteAdjustmentReason(tx: Transaction, reasonId: string): Promise<void> {
  const existing = await findReason(tx, reasonId);
  await assertVoidKept(tx, existing, null);
  await tx.delete(adjustmentReasons).where(eq(adjustmentReasons.id, reasonId));
}

/**
 * Puts the reasons in the order given. `ids` must name every reason exactly once, so a screen
 * working from a stale list is refused rather than half-applied.
 */
export async function reorderAdjustmentReasons(
  tx: Transaction,
  ids: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({ id: adjustmentReasons.id, position: adjustmentReasons.position })
    .from(adjustmentReasons);
  const current = new Map(rows.map((row) => [row.id, row.position]));
  const unknown = ids.find((reasonId) => !current.has(reasonId));
  if (unknown !== undefined)
    throw new AppError("adjustment_reason.not_found", { reasonId: unknown });
  if (new Set(ids).size !== ids.length || ids.length !== current.size) throw invalid("ids");
  for (const [position, reasonId] of ids.entries()) {
    if (current.get(reasonId) === position) continue;
    await tx.update(adjustmentReasons).set({ position }).where(eq(adjustmentReasons.id, reasonId));
  }
}
