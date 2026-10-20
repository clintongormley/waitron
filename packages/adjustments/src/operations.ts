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
} from "@waitron/shared";
import { reasonShapeFault, type AdjustmentAction, type AdjustmentReason } from "./policy.js";
import { adjustmentReasons, type ReasonKind } from "./schema/reasons.js";
import "./errors.js";

/** Everything an owner edits on a reason; `active` and `position` have operations of their own. */
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
    active: row.active,
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
 * Refuses a change to a switched-on Void reason that would leave the venue no switched-on Void
 * reason, or none that asks for a note (A758 D27). `after` is the reason's state once changed;
 * a reason that was not a switched-on Void reason is never refused.
 */
async function assertVoidKept(
  tx: Transaction,
  before: ReasonRow,
  after: { active: boolean; kind: ReasonKind; noteRequired: boolean },
): Promise<void> {
  if (!before.active || before.kind !== "void") return;
  const others = await tx
    .select({ noteRequired: adjustmentReasons.noteRequired })
    .from(adjustmentReasons)
    .where(
      and(
        eq(adjustmentReasons.active, true),
        eq(adjustmentReasons.kind, "void"),
        ne(adjustmentReasons.id, before.id),
      ),
    );
  const remaining = after.active && after.kind === "void" ? [...others, after] : others;
  if (remaining.length === 0) {
    throw new AppError("adjustment_reason.void_required", { withNote: false });
  }
  if (before.noteRequired && !remaining.some((reason) => reason.noteRequired)) {
    throw new AppError("adjustment_reason.void_required", { withNote: true });
  }
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

/** One reason by its id, active or not; `adjustment_reason.not_found` when none has it. */
export async function findAdjustmentReason(
  tx: Transaction,
  reasonId: string,
): Promise<AdjustmentReason> {
  return toReason(await findReason(tx, reasonId));
}

/** Reasons in the order staff see them. Active ones only unless asked. */
export async function listAdjustmentReasons(
  tx: Transaction,
  opts: { includeInactive?: boolean } = {},
): Promise<AdjustmentReason[]> {
  const rows = await tx
    .select()
    .from(adjustmentReasons)
    .where(opts.includeInactive === true ? undefined : eq(adjustmentReasons.active, true))
    .orderBy(...STAFF_ORDER);
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
  await assertVoidKept(tx, existing, { ...values, active: existing.active });
  const [row] = await tx
    .update(adjustmentReasons)
    .set(values)
    .where(eq(adjustmentReasons.id, reasonId))
    .returning();
  return toReason(row!);
}

/** Kept, never deleted, so anything naming the reason by id can still read it. */
export async function deactivateAdjustmentReason(tx: Transaction, reasonId: string): Promise<void> {
  const existing = await findReason(tx, reasonId);
  await assertVoidKept(tx, existing, { ...existing, active: false });
  await tx
    .update(adjustmentReasons)
    .set({ active: false })
    .where(eq(adjustmentReasons.id, reasonId));
}

/** Keeps its position, so no two reasons come to share one. Refused while an active reason holds
 * its name, which the partial unique index would otherwise refuse with no domain code. */
export async function reactivateAdjustmentReason(
  tx: Transaction,
  reasonId: string,
): Promise<AdjustmentReason> {
  const existing = await findReason(tx, reasonId);
  await assertNameFree(tx, existing.name, reasonId);
  const [row] = await tx
    .update(adjustmentReasons)
    .set({ active: true })
    .where(eq(adjustmentReasons.id, reasonId))
    .returning();
  return toReason(row!);
}

/**
 * Puts the active reasons in the order given, then the inactive ones after them in the order they
 * already had, so no two reasons share a position. `ids` must name every active reason exactly
 * once, so a screen working from a stale list is refused rather than half-applied.
 */
export async function reorderAdjustmentReasons(
  tx: Transaction,
  ids: readonly string[],
): Promise<void> {
  const rows = await tx
    .select({
      id: adjustmentReasons.id,
      active: adjustmentReasons.active,
      position: adjustmentReasons.position,
    })
    .from(adjustmentReasons)
    .orderBy(...STAFF_ORDER);
  const current = new Map(rows.map((row) => [row.id, row.position]));
  const active = new Set(rows.filter((row) => row.active).map((row) => row.id));
  const inactive = rows.filter((row) => !row.active).map((row) => row.id);
  const unknown = ids.find((reasonId) => !active.has(reasonId));
  if (unknown !== undefined)
    throw new AppError("adjustment_reason.not_found", { reasonId: unknown });
  if (new Set(ids).size !== ids.length || ids.length !== active.size) throw invalid("ids");
  for (const [position, reasonId] of [...ids, ...inactive].entries()) {
    if (current.get(reasonId) === position) continue;
    await tx.update(adjustmentReasons).set({ position }).where(eq(adjustmentReasons.id, reasonId));
  }
}
