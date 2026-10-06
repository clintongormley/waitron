import { and, eq } from "drizzle-orm";
import { deviceProfiles } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "./schema/persons.js";
import {
  deviceProfileAdmissionPersons,
  deviceProfileAdmissionRoles,
} from "./schema/profile-admission.js";
import type { StaffListEntry } from "./staff.js";

/** The roles a profile admits, `"every"` when it names none; `null` when the profile does not exist. */
async function admittedRoles(
  tx: Transaction,
  profileId: string,
): Promise<ReadonlySet<string> | "every" | null> {
  const [profile] = await tx
    .select({ id: deviceProfiles.id })
    .from(deviceProfiles)
    .where(eq(deviceProfiles.id, profileId));
  if (profile === undefined) return null;
  const rows = await tx
    .select({ role: deviceProfileAdmissionRoles.role })
    .from(deviceProfileAdmissionRoles)
    .where(eq(deviceProfileAdmissionRoles.deviceProfileId, profileId));
  return rows.length === 0 ? "every" : new Set(rows.map((row) => row.role));
}

/** Each person with their role and their exception on `profileId`, if any. */
function personsWithException(tx: Transaction, profileId: string) {
  return tx
    .select({
      personId: persons.id,
      displayName: persons.displayName,
      role: persons.role,
      exception: deviceProfileAdmissionPersons.admitted,
    })
    .from(persons)
    .leftJoin(
      deviceProfileAdmissionPersons,
      and(
        eq(deviceProfileAdmissionPersons.personId, persons.id),
        eq(deviceProfileAdmissionPersons.deviceProfileId, profileId),
      ),
    );
}

function admits(
  roles: ReadonlySet<string> | "every",
  person: { role: string; exception: boolean | null },
): boolean {
  if (person.exception !== null) return person.exception;
  return roles === "every" || roles.has(person.role);
}

/**
 * Whether `personId` may sign in on, or switch to, the device profile `profileId`. Only an active
 * person is ever admitted. Their own exception on the profile decides first; without one, their
 * role must be in the profile's role set, and a profile with no role set admits every role.
 */
export async function canUseDeviceProfile(
  tx: Transaction,
  profileId: string,
  personId: string,
): Promise<boolean> {
  const roles = await admittedRoles(tx, profileId);
  if (roles === null) return false;
  const [person] = await personsWithException(tx, profileId).where(
    and(eq(persons.id, personId), eq(persons.status, "active")),
  );
  return person !== undefined && admits(roles, person);
}

/** The people {@link canUseDeviceProfile} admits to `profileId`, in the shape and order of
 * `listActiveStaff`. */
export async function listStaffAdmittedTo(
  tx: Transaction,
  profileId: string,
): Promise<StaffListEntry[]> {
  const roles = await admittedRoles(tx, profileId);
  if (roles === null) return [];
  const rows = await personsWithException(tx, profileId)
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  return rows
    .filter((row) => admits(roles, row))
    .map((row) => ({ personId: row.personId, displayName: row.displayName }));
}
