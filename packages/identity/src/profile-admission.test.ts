import { CORE_MIGRATIONS, deviceProfiles, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { canUseDeviceProfile, listStaffAdmittedTo } from "./profile-admission.js";
import {
  deviceProfileAdmissionPersons,
  deviceProfileAdmissionRoles,
} from "./schema/profile-admission.js";
import type { PersonRoleValue } from "./permissions.js";
import { seedPerson } from "../test/fixtures.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

const ROLES: readonly PersonRoleValue[] = ["staff", "supervisor", "manager", "admin"];

function run<T>(fn: (tx: Transaction) => Promise<T> | T): Promise<T> {
  return withTransaction(suite.db, fn);
}

async function seedProfile(): Promise<string> {
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${crypto.randomUUID()}`, formFactor: "till", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

async function admitRoles(profileId: string, roles: readonly PersonRoleValue[]): Promise<void> {
  await suite.db
    .insert(deviceProfileAdmissionRoles)
    .values(roles.map((role) => ({ deviceProfileId: profileId, role })));
}

async function setException(profileId: string, personId: string, admitted: boolean): Promise<void> {
  await suite.db
    .insert(deviceProfileAdmissionPersons)
    .values({ deviceProfileId: profileId, personId, admitted });
}

function admits(profileId: string, personId: string): Promise<boolean> {
  return run((tx) => canUseDeviceProfile(tx, profileId, personId));
}

describe("canUseDeviceProfile", () => {
  it("admits every active person, whatever their role, to a profile with no admission rows", async () => {
    const profileId = await seedProfile();
    for (const role of ROLES) {
      const personId = await seedPerson(suite.db, role);
      expect(await admits(profileId, personId), role).toBe(true);
    }
  });

  it("admits each role exactly when the profile's role set names it", async () => {
    const people = new Map<PersonRoleValue, string>();
    for (const role of ROLES) people.set(role, await seedPerson(suite.db, role));
    for (const allowed of ROLES) {
      const profileId = await seedProfile();
      await admitRoles(profileId, [allowed]);
      for (const role of ROLES) {
        expect(await admits(profileId, people.get(role)!), `${allowed} set, ${role}`).toBe(
          role === allowed,
        );
      }
    }
  });

  it("admits a person outside the role set who holds an explicit allow, and nobody else of their role", async () => {
    const profileId = await seedProfile();
    await admitRoles(profileId, ["manager"]);
    const allowed = await seedPerson(suite.db, "staff");
    const colleague = await seedPerson(suite.db, "staff");
    await setException(profileId, allowed, true);

    expect(await admits(profileId, allowed)).toBe(true);
    expect(await admits(profileId, colleague)).toBe(false);
  });

  it("refuses a person with an explicit deny though their role is admitted, and admits a colleague of the same role", async () => {
    const everyRole = await seedProfile();
    const managersOnly = await seedProfile();
    await admitRoles(managersOnly, ["manager"]);
    const denied = await seedPerson(suite.db, "manager");
    const colleague = await seedPerson(suite.db, "manager");
    await setException(everyRole, denied, false);
    await setException(managersOnly, denied, false);

    expect(await admits(everyRole, denied)).toBe(false);
    expect(await admits(managersOnly, denied)).toBe(false);
    expect(await admits(everyRole, colleague)).toBe(true);
    expect(await admits(managersOnly, colleague)).toBe(true);
  });

  it("follows a change of the person's role", async () => {
    const profileId = await seedProfile();
    await admitRoles(profileId, ["manager"]);
    const personId = await seedPerson(suite.db, "staff");
    expect(await admits(profileId, personId)).toBe(false);

    await suite.db.execute(sql`update persons set role = 'manager' where id = ${personId}`);
    expect(await admits(profileId, personId)).toBe(true);

    await suite.db.execute(sql`update persons set role = 'supervisor' where id = ${personId}`);
    expect(await admits(profileId, personId)).toBe(false);
  });

  it("never admits a suspended, pending or missing person, even with an explicit allow on an open profile", async () => {
    const profileId = await seedProfile();
    const suspended = await seedPerson(suite.db, "admin", "suspended");
    const pending = await seedPerson(suite.db, "admin", "pending");
    await setException(profileId, suspended, true);
    await setException(profileId, pending, true);

    expect(await admits(profileId, suspended)).toBe(false);
    expect(await admits(profileId, pending)).toBe(false);
    expect(await admits(profileId, crypto.randomUUID())).toBe(false);
    // The same profile still admits an active person.
    expect(await admits(profileId, await seedPerson(suite.db, "staff"))).toBe(true);
  });

  it("falls back to the role set once an exception is deleted", async () => {
    const profileId = await seedProfile();
    await admitRoles(profileId, ["manager"]);
    const allowedStaff = await seedPerson(suite.db, "staff");
    const deniedManager = await seedPerson(suite.db, "manager");
    await setException(profileId, allowedStaff, true);
    await setException(profileId, deniedManager, false);
    expect(await admits(profileId, allowedStaff)).toBe(true);
    expect(await admits(profileId, deniedManager)).toBe(false);

    await suite.db
      .delete(deviceProfileAdmissionPersons)
      .where(eq(deviceProfileAdmissionPersons.deviceProfileId, profileId));

    expect(await admits(profileId, allowedStaff)).toBe(false);
    expect(await admits(profileId, deniedManager)).toBe(true);
  });

  it("reads one profile's exceptions only", async () => {
    const restricted = await seedProfile();
    const other = await seedProfile();
    await admitRoles(restricted, ["manager"]);
    await admitRoles(other, ["manager"]);
    const personId = await seedPerson(suite.db, "staff");
    await setException(other, personId, true);

    expect(await admits(restricted, personId)).toBe(false);
    expect(await admits(other, personId)).toBe(true);
  });

  it("admits nobody to a profile that does not exist", async () => {
    const personId = await seedPerson(suite.db, "admin");
    expect(await admits(crypto.randomUUID(), personId)).toBe(false);
  });
});

describe("the admission rows", () => {
  it("go with the profile when it is deleted, and with the person when they are deleted", async () => {
    const profileId = await seedProfile();
    const kept = await seedProfile();
    const personId = await seedPerson(suite.db, "staff");
    const other = await seedPerson(suite.db, "staff");
    await admitRoles(profileId, ["manager"]);
    await admitRoles(kept, ["manager"]);
    await setException(profileId, personId, true);
    await setException(kept, personId, true);
    await setException(kept, other, true);

    await suite.db.delete(deviceProfiles).where(eq(deviceProfiles.id, profileId));
    await suite.db.execute(sql`delete from persons where id = ${personId}`);

    const roles = await suite.db
      .select({ profileId: deviceProfileAdmissionRoles.deviceProfileId })
      .from(deviceProfileAdmissionRoles)
      .where(sql`${deviceProfileAdmissionRoles.deviceProfileId} in (${profileId}, ${kept})`);
    expect(roles).toEqual([{ profileId: kept }]);
    const exceptions = await suite.db
      .select({ personId: deviceProfileAdmissionPersons.personId })
      .from(deviceProfileAdmissionPersons)
      .where(
        and(
          sql`${deviceProfileAdmissionPersons.deviceProfileId} in (${profileId}, ${kept})`,
          sql`${deviceProfileAdmissionPersons.personId} in (${personId}, ${other})`,
        ),
      );
    expect(exceptions).toEqual([{ personId: other }]);
  });

  it("refuses a role that is not a person role", async () => {
    const profileId = await seedProfile();
    // Wrapped: `execute` throws synchronously on this engine.
    await expect(async () =>
      suite.db.execute(
        sql`insert into device_profile_admission_roles (device_profile_id, role) values (${profileId}, 'owner')`,
      ),
    ).rejects.toThrow("CHECK constraint failed: device_profile_admission_roles_role_ck");
  });
});

describe("listStaffAdmittedTo", () => {
  it("lists the active people the profile admits, by name, as id and name only", async () => {
    const profileId = await seedProfile();
    await admitRoles(profileId, ["manager"]);
    const tag = crypto.randomUUID();
    const named = async (
      name: string,
      role: PersonRoleValue,
      status: "active" | "suspended" = "active",
    ): Promise<string> => {
      const id = await seedPerson(suite.db, role, status);
      await suite.db.execute(
        sql`update persons set display_name = ${`${name} ${tag}`} where id = ${id}`,
      );
      return id;
    };
    // Inserted out of name order, so a name-ordered answer proves the ordering.
    const zara = await named("Zara", "manager");
    const allowedStaff = await named("Bea", "staff");
    await named("Carl", "staff");
    const deniedManager = await named("Dora", "manager");
    const suspendedManager = await named("Eva", "manager", "suspended");
    const ana = await named("Ana", "manager");
    await setException(profileId, allowedStaff, true);
    await setException(profileId, deniedManager, false);
    await setException(profileId, suspendedManager, true);

    const listed = (await run((tx) => listStaffAdmittedTo(tx, profileId))).filter((entry) =>
      entry.displayName.endsWith(tag),
    );

    expect(listed).toEqual([
      { personId: ana, displayName: `Ana ${tag}` },
      { personId: allowedStaff, displayName: `Bea ${tag}` },
      { personId: zara, displayName: `Zara ${tag}` },
    ]);
  });

  it("lists every active person for a profile with no admission rows", async () => {
    const profileId = await seedProfile();
    const tag = crypto.randomUUID();
    const ids: string[] = [];
    for (const role of ROLES) {
      const id = await seedPerson(suite.db, role);
      await suite.db.execute(
        sql`update persons set display_name = ${`${role} ${tag}`} where id = ${id}`,
      );
      ids.push(id);
    }

    const listed = (await run((tx) => listStaffAdmittedTo(tx, profileId))).filter((entry) =>
      entry.displayName.endsWith(tag),
    );

    expect(listed.map((entry) => entry.personId).sort()).toEqual([...ids].sort());
  });

  it("lists nobody for a profile that does not exist", async () => {
    await seedPerson(suite.db, "admin");
    expect(await run((tx) => listStaffAdmittedTo(tx, crypto.randomUUID()))).toEqual([]);
  });
});
