import { eq } from "drizzle-orm";
import { devices, locations, nodes } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { NodeId, SaleOrigin } from "@waitron/shared";

/**
 * The description of operation a sale files with: its device's location's, or, for a sale with no
 * device, the location of the node that chains it.
 */
export async function operationDescriptionFor(
  tx: Transaction,
  origin: SaleOrigin,
  nodeId: NodeId,
): Promise<string> {
  const [location] =
    origin.deviceId === null
      ? await tx
          .select({ operationDescription: locations.operationDescription })
          .from(nodes)
          .innerJoin(locations, eq(locations.id, nodes.locationId))
          .where(eq(nodes.id, nodeId))
      : await tx
          .select({ operationDescription: locations.operationDescription })
          .from(devices)
          .innerJoin(locations, eq(locations.id, devices.locationId))
          .where(eq(devices.id, origin.deviceId));
  /* v8 ignore start */
  if (location === undefined) {
    // `devices.location_id` and `nodes.location_id` are not-null foreign keys, and the sale row
    // written before this read names the device and node by key, so neither can be missing here.
    throw new Error(`no location found for the sale's ${origin.deviceId ?? nodeId}`);
  }
  /* v8 ignore stop */
  return location.operationDescription;
}
