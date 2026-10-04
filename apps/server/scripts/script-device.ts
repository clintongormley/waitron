import { and, eq } from "drizzle-orm";
import { deviceProfiles, devices, nodes, tills } from "@waitron/db";
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
  // A till device still names a till until the tills table goes (`device_binding_rule_insert`).
  const [till] = await tx
    .select({ id: tills.id })
    .from(tills)
    .where(and(eq(tills.locationId, locationId), eq(tills.name, label)));
  const tillId =
    till?.id ??
    (await tx.insert(tills).values({ locationId, name: label }).returning({ id: tills.id }))[0]!.id;
  const [device] = await tx
    .insert(devices)
    .values({
      locationId,
      deviceProfileId: profileId,
      tillId,
      label,
      tokenHash: "unusable",
      active: false,
    })
    .returning({ id: devices.id });
  return device!.id;
}
