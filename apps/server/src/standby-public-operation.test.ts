import { seedPersons, setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { readVenue } from "@waitron/db";
import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  nodes,
  stampDeployment,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { NODE_MIGRATIONS, readPairLink } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { loadKeyRing, setPairLinkStateTx, writePairLinkTx } from "@waitron/credentials";
import { hashPassword } from "@waitron/identity";
import { generateNodeKeyPair, signDocumentBody } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { generateStandbyIdentity } from "./reserved-identity.js";
import {
  joinAsBundleAnswer,
  joiningBox,
  mountBoxJoin,
  signedInCookie,
  type PersonSent,
} from "./testing/box-join.js";
import { holdRecoveryKey } from "./testing/recovery-key.js";

const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", async () => {
  const { modulesSettings } = await import("@waitron/module");
  return { ALL_MODULES: modules, MODULES_SETTINGS: modulesSettings(modules) };
});
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
});
const PRIMARY = "f1000000-0000-4000-8000-000000000002";
const TARGET = "f2000000-0000-4000-8000-000000000003";
const ADMIN = "f1000000-0000-4000-8000-000000000004";
const ADMIN_EMAIL = "owner@example.test";
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
let collected: string[];
beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-standby-public-"));
  await mkdir(join(stateDir, "tls"));
  await writeFile(join(stateDir, "tls", "ca.crt"), "public-test-ca");
  await writeFile(join(stateDir, "tls", "ca.key"), "public-test-ca-key");
  await holdRecoveryKey(stateDir);
});
afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});
beforeEach(async () => {
  collected = [];
  retained = undefined;
  await seedVenue(suite.db, {
    name: "Restaurant",
    invoiceLocales: ["es"],
  });
  await suite.db.insert(nodes).values([
    { id: PRIMARY, name: "Primary" },
    { id: TARGET, name: "Spare" },
  ]);
  await seedPersons(suite.db, {
    id: ADMIN,
    email: ADMIN_EMAIL,
    displayName: "Administrator",
    role: "admin",
    passwordHash: HASH,
  });
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
            seedVenueSettings(tx, { name: "Source collected" }),
          );
          return run({ ...operation, input: { current: "independent" } });
        },
      },
      provisioning: {
        standby: {
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
            expect((await readVenue(tx)).name).toBe("Source collected");
            return { state: { identity: "P000042", eventId: "public-event", operatorId: ADMIN } };
          },
          async establish() {},
        },
      },
    }),
  );
});
async function bundleApp() {
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, PRIMARY);
  const app = new Hono();
  mountBoxJoin(app, {
    appDb: suite.db,
    node: suite.node,
    ring: RING,
    stateDir: stateDir!,
    boxHostname: "waitron.local",
    advertisedOrigin: "https://box.test",
    designated: { nodeId: PRIMARY },
    wakeSpareJoin: () => {},
  });
  return app;
}
/** The spare asks to join and says Yes, and the administrator, signed in afresh, approves. */
async function approvedJoin(
  app: Hono,
  body: ReturnType<typeof bundleBody>,
  sent: Partial<PersonSent> = {},
) {
  const spare = joiningBox("192.168.1.20", {
    identity: { ...generateStandbyIdentity(), nodeId: TARGET },
    contactUrl: "https://spare.test",
    storeUrl: "https://spare.test:7443",
  });
  return joinAsBundleAnswer(app, {
    box: spare,
    sent: { cookie: await signedInCookie(suite.db, ADMIN), ...sent },
    moduleOperation: body.moduleOperation,
  });
}
function bundleBody() {
  return { moduleOperation: { binding: scope("reserve"), input } };
}
it("reserves an opaque dormant identity through the approved join of a freshly signed-in administrator", async () => {
  const response = await approvedJoin(await bundleApp(), bundleBody());
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
it("admits with the module operation over the streaming link of a spare the chart lists evicted", async () => {
  const app = await bundleApp();
  const old = "f3000000-0000-4000-8000-000000000005";
  const body = {
    term: 1,
    nodes: [
      { nodeId: PRIMARY, contactUrl: "https://box.test", standing: "serving-primary" as const },
      { nodeId: old, contactUrl: "https://old.test", standing: "evicted" as const },
    ],
  };
  const key = await readNodeIdentityKey(suite.node, RING, PRIMARY);
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: PRIMARY,
    signature: signDocumentBody(body, key),
    endorsements: [],
  });
  await withNodeTransaction(suite.node, async (tx) => {
    await writePairLinkTx(tx, RING, PRIMARY, {
      role: "streams",
      state: "pending",
      peerNodeId: old,
      peerPublicKey: generateNodeKeyPair().publicKey,
      storeUrl: "https://old.test:7443",
      venueId: "venue",
      accessKeyId: "old-access-key",
      secretAccessKey: "old-secret-key",
    });
    await setPairLinkStateTx(tx, PRIMARY, "streaming");
  });

  const response = await approvedJoin(app, bundleBody());

  expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
  expect((await readPairLink(suite.node, PRIMARY))?.peerNodeId).toBe(TARGET);
});
it.each(["action", "sourceId", "targetNodeId"])(
  "refuses a reserve operation with a mismatched %s",
  async (field) => {
    const body = bundleBody();
    Object.assign(body.moduleOperation.binding, {
      [field]: field === "action" ? "promote" : ADMIN,
    });
    const response = await approvedJoin(await bundleApp(), body);
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
  const response = await approvedJoin(app, body);
  expect(response.status).toBe(400);
  expect((await response.json()).error).toEqual({
    code: "module.operation_invalid",
    params: { module: "disabled-regime" },
  });
  expect(collected).toEqual([]);
});
it("refuses an approver without node.manage before collecting reservation evidence", async () => {
  const app = await bundleApp();
  await setBuiltInRoleForTest(suite.db, ADMIN, "manager");
  const response = await approvedJoin(app, bundleBody());
  expect(response.status).toBe(403);
  expect((await response.json()).error).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "node.manage" },
  });
  expect(collected).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
});
it.each([
  [
    "a stale sign-in",
    async () => ({ cookie: await signedInCookie(suite.db, ADMIN, false) }),
    400,
    "management_session.proof_required",
  ],
  [
    "another page",
    async () => ({ headers: { origin: "https://elsewhere.example" } }),
    403,
    "node.operation_page_required",
  ],
] as const)(
  "does not consult outside evidence for a join approved on %s",
  async (_case, sent, status, code) => {
    const app = await bundleApp();
    const response = await approvedJoin(app, bundleBody(), await sent());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(collected).toEqual([]);
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
  },
);
