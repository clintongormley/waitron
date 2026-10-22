import { and, eq, isNull } from "drizzle-orm";
import { parties, partyTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { recordStepCompletions } from "@waitron/venue-service";
import { stepsClearedByDone } from "./service-step-reckoning.js";
import { readStepFacts } from "./service-step-signals.js";
import type { TillConfig } from "./till-config.js";
import { assertSubjectZones } from "./zone-access.js";
import "./errors.js";

/**
 * Records Done for a live step and for every live step of its department due no later, the ones
 * it was hiding, at one time. A Done that would change nothing writes nothing, so a second tap is
 * harmless. Tables of one department share their steps, so one table's list names each once. The
 * table the step was found on is held to the profile's zones, as the party is by the route.
 */
export async function markServiceStepDone(
  tx: Transaction,
  args: {
    cfg: TillConfig;
    deviceProfileId: string;
    partyId: string;
    stepId: string;
    personId: string;
    nowMs: number;
  },
): Promise<{ cleared: string[] }> {
  const { cfg, deviceProfileId, partyId, stepId, personId, nowMs } = args;
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
  await assertSubjectZones(tx, cfg, deviceProfileId, [{ tableId }]);
  const cleared = stepsClearedByDone(table.rules, table.facts, stepId, nowMs);
  if (cleared.length === 0) return { cleared: [] };
  const doneAt = new Date(nowMs).toISOString();
  await recordStepCompletions(
    tx,
    cleared.map((id) => ({ partyId, stepId: id, doneAt, doneBy: personId })),
  );
  return { cleared };
}
