import { foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { id, table } from "../columns.js";
import { deviceProfiles } from "../device-profiles.js";
import { staffRoles } from "./staff-roles.js";

export const deviceProfileAdmissionRoles = table(
  "device_profile_admission_roles",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    staffRoleId: id("staff_role_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceProfileId, t.staffRoleId],
      name: "device_profile_admission_roles_pk",
    }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_profile_admission_roles_profile_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.staffRoleId],
      foreignColumns: [staffRoles.id],
      name: "device_profile_admission_roles_role_fk",
    }).onDelete("cascade"),
  ],
);
