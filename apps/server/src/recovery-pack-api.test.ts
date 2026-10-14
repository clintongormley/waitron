import { Hono } from "hono";
import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { nodeId, locationId } from "@waitron/shared";
import { mintBreakGlassSecret } from "./break-glass.js";
import { mountRecoveryPackApi } from "./recovery-pack-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });
const node = {
  nodeId: nodeId("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
  locationId: locationId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
};
let secret: string;
let managerToken: string;
let staffToken: string;
const logs: unknown[] = [];
beforeEach(async () => {
  logs.length = 0;
  await stampDeployment(suite.db, "preproduction");
  secret = await mintBreakGlassSecret(suite.db, node.nodeId);
  await withTransaction(suite.db, async (tx) => {
    for (const role of ["manager", "staff"] as const) {
      const [person] = await tx
        .insert(persons)
        .values({ displayName: role, role, pinHash: "unused", passwordHash: "unused" })
        .returning();
      const session = await startManagementSession(tx, { personId: person!.id });
      if (role === "manager") managerToken = session.token;
      else staffToken = session.token;
    }
  });
});

function app(failing = false) {
  const instance = new Hono();
  const module = {
    ...fakeModule("test-regime"),
    backup: {
      recoveryPack: async () => {
        if (failing) throw new Error(`do not log ${secret}`);
        return { signedBlock: "public-block", snapshot: true };
      },
    },
  };
  mountRecoveryPackApi(
    instance,
    {
      db: suite.db,
      node,
      venueId: "venue-one",
      modules: [module],
      now: () => new Date("2026-10-14T10:00:00.000Z"),
    },
    (...values) => logs.push(values),
  );
  return instance;
}

function download(token = managerToken, key = secret, instance = app()) {
  return instance.request("/api/box/recovery-pack", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `waitron_management_session=${token}` },
    body: JSON.stringify({ nodeRecoveryKey: key, modules: { "test-regime": {} } }),
  });
}

it("requires a management session", async () => {
  const response = await app().request("/api/box/recovery-pack", { method: "POST" });
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "management_session.required" } });
});

it("refuses staff even when they hold the node key", async () => {
  const response = await download(staffToken);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
});

it("downloads a secret-bearing attachment without a subscription, bucket or new key", async () => {
  const response = await download();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="waitron-node-recovery-2026-10-14.json"',
  );
  expect(await response.json()).toMatchObject({
    kind: "node-recovery-pack",
    nodeRecovery: { nodeId: node.nodeId, name: expect.any(String), secret },
    modules: { "test-regime": { signedBlock: "public-block", snapshot: true } },
  });
  expect(JSON.stringify(logs)).not.toContain(secret);
  expect(JSON.stringify(logs)).not.toContain(managerToken);
});

it("refuses a wrong key without putting the submitted key in its answer or log", async () => {
  const response = await download(managerToken, "wrong-secret-should-stay-private");
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: { code: "promotion.break_glass_invalid", params: {} },
  });
  expect(JSON.stringify(logs)).not.toContain("wrong-secret-should-stay-private");
});

it("keeps an unexpected module error opaque even when its message carries the key", async () => {
  const response = await download(managerToken, secret, app(true));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: { code: "server.internal" } });
  expect(JSON.stringify(logs)).not.toContain(secret);
});

it("does not expose a secret-bearing pack through GET", async () => {
  const response = await app().request("/api/box/recovery-pack");
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(secret);
  expect(logs).toEqual([]);
});
