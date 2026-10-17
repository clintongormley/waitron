import { and, eq } from "drizzle-orm";
import { firstUnusedStationColour, type StationColour } from "@waitron/shared";
import type { Transaction } from "./client.js";
import { kitchenStations } from "./schema/kitchen-stations.js";

export async function nextStationColour(
  tx: Transaction,
  locationId: string,
): Promise<StationColour> {
  const rows = await tx
    .select({ colour: kitchenStations.colour })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.locationId, locationId), eq(kitchenStations.active, true)));
  return firstUnusedStationColour(rows.map(({ colour }) => colour));
}
