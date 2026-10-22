import { asc, eq } from "drizzle-orm";
import { parties, withTransaction, type Database } from "@waitron/db";
import {
  saveServiceSteps,
  serviceSteps,
  zoneServicePolicies,
  type ServiceStepInput,
} from "@waitron/venue-service";
import type { TillConfig } from "../till-config.js";

interface HasVenue {
  db: Database;
  cfg: Pick<TillConfig, "locationId">;
}

export async function departmentOf(v: HasVenue, zoneId: string): Promise<string> {
  const [row] = await withTransaction(v.db, (tx) =>
    tx
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, zoneId)),
  );
  return row!.departmentId;
}

/** Replaces every step the department holds, starters included; the new ids in list order. */
export async function setSteps(
  v: HasVenue,
  departmentId: string,
  steps: ServiceStepInput[],
): Promise<string[]> {
  return withTransaction(v.db, async (tx) => {
    await saveServiceSteps(tx, v.cfg, departmentId, steps);
    const rows = await tx
      .select({ id: serviceSteps.id })
      .from(serviceSteps)
      .where(eq(serviceSteps.departmentId, departmentId))
      .orderBy(asc(serviceSteps.position));
    return rows.map((row) => row.id);
  });
}

export async function setOpenedAt(v: HasVenue, partyId: string, iso: string): Promise<void> {
  await withTransaction(v.db, (tx) =>
    tx.update(parties).set({ openedAt: iso }).where(eq(parties.id, partyId)),
  );
}
