import "./errors.js";
import { eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Transaction } from "./client.js";
import { kitchenTimingDefaults } from "./schema/kitchen-timing.js";
import { locations } from "./schema/tenants.js";

// Inner timing joins must not turn incomplete configuration into an empty kitchen.
export async function assertKitchenTimingPresent(tx: Transaction): Promise<void> {
  const [missing] = await tx
    .select({ locationId: locations.id })
    .from(locations)
    .leftJoin(kitchenTimingDefaults, eq(kitchenTimingDefaults.locationId, locations.id))
    .where(isNull(kitchenTimingDefaults.locationId))
    .limit(1);
  if (missing !== undefined) throw new AppError("station.timing_missing", missing);
}
