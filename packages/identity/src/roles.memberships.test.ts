import {
  CORE_MIGRATIONS,
  activityLog,
  managementSessions,
  outgoingMail,
  personRoles,
  persons,
  roles,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { openFreshManagementSession, refusalOf } from "../test/fixtures.js";
import { seedPersons } from "../test/person-rows.js";
import * as identity from "./index.js";
import { declaredPermissions } from "./permissions.js";
import { completeAccountAction, issueAccountAction } from "./account-action.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function fixture(admin = false) {
  const anchor = await openFreshManagementSession(suite.db, "admin");
  const actor = admin ? anchor : await openFreshManagementSession(suite.db, "manager");
  const builtIns = await withTransaction(suite.db, identity.ensureBuiltInRoles);
  await suite.db
    .update(roles)
    .set({ permissions: ["person.admin", "payment.take"] })
    .where(eq(roles.id, builtIns.manager));
  const [target] = await seedPersons(suite.db, {
    displayName: "Waiter",
    email: "waiter@example.test",
  });
  await suite.db.insert(roles).values([
    {
      id: "service",
      name: "Service lead",
      nameFolded: "service lead",
      permissions: ["payment.take", "sale.discount"],
    },
    {
      id: "accountant",
      name: "Accountant",
      nameFolded: "accountant",
      permissions: ["report.export"],
    },
  ]);
  await suite.db.insert(personRoles).values({ personId: target!.id, roleId: "accountant" });
  const expectedRoleIds = [builtIns.staff, "accountant"];
  const input = {
    managementSessionId: actor.token,
    personId: target!.id,
    roleIds: [...expectedRoleIds, "service"],
    expectedRoleIds,
  };
  return { actor, target: target!, builtIns, input };
}

it("adds an allowed role despite the target's stronger role, logging and queuing exactly that change", async () => {
  const { actor, target, input } = await fixture();
  const result = await withTransaction(suite.db, (tx) => identity.setPersonAccessRoles(tx, input));
  expect(new Set(result.roleIds)).toEqual(new Set(input.roleIds));
  expect((await identity.readPersonAuthority(suite.db, target.id)).roleIds).toEqual(
    expect.arrayContaining(input.roleIds),
  );
  const entries = await suite.db.select().from(activityLog);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "access_role.member_added",
    personId: actor.personId,
    subjectKind: "person",
    subjectId: target.id,
  });
  expect(entries[0]!.data).toEqual({ roleId: "service", builtInKey: null, name: "Service lead" });
  const [editor] = await suite.db.select().from(persons).where(eq(persons.id, actor.personId));
  const mail = await suite.db.select().from(outgoingMail);
  expect(mail).toHaveLength(1);
  expect(mail[0]).toMatchObject({
    kind: "role_membership_changed",
    dedupeKey: `role-membership:${entries[0]!.id}`,
    subjectId: entries[0]!.id,
    personId: target.id,
    requestedBy: actor.personId,
  });
  expect(mail[0]!.params).toEqual({
    change: "added",
    builtInKey: null,
    roleName: "Service lead",
    editorName: editor!.displayName,
    at: entries[0]!.at.toISOString(),
  });
});

it("refuses taking away a role whose declared permissions the actor lacks", async () => {
  const { input } = await fixture();
  expect(
    await refusalOf(() =>
      withTransaction(suite.db, (tx) =>
        identity.setPersonAccessRoles(tx, { ...input, roleIds: [input.expectedRoleIds[0]!] }),
      ),
    ),
  ).toMatchObject({ code: "role.not_permitted", params: { roleId: "accountant" } });
});

it.each(["added", "removed"])(
  "only Admin may have Admin %s, even with every current permission",
  async (change) => {
    const { actor, target, input, builtIns } = await fixture();
    await suite.db
      .insert(roles)
      .values({
        id: "all-current",
        name: "All current",
        nameFolded: "all current",
        permissions: declaredPermissions(),
      });
    await suite.db.delete(personRoles).where(eq(personRoles.personId, actor.personId));
    await suite.db.insert(personRoles).values({ personId: actor.personId, roleId: "all-current" });
    if (change === "removed")
      await suite.db.insert(personRoles).values({ personId: target.id, roleId: builtIns.admin });
    expect(
      await refusalOf(() =>
        withTransaction(suite.db, (tx) =>
          identity.setPersonAccessRoles(tx, {
            ...input,
            expectedRoleIds:
              change === "removed"
                ? [...input.expectedRoleIds, builtIns.admin]
                : input.expectedRoleIds,
            roleIds:
              change === "added"
                ? [...input.expectedRoleIds, builtIns.admin]
                : input.expectedRoleIds,
          }),
        ),
      ),
    ).toMatchObject({ code: "role.not_permitted", params: { roleId: builtIns.admin } });
    expect((await identity.readPersonAuthority(suite.db, actor.personId)).admin).toBe(false);
  },
);

it.each([false, true])(
  "ignores retired permissions when giving a role (Admin %s)",
  async (admin) => {
    const { input } = await fixture(admin);
    await withTransaction(suite.db, (tx) => identity.setPersonAccessRoles(tx, input));
    expect(
      (await suite.db.select().from(personRoles)).some(
        (row) => row.personId === input.personId && row.roleId === "service",
      ),
    ).toBe(true);
  },
);

it.each([
  { mode: "stale", code: "person.roles_changed", params: {} },
  { mode: "unknown", code: "role.not_found", params: { roleId: "missing" } },
  { mode: "duplicate", code: "management.request_invalid", params: { field: "roleIds" } },
  { mode: "missing-person", code: "person.not_found", params: { personId: "missing" } },
  {
    mode: "permission",
    code: "authorization.not_permitted",
    params: { permission: "person.admin" },
  },
  { mode: "old-proof", code: "management_session.proof_required", params: {} },
])("refuses $mode without recording or queuing a change", async ({ mode, code, params }) => {
  const { actor, builtIns, input } = await fixture();
  if (mode === "stale") input.expectedRoleIds = [builtIns.staff];
  if (mode === "unknown") input.roleIds.push("missing");
  if (mode === "duplicate") input.roleIds.push("service");
  if (mode === "missing-person") input.personId = "missing";
  if (mode === "permission")
    await suite.db
      .update(roles)
      .set({ permissions: ["payment.take"] })
      .where(eq(roles.id, builtIns.manager));
  if (mode === "old-proof")
    await suite.db
      .update(managementSessions)
      .set({ provedAt: new Date(Date.now() - 16 * 60000).toISOString() })
      .where(eq(managementSessions.personId, actor.personId));
  expect(
    await refusalOf(() =>
      withTransaction(suite.db, (tx) => identity.setPersonAccessRoles(tx, input)),
    ),
  ).toMatchObject({ code, params });
  expect(await suite.db.select().from(activityLog)).toEqual([]);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("reordered sets leave memberships, history and queue unchanged", async () => {
  const { input } = await fixture();
  const before = await suite.db.select().from(personRoles);
  const result = await withTransaction(suite.db, (tx) =>
    identity.setPersonAccessRoles(tx, { ...input, roleIds: [...input.expectedRoleIds].reverse() }),
  );
  expect(new Set(result.roleIds)).toEqual(new Set(input.expectedRoleIds));
  expect(await suite.db.select().from(personRoles)).toEqual(before);
  expect(await suite.db.select().from(activityLog)).toEqual([]);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("allows no roles and records each removal", async () => {
  const { actor, input } = await fixture(true);
  expect(
    await withTransaction(suite.db, (tx) =>
      identity.setPersonAccessRoles(tx, { ...input, roleIds: [] }),
    ),
  ).toEqual({ roleIds: [] });
  expect((await identity.readPersonAuthority(suite.db, input.personId)).roleIds).toEqual([]);
  const entries = await suite.db.select().from(activityLog);
  expect(entries).toHaveLength(2);
  expect(
    entries.map((row) => ({
      kind: row.kind,
      actor: row.personId,
      subject: row.subjectId,
      data: row.data,
    })),
  ).toEqual(
    expect.arrayContaining([
      {
        kind: "access_role.member_removed",
        actor: actor.personId,
        subject: input.personId,
        data: { roleId: input.expectedRoleIds[0], builtInKey: "staff", name: null },
      },
      {
        kind: "access_role.member_removed",
        actor: actor.personId,
        subject: input.personId,
        data: { roleId: "accountant", builtInKey: null, name: "Accountant" },
      },
    ]),
  );
  expect(await suite.db.select().from(outgoingMail)).toHaveLength(2);
});

it("backs out memberships, log and mail when removing the last usable Admin", async () => {
  const { actor, builtIns } = await fixture(true);
  expect(
    await refusalOf(() =>
      withTransaction(suite.db, (tx) =>
        identity.setPersonAccessRoles(tx, {
          managementSessionId: actor.token,
          personId: actor.personId,
          roleIds: [],
          expectedRoleIds: [builtIns.admin],
        }),
      ),
    ),
  ).toMatchObject({ code: "person.last_admin", params: {} });
  expect((await identity.readPersonAuthority(suite.db, actor.personId)).admin).toBe(true);
  expect(await suite.db.select().from(activityLog)).toEqual([]);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("keeps an outstanding invitation usable after adding a role", async () => {
  const { input, target } = await fixture(true);
  await suite.db.update(persons).set({ status: "pending" }).where(eq(persons.id, target.id));
  const action = await withTransaction(suite.db, (tx) =>
    issueAccountAction(tx, { personId: target.id, purpose: "invitation" }),
  );
  await withTransaction(suite.db, (tx) => identity.setPersonAccessRoles(tx, input));
  const result = await withTransaction(suite.db, (tx) =>
    completeAccountAction(tx, {
      token: action.token,
      purpose: "invitation",
      password: "new correct horse",
      pin: "5678",
    }),
  );
  expect(result.personId).toBe(target.id);
  expect((await identity.readPersonAuthority(suite.db, target.id)).roleIds).toContain("service");
});

it("still records a membership when the recipient has no email", async () => {
  const { target, input } = await fixture();
  await suite.db.update(persons).set({ email: null }).where(eq(persons.id, target.id));
  await withTransaction(suite.db, (tx) => identity.setPersonAccessRoles(tx, input));
  expect(await suite.db.select().from(activityLog)).toHaveLength(1);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});
