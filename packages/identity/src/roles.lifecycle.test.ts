import {
  CORE_MIGRATIONS,
  activityLog,
  managementSessions,
  outgoingMail,
  personRoles,
  roles,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import * as identity from "./index.js";
import { declaredPermissions, registerModulePermissions } from "./permissions.js";
import { openFreshManagementSession, openManagementSession, refusalOf } from "../test/fixtures.js";
import { seedPersons } from "../test/person-rows.js";

registerModulePermissions([{ permission: "fiscal.remedy", defaultHolders: [] }]);
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture(admin = false) {
  const anchor = await openFreshManagementSession(suite.db, "admin");
  const actor = admin ? anchor : await openFreshManagementSession(suite.db, "manager");
  const builtIns = await withTransaction(suite.db, identity.ensureBuiltInRoles);
  return { actor, builtIns };
}
const create = (
  token: string,
  name = "Accountant",
  permissions = ["report.view", "report.export", "fiscal.view"],
  copiedFrom?: string,
) =>
  withTransaction(suite.db, (tx) =>
    identity.createAccessRole(tx, {
      managementSessionId: token,
      name,
      permissions,
      ...(copiedFrom === undefined ? {} : { copiedFrom }),
    }),
  );

it("creates a trimmed custom role with only its declared grants and one activity entry", async () => {
  const { actor } = await fixture();
  const { id } = await create(actor.token, "  Accountant  ");
  const [row] = await suite.db.select().from(roles).where(eq(roles.id, id));
  expect(row).toMatchObject({
    name: "Accountant",
    nameFolded: "accountant",
    builtInKey: null,
    permissions: ["report.view", "report.export", "fiscal.view"],
  });
  const entries = await suite.db.select().from(activityLog);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "access_role.created",
    personId: actor.personId,
    subjectKind: "access_role",
    subjectId: id,
  });
  expect(entries[0]!.data).toEqual({
    name: "Accountant",
    permissions: ["report.view", "report.export", "fiscal.view"],
    copiedFromRoleId: null,
  });
});

it.each([
  ["node.manage", "role.not_permitted"],
  ["retired.permission", "role.permission_unknown"],
])("refuses creating a role with %s", async (permission, code) => {
  const { actor } = await fixture();
  expect(await refusalOf(() => create(actor.token, "Accountant", [permission!]))).toEqual({
    code,
    params: permission === "node.manage" ? {} : { permission },
    reason: undefined,
  });
  expect(await suite.db.select().from(activityLog)).toEqual([]);
});

it("requires person.admin even when every proposed grant is held", async () => {
  const { token } = await openFreshManagementSession(suite.db, "supervisor");
  expect(await refusalOf(() => create(token, "Viewer", ["report.view"]))).toMatchObject({
    code: "authorization.not_permitted",
    params: { permission: "person.admin" },
  });
});

it("copies the current source grants without its holders and refuses a Manager copying Admin", async () => {
  const { actor, builtIns } = await fixture();
  expect(
    await refusalOf(() => create(actor.token, "Admin copy", [], builtIns.admin)),
  ).toMatchObject({ code: "role.not_permitted" });
  const admin = await openFreshManagementSession(suite.db, "admin");
  const { id } = await create(admin.token, "All today", [], builtIns.admin);
  const [row] = await suite.db.select().from(roles).where(eq(roles.id, id));
  expect(row!.builtInKey).toBeNull();
  expect(row!.permissions).toEqual(declaredPermissions());
  expect(await suite.db.select().from(personRoles).where(eq(personRoles.roleId, id))).toEqual([]);
  const entries = await suite.db.select().from(activityLog);
  expect(entries[0]!.data).toMatchObject({ copiedFromRoleId: builtIns.admin });
  await suite.db
    .update(roles)
    .set({ permissions: ["report.view", "retired.permission"] })
    .where(eq(roles.id, builtIns.staff));
  const custom = await create(actor.token, "Current staff", [], builtIns.staff);
  expect(
    (await suite.db.select().from(roles).where(eq(roles.id, custom.id)))[0]!.permissions,
  ).toEqual(["report.view"]);
});

it("refuses empty and duplicate custom names for both create and rename", async () => {
  const { actor } = await fixture();
  expect(await refusalOf(() => create(actor.token, "   "))).toMatchObject({
    code: "role.name_required",
  });
  await create(actor.token);
  expect(await refusalOf(() => create(actor.token, " ACCOUNTANT "))).toMatchObject({
    code: "role.name_taken",
    params: { name: "ACCOUNTANT" },
  });
  const other = await create(actor.token, "Viewer", ["report.view"]);
  const rename = (name: string) =>
    withTransaction(suite.db, (tx) =>
      identity.renameAccessRole(tx, {
        managementSessionId: actor.token,
        roleId: other.id,
        name,
        expectedName: "Viewer",
      }),
    );
  expect(await refusalOf(() => rename("   "))).toMatchObject({ code: "role.name_required" });
  expect(await refusalOf(() => rename("accountant"))).toMatchObject({ code: "role.name_taken" });
});

it("renames with an expected-name comparison, logging only a real change", async () => {
  const { actor } = await fixture();
  const { id } = await create(actor.token);
  const rename = (name: string, expectedName: string) =>
    withTransaction(suite.db, (tx) =>
      identity.renameAccessRole(tx, {
        managementSessionId: actor.token,
        roleId: id,
        name,
        expectedName,
      }),
    );
  await rename("  Bookkeeper  ", "Accountant");
  await rename("Bookkeeper", "Bookkeeper");
  expect(await refusalOf(() => rename("Viewer", "Accountant"))).toMatchObject({
    code: "role.changed",
    params: {},
  });
  expect((await suite.db.select().from(roles).where(eq(roles.id, id)))[0]!.name).toBe("Bookkeeper");
  const entries = await suite.db.select().from(activityLog);
  expect(entries.map((e) => e.kind)).toEqual(["access_role.created", "access_role.renamed"]);
  expect(entries[1]!.data).toEqual({ from: "Accountant", to: "Bookkeeper" });
});

it.each(["rename", "permissions", "delete"])(
  "Rule 1 refuses %s when the old role has a stronger declared grant",
  async (operation) => {
    const { actor } = await fixture();
    const admin = await openFreshManagementSession(suite.db, "admin");
    const { id } = await create(admin.token, "Remedy", ["report.view", "fiscal.remedy"]);
    const input = { managementSessionId: actor.token, roleId: id };
    const change = () =>
      withTransaction(suite.db, (tx) =>
        operation === "rename"
          ? identity.renameAccessRole(tx, { ...input, name: "New", expectedName: "Remedy" })
          : operation === "delete"
            ? identity.deleteAccessRole(tx, input)
            : identity.setAccessRolePermissions(tx, {
                ...input,
                permissions: ["report.view"],
                expectedPermissions: ["report.view", "fiscal.remedy"],
              }),
      );
    expect(await refusalOf(change)).toMatchObject({
      code: "role.not_permitted",
      params: { roleId: id },
    });
    expect((await suite.db.select().from(activityLog)).map((e) => e.kind)).toEqual([
      "access_role.created",
    ]);
  },
);

it("protects built-in names/deletion and Admin's permissions", async () => {
  const { actor, builtIns } = await fixture(true);
  const input = { managementSessionId: actor.token, roleId: builtIns.manager };
  expect(
    await refusalOf(() =>
      withTransaction(suite.db, (tx) =>
        identity.renameAccessRole(tx, { ...input, name: "New", expectedName: "Manager" }),
      ),
    ),
  ).toMatchObject({ code: "role.built_in" });
  expect(
    await refusalOf(() => withTransaction(suite.db, (tx) => identity.deleteAccessRole(tx, input))),
  ).toMatchObject({ code: "role.built_in" });
  expect(
    await refusalOf(() =>
      withTransaction(suite.db, (tx) =>
        identity.setAccessRolePermissions(tx, {
          ...input,
          roleId: builtIns.admin,
          permissions: [],
          expectedPermissions: declaredPermissions(),
        }),
      ),
    ),
  ).toMatchObject({ code: "role.built_in" });
});

it("edits built-in grants by set value, logs each difference and changes live authority without mail", async () => {
  const { actor, builtIns } = await fixture(true);
  const [person] = await seedPersons(suite.db, {
    displayName: "Waiter",
    email: "waiter@example.test",
  });
  const target = person!.id;
  await suite.db
    .update(roles)
    .set({ permissions: ["payment.take", "report.view"] })
    .where(eq(roles.id, builtIns.staff));
  const edit = (permissions: string[], expectedPermissions: string[]) =>
    withTransaction(suite.db, (tx) =>
      identity.setAccessRolePermissions(tx, {
        managementSessionId: actor.token,
        roleId: builtIns.staff,
        permissions,
        expectedPermissions,
      }),
    );
  await edit(["report.export", "report.view"], ["report.view", "payment.take"]);
  await edit(["report.view", "report.export"], ["report.export", "report.view"]);
  expect(identity.holds(await identity.readPersonAuthority(suite.db, target), "payment.take")).toBe(
    false,
  );
  expect(
    identity.holds(await identity.readPersonAuthority(suite.db, target), "report.export"),
  ).toBe(true);
  expect(await refusalOf(() => edit([], ["payment.take"]))).toMatchObject({ code: "role.changed" });
  const entries = await suite.db.select().from(activityLog);
  expect(entries.map((e) => [e.kind, e.data])).toEqual([
    ["access_role.permission_removed", { permission: "payment.take" }],
    ["access_role.permission_added", { permission: "report.export" }],
  ]);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("refuses adding an unheld or undeclared permission while allowing retired stored ids to be removed", async () => {
  const { actor } = await fixture();
  const { id } = await create(actor.token, "Viewer", ["report.view"]);
  const edit = (permissions: string[], expectedPermissions = ["report.view"]) =>
    withTransaction(suite.db, (tx) =>
      identity.setAccessRolePermissions(tx, {
        managementSessionId: actor.token,
        roleId: id,
        permissions,
        expectedPermissions,
      }),
    );
  expect(await refusalOf(() => edit(["node.manage"]))).toMatchObject({
    code: "role.not_permitted",
  });
  expect(await refusalOf(() => edit(["retired.permission"]))).toMatchObject({
    code: "role.permission_unknown",
    params: { permission: "retired.permission" },
  });
  await suite.db
    .update(roles)
    .set({ permissions: ["report.view", "retired.permission"] })
    .where(eq(roles.id, id));
  await edit([], ["report.view"]);
  expect((await suite.db.select().from(roles).where(eq(roles.id, id)))[0]!.permissions).toEqual([]);
  expect(
    (await suite.db.select().from(activityLog)).map((entry) => [entry.kind, entry.data]),
  ).toEqual([
    [
      "access_role.created",
      { name: "Viewer", permissions: ["report.view"], copiedFromRoleId: null },
    ],
    ["access_role.permission_removed", { permission: "report.view" }],
    ["access_role.permission_removed", { permission: "retired.permission" }],
  ]);
});

it("deletes the custom role and every membership, logs each removal and queues only email holders", async () => {
  const { actor } = await fixture();
  const { id } = await create(actor.token);
  const people = await seedPersons(suite.db, [
    { displayName: "One", email: "one@example.test" },
    { displayName: "Two", email: "two@example.test" },
    { displayName: "Three" },
  ]);
  await suite.db.insert(personRoles).values(people.map((p) => ({ personId: p.id, roleId: id })));
  expect(
    await withTransaction(suite.db, (tx) =>
      identity.deleteAccessRole(tx, { managementSessionId: actor.token, roleId: id }),
    ),
  ).toEqual({ removedFrom: 3 });
  expect(await suite.db.select().from(roles).where(eq(roles.id, id))).toEqual([]);
  expect(await suite.db.select().from(personRoles).where(eq(personRoles.roleId, id))).toEqual([]);
  const entries = await suite.db.select().from(activityLog);
  expect(entries.map((e) => e.kind)).toEqual([
    "access_role.created",
    "access_role.member_removed",
    "access_role.member_removed",
    "access_role.member_removed",
    "access_role.deleted",
  ]);
  expect(
    new Set(entries.filter((e) => e.kind === "access_role.member_removed").map((e) => e.subjectId)),
  ).toEqual(new Set(people.map((p) => p.id)));
  expect(entries.at(-1)!.data).toEqual({
    name: "Accountant",
    permissions: ["report.view", "report.export", "fiscal.view"],
  });
  const mail = await suite.db.select().from(outgoingMail);
  expect(mail).toHaveLength(2);
  expect(new Set(mail.map((m) => m.personId))).toEqual(
    new Set(people.slice(0, 2).map((p) => p.id)),
  );
  expect(
    mail.every(
      (m) =>
        m.kind === "role_membership_changed" &&
        m.params.change === "removed" &&
        m.params.roleName === "Accountant",
    ),
  ).toBe(true);
  expect(mail.map((m) => m.subjectId).sort()).toEqual(
    entries
      .filter(
        (e) =>
          e.kind === "access_role.member_removed" &&
          people.slice(0, 2).some((p) => p.id === e.subjectId),
      )
      .map((e) => e.id)
      .sort(),
  );
});

it.each(["rename", "permissions", "delete", "copy"])(
  "refuses a missing role for %s",
  async (operation) => {
    const { actor } = await fixture(true);
    const input = { managementSessionId: actor.token, roleId: crypto.randomUUID() };
    const change = () =>
      withTransaction(suite.db, (tx) =>
        operation === "rename"
          ? identity.renameAccessRole(tx, { ...input, name: "New", expectedName: "Old" })
          : operation === "permissions"
            ? identity.setAccessRolePermissions(tx, {
                ...input,
                permissions: [],
                expectedPermissions: [],
              })
            : operation === "delete"
              ? identity.deleteAccessRole(tx, input)
              : identity.createAccessRole(tx, {
                  managementSessionId: actor.token,
                  name: "Copy",
                  permissions: [],
                  copiedFrom: input.roleId,
                }),
      );
    expect(await refusalOf(change)).toMatchObject({
      code: "role.not_found",
      params: { roleId: input.roleId },
    });
  },
);

it("requires fresh proof for lifecycle changes", async () => {
  const { token } = await openManagementSession(suite.db, "admin");
  expect(await refusalOf(() => create(token))).toMatchObject({
    code: "management_session.proof_required",
  });
  expect(await suite.db.select().from(activityLog)).toEqual([]);
  expect(await suite.db.select().from(managementSessions)).toHaveLength(1);
});

it("folds case and Unicode accents for duplicate names while preserving the accent distinction", async () => {
  const { actor } = await fixture();
  await create(actor.token, "Café", []);
  expect(await refusalOf(() => create(actor.token, "CAFE\u0301", []))).toMatchObject({
    code: "role.name_taken",
  });
  const plain = await create(actor.token, "Cafe", []);
  expect((await suite.db.select().from(roles).where(eq(roles.id, plain.id)))[0]!.name).toBe("Cafe");
});
