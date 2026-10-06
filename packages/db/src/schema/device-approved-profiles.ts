import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "./columns.js";
import { deviceProfiles } from "./device-profiles.js";
import { devices } from "./devices.js";

/**
 * The profiles a manager approved for a device besides its active one (`devices.device_profile_id`),
 * which counts as approved without a row here. Staff switch only within the active profile and
 * these.
 */
export const deviceApprovedProfiles = table(
  "device_approved_profiles",
  {
    deviceId: id("device_id").notNull(),
    deviceProfileId: id("device_profile_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceId, t.deviceProfileId],
      name: "device_approved_profiles_pk",
    }),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "device_approved_profiles_device_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_approved_profiles_profile_fk",
    }).onDelete("cascade"),
  ],
);
