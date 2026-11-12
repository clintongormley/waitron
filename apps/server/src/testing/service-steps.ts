import { asc, eq } from "drizzle-orm";
import { parties, withTransaction, type Database } from "@waitron/db";
import {
  saveServiceSteps,
  serviceSteps,
  floorZones,
  type ServiceStepInput,
} from "@waitron/venue-service";

interface HasVenue {
  db: Database;
}

export async function departmentOf(v: HasVenue, zoneId: string): Promise<string> {
  const [row] = await withTransaction(v.db, (tx) =>
    tx
      .select({ departmentId: floorZones.departmentId })
      .from(floorZones)
      .where(eq(floorZones.id, zoneId)),
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
    await saveServiceSteps(tx, departmentId, steps);
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
