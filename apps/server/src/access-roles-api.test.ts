import { CORE_MIGRATIONS, activityLog, roles, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ensureBuiltInRoles } from "@waitron/identity";
import { openFreshManagementSession } from "@waitron/identity/test/fixtures.js";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { mountManagementApi } from "./management-api.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture() {
  await openFreshManagementSession(suite.db, "admin");
  const actor = await openFreshManagementSession(suite.db, "manager");
  const builtIns = await withTransaction(suite.db, ensureBuiltInRoles);
  const [role] = await suite.db
    .insert(roles)
    .values({ name: "Viewer", nameFolded: "viewer", permissions: ["report.view"] })
    .returning();
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: crypto.randomUUID() },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    () => {},
  );
  const send = (method: string, path: string, body?: unknown, signedIn = true) =>
    app.request(`/management-api/access-roles${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(signedIn ? { cookie: `waitron_management_session=${actor.token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { actor, builtIns, role: role!, send };
}

it("creates and copies through the mounted API and answers 201 with their ids", async () => {
  const { send, role } = await fixture();
  for (const copiedFrom of [undefined, role.id]) {
    const response = await send("POST", "", {
      name: copiedFrom === undefined ? "Accountant" : "Viewer copy",
      permissions: copiedFrom === undefined ? ["report.view", "report.export"] : [],
      ...(copiedFrom === undefined ? {} : { copiedFrom }),
    });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect((await suite.db.select().from(roles).where(eq(roles.id, id)))[0]!.permissions).toEqual(
      copiedFrom === undefined ? ["report.view", "report.export"] : ["report.view"],
    );
  }
});

it("renames, edits and deletes through the mounted API", async () => {
  const { send, role } = await fixture();
  const renamed = await send("PUT", `/${role.id}/name`, {
    name: "Bookkeeper",
    expectedName: "Viewer",
  });
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toEqual({});
  expect((await suite.db.select().from(roles).where(eq(roles.id, role.id)))[0]!.name).toBe(
    "Bookkeeper",
  );
  const edited = await send("PUT", `/${role.id}/permissions`, {
    permissions: ["report.export"],
    expectedPermissions: ["report.view"],
  });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toEqual({});
  expect(
    (await suite.db.select().from(roles).where(eq(roles.id, role.id)))[0]!.permissions,
  ).toEqual(["report.export"]);
  const deleted = await send("DELETE", `/${role.id}`);
  expect(deleted.status).toBe(200);
  expect(await deleted.json()).toEqual({ removedFrom: 0 });
  expect(await suite.db.select().from(roles).where(eq(roles.id, role.id))).toEqual([]);
});

const operations = ["create", "rename", "permissions", "delete"] as const;
function requestFor(operation: (typeof operations)[number], id: string) {
  if (operation === "create")
    return { method: "POST", path: "", body: { name: "Created", permissions: ["report.view"] } };
  if (operation === "rename")
    return { method: "PUT", path: `/${id}/name`, body: { name: "New", expectedName: "Viewer" } };
  if (operation === "permissions")
    return {
      method: "PUT",
      path: `/${id}/permissions`,
      body: { permissions: [], expectedPermissions: ["report.view"] },
    };
  return { method: "DELETE", path: `/${id}`, body: undefined };
}

it.each(operations)("%s refuses an actor without person.admin", async (operation) => {
  const { send, builtIns, role } = await fixture();
  await suite.db
    .update(roles)
    .set({ permissions: ["report.view"] })
    .where(eq(roles.id, builtIns.manager));
  const request = requestFor(operation, role.id);
  const response = await send(request.method, request.path, request.body);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "authorization.not_permitted", params: { permission: "person.admin" } },
  });
  expect(await suite.db.select().from(activityLog)).toEqual([]);
});

it.each(operations)("%s requires a session and fresh proof", async (operation) => {
  const { send, actor, role } = await fixture();
  const request = requestFor(operation, role.id);
  const unsigned = await send(request.method, request.path, request.body, false);
  expect(unsigned.status).toBe(401);
  expect(await unsigned.json()).toMatchObject({ error: { code: "management_session.required" } });
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, actor.token, false));
  const stale = await send(request.method, request.path, request.body);
  expect(stale.status).toBe(400);
  expect(await stale.json()).toMatchObject({
    error: { code: "management_session.proof_required" },
  });
});

it("maps stale drafts, protected built-ins, missing roles and held-grant refusals", async () => {
  const { send, role, builtIns } = await fixture();
  for (const [method, path, body, status, code] of [
    ["PUT", `/${role.id}/name`, { name: "New", expectedName: "Outdated" }, 409, "role.changed"],
    [
      "PUT",
      `/${role.id}/permissions`,
      { permissions: [], expectedPermissions: [] },
      409,
      "role.changed",
    ],
    ["DELETE", `/${builtIns.staff}`, undefined, 409, "role.built_in"],
    ["DELETE", `/${crypto.randomUUID()}`, undefined, 404, "role.not_found"],
    ["POST", "", { name: "Escalated", permissions: ["node.manage"] }, 403, "role.not_permitted"],
  ] as const) {
    const response = await send(method, path, body);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  }
});

it.each([
  ["POST", "", { name: null, permissions: [] }],
  ["POST", "", { name: "New", permissions: null }],
  ["POST", "", { name: "New", permissions: [1] }],
  ["POST", "", { name: "New", permissions: [], copiedFrom: null }],
  ["PUT", "/name", { name: "New", expectedName: null }],
  ["PUT", "/permissions", { permissions: [], expectedPermissions: null }],
] as const)("%s rejects malformed fields at %s", async (method, suffix, body) => {
  const { send, role } = await fixture();
  const response = await send(method, method === "POST" ? "" : `/${role.id}${suffix}`, body);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "management.request_invalid" } });
  expect(await suite.db.select().from(activityLog)).toEqual([]);
});
