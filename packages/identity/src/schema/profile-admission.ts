import { check, foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { deviceProfiles, enumCheck, flag, id, table } from "@waitron/db";
import { personRole, persons } from "./persons.js";

/**
 * The roles a device profile admits. A profile with no row here admits every role, so these rows
 * only ever narrow it.
 */
export const deviceProfileAdmissionRoles = table(
  "device_profile_admission_roles",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    role: personRole("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceProfileId, t.role], name: "device_profile_admission_roles_pk" }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_profile_admission_roles_profile_fk",
    }).onDelete("cascade"),
    check("device_profile_admission_roles_role_ck", enumCheck(t.role)),
  ],
);

/** One person's exception to a profile's role set: `admitted` false refuses them whatever their
 * role, true admits them whatever their role. */
export const deviceProfileAdmissionPersons = table(
  "device_profile_admission_persons",
  {
    deviceProfileId: id("device_profile_id").notNull(),
    personId: id("person_id").notNull(),
    admitted: flag("admitted").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.deviceProfileId, t.personId],
      name: "device_profile_admission_persons_pk",
    }),
    foreignKey({
      columns: [t.deviceProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "device_profile_admission_persons_profile_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.personId],
      foreignColumns: [persons.id],
      name: "device_profile_admission_persons_person_fk",
    }).onDelete("cascade"),
  ],
);
