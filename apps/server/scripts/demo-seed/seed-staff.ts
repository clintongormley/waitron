// Inserts directly: a seed script has no management session.

import {
  deviceProfiles,
  deviceProfileAdmissionRoles,
  personStaffRoles,
  staffRoles,
} from "@waitron/db";
import { starterName } from "@waitron/country-packs";
import { DEMO_JOB_ROLE_NAMES } from "@waitron/provisioning";
import type { SeedLocale } from "./locale.js";
import type { Transaction } from "@waitron/db";
import { setBuiltInMembership, hashPassword, hashPin, persons } from "@waitron/identity";
import { DEMO_PIN, DEMO_DASHBOARD_PASSWORD } from "./credentials.js";
import type { DemoDataSet } from "./data-set.js";

export interface SeedStaffInput {
  dataSet: DemoDataSet;
  locale?: SeedLocale;
}

export async function seedStaff(
  tx: Transaction,
  { dataSet, locale = "en" }: SeedStaffInput,
): Promise<void> {
  const roles = new Map<string, string>();
  for (const name of ["Waiter", "Kitchen", "Manager on duty"]) {
    const [role] = await tx
      .insert(staffRoles)
      .values({ name: starterName(DEMO_JOB_ROLE_NAMES, name, locale) })
      .returning({ id: staffRoles.id });
    roles.set(name, role!.id);
  }
  const pinHash = hashPin(DEMO_PIN);
  for (const person of dataSet.staff) {
    const passwordHash = person.dashboardLogin ? hashPassword(DEMO_DASHBOARD_PASSWORD) : null;
    const [created] = await tx
      .insert(persons)
      .values({
        displayName: person.displayName,
        pinHash,
        passwordHash,
        email: person.email,
      })
      .returning({ id: persons.id });
    await setBuiltInMembership(tx, created!.id, person.role);
    for (const name of person.jobRoles) {
      await tx
        .insert(personStaffRoles)
        .values({ personId: created!.id, staffRoleId: roles.get(name)! });
    }
  }
  for (const profile of await tx
    .select({ id: deviceProfiles.id, formFactor: deviceProfiles.formFactor })
    .from(deviceProfiles)) {
    const jobs = profile.formFactor === "kds" ? ["Kitchen"] : ["Waiter", "Manager on duty"];
    await tx
      .insert(deviceProfileAdmissionRoles)
      .values(jobs.map((name) => ({ deviceProfileId: profile.id, staffRoleId: roles.get(name)! })));
  }
}
