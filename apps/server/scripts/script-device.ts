import { eq } from "drizzle-orm";
import { deviceProfiles, devices } from "@waitron/db";
import type { Transaction } from "@waitron/db";

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
