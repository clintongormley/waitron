import {
  CORE_MIGRATIONS,
  outgoingMail,
  personRoles,
  persons,
  roles,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPassword, hashPin, registerModulePermissions } from "@waitron/identity";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { mountManagementApi } from "./management-api.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

registerModulePermissions([{ permission: "fiscal.remedy", defaultHolders: [] }]);
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const operations = [
  "email",
  "status",
  "reset-pin",
  "reset-login",
  "reactivate",
  "invitation",
  "deactivate",
] as const;
type Operation = (typeof operations)[number];

async function fixture(
  operation: Operation,
  targetKind: "waiter" | "accountant" | "admin",
  emailPermission = true,
) {
  const [manager, target] = await seedPersons(suite.db, [
    {
      displayName: "Manager",
      role: "manager",
      email: "manager@example.test",
      passwordHash: hashPassword("correct horse"),
    },
    {
      displayName: "Target",
      firstNames: "Target",
      lastNames: "Person",
      role: targetKind === "admin" ? "admin" : "staff",
      email: "target@example.test",
      pinHash: hashPin("1234"),
      status:
        operation === "reactivate"
          ? "suspended"
          : operation === "invitation"
            ? "pending"
            : "active",
    },
  ]);
  const [managerRole] = await suite.db.select().from(roles).where(eq(roles.builtInKey, "manager"));
  await suite.db
    .update(roles)
    .set({
      permissions: [...managerRole!.permissions, ...(emailPermission ? ["person.email"] : [])],
    })
    .where(eq(roles.id, managerRole!.id));
  if (targetKind === "accountant") {
    const [accountant] = await suite.db
      .insert(roles)
      .values({
        name: "Accountant",
        nameFolded: "accountant",
        permissions: ["report.view", "fiscal.remedy"],
      })
      .returning();
    await suite.db.insert(personRoles).values({ personId: target!.id, roleId: accountant!.id });
  }
  await seedPersons(suite.db, {
    displayName: "Other Admin",
    role: "admin",
    passwordHash: hashPassword("other admin password"),
  });
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
      accountMailMode: async () => "smtp",
    },
    () => {},
  );
  const login = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: manager!.email, password: "correct horse" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, cookie));
  const send = (path: string, method = "POST", body?: unknown) =>
    app.request(path, {
      method,
      headers: { cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return {
    cookie,
    manager: manager!,
    target: { ...target!, role: targetKind === "admin" ? "admin" : "staff" },
    send,
  };
}

async function change(operation: Operation, f: Awaited<ReturnType<typeof fixture>>) {
  const path = `/management-api/staff/${f.target.id}`;
  if (operation === "email" || operation === "status")
    return f.send(path, "PUT", {
      displayName: "Target",
      firstNames: "Target",
      lastNames: "Person",
      telephone: null,
      email: operation === "email" ? "changed@example.test" : f.target.email,
      role: f.target.role,
      status: operation === "status" ? "suspended" : f.target.status,
    });
  return f.send(`${path}/${operation}`);
}

it.each(operations)("a Manager covering a waiter can change %s", async (operation) => {
  const f = await fixture(operation, "waiter");
  const response = await change(operation, f);
  expect(response.status).toBe(
    ["reset-login", "reactivate", "invitation"].includes(operation) ? 200 : 204,
  );
  const [after] = await suite.db.select().from(persons).where(eq(persons.id, f.target.id));
  if (operation === "email") expect(after!.email).toBe("changed@example.test");
  if (["status", "deactivate"].includes(operation)) expect(after!.status).toBe("suspended");
  if (operation === "reset-pin") expect(after!.pinHash).toBeNull();
  if (["reset-login", "reactivate", "invitation"].includes(operation)) {
    expect(await response.json()).toEqual({ invitationSent: true, delivery: "queued" });
    expect(after!.status).toBe("pending");
    expect(
      await suite.db
        .select({ personId: outgoingMail.personId, requestedBy: outgoingMail.requestedBy })
        .from(outgoingMail),
    ).toEqual([{ personId: f.target.id, requestedBy: f.manager.id }]);
  }
});

it.each(
  operations.flatMap((operation) =>
    (["accountant", "admin"] as const).map((targetKind) => ({ operation, targetKind })),
  ),
)("a Manager cannot change $operation for an $targetKind", async ({ operation, targetKind }) => {
  const f = await fixture(operation, targetKind);
  const before = await suite.db.select().from(persons).where(eq(persons.id, f.target.id));
  const response = await change(operation, f);
  expect(await response.json()).toMatchObject({
    error: { code: "person.holds_more", params: { personId: f.target.id } },
  });
  expect(response.status).toBe(403);
  expect(await suite.db.select().from(persons).where(eq(persons.id, f.target.id))).toEqual(before);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("changing an existing email also needs person.email", async () => {
  const f = await fixture("email", "waiter", false);
  const response = await change("email", f);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "authorization.not_permitted", params: { permission: "person.email" } },
  });
  expect((await suite.db.select().from(persons).where(eq(persons.id, f.target.id)))[0]!.email).toBe(
    "target@example.test",
  );
});

it("a Manager with person.admin can invite someone new without person.email", async () => {
  const f = await fixture("email", "waiter", false);
  const response = await f.send("/management-api/staff", "POST", {
    displayName: "New starter",
    firstNames: "New",
    lastNames: "Starter",
    telephone: null,
    email: "new@example.test",
    roleIds: [(await suite.db.select().from(roles)).find((r) => r.builtInKey === "staff")!.id],
  });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ id: expect.any(String), invitationSent: true });
  expect(
    await suite.db
      .select({ email: persons.email, status: persons.status })
      .from(persons)
      .where(eq(persons.email, "new@example.test")),
  ).toEqual([{ email: "new@example.test", status: "pending" }]);
});

it("the membership route cannot demote the last usable Admin", async () => {
  const f = await fixture("email", "admin");
  await setBuiltInRoleForTest(suite.db, f.manager.id, "admin");
  await suite.db.update(persons).set({ passwordHash: null });
  await suite.db
    .update(persons)
    .set({ passwordHash: "target-password" })
    .where(eq(persons.id, f.target.id));
  const builtIns = await suite.db.select().from(roles);
  const response = await f.send(`/management-api/staff/${f.target.id}/access-roles`, "PUT", {
    roleIds: [builtIns.find((role) => role.builtInKey === "manager")!.id],
    expectedRoleIds: [builtIns.find((role) => role.builtInKey === "admin")!.id],
  });
  expect(await response.json()).toMatchObject({ error: { code: "person.last_admin" } });
  expect(response.status).toBe(409);
  const [adminRole] = await suite.db.select().from(roles).where(eq(roles.builtInKey, "admin"));
  expect(
    await suite.db.select().from(personRoles).where(eq(personRoles.personId, f.target.id)),
  ).toEqual([{ personId: f.target.id, roleId: adminRole!.id }]);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("lists access roles and saves several memberships independently of details", async () => {
  const f = await fixture("email", "waiter", false);
  const listed = await f.send("/management-api/access-roles", "GET");
  expect(listed.status).toBe(200);
  const choices = (await listed.json()) as {
    id: string;
    builtInKey: string;
    holderCount: number;
    permissions: string[];
  }[];
  expect(choices.map((role) => role.builtInKey)).toEqual([
    "staff",
    "supervisor",
    "manager",
    "admin",
  ]);
  expect(choices[0]!.holderCount).toBe(1);
  const roleIds = choices.slice(0, 2).map((role) => role.id);
  const response = await f.send(`/management-api/staff/${f.target.id}/access-roles`, "PUT", {
    roleIds,
    expectedRoleIds: roleIds.slice(0, 1),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ roleIds });
  const roster = await f.send("/management-api/staff", "GET");
  const target = ((await roster.json()) as { personId: string; roleIds: string[] }[]).find(
    (p) => p.personId === f.target.id,
  )!;
  expect(target.roleIds.sort()).toEqual([...roleIds].sort());
  expect(target).not.toHaveProperty("role");
});

it("membership saves require a fresh sign-in while name-only saves do not", async () => {
  const f = await fixture("email", "waiter", false);
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, f.cookie, false));
  const membership = await f.send(`/management-api/staff/${f.target.id}/access-roles`, "PUT", {
    roleIds: [],
    expectedRoleIds: [],
  });
  expect(membership.status).toBe(400);
  expect(await membership.json()).toMatchObject({
    error: { code: "management_session.proof_required" },
  });
  const details = await f.send(`/management-api/staff/${f.target.id}`, "PUT", {
    displayName: "Updated target",
    firstNames: "Target",
    lastNames: "Person",
    telephone: null,
    email: f.target.email,
    status: f.target.status,
  });
  expect(details.status).toBe(204);
  expect(
    (await suite.db.select().from(persons).where(eq(persons.id, f.target.id)))[0]!.displayName,
  ).toBe("Updated target");
});

it.each([
  ["role.not_found", 404],
  ["person.roles_changed", 409],
  ["role.not_permitted", 403],
] as const)("membership routes map %s", async (code, status) => {
  const f = await fixture("email", "waiter", false);
  const builtIns = await suite.db.select().from(roles);
  const staff = builtIns.find((r) => r.builtInKey === "staff")!.id;
  const admin = builtIns.find((r) => r.builtInKey === "admin")!.id;
  const response = await f.send(`/management-api/staff/${f.target.id}/access-roles`, "PUT", {
    roleIds: code === "role.not_found" ? [crypto.randomUUID()] : [admin],
    expectedRoleIds: code === "person.roles_changed" ? [] : [staff],
  });
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
});

it("a default Manager invites several roles but cannot hand out Admin", async () => {
  const f = await fixture("email", "waiter", false);
  const choices = await suite.db.select().from(roles);
  const ids = choices
    .filter((r) => r.builtInKey === "staff" || r.builtInKey === "supervisor")
    .map((r) => r.id);
  const body = {
    displayName: "New member",
    firstNames: "New",
    lastNames: "Member",
    telephone: null,
    email: "member@example.test",
    roleIds: ids,
  };
  const accepted = await f.send("/management-api/staff", "POST", body);
  expect(accepted.status).toBe(201);
  const { id } = (await accepted.json()) as { id: string };
  expect(
    (await suite.db.select().from(personRoles).where(eq(personRoles.personId, id)))
      .map((r) => r.roleId)
      .sort(),
  ).toEqual([...ids].sort());
  const refused = await f.send("/management-api/staff", "POST", {
    ...body,
    displayName: "Forbidden",
    email: "forbidden@example.test",
    roleIds: [choices.find((r) => r.builtInKey === "admin")!.id],
  });
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: { code: "role.not_permitted" } });
  expect(
    await suite.db.select().from(persons).where(eq(persons.email, "forbidden@example.test")),
  ).toEqual([]);
});

it("refuses the access-role list to a staff session", async () => {
  const f = await fixture("email", "waiter", false);
  await setBuiltInRoleForTest(suite.db, f.manager.id, "staff");
  const response = await f.send("/management-api/access-roles", "GET");
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({
    error: { code: "authorization.not_permitted", params: { permission: "person.manage" } },
  });
});

it.each([
  ["roleIds", null],
  ["expectedRoleIds", [42]],
] as const)("refuses malformed membership %s before writing", async (field, value) => {
  const f = await fixture("email", "waiter", false);
  const before = await suite.db
    .select()
    .from(personRoles)
    .where(eq(personRoles.personId, f.target.id));
  const response = await f.send(`/management-api/staff/${f.target.id}/access-roles`, "PUT", {
    roleIds: [],
    expectedRoleIds: [],
    [field]: value,
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "management.request_invalid", params: { field } },
  });
  expect(
    await suite.db.select().from(personRoles).where(eq(personRoles.personId, f.target.id)),
  ).toEqual(before);
});
