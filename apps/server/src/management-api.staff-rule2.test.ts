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
import { seedPersons } from "@waitron/identity/test/person-rows.js";
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
      permissions: [
        ...managerRole!.permissions,
        "person.admin",
        ...(emailPermission ? ["person.email"] : []),
      ],
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
    role: "staff",
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
