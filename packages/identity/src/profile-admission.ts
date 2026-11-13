import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { deviceProfileAdmissionRoles, persons, personStaffRoles, staffRoles } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { StaffListEntry } from "./staff.js";

function admittedPeople(tx: Database | Transaction) {
  return tx
    .selectDistinct({
      profileId: deviceProfileAdmissionRoles.deviceProfileId,
      personId: persons.id,
      displayName: persons.displayName,
    })
    .from(deviceProfileAdmissionRoles)
    .innerJoin(staffRoles, eq(staffRoles.id, deviceProfileAdmissionRoles.staffRoleId))
    .innerJoin(personStaffRoles, eq(personStaffRoles.staffRoleId, staffRoles.id))
    .innerJoin(persons, eq(persons.id, personStaffRoles.personId));
}

export async function canUseDeviceProfile(
  tx: Database | Transaction,
  profileId: string,
  personId: string,
): Promise<boolean> {
  const rows = await admittedPeople(tx)
    .where(
      and(
        eq(deviceProfileAdmissionRoles.deviceProfileId, profileId),
        eq(persons.id, personId),
        eq(persons.status, "active"),
        isNull(staffRoles.hiddenAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function profilesAdmitting(
  tx: Transaction,
  personId: string,
  profileIds: readonly string[],
): Promise<string[]> {
  if (profileIds.length === 0) return [];
  const rows = await admittedPeople(tx).where(
    and(
      inArray(deviceProfileAdmissionRoles.deviceProfileId, [...profileIds]),
      eq(persons.id, personId),
      eq(persons.status, "active"),
      isNull(staffRoles.hiddenAt),
    ),
  );
  const admitted = new Set(rows.map((row) => row.profileId));
  return profileIds.filter((id) => admitted.has(id));
}

export async function listStaffAdmittedTo(
  tx: Transaction,
  profileId: string,
): Promise<StaffListEntry[]> {
  const rows = await admittedPeople(tx)
    .where(
      and(
        eq(deviceProfileAdmissionRoles.deviceProfileId, profileId),
        eq(persons.status, "active"),
        isNull(staffRoles.hiddenAt),
      ),
    )
    .orderBy(asc(persons.displayName));
  return rows.map(({ personId, displayName }) => ({ personId, displayName }));
}

export interface ProfileAdmission {
  admittedStaffRoleIds: string[];
}

export async function readProfileAdmissions(
  tx: Transaction,
  profileIds: readonly string[],
): Promise<({ profileId: string } & ProfileAdmission)[]> {
  if (profileIds.length === 0) return [];
  const rows = await tx
    .select({
      profileId: deviceProfileAdmissionRoles.deviceProfileId,
      staffRoleId: deviceProfileAdmissionRoles.staffRoleId,
    })
    .from(deviceProfileAdmissionRoles)
    .innerJoin(staffRoles, eq(staffRoles.id, deviceProfileAdmissionRoles.staffRoleId))
    .where(
      and(
        inArray(deviceProfileAdmissionRoles.deviceProfileId, [...profileIds]),
        isNull(staffRoles.hiddenAt),
      ),
    )
    .orderBy(asc(staffRoles.position), asc(staffRoles.name));
  return profileIds.map((profileId) => ({
    profileId,
    admittedStaffRoleIds: rows
      .filter((row) => row.profileId === profileId)
      .map((row) => row.staffRoleId),
  }));
}

export async function setProfileAdmission(
  tx: Transaction,
  profileId: string,
  input: Partial<ProfileAdmission>,
): Promise<void> {
  if (input.admittedStaffRoleIds === undefined) return;
  const ids = [...new Set(input.admittedStaffRoleIds)];
  if (ids.length > 0) {
    const found = await tx
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(and(inArray(staffRoles.id, ids), isNull(staffRoles.hiddenAt)));
    const missing = ids.find((id) => !found.some((row) => row.id === id));
    if (missing !== undefined)
      throw new AppError("device_profile.admission_invalid", {
        field: "admittedStaffRoleIds",
        reason: "not_found",
        staffRoleId: missing,
      });
  }
  await tx
    .delete(deviceProfileAdmissionRoles)
    .where(eq(deviceProfileAdmissionRoles.deviceProfileId, profileId));
  if (ids.length > 0)
    await tx
      .insert(deviceProfileAdmissionRoles)
      .values(ids.map((staffRoleId) => ({ deviceProfileId: profileId, staffRoleId })));
}
