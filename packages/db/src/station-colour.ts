import { eq } from "drizzle-orm";
import { firstUnusedStationColour, type StationColour } from "@waitron/shared";
import type { Transaction } from "./client.js";
import { kitchenStations } from "./schema/kitchen-stations.js";

export async function nextStationColour(
  tx: Transaction,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- venue-apply.ts still passes it; A1301 S16 drops it
  _locationId?: string,
): Promise<StationColour> {
  const rows = await tx
    .select({ colour: kitchenStations.colour })
    .from(kitchenStations)
    .where(eq(kitchenStations.active, true));
  return firstUnusedStationColour(rows.map(({ colour }) => colour));
}
