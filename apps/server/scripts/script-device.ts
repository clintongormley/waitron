import { eq } from "drizzle-orm";
import { deviceProfiles, devices, nodes } from "@waitron/db";
import type { Transaction } from "@waitron/db";

/** The location `nodeId` sells at. */
export async function nodeLocation(tx: Transaction, nodeId: string): Promise<string> {
  const [node] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, nodeId));
  if (node === undefined) throw new Error(`no node ${nodeId}`);
  return node.locationId;
}

/**
 * A device for a script's shift session to name, at `locationId`, under a till profile named `label`
 * (made on the first run). Revoked from the start, so no route accepts it as a device.
 */
export async function scriptSessionDevice(
  tx: Transaction,
  locationId: string,
  label: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.name, label));
  const profileId =
    existing?.id ??
    (
      await tx
        .insert(deviceProfiles)
        .values({ name: label, formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id })
    )[0]!.id;
  const [device] = await tx
    .insert(devices)
    .values({
      locationId,
      deviceProfileId: profileId,
      label,
      tokenHash: "unusable",
      active: false,
    })
    .returning({ id: devices.id });
  return device!.id;
}
