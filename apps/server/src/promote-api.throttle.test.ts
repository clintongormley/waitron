import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withNodeTransaction } from "@waitron/db";
import { setRecoveryKeyTx } from "@waitron/node-db";
import { makeBreakGlassSecret } from "./break-glass.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPassword } from "@waitron/identity";
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
  await seedPersons(suite.db, [
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

it.each(["legacy", "module", "preparation"])(
  "keeps the real recovery key usable after wrong guesses on %s",
  async (kind) => {
    const made = await makeBreakGlassSecret();
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, made.verifier, "test-key"),
    );
    const service = app();
    const request = (breakGlass: string) =>
      kind === "legacy" ? { breakGlass, oldNodeNeutralised: true } : { ...body(), breakGlass };
    const suffix = kind === "preparation" ? "/preparation" : "";
    for (let i = 0; i < 12; i++) {
      const refused = await send(service, suffix, request(`wrong-key-${i}`));
      expect(refused.status).toBe(401);
      expect(refused.body.error.code).toBe("promotion.break_glass_invalid");
    }
    expect((await send(service, suffix, request(made.secret))).status).toBe(200);
    // Recovery attempts do not consume a person's password allowance.
    expect((await send(service, "", body(PASSWORD))).status).toBe(200);
  },
);
