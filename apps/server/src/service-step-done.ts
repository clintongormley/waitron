import { and, eq, isNull } from "drizzle-orm";
import { parties, partyTables, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { recordStepCompletions } from "@waitron/venue-service";
import { readTableSteps } from "./service-step-signals.js";
import "./errors.js";

/**
 * Records Done for a live step and for every live step of its department due no later, the ones
 * it was hiding, at one time. A step no longer live clears nothing and writes nothing, so a second
 * tap is harmless. Tables of one department share their steps, so one table's list names each once.
 */
export async function markServiceStepDone(
  tx: Transaction,
  args: { partyId: string; stepId: string; personId: string; nowMs: number },
): Promise<{ cleared: string[] }> {
  const { partyId, stepId, personId, nowMs } = args;
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
  const steps = await readTableSteps(
    tx,
    [{ partyId, openedAt: party.openedAt, tableIds: tables.map((row) => row.tableId) }],
    nowMs,
  );
  const table = [...steps.values()].find((entry) => entry.ruleIds.has(stepId));
  if (table === undefined) throw new AppError("service_step.not_found", { stepId });
  const shown = table.live.find((step) => step.stepId === stepId);
  if (shown === undefined) return { cleared: [] };
  const cleared = table.live.filter((step) => step.dueAt <= shown.dueAt).map((step) => step.stepId);
  const doneAt = new Date(nowMs).toISOString();
  await recordStepCompletions(
    tx,
    cleared.map((id) => ({ partyId, stepId: id, doneAt, doneBy: personId })),
  );
  return { cleared };
}
