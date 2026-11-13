import { expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { activityLog, outgoingMail, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, hashPassword } from "@waitron/identity";
import { appliedSchemaVersion, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { modulesWithSets } from "@waitron/module";
import { request } from "../test/first-setup-request.js";
import { applyHistoricalTestVenue as applyVenue } from "../test/allocated-venue.js";
import { planVenue } from "./venue-plan.js";
import { buildConfigurationBundle, importConfigurationTables } from "./configuration-transfer.js";
import { STARTER_JOB_ROLE_NAMES } from "./starter-content.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const targetSuite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const venue = (taxId: string) => ({
  ...request,
  taxId,
  operationDescription: "Restaurant",
  admin: {
    displayName: "Admin",
    email: `${taxId.toLowerCase()}@example.test`,
    pinHash: hashPin("1234"),
    passwordHash: hashPassword("a secure password"),
  },
});

for (const mode of [true, false, "empty", "no-target-job"] as const) {
  const hasRoles = mode === true;
  const empty = mode === "empty" || mode === "no-target-job";
  it(`after an import ${mode === "no-target-job" ? "without a target starter job, " : ""}the administrator holds ${empty ? "the starter Team when the source has no job roles" : hasRoles ? "the exporting administrator's job roles" : "every imported visible job role when the source administrator held none"}`, async () => {
    const source = await applyVenue(planVenue(venue("B24681390"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    const admin = suite.db.all<{ id: string }>(
      sql`select id from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin')`,
    )[0]!.id;
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`delete from person_staff_roles`);
      await tx.execute(sql`delete from staff_roles`);
      if (!empty)
        await tx.execute(sql`insert into staff_roles (id, name, hidden_at) values
        ('source-waiter', 'Waiter', null), ('source-kitchen', 'Kitchen', null),
        ('source-hidden', 'Retired', '2026-11-01T00:00:00Z')`);
      if (hasRoles)
        await tx.execute(sql`insert into person_staff_roles (person_id, staff_role_id)
        values (${admin!}, 'source-waiter')`);
    });
    const versions: Record<string, number> = {};
    for (const module of modulesWithSets(ALL_MODULES))
      versions[module.name] = await appliedSchemaVersion(
        { venue: suite.db, node: suite.node },
        module.migrations,
      );
    const bundle = await buildConfigurationBundle(
      suite.db,
      { ...source, sourceOperatorId: admin! },
      ALL_MODULES,
      new Date("2026-11-12T12:00:00Z"),
      versions,
    );
    await applyVenue(
      planVenue(
        { ...venue("B42086431"), invoiceLocales: mode === "no-target-job" ? ["en-GB"] : ["es-ES"] },
        ALL_MODULES,
      ),
      {
        db: targetSuite.db,
        modules: ALL_MODULES,
        beforeCommit: async (tx) => {
          if (mode === "no-target-job") {
            await tx.execute(sql`delete from person_staff_roles`);
            await tx.execute(sql`delete from staff_roles`);
          }
          await importConfigurationTables(tx, bundle, ALL_MODULES, versions);
        },
      },
    );
    const held = targetSuite.db.all<{
      id: string;
      name: string;
    }>(sql`select r.id, r.name from staff_roles r
      join person_staff_roles h on h.staff_role_id = r.id join persons p on p.id = h.person_id
      where p.id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin') order by r.name`);
    expect(held.map((r) => r.name)).toEqual(
      empty ? [STARTER_JOB_ROLE_NAMES.Team.es] : hasRoles ? ["Waiter"] : ["Kitchen", "Waiter"],
    );
    expect(held.every((r) => !r.id.startsWith("source-"))).toBe(true);
    const targetAdmin = targetSuite.db.all<{ id: string }>(
      sql`select id from persons where id in (select person_roles.person_id from person_roles join roles on roles.id = person_roles.role_id where roles.built_in_key = 'admin')`,
    )[0]!.id;
    const baseline = await targetSuite.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.kind, "job_role.member_added"));
    expect(baseline.filter((row) => row.subjectId === targetAdmin)).toHaveLength(held.length);
    for (const role of held)
      expect(baseline).toContainEqual(
        expect.objectContaining({
          personId: null,
          subjectId: targetAdmin,
          data: { staffRoleId: role.id, name: role.name },
        }),
      );
    expect(await targetSuite.db.select().from(outgoingMail)).toEqual([]);
  });
}
