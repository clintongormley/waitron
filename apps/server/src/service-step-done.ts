import { and, eq, isNull } from "drizzle-orm";
import { parties, partyTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  readStepCompletions,
  readTableStepRules,
  recordStepCompletions,
} from "@waitron/venue-service";
import { CLOCK_AHEAD_MS, stepsClearedByDone } from "./service-step-reckoning.js";
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

/**
 * Done travels with a bill only to a party with no dishes of its own (one just opened at a free
 * table or by a split), never onto a seated table or in a combine, where it would hide the
 * receiving party's own due step. `to` gets `from`'s latest Done of each step of `tableIds`'
 * departments that a serving starts, one row per step: the dishes it takes keep their serving
 * times, so without it such a step would be asked again. A step that follows another needs none,
 * as the arrival counts as `to`'s first order and clears it.
 */
export async function carryDoneWithBill(
  tx: Transaction,
  from: string,
  to: string,
  tableIds: readonly string[],
): Promise<void> {
  const carried = new Set<string>();
  for (const { rules } of (await readTableStepRules(tx, tableIds)).values()) {
    for (const rule of rules) {
      if (rule.start === "course_served" || rule.start === "all_served") carried.add(rule.id);
    }
  }
  if (carried.size === 0) return;
  const fromLatest = new Map<string, { doneAt: string; doneBy: string }>();
  for (const row of await readStepCompletions(tx, [from])) {
    if (!carried.has(row.stepId)) continue;
    const kept = fromLatest.get(row.stepId);
    if (kept === undefined || Date.parse(row.doneAt) > Date.parse(kept.doneAt))
      fromLatest.set(row.stepId, row);
  }
  await recordStepCompletions(
    tx,
    [...fromLatest].map(([stepId, { doneAt, doneBy }]) => ({
      partyId: to,
      stepId,
      doneAt,
      doneBy,
    })),
  );
}
