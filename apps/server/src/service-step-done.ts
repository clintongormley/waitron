import { and, eq, inArray, isNull } from "drizzle-orm";
import { parties, partyTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  readTableStepRules,
  recordStepCompletions,
  serviceStepCompletions,
} from "@waitron/venue-service";
import { stepsClearedByDone } from "./service-step-reckoning.js";
import { readStepFacts } from "./service-step-signals.js";
import { assertSubjectZones } from "./zone-access.js";
import "./errors.js";

/**
 * Below the shortest repeat interval (one minute, `service_steps_minutes_ck`), so a Done accepted
 * early can only be for the repeat the server shows next, never one beyond it.
 */
const CLOCK_AHEAD_MS = 30_000;

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
 * Gives party `to` the Done rows party `from` holds for the steps of `tableIds`' departments that
 * start from a serving: a moved bill's dishes keep their serving times, so without them a step
 * already done would be asked again. A repeating step counts afresh from the arrival, and a seated
 * step clears on it, so their Done stays behind.
 */
export async function carryServingStepDones(
  tx: Transaction,
  from: string,
  to: string,
  tableIds: readonly string[],
): Promise<void> {
  const stepIds = [...(await readTableStepRules(tx, tableIds)).values()].flatMap((table) =>
    table.rules
      .filter((rule) => rule.start === "course_served" || rule.start === "all_served")
      .map((rule) => rule.id),
  );
  if (stepIds.length === 0) return;
  const rows = await tx
    .select({
      stepId: serviceStepCompletions.stepId,
      doneAt: serviceStepCompletions.doneAt,
      doneBy: serviceStepCompletions.doneBy,
    })
    .from(serviceStepCompletions)
    .where(
      and(
        eq(serviceStepCompletions.partyId, from),
        inArray(serviceStepCompletions.stepId, stepIds),
      ),
    );
  await recordStepCompletions(
    tx,
    rows.map((row) => ({ partyId: to, ...row })),
  );
}
