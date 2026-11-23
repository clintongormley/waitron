import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { mountCloudApi } from "./cloud-api.js";
import { installationFixture } from "../test/cloud-installation-fixture.js";
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
async function actor() {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await seedPersons(tx, { displayName: "Alex", role: "admin" });
    const session = await startManagementSession(tx, { method: "password", personId: p!.id });
    return { id: p!.id, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}
const value = {
  version: 1 as const,
  installationId: "private",
  venueId: "private",
  countryCode: "ES" as const,
  asOf: "2026-11-10T12:00:00.000Z",
  code: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
  codeIssuedAt: "2026-11-01T09:00:00.000Z",
  address: "https://current.example.test/",
};
it("reveals only public code facts, with node.manage and origin checks before and after Cloud waits", async () => {
  const f = await installationFixture();
  try {
    const who = await actor();
    let primary = true,
      calls = 0,
      beforeReturn = async () => {};
    const app = new Hono();
    const logs: unknown[] = [];
    mountCloudApi(
      app,
      {
        db: suite.db,
        managementOrigin: "https://venue.test",
        isPrimary: () => primary,
        connection: {
          ...f.client,
          emergencyCode: async () => {
            calls++;
            await beforeReturn();
            return value;
          },
        },
      },
      (...args) => {
        logs.push(args);
      },
    );
    const request = (origin = "https://venue.test") =>
      app.request("/management-api/cloud/emergency/code", {
        method: "POST",
        headers: { cookie: who.cookie, origin, "content-type": "application/json" },
        body: "{}",
      });
    const success = await request();
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("no-store");
    expect(await success.json()).toEqual({
      asOf: value.asOf,
      code: value.code,
      codeIssuedAt: value.codeIssuedAt,
      address: value.address,
    });
    expect((await request("https://other.test")).status).toBe(403);
    expect(calls).toBe(1);
    beforeReturn = async () => {
      primary = false;
    };
    expect(await (await request()).json()).toEqual({
      error: { code: "cloud.not_primary", params: {} },
    });
    primary = true;
    beforeReturn = () => setBuiltInRoleForTest(suite.db, who.id, "manager");
    const refused = await request();
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(await refused.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "node.manage" } },
    });
    expect((await request()).status).toBe(403);
    expect(calls).toBe(3);
    expect(JSON.stringify(logs)).not.toContain(value.code);
  } finally {
    await f.close();
  }
});
it("refuses a code request with a body before asking Cloud, and answers one on a box without a connection", async () => {
  const who = await actor();
  const app = new Hono();
  mountCloudApi(
    app,
    { db: suite.db, managementOrigin: "https://venue.test", isPrimary: () => true },
    () => {},
  );
  const request = (body: string) =>
    app.request("/management-api/cloud/emergency/code", {
      method: "POST",
      headers: {
        cookie: who.cookie,
        origin: "https://venue.test",
        "content-type": "application/json",
      },
      body,
    });
  for (const body of ['{"again":true}', "[]", "null"]) {
    const refused = await request(body);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: { code: "cloud.request_invalid", params: {} } });
  }
  const unconfigured = await request("{}");
  expect(unconfigured.status).toBe(409);
  expect(await unconfigured.json()).toEqual({
    error: { code: "cloud.not_configured", params: {} },
  });
});

it("names eligible active people and authenticator presence without disclosing credentials", async () => {
  const who = await actor();
  await seedPersons(suite.db, [
    {
      displayName: "Beatrice",
      role: "admin",
      totpSecret: "sealed-authenticator",
      passwordHash: "private-hash",
    },
    { displayName: "Staff", role: "staff", totpSecret: "not-eligible" },
    { displayName: "Suspended", role: "admin", status: "suspended", totpSecret: "not-active" },
  ]);
  const app = new Hono();
  mountCloudApi(
    app,
    { db: suite.db, managementOrigin: "https://venue.test", isPrimary: () => true },
    () => {},
  );
  const request = () =>
    app.request("/management-api/cloud/emergency/people", { headers: { cookie: who.cookie } });
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual([
    { personId: who.id, displayName: "Alex", hasAuthenticator: false },
    { personId: expect.any(String), displayName: "Beatrice", hasAuthenticator: true },
  ]);
  await setBuiltInRoleForTest(suite.db, who.id, "manager");
  expect((await request()).status).toBe(403);
});
it.each([
  ["cloud.emergency_hosting_closed", { reason: "setting_off" }, 403],
  ["cloud.emergency_code_rate_limited", { seconds: 17 }, 429],
] as const)("returns %s as a public no-store refusal", async (code, params, status) => {
  const f = await installationFixture();
  try {
    const who = await actor(),
      app = new Hono();
    mountCloudApi(
      app,
      {
        db: suite.db,
        managementOrigin: "https://venue.test",
        isPrimary: () => true,
        connection: {
          ...f.client,
          emergencyCode: async () => {
            throw new AppError(code, params);
          },
        },
      },
      () => {},
    );
    const response = await app.request("/management-api/cloud/emergency/code", {
      method: "POST",
      headers: {
        cookie: who.cookie,
        origin: "https://venue.test",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code, params } });
  } finally {
    await f.close();
  }
});
