import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";

import { beforeEach, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, registerModulePermissions, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { mountRecordRemedies } from "./record-remedy-routes.js";
import { FISCAL_PERMISSIONS } from "./permissions.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
let token: string;
let personId: string;
beforeEach(async () => {
  registerModulePermissions(FISCAL_PERMISSIONS);
  await withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, {
      displayName: "Administrator",
      role: "admin",
      pinHash: hashPin("2468"),
    });
    personId = person!.id;
    token = (await startManagementSession(tx, { personId })).token;
  });
});

function send(body: unknown, cookie = `${MANAGEMENT_COOKIE}=${token}`) {
  const app = new Hono();
  mountRecordRemedies(app, { db: suite.db }, () => {});
  return app.request("/management-api/fiscal-records/remedy", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

it.each(["", "management_session=not-a-session"])(
  "requires a real management session: %s",
  async (cookie) => {
    const res = await send({ kind: "record-correction" }, cookie);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
  },
);

it.each(["staff", "supervisor", "manager"] as const)(
  "refuses a direct %s request",
  async (role) => {
    await setBuiltInRoleForTest(suite.db, personId, role);
    const res = await send({ kind: "record-correction" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  },
);

it.each([
  "record-correction",
  "corrective-invoice",
  "absent-original-cancellation",
  "release-brake",
])("refuses disabled %s even when the administrator sends a claimed enablement", async (kind) => {
  const res = await send({
    kind,
    enabledRemedies: [kind],
    operatorId: personId,
    reason: "Claimed authorisation",
  });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: { code: "fiscal.remedy_disabled", params: { kind } } });
});

it.each([
  { body: null },
  { body: [] },
  { body: {} },
  { body: { kind: null } },
  { body: { kind: "unknown" } },
])("refuses a malformed remedy request: %j", async ({ body }) => {
  const res = await send(body);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: { code: "fiscal.remedy_request_invalid" } });
});
