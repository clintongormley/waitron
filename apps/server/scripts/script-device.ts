import { and, eq, isNull } from "drizzle-orm";
import { deviceProfiles, devices, venueLocationId } from "@waitron/db";
import type { Transaction } from "@waitron/db";

/**
 * Revoked from the start, so no route accepts it as a device.
 */
export async function scriptSessionDevice(tx: Transaction, label: string): Promise<string> {
  const [existing] = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(and(eq(deviceProfiles.name, label), isNull(deviceProfiles.retiredAt)));
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
      locationId: await venueLocationId(tx),
      deviceProfileId: profileId,
      label,
      tokenHash: "unusable",
      active: false,
    })
    .returning({ id: devices.id });
  return device!.id;
}
