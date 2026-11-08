import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword, persons } from "@waitron/identity";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { mountPromoteApi } from "./promote-api.js";
import { nodeId } from "@waitron/shared";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const ADMIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NODE = "33333333-3333-4333-8333-333333333333";
const PASSWORD = "correct-test-password";
const passwordHash = hashPassword(PASSWORD);
let root: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "promote-throttle-"));
  await suite.db.insert(persons).values([
    { id: ADMIN, displayName: "Administrator", role: "admin", passwordHash },
    { id: OTHER, displayName: "Other administrator", role: "admin", passwordHash },
  ]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

function app() {
  const contribution = fakeModule("test-promotion", {
    operations: {
      prepare: (operation, run) => run(operation),
      recovery: async () => ({ prepared: true }),
    },
  });
  const nodePreparation = createNodeOperationPreparation({
    db: suite.db,
    nodeDb: suite.node,
    node: { nodeId: nodeId(NODE) },
    stateDir: join(root!, "state"),
    venueDir: join(root!, "venue"),
    modules: [contribution],
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
  const app = new Hono();
  mountPromoteApi(app, {
    appDb: suite.db,
    nodeDb: suite.node,
    nodeId: NODE,
    credentialKeyRing: TOTP_KEY_RING,
    modules: [contribution],
    nodePreparation,
    requestFromBox: () => false,
    run: async () => ({ alreadyPrimary: false, restarting: true }),
  });
  return app;
}
function body(password = "wrong", personId = ADMIN) {
  return {
    personId,
    password,
    oldNodeNeutralised: true,
    noParallelRecovery: true,
    moduleOperation: {
      binding: {
        module: "test-promotion",
        action: "promote",
        eventId: "attempt",
        sourceId: OTHER,
        targetNodeId: NODE,
      },
      input: null,
    },
    proposal: { action: "clock-challenge" },
  };
}
async function send(app: Hono, suffix: string, value: unknown) {
  const socket = new TLSSocket(new Socket());
  try {
    const response = await app.request(
      `https://box.test/management-api/promote${suffix}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      },
      { incoming: { socket } },
    );
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie"),
    };
  } finally {
    socket.destroy();
  }
}

it.each(["legacy", "module", "preparation"])(
  "limits repeated wrong %s passwords and permits a fresh correct attempt after the wait",
  async (kind) => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const service = app();
    const suffix = kind === "preparation" ? "/preparation" : "";
    const request = (password: string, personId = ADMIN) =>
      kind === "legacy"
        ? { personId, password, oldNodeNeutralised: true }
        : body(password, personId);
    for (let i = 0; i < 4; i++) {
      expect((await send(service, suffix, request("wrong"))).status).toBe(401);
    }
    const refused = await send(service, suffix, request(PASSWORD));
    expect(refused).toEqual({
      status: 429,
      body: { error: { code: "password.throttled", params: { retryAfterSeconds: 2 } } },
      cookie: null,
    });
    expect((await send(service, suffix, request(PASSWORD, OTHER))).status).toBe(200);
    now += 2000;
    expect((await send(service, suffix, request(PASSWORD))).status).toBe(200);
    // A successful sign-in resets the prior failures, and still issues no browser cookie.
    expect(await send(service, suffix, request("wrong"))).toMatchObject({
      status: 401,
      cookie: null,
    });
  },
);

it("shares the failure budget across preparation and promotion", async () => {
  const service = app();
  for (const path of ["", "/preparation", "", "/preparation"]) {
    expect((await send(service, path, body())).status).toBe(401);
  }
  expect((await send(service, "", body(PASSWORD))).status).toBe(429);
});

it("limits wrong recovery keys without letting a changed guess choose a new bucket", async () => {
  const service = app();
  for (let i = 0; i < 4; i++) {
    expect(
      (await send(service, "", { breakGlass: `wrong-key-${i}`, oldNodeNeutralised: true })).status,
    ).toBe(401);
  }
  const refused = await send(service, "", {
    breakGlass: "another-guess",
    oldNodeNeutralised: true,
  });
  expect(refused.status).toBe(429);
  expect(refused.body.error.code).toBe("password.throttled");
});
