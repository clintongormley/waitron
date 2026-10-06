import { and, asc, eq, inArray } from "drizzle-orm";
import { deviceProfiles } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { PersonRoleValue } from "./permissions.js";
import { personRole, persons } from "./schema/persons.js";
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

/** Who may sign in on a device profile, as a manager edits it. */
export interface ProfileAdmission {
  /** Never empty: a profile with no role rows admits every role, and reads as all of them. */
  admittedRoles: PersonRoleValue[];
  personExceptions: { personId: string; admitted: boolean }[];
}

/** Each named profile's role set and person exceptions, in the order `profileIds` names them. */
export async function readProfileAdmissions(
  tx: Transaction,
  profileIds: readonly string[],
): Promise<({ profileId: string } & ProfileAdmission)[]> {
  if (profileIds.length === 0) return [];
  const roles = await tx
    .select({
      profileId: deviceProfileAdmissionRoles.deviceProfileId,
      role: deviceProfileAdmissionRoles.role,
    })
    .from(deviceProfileAdmissionRoles)
    .where(inArray(deviceProfileAdmissionRoles.deviceProfileId, [...profileIds]));
  const exceptions = await tx
    .select({
      profileId: deviceProfileAdmissionPersons.deviceProfileId,
      personId: deviceProfileAdmissionPersons.personId,
      admitted: deviceProfileAdmissionPersons.admitted,
    })
    .from(deviceProfileAdmissionPersons)
    .where(inArray(deviceProfileAdmissionPersons.deviceProfileId, [...profileIds]))
    .orderBy(asc(deviceProfileAdmissionPersons.personId));
  return profileIds.map((profileId) => {
    const named = roles.filter((row) => row.profileId === profileId).map((row) => row.role);
    return {
      profileId,
      admittedRoles: personRole.enumValues.filter(
        (role) => named.length === 0 || named.includes(role),
      ),
      personExceptions: exceptions
        .filter((row) => row.profileId === profileId)
        .map(({ personId, admitted }) => ({ personId, admitted })),
    };
  });
}

/**
 * Replaces the parts of a profile's sign-in rule that `input` names. An empty role set is refused,
 * because storing no role rows means every role; every role is stored as no rows. A person exception
 * must name a person that exists, whatever their status.
 */
export async function setProfileAdmission(
  tx: Transaction,
  profileId: string,
  input: Partial<ProfileAdmission>,
): Promise<void> {
  if (input.admittedRoles !== undefined) {
    const named = new Set(input.admittedRoles);
    if (named.size === 0)
      throw new AppError("device_profile.admission_invalid", {
        field: "admittedRoles",
        reason: "empty",
      });
    await tx
      .delete(deviceProfileAdmissionRoles)
      .where(eq(deviceProfileAdmissionRoles.deviceProfileId, profileId));
    if (personRole.enumValues.some((role) => !named.has(role)))
      await tx
        .insert(deviceProfileAdmissionRoles)
        .values([...named].map((role) => ({ deviceProfileId: profileId, role })));
  }
  if (input.personExceptions !== undefined) {
    const ids = input.personExceptions.map((exception) => exception.personId);
    if (ids.length > 0) {
      const found = await tx
        .select({ id: persons.id })
        .from(persons)
        .where(inArray(persons.id, ids));
      const missing = ids.find((id) => !found.some((row) => row.id === id));
      if (missing !== undefined)
        throw new AppError("device_profile.admission_invalid", {
          field: "personExceptions",
          reason: "not_found",
          personId: missing,
        });
    }
    await tx
      .delete(deviceProfileAdmissionPersons)
      .where(eq(deviceProfileAdmissionPersons.deviceProfileId, profileId));
    if (ids.length > 0)
      await tx.insert(deviceProfileAdmissionPersons).values(
        input.personExceptions.map(({ personId, admitted }) => ({
          deviceProfileId: profileId,
          personId,
          admitted,
        })),
      );
  }
}
