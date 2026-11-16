import { and, eq, isNull } from "drizzle-orm";
import { parties, partyTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  readStepCompletions,
  readTableStepRules,
  recordStepCompletions,
} from "@waitron/venue-service";
import { CLOCK_AHEAD_MS, stepsClearedByDone, type StepRule } from "./service-step-reckoning.js";
import { readStepFacts } from "./service-step-signals.js";
import { assertSubjectZones } from "./zone-access.js";
import "./errors.js";

/**
 * Records Done for a live step and for every live step of its department due no later, the ones
 * it was hiding, at one time. `dueAt` is when the till showed the step as due: a Done for that
 * occurrence once it is cleared, or one that would change nothing, writes nothing, so a second
 * tap, or a second till's, is harmless. A repeat of an every-N-minutes step shown due up to
 * {@link CLOCK_AHEAD_MS} before the server's clock reaches it, by a till whose clock is ahead, is
 * reckoned and recorded as done at its `dueAt`. Tables of one department share their steps, so one
 * table's list names each once. The table the step was found on is held to the profile's zones,
 * as the party is by the route.
 */
export async function markServiceStepDone(
  tx: Transaction,
  args: {
    deviceProfileId: string;
    partyId: string;
    stepId: string;
    dueAt: number;
    personId: string;
    nowMs: number;
  },
): Promise<{ cleared: string[] }> {
  const { deviceProfileId, partyId, stepId, dueAt, personId, nowMs } = args;
  const [party] = await tx
    .select({ state: parties.state, openedAt: parties.openedAt })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined || party.state !== "open") {
    throw new AppError("party.not_open", { partyId });
  }
  const tables = await tx
    .select({ tableId: partyTables.tableId })
    .from(partyTables)
    .where(and(eq(partyTables.partyId, partyId), isNull(partyTables.leftAt)));
  const steps = await readStepFacts(tx, [
    { partyId, openedAt: party.openedAt, tableIds: tables.map((row) => row.tableId) },
  ]);
  const found = [...steps].find(([, entry]) => entry.rules.some((rule) => rule.id === stepId));
  if (found === undefined) throw new AppError("service_step.not_found", { stepId });
  const [tableId, table] = found;
  await assertSubjectZones(tx, deviceProfileId, [{ tableId }]);
  const tapped = table.rules.find((rule) => rule.id === stepId)!;
  const at =
    tapped.start === "since_last_order" && dueAt > nowMs && dueAt - nowMs <= CLOCK_AHEAD_MS
      ? dueAt
      : nowMs;
  const cleared = stepsClearedByDone(table.rules, table.facts, { stepId, dueAt }, at);
  if (cleared.length === 0) return { cleared: [] };
  const doneAt = new Date(at).toISOString();
  await recordStepCompletions(
    tx,
    cleared.map((id) => ({ partyId, stepId: id, doneAt, doneBy: personId })),
  );
  return { cleared };
}

/** Whether a serving starts the step, or a step it follows at any remove. */
function startsFromServing(rule: StepRule, byId: ReadonlyMap<string, StepRule>): boolean {
  const seen = new Set<string>();
  let step: StepRule | undefined = rule;
  while (step?.start === "after_step" && !seen.has(step.id)) {
    seen.add(step.id);
    step = step.afterStepId === null ? undefined : byId.get(step.afterStepId);
  }
  return step?.start === "course_served" || step?.start === "all_served";
}

/**
 * Gives party `to` party `from`'s latest Done of each step of `tableIds`' departments that
 * {@link startsFromServing}, unless `to` holds one as late. The dishes `to` takes keep their
 * serving times, so without it such a step would be asked again.
 */
export async function carryDoneWithBill(
  tx: Transaction,
  from: string,
  to: string,
  tableIds: readonly string[],
): Promise<void> {
  const carried = new Set<string>();
  for (const { rules } of (await readTableStepRules(tx, tableIds)).values()) {
    const byId = new Map(rules.map((rule) => [rule.id, rule]));
    for (const rule of rules) if (startsFromServing(rule, byId)) carried.add(rule.id);
  }
  if (carried.size === 0) return;
  const fromLatest = new Map<string, { doneAt: string; doneBy: string }>();
  const toLatest = new Map<string, number>();
  for (const row of await readStepCompletions(tx, [from, to])) {
    if (!carried.has(row.stepId)) continue;
    const at = Date.parse(row.doneAt);
    if (row.partyId === to) {
      toLatest.set(row.stepId, Math.max(toLatest.get(row.stepId) ?? at, at));
      continue;
    }
    const kept = fromLatest.get(row.stepId);
    if (kept === undefined || at > Date.parse(kept.doneAt)) fromLatest.set(row.stepId, row);
  }
  await recordStepCompletions(
    tx,
    [...fromLatest]
      .filter(([stepId, { doneAt }]) => Date.parse(doneAt) > (toLatest.get(stepId) ?? -Infinity))
      .map(([stepId, { doneAt, doneBy }]) => ({ partyId: to, stepId, doneAt, doneBy })),
  );
}
