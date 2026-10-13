import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  nodes,
  readDeploymentMode,
  readSingletonRole,
  setDeploymentMode,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing } from "@waitron/credentials";
import { IDENTITY_MIGRATIONS, hashPassword, persons } from "@waitron/identity";
import { generateNodeKeyPair } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { establishNodeIdentity } from "./node-identity.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { mountPromoteApi } from "./promote-api.js";
import { mountMirrorBundleApi } from "./mirror-bundle-api.js";
import { TOTP_KEY_RING, enrolAuthenticator, wrongTotpCode } from "./testing/authenticator.js";

const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, IDENTITY_MIGRATIONS],
});
const LOCATION = "f1000000-0000-4000-8000-000000000001";
const PRIMARY = "f1000000-0000-4000-8000-000000000002";
const TARGET = "f1000000-0000-4000-8000-000000000003";
const ADMIN = "f1000000-0000-4000-8000-000000000004";
const PASSWORD = "public-test-admin";
const HASH = hashPassword(PASSWORD);
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x24).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const input = { outsideEvidence: "public-signed-evidence" };
const scope = (action: string) => ({
  module: "test-regime",
  action,
  eventId: "public-event",
  sourceId: PRIMARY,
  targetNodeId: TARGET,
});
let stateDir: string | undefined;
let retained: ModuleOperationInput | undefined;
let observedOperator: unknown;
let collected: string[];
let replaceKey: boolean;
beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-standby-public-"));
  await mkdir(join(stateDir, "tls"));
  await writeFile(join(stateDir, "tls", "ca.crt"), "public-test-ca");
});
afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});
beforeEach(async () => {
  collected = [];
  retained = undefined;
  observedOperator = undefined;
  replaceKey = false;
  await seedTenant(suite.db);
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Restaurant",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await suite.db.insert(nodes).values([
    { id: PRIMARY, locationId: LOCATION, name: "Primary" },
    { id: TARGET, locationId: LOCATION, name: "Spare" },
  ]);
  await suite.db
    .insert(persons)
    .values({ id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: HASH });
  await stampDeployment(suite.db, "preproduction");
  modules.splice(
    0,
    modules.length,
    fakeModule("test-regime", {
      operations: {
        async prepare<T>(
          operation: ModuleOperationInput,
          run: (ready: ModuleOperationInput) => Promise<T>,
        ) {
          expect(operation.input).toEqual(input);
          expect(readOperationAuthority(operation.authority, operation.binding)).toBeDefined();
          collected.push(operation.binding.action);
          // A separate writer must finish before the operation opens its write transaction.
          await withTransaction(suite.db, (tx) =>
            tx.update(locations).set({ name: "Source collected" }),
          );
          if (replaceKey) await mintBreakGlassSecret(suite.db, TARGET);
          return run({ ...operation, input: { current: "independent" } });
        },
      },
      provisioning: {
        standby: {
          series: "on-activation",
          async reserve(tx, primary, standby, operation) {
            if (operation === undefined)
              throw new AppError("module.operation_invalid", { module: "test-regime" });
            retained = operation;
            expect(primary.nodeId).toBe(PRIMARY);
            expect(standby?.nodeId).toBe(TARGET);
            expect(operation.binding).toEqual(scope("reserve"));
            expect(readOperationAuthority(operation.authority, operation.binding)).toEqual({
              operatorId: ADMIN,
            });
            expect(operation.input).toEqual({ current: "independent" });
            expect((await tx.select().from(locations))[0]?.name).toBe("Source collected");
            return { state: { identity: "P000042", eventId: "public-event", operatorId: ADMIN } };
          },
          async establish() {},
          async activate(tx, node, operation) {
            if (operation === undefined)
              throw new AppError("module.operation_invalid", { module: "test-regime" });
            retained = operation;
            expect(operation.binding).toEqual(scope("promote"));
            observedOperator = readOperationAuthority(
              operation.authority,
              operation.binding,
            )?.operatorId;
            expect(operation.input).toEqual({ current: "independent" });
            await tx.insert(invoiceSeries).values([
              { nodeId: node.nodeId, purpose: "standard", code: "A-P000042" },
              { nodeId: node.nodeId, purpose: "full", code: "FF-P000042" },
              { nodeId: node.nodeId, purpose: "rectificative", code: "R-P000042" },
            ]);
          },
        },
      },
    }),
  );
});
async function promotionApp() {
  await setDeploymentMode(suite.db, TARGET, "mirror");
  await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, TARGET);
  const holders = createDeploymentHolders("mirror", "secondary");
  const app = new Hono();
  mountPromoteApi(app, {
    appDb: suite.db,
    nodeId: TARGET,
    credentialKeyRing: TOTP_KEY_RING,
    modules,
    async run(attestation, withModuleOperations) {
      const result = await promoteMirrorToPrimary(
        {
          db: suite.db,
          ring: RING,
          nodeId: TARGET,
          holders,
          modules,
          withModuleOperations,
          persistTradingEnv: async () => {},
          log: () => {},
        },
        attestation,
      );
      return { alreadyPrimary: result.alreadyPrimary, restarting: !result.alreadyPrimary };
    },
  });
  return app;
}
async function bundleApp() {
  await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, PRIMARY);
  const app = new Hono();
  mountMirrorBundleApi(app, {
    appDb: suite.db,
    ring: RING,
    stateDir: stateDir!,
    relayUrl: "https://relay.test",
    boxHostname: "waitron.local",
    designated: { nodeId: PRIMARY, locationId: LOCATION },
    accountKey: "test-account",
    credentialKeyRing: TOTP_KEY_RING,
  });
  return app;
}
function post(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function promoteBody(credentials: Record<string, unknown>) {
  return {
    ...credentials,
    oldNodeNeutralised: true,
    moduleOperation: { binding: scope("promote"), input },
  };
}
function bundleBody() {
  return {
    personId: ADMIN,
    password: PASSWORD,
    standbyNodeId: TARGET,
    standbyPublicKey: generateNodeKeyPair().publicKey,
    standbyContactUrl: "https://spare.test",
    moduleOperation: { binding: scope("reserve"), input },
  };
}
async function untouched() {
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
  expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
  expect(await readSingletonRole(suite.db, TARGET)).toBe("secondary");
}
it.each(["account", "key"])(
  "activates all purposes through the public promotion route with %s authentication",
  async (method) => {
    const app = await promotionApp();
    const credentials =
      method === "account"
        ? { personId: ADMIN, password: PASSWORD }
        : { breakGlass: await mintBreakGlassSecret(suite.db, TARGET) };
    const response = await post(app, "/management-api/promote", promoteBody(credentials));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(await response.json()).toEqual({ alreadyPrimary: false, restarting: true });
    expect(
      (await suite.db.select().from(invoiceSeries))
        .map(({ code, purpose }) => ({ code, purpose }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    ).toEqual([
      { code: "A-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "R-P000042", purpose: "rectificative" },
    ]);
    expect(await readSingletonRole(suite.db, TARGET)).toBe("primary");
    expect(collected).toEqual(["promote"]);
    const expectedOperator =
      method === "account"
        ? ADMIN
        : { kind: "recovery-key", nodeId: TARGET, eventId: "public-event" };
    // Save the authenticated identity during activation: the token is already expired here.
    expect(retained?.binding).toEqual(scope("promote"));
    expect(readOperationAuthority(retained!.authority, retained!.binding)).toBeUndefined();
    expect(observedOperator).toEqual(expectedOperator);
  },
);
it("reserves an opaque dormant identity through the public bundle route after reauthentication", async () => {
  const response = await post(await bundleApp(), "/management-api/mirror-bundle", bundleBody());
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  const bundle = await response.json();
  expect(bundle.reservedIdentity.modules).toEqual({
    "test-regime": { identity: "P000042", eventId: "public-event", operatorId: ADMIN },
  });
  expect(bundle.reservedIdentity.series).toEqual([]);
  expect(JSON.stringify(bundle)).not.toContain("authority");
  expect(collected).toEqual(["reserve"]);
  expect(readOperationAuthority(retained!.authority, retained!.binding)).toBeUndefined();
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
});
it("refuses a node key replaced during outside collection without activating or changing role", async () => {
  const app = await promotionApp();
  const key = await mintBreakGlassSecret(suite.db, TARGET);
  replaceKey = true;
  const response = await post(app, "/management-api/promote", promoteBody({ breakGlass: key }));
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("promotion.break_glass_invalid");
  expect(collected).toEqual(["promote"]);
  await untouched();
});
it("rolls back all activated series and role when the chart write refuses", async () => {
  const app = await promotionApp();
  await suite.db.execute(
    sql`create trigger public_chart_refusal before insert on node_membership begin select raise(abort, 'test public chart refusal'); end`,
  );
  try {
    const response = await post(
      app,
      "/management-api/promote",
      promoteBody({ personId: ADMIN, password: PASSWORD }),
    );
    expect(response.status).toBe(500);
    expect(collected).toEqual(["promote"]);
    await untouched();
  } finally {
    await suite.db.execute(sql`drop trigger public_chart_refusal`);
  }
});
it("does not consult outside evidence when the account password is wrong", async () => {
  const app = await promotionApp();
  const response = await post(
    app,
    "/management-api/promote",
    promoteBody({ personId: ADMIN, password: "wrong" }),
  );
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("password.invalid");
  expect(collected).toEqual([]);
  await untouched();
});
it("does not consult outside evidence when the node key is wrong, even with valid account credentials", async () => {
  const app = await promotionApp();
  await mintBreakGlassSecret(suite.db, TARGET);
  const response = await post(
    app,
    "/management-api/promote",
    promoteBody({ breakGlass: "wrong", personId: ADMIN, password: PASSWORD }),
  );
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("promotion.break_glass_invalid");
  expect(collected).toEqual([]);
  await untouched();
});
it("requires the administrator's current authenticator code before outside collection", async () => {
  const app = await promotionApp();
  const secret = await enrolAuthenticator(suite.db, ADMIN, PASSWORD, TOTP_KEY_RING);
  const response = await post(
    app,
    "/management-api/promote",
    promoteBody({ personId: ADMIN, password: PASSWORD, totp: wrongTotpCode(secret) }),
  );
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe("password.invalid");
  expect(collected).toEqual([]);
  await untouched();
});
it.each(["module", "action", "targetNodeId"])(
  "refuses a promotion operation with a mismatched %s",
  async (field) => {
    const app = await promotionApp();
    const body = promoteBody({ personId: ADMIN, password: PASSWORD });
    Object.assign(body.moduleOperation.binding, {
      [field]: field === "targetNodeId" ? PRIMARY : "wrong",
    });
    const response = await post(app, "/management-api/promote", body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("module.operation_invalid");
    expect(collected).toEqual([]);
    await untouched();
  },
);
it.each(["action", "sourceId", "targetNodeId"])(
  "refuses a reserve operation with a mismatched %s",
  async (field) => {
    const body = bundleBody();
    Object.assign(body.moduleOperation.binding, {
      [field]: field === "action" ? "promote" : ADMIN,
    });
    const response = await post(await bundleApp(), "/management-api/mirror-bundle", body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("module.operation_invalid");
    expect(collected).toEqual([]);
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
  },
);
it("refuses reservation evidence for a module the enabled set does not reserve", async () => {
  const app = await bundleApp();
  modules.length = 0;
  const body = bundleBody();
  body.moduleOperation.binding.module = "disabled-regime";
  const response = await post(app, "/management-api/mirror-bundle", body);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toEqual({
    code: "module.operation_invalid",
    params: { module: "disabled-regime" },
  });
  expect(collected).toEqual([]);
});
it("returns the committed promotion result after a lost response without consulting outside evidence again", async () => {
  const app = await promotionApp();
  const key = await mintBreakGlassSecret(suite.db, TARGET);
  const body = promoteBody({ breakGlass: key });
  const first = await post(app, "/management-api/promote", body);
  expect(first.status).toBe(200);
  const before = await suite.db.select().from(invoiceSeries);
  modules[0] = {
    ...modules[0]!,
    operations: {
      async prepare() {
        throw new Error("outside receipt is no longer available");
      },
    },
  };
  const repeated = await post(app, "/management-api/promote", body);
  expect(repeated.status, JSON.stringify(await repeated.clone().json())).toBe(200);
  expect(await repeated.json()).toEqual({ alreadyPrimary: true, restarting: false });
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  expect(collected).toEqual(["promote"]);
});
it("refuses a promotion runner redirected to another node before collecting evidence", async () => {
  await setDeploymentMode(suite.db, TARGET, "mirror");
  const app = new Hono();
  mountPromoteApi(app, {
    appDb: suite.db,
    nodeId: TARGET,
    modules,
    credentialKeyRing: TOTP_KEY_RING,
    async run(_attestation, runner) {
      expect(runner).toBeDefined();
      await runner!(
        { db: suite.db, node: { nodeId: PRIMARY as never, locationId: LOCATION as never } },
        async (tx) => {
          await tx
            .insert(invoiceSeries)
            .values({ nodeId: PRIMARY, code: "incorrect", purpose: "standard" });
          return "incorrect";
        },
      );
      return { alreadyPrimary: false, restarting: true };
    },
  });
  const response = await post(
    app,
    "/management-api/promote",
    promoteBody({ personId: ADMIN, password: PASSWORD }),
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("module.operation_invalid");
  expect(collected).toEqual([]);
  await untouched();
});
it("refuses a manager's correct password before collecting reservation evidence", async () => {
  const app = await bundleApp();
  await suite.db.update(persons).set({ role: "manager" });
  const response = await post(app, "/management-api/mirror-bundle", bundleBody());
  expect(response.status).toBe(403);
  expect((await response.json()).error).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "mirror.create" },
  });
  expect(collected).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
});
