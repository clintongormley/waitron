import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, webauthnChallenges, webauthnCredentials } from "@waitron/identity";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { mountBackupRecoveryPackApi } from "./backup-recovery-pack-api.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

beforeEach(async () => {
  await suite.db.delete(webauthnCredentials);
});

function app() {
  const instance = new Hono();
  mountBackupRecoveryPackApi(instance, { db: suite.db, rpId: "localhost" }, () => {});
  return instance;
}

const options = (token?: string) =>
  app().request("/api/backup/recovery-pack/passkey-options", {
    method: "POST",
    headers: token === undefined ? {} : { cookie: `waitron_management_session=${token}` },
  });

it("needs a management session", async () => {
  const response = await options();
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "management_session.required" } });
});

it("needs system.manage, storing no challenge for a person without it", async () => {
  const { personId, token } = await openManagementSession(suite.db, "supervisor");
  await suite.db
    .insert(webauthnCredentials)
    .values({ personId, credentialId: "cred-supervisor", publicKey: "AQID", counter: 0 });
  const before = (await suite.db.select().from(webauthnChallenges)).length;
  const response = await options(token);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect(await suite.db.select().from(webauthnChallenges)).toHaveLength(before);
});

it("answers the signed-in admin's own passkey challenge, never stored by a cache", async () => {
  const { personId, token } = await openManagementSession(suite.db, "admin");
  await suite.db
    .insert(webauthnCredentials)
    .values({ personId, credentialId: "cred-admin", publicKey: "AQID", counter: 0 });
  const response = await options(token);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = (await response.json()) as {
    challengeHandle: string;
    options: { allowCredentials: { id: string }[]; userVerification: string };
  };
  expect(body.options.allowCredentials.map((c) => c.id)).toEqual(["cred-admin"]);
  expect(body.options.userVerification).toBe("required");
  expect(typeof body.challengeHandle).toBe("string");
});

it("refuses an admin with no passkey as passkey.not_registered", async () => {
  const { token } = await openManagementSession(suite.db, "admin");
  const response = await options(token);
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error: { code: "passkey.not_registered" } });
});
