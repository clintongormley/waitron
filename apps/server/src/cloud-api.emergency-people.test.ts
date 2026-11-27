import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountCloudApi } from "./cloud-api.js";
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
async function actor() {
  return withTransaction(suite.db, async (tx) => {
    const [p] = await seedPersons(tx, { displayName: "Alex", role: "admin" });
    const session = await startManagementSession(tx, { method: "password", personId: p!.id });
    return { id: p!.id, cookie: `${MANAGEMENT_COOKIE}=${session.token}` };
  });
}
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
it("no route answers /management-api/cloud/emergency/code", async () => {
  const who = await actor();
  const app = new Hono();
  mountCloudApi(
    app,
    { db: suite.db, managementOrigin: "https://venue.test", isPrimary: () => true },
    () => {},
  );
  for (const method of ["GET", "POST"])
    expect(
      (
        await app.request("/management-api/cloud/emergency/code", {
          method,
          headers: {
            cookie: who.cookie,
            origin: "https://venue.test",
            "content-type": "application/json",
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        })
      ).status,
    ).toBe(404);
});
