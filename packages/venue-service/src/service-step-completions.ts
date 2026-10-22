import { asc, eq, inArray } from "drizzle-orm";
import { diningTables, type Transaction } from "@waitron/db";
import { zoneServicePolicies } from "./schema/service.js";
import {
  serviceStepCompletions,
  serviceSteps,
  type ServiceStepStart,
} from "./schema/service-steps.js";

export interface StepRule {
  id: string;
  name: string;
  start: ServiceStepStart;
  courseId: string | null;
  minutes: number;
}

/** A table in no department is absent; one whose department has no steps has `rules: []`. */
export async function readTableStepRules(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Map<string, { departmentId: string; rules: StepRule[] }>> {
  const found = new Map<string, { departmentId: string; rules: StepRule[] }>();
  if (tableIds.length === 0) return found;
  const rows = await tx
    .select({
      tableId: diningTables.id,
      departmentId: zoneServicePolicies.departmentId,
      id: serviceSteps.id,
      name: serviceSteps.name,
      start: serviceSteps.start,
      courseId: serviceSteps.courseId,
      minutes: serviceSteps.minutes,
    })
    .from(diningTables)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, diningTables.zoneId))
    .leftJoin(serviceSteps, eq(serviceSteps.departmentId, zoneServicePolicies.departmentId))
    .where(inArray(diningTables.id, [...tableIds]))
    .orderBy(asc(serviceSteps.position), asc(serviceSteps.id));
  for (const row of rows) {
    let table = found.get(row.tableId);
    if (table === undefined) {
      table = { departmentId: row.departmentId, rules: [] };
      found.set(row.tableId, table);
    }
    if (row.id === null) continue;
    table.rules.push({
      id: row.id,
      name: row.name!,
      start: row.start!,
      courseId: row.courseId,
      minutes: row.minutes!,
    });
  }
  return found;
}

/** Every Done of the given parties, unordered; a step done again has a row per Done. */
export async function readStepCompletions(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<{ partyId: string; stepId: string; doneAt: string }[]> {
  if (partyIds.length === 0) return [];
  return tx
    .select({
      partyId: serviceStepCompletions.partyId,
      stepId: serviceStepCompletions.stepId,
      doneAt: serviceStepCompletions.doneAt,
    })
    .from(serviceStepCompletions)
    .where(inArray(serviceStepCompletions.partyId, [...partyIds]));
}

export async function recordStepCompletions(
  tx: Transaction,
  rows: readonly { partyId: string; stepId: string; doneAt: string; doneBy: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(serviceStepCompletions).values([...rows]);
}
