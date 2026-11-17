import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  withTransaction,
  persons,
  roles,
  dashboardSessions,
  withFoldedPersonChanges,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession, hashSessionToken } from "@waitron/identity";
import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { ownerRecoveryFixture } from "../test/cloud-owner-recovery-fixture.js";
import { mountCloudApi } from "./cloud-api.js";
import { createStaffApp } from "./cloud-remote.js";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60000,
});
async function fixture(role: "admin" | "manager" = "admin") {
  const f = await ownerRecoveryFixture();
  const person = await withTransaction(suite.db, async (tx) => {
    const [p] = await seedPersons(tx, { displayName: "Local administrator", role });
    const session = await startManagementSession(tx, { personId: p!.id, method: "password" });
    await setFreshManagementSignIn(tx, session.token);
    return { id: p!.id, token: session.token };
  });
  let primary = true;
  const app = new Hono();
  mountCloudApi(
    app,
    {
      db: suite.db,
      connection: f.client,
      managementOrigin: "https://venue.test",
      isPrimary: () => primary,
    },
    () => {},
  );
  const send = (
    action = "read",
    body: unknown = action === "read" ? {} : { request: f.request },
    options: { origin?: string; token?: string; remote?: boolean } = {},
  ) => {
    const origin =
      options.origin ?? (options.remote ? "https://staff.example.test" : "https://venue.test");
    const appToUse = options.remote ? createStaffApp(app, "https://staff.example.test") : app;
    return appToUse.request(`${origin}/management-api/cloud/owner-recovery/${action}`, {
      method: "POST",
      headers: {
        origin,
        cookie: `${MANAGEMENT_COOKIE}=${options.token ?? person.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };
  return {
    ...f,
    person,
    send,
    stepDown: () => {
      primary = false;
    },
  };
}
it("lets a fresh local administrator discover and decide with the server's person ID", async () => {
  const f = await fixture();
  const response = await f.send();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ requests: [f.request] });
  for (const action of ["approve", "refuse"] as const) {
    const state = action === "approve" ? "approved" : "refused";
    f.reply({ requestId: f.request.requestId, state });
    const reply = await f.send(action);
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ requestId: f.request.requestId, state });
    expect(f.calls.at(-1)![7]).toBe(
      JSON.stringify({
        request: f.request,
        [action === "approve" ? "approvedBy" : "refusedBy"]: f.person.id,
      }),
    );
  }
});
it.each(["manager", "delegated box permission", "no management permission"] as const)(
  "refuses %s without naming a permission they lack",
  async (kind) => {
    const f = await fixture("manager");
    if (kind === "delegated box permission")
      await withTransaction(suite.db, async (tx) => {
        const [role] = await tx.select().from(roles).where(eq(roles.builtInKey, "manager"));
        await tx
          .update(roles)
          .set({ permissions: [...role!.permissions, "system.box_admin"] })
          .where(eq(roles.id, role!.id));
      });
    if (kind === "no management permission")
      await withTransaction(suite.db, async (tx) => {
        await tx.update(roles).set({ permissions: [] }).where(eq(roles.builtInKey, "manager"));
      });
    for (const action of ["read", "approve", "refuse"]) {
      const reply = await f.send(action);
      expect(reply.status).toBe(403);
      expect(await reply.json()).toEqual({
        error: { code: "cloud.owner_recovery_admin_required", params: {} },
      });
    }
    expect(f.calls).toEqual([]);
  },
);
it.each([
  "foreign page",
  "remote staff page",
  "non-primary",
  "invalid session",
  "stale proof",
  "expired session",
  "suspended",
] as const)("refuses recovery from %s before calling Cloud", async (kind) => {
  const f = await fixture();
  const options =
    kind === "foreign page"
      ? { origin: "https://attacker.test" }
      : kind === "remote staff page"
        ? { remote: true }
        : kind === "invalid session"
          ? { token: randomUUID() }
          : {};
  if (kind === "non-primary") f.stepDown();
  if (kind === "stale proof")
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, f.person.token, false));
  if (kind === "expired session")
    await withTransaction(suite.db, (tx) =>
      tx
        .update(dashboardSessions)
        .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000).toISOString() })
        .where(eq(dashboardSessions.tokenHash, hashSessionToken(f.person.token))),
    );
  if (kind === "suspended")
    await withTransaction(suite.db, (tx) =>
      tx
        .update(persons)
        .set(withFoldedPersonChanges({ status: "suspended" }))
        .where(eq(persons.id, f.person.id)),
    );
  const response = await f.send("read", {}, options);
  const code =
    kind === "non-primary"
      ? "cloud.not_primary"
      : kind === "invalid session"
        ? "management_session.required"
        : kind === "expired session"
          ? "management_session.expired"
          : kind === "stale proof"
            ? "management_session.proof_required"
            : kind === "suspended"
              ? "person.suspended"
              : "authorization.not_permitted";
  expect((await response.json()).error.code).toBe(code);
  expect(f.calls).toEqual([]);
});
it("rejects caller-supplied actor and malformed bodies, and surfaces Cloud conflict", async () => {
  const f = await fixture();
  for (const [action, body] of [
    ["read", { role: "admin" }],
    ["approve", { request: f.request, approvedBy: randomUUID() }],
    ["refuse", {}],
  ] as const) {
    expect((await (await f.send(action, body)).json()).error.code).toBe("cloud.request_invalid");
  }
  expect(f.calls).toEqual([]);
  f.refuse("conflict", 409);
  const response = await f.send("approve");
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: { code: "cloud.request_unavailable", params: {} },
  });
});
it.each([
  ["administrator", "renewal"],
  ["primary", "renewal"],
  ["administrator", "reply"],
  ["primary", "reply"],
] as const)("rechecks %s after the %s wait", async (kind, phase) => {
  const f = await fixture();
  const change = async () => {
    if (kind === "primary") f.stepDown();
    else await withTransaction(suite.db, (tx) => setBuiltInRoleForTest(tx, f.person.id, "manager"));
  };
  if (phase === "renewal") f.delay(change);
  else f.hold(change);
  const response = await f.send(phase === "reply" ? "read" : "approve");
  expect((await response.json()).error.code).toBe(
    kind === "primary" ? "cloud.not_primary" : "cloud.owner_recovery_admin_required",
  );
  expect(f.calls).toHaveLength(phase === "renewal" ? 0 : 1);
});

it("reports Cloud's recorded approval when fresh proof expires during the call", async () => {
  const f = await fixture();
  f.reply({ requestId: f.request.requestId, state: "approved" });
  f.hold(() =>
    withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, f.person.token, false)),
  );
  const response = await f.send("approve");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ requestId: f.request.requestId, state: "approved" });
  expect(f.calls).toHaveLength(1);
  const read = await f.send();
  expect((await read.json()).error.code).toBe("management_session.proof_required");
  expect(f.calls).toHaveLength(1);
});
