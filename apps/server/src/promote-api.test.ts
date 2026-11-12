import { Hono } from "hono";
import { once } from "node:events";
import { createServer as createHttpsServer } from "node:https";
import { Socket, type AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { TLSSocket } from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import {
  CORE_MIGRATIONS,
  withNodeTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { HandoverRole, HandoverScenario, HandoverState } from "@waitron/handover";
import { hashSecret } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import {
  NODE_MIGRATIONS,
  nodeHandoverEvents,
  nodeHandoverOperations,
  setRecoveryKeyTx,
} from "@waitron/node-db";
import type { PromoteApiDeps, PromoteRunResult } from "./promote-api.js";

// Login, authorisation, `verifyBreakGlass` and `run` are doubled, so this pins only the endpoint's own
// logic, never the promote functions. Only the handover cases hold a real node.db.

const PERSON = "22222222-2222-2222-2222-222222222222";
const GOOD_SECRET = "correct-break-glass-secret";
const SESSION_ID = "33333333-3333-3333-3333-333333333333";

// `vi.hoisted`, because the `vi.mock` factory is hoisted above the file and closes over these refs.
const {
  checkManagerPassword,
  loginManagerById,
  authorizeManager,
  endManagementSession,
  verifyBreakGlass,
} = vi.hoisted(() => ({
  // The database is `{}` here, so the real pre-check could not read it.
  checkManagerPassword: vi.fn(async () => undefined),
  loginManagerById: vi.fn(async () => ({ token: "33333333-3333-3333-3333-333333333333" })),
  authorizeManager: vi.fn(async () => {}),
  endManagementSession: vi.fn(async () => {}),
  verifyBreakGlass: vi.fn(
    async (_db: unknown, _nodeId: string, secret: string) =>
      secret === "correct-break-glass-secret",
  ),
}));
vi.mock("@waitron/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/db")>();
  return {
    ...actual,
    withTransaction: vi.fn(async (_db: unknown, cb: (tx: unknown) => Promise<unknown>) => cb({})),
  };
});
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return {
    ...actual,
    checkManagerPassword,
    loginManagerById,
    authorizeManager,
    endManagementSession,
  };
});

vi.mock("./break-glass.js", () => ({ verifyBreakGlass }));

import { mountPromoteApi } from "./promote-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { resetObserver } from "./testing/connection-reset.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

const fakeDb = {} as Database;
// Answers the route's read of open handover operations with none.
const fakeNode = {
  select: () => ({ from: () => ({ where: async () => [] }) }),
} as unknown as NodeDatabase;
const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function appWith(
  run: (a: { oldNodeNeutralised: boolean }) => Promise<PromoteRunResult> = vi.fn(async () => ({
    alreadyPrimary: false,
    restarting: true,
  })),
): { app: Hono; run: typeof run } {
  const app = new Hono();
  mountPromoteApi(app, {
    appDb: fakeDb,
    nodeDb: fakeNode,
    nodeId: NODE,
    run,
    credentialKeyRing: TOTP_KEY_RING,
  });
  return { app, run };
}

async function post(app: Hono, body: unknown): Promise<Response> {
  return app.request("/management-api/promote", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /management-api/promote (two-path auth over the promote closure)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("an admin login with node.promote authorizes and promotes", async () => {
    const { app, run } = appWith();
    const res = await post(app, {
      oldNodeNeutralised: true,
      personId: PERSON,
      password: "pw",
    });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: true });
    expect(await res.json()).toEqual({ alreadyPrimary: false, restarting: true });
    expect(loginManagerById).toHaveBeenCalled();
    expect(authorizeManager).toHaveBeenCalledWith(expect.anything(), {
      managementSessionId: SESSION_ID,
      permission: "node.promote",
    });
    expect(endManagementSession).toHaveBeenCalledWith(expect.anything(), SESSION_ID);
    expect(verifyBreakGlass).not.toHaveBeenCalled();
  });

  it("break-glass secret authorizes and promotes", async () => {
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: true });
    expect(verifyBreakGlass).toHaveBeenCalledWith(fakeNode, NODE, GOOD_SECRET);
    // The break-glass path never touches the manager-login path.
    expect(loginManagerById).not.toHaveBeenCalled();
  });

  it("a wrong break-glass secret is refused 401 and never calls run", async () => {
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: "wrong" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("promotion.break_glass_invalid");
    expect(run).not.toHaveBeenCalled();
  });

  it("no credential is refused 401 and never calls run", async () => {
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
    expect(run).not.toHaveBeenCalled();
  });

  it("a login credential whose totp is not a string is refused 401 without trying the login", async () => {
    const { app, run } = appWith();
    const res = await post(app, {
      oldNodeNeutralised: true,
      personId: PERSON,
      password: "pw",
      totp: 123456,
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("password.invalid");
    expect(loginManagerById).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("passes a string totp through to the login", async () => {
    const { app, run } = appWith();
    const res = await post(app, {
      oldNodeNeutralised: false,
      personId: PERSON,
      password: "pw",
      totp: "123456",
    });
    expect(res.status).toBe(200);
    expect(loginManagerById).toHaveBeenCalledWith(expect.anything(), {
      personId: PERSON,
      password: "pw",
      totp: "123456",
      totpKeyRing: TOTP_KEY_RING,
    });
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: false });
  });

  it("a non-admin credential (authorization.not_permitted) is refused 403 and never calls run", async () => {
    authorizeManager.mockRejectedValueOnce(
      new AppError("authorization.not_permitted", { permission: "node.promote" }),
    );
    const { app, run } = appWith();
    const res = await post(app, { oldNodeNeutralised: true, personId: PERSON, password: "pw" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("authorization.not_permitted");
    expect(run).not.toHaveBeenCalled();
  });

  it("missing attestation surfaces run's promotion.fence_not_attested (400)", async () => {
    const run = vi.fn(async (): Promise<PromoteRunResult> => {
      throw new AppError("promotion.fence_not_attested", {});
    });
    const { app } = appWith(run);
    const res = await post(app, { oldNodeNeutralised: false, personId: PERSON, password: "pw" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("promotion.fence_not_attested");
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: false });
  });

  it("run's chart-minting refusals map to 409", async () => {
    const refusals = [
      new AppError("membership.chart_too_large", { list: "nodes", count: 9, limit: 8 }),
      new AppError("membership.cleared_list_full", { count: 257, limit: 256 }),
      new AppError("membership.revoked_duplicate", { nodeId: "x" }),
      new AppError("membership.revoked_node_listed", { nodeId: "x" }),
    ];
    for (const refusal of refusals) {
      const { app } = appWith(
        vi.fn(async (): Promise<PromoteRunResult> => {
          throw refusal;
        }),
      );
      const res = await post(app, { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
      expect([res.status, (await res.json()).error.code]).toEqual([409, refusal.code]);
    }
  });

  it("run's membership.held_untrusted maps to 409", async () => {
    const run = vi.fn(async (): Promise<PromoteRunResult> => {
      throw new AppError("membership.held_untrusted", { reason: "untrusted_signer" });
    });
    const { app } = appWith(run);
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("membership.held_untrusted");
  });

  it("run's promotion.node_fenced maps to 409", async () => {
    const run = vi.fn(async (): Promise<PromoteRunResult> => {
      throw new AppError("promotion.node_fenced", { standing: "sell-only" });
    });
    const { app } = appWith(run);
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("promotion.node_fenced");
  });
});

describe("the promote routes' context for the node preparation", () => {
  it("both routes hand on only the fence and sole-recovery answers, never a relinquishment claim or the sign-in fields", async () => {
    const prepare = vi.fn(async () => ({}));
    const withPromotion = vi.fn(async () => ({}));
    const app = new Hono();
    mountPromoteApi(app, {
      appDb: fakeDb,
      nodeDb: fakeNode,
      nodeId: NODE,
      run: vi.fn(),
      credentialKeyRing: TOTP_KEY_RING,
      nodePreparation: { prepare, withPromotion } as unknown as PromoteApiDeps["nodePreparation"],
      requestFromBox: () => false,
    });
    const binding = {
      module: "test-regime",
      action: "promote",
      eventId: "event-1",
      sourceId: "promotion-1",
      targetNodeId: NODE,
    };
    const body = {
      oldNodeNeutralised: true,
      noParallelRecovery: true,
      oldMachineRelinquished: true,
      personId: PERSON,
      password: "pw",
      totp: "123456",
      breakGlass: GOOD_SECRET,
      moduleOperation: { binding, input: null },
    };
    const socket = new TLSSocket(new Socket());
    try {
      for (const [path, sent] of [
        ["/preparation", { ...body, proposal: { action: "clock-challenge" } }],
        ["", body],
      ] as const) {
        const response = await app.request(
          `https://box.test/management-api/promote${path}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(sent),
          },
          { incoming: { socket } },
        );
        expect(response.status).toBe(200);
      }
    } finally {
      socket.destroy();
    }
    const exact = { oldNodeNeutralised: true, noParallelRecovery: true };
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(withPromotion).toHaveBeenCalledTimes(1);
    expect((prepare.mock.calls[0] as unknown[])[2]).toStrictEqual(exact);
    expect((withPromotion.mock.calls[0] as unknown[])[2]).toStrictEqual(exact);
  });
});

describe("an ordinary promotion while a handover is open on this box", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
  const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const LATER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const OTHER_BOX = "99999999-9999-4999-8999-999999999999";
  const binding = {
    module: "test-regime",
    action: "promote",
    eventId: "event-1",
    sourceId: "promotion-1",
    targetNodeId: NODE,
  };
  const SIGN_INS = [
    { oldNodeNeutralised: true, breakGlass: GOOD_SECRET },
    { oldNodeNeutralised: true, personId: PERSON, password: "pw" },
    { moduleOperation: { binding, input: null }, breakGlass: GOOD_SECRET },
    { moduleOperation: { binding, input: null }, personId: PERSON, password: "pw" },
    { moduleOperation: { binding, input: null }, noParallelRecovery: true },
  ];

  const run = vi.fn(async () => ({ alreadyPrimary: false, restarting: true }));
  type AfterSignIn = (() => Promise<void>) | undefined;
  const prepare = vi.fn(async (...args: unknown[]) => {
    await (args[5] as AfterSignIn)?.();
    return { prepared: true };
  });
  const withPromotion = vi.fn(async (...args: unknown[]) => {
    await (args[4] as AfterSignIn)?.();
    return { promoted: true };
  });
  const regime = fakeModule("test-regime", {
    provisioning: {
      standby: { activate: async () => undefined },
    } as unknown as WaitronModule["provisioning"],
  });
  let app: Hono;
  let socket: TLSSocket;

  beforeEach(async () => {
    vi.clearAllMocks();
    await withNodeTransaction(suite.node, (tx) =>
      setRecoveryKeyTx(tx, NODE, hashSecret(GOOD_SECRET), "paper-1"),
    );
    app = new Hono();
    mountPromoteApi(app, {
      appDb: fakeDb,
      nodeDb: suite.node,
      nodeId: NODE,
      run,
      modules: [regime],
      credentialKeyRing: TOTP_KEY_RING,
      nodePreparation: { prepare, withPromotion } as unknown as PromoteApiDeps["nodePreparation"],
      requestFromBox: () => false,
    });
    socket = new TLSSocket(new Socket());
  });

  afterEach(() => {
    socket.destroy();
  });

  /** An operation between this box and `OTHER_BOX`, moved through `path`. */
  async function operation(
    role: HandoverRole,
    scenario: HandoverScenario,
    path: readonly HandoverState[] = [],
    { operationId = OP, nodeId = NODE }: { operationId?: string; nodeId?: string } = {},
  ): Promise<void> {
    const store = { node: suite.node, nodeId };
    await beginHandover(
      store,
      {
        operationId,
        scenario,
        venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
        sourceNodeId: role === "source" ? nodeId : OTHER_BOX,
        destinationNodeId: role === "source" ? OTHER_BOX : nodeId,
        membership: { term: 3, digest: "a".repeat(64) },
      },
      role,
    );
    for (const state of path) await advanceHandover(store, operationId, state, {});
  }

  function send(path: "" | "/preparation", body: unknown): Promise<Response> {
    return Promise.resolve(
      app.request(
        `https://box.test/management-api/promote${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { incoming: { socket } },
      ),
    );
  }

  async function recorded(): Promise<unknown> {
    return {
      operations: await suite.node.select().from(nodeHandoverOperations),
      events: await suite.node.select().from(nodeHandoverEvents),
    };
  }

  /** Each signed-in way onto the promote route, then the preparation route: refused, nothing changed. */
  async function expectRefusedNamingOperation(operationId: string): Promise<void> {
    const before = await recorded();
    const refusal = { error: { code: "handover.operation_in_progress", params: { operationId } } };
    for (const body of SIGN_INS) {
      const response = await send("", body);
      expect([response.status, await response.json()]).toEqual([409, refusal]);
    }
    const preparation = await send("/preparation", {
      moduleOperation: { binding, input: null },
      noParallelRecovery: true,
    });
    expect([preparation.status, await preparation.json()]).toEqual([409, refusal]);

    expect(run).not.toHaveBeenCalled();
    expect(await recorded()).toEqual(before);
  }

  /** The promote route reaches `run`, and the preparation route reaches `prepare`. */
  async function expectPromotesAsToday(): Promise<void> {
    const promoted = await send("", { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
    expect([promoted.status, await promoted.json()]).toEqual([
      200,
      { alreadyPrimary: false, restarting: true },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    const prepared = await send("/preparation", { moduleOperation: { binding, input: null } });
    expect([prepared.status, await prepared.json()]).toEqual([200, { prepared: true }]);
    expect(prepare).toHaveBeenCalledTimes(1);
  }

  const REFUSED: readonly [HandoverScenario, readonly HandoverState[]][] = [
    ["controlled", []],
    ["controlled", ["copy_accepted"]],
    ["controlled", ["copy_accepted", "filing_assumed"]],
    ["emergency", []],
    ["emergency", ["emergency_declared"]],
  ];
  it.each(REFUSED)(
    "a destination operation (%s, moved through %j) is refused `handover.operation_in_progress` and records nothing",
    async (scenario, path) => {
      await operation("destination", scenario, path);
      await expectRefusedNamingOperation(OP);
    },
  );

  it("with no open operation it promotes as today", async () => {
    await expectPromotesAsToday();
  });

  const CLOSED: readonly (readonly HandoverState[])[] = [
    ["abandoned"],
    ["replaced"],
    ["copy_accepted", "filing_assumed", "activated", "return_pending", "return_complete"],
    ["copy_accepted", "filing_assumed", "activated", "return_pending", "return_abandoned"],
  ];
  for (const path of CLOSED) {
    it(`with a closed operation (moved through ${path.join(", ")}) it promotes as today`, async () => {
      await operation("destination", "controlled", path);
      await expectPromotesAsToday();
    });
  }

  const ACTIVATED: readonly [HandoverScenario, readonly HandoverState[]][] = [
    ["controlled", ["copy_accepted", "filing_assumed", "activated"]],
    ["controlled", ["copy_accepted", "filing_assumed", "activated", "return_pending"]],
    ["emergency", ["emergency_declared", "activated"]],
  ];
  it.each(ACTIVATED)(
    "from activation on (%s, moved through %j) it answers as today",
    async (scenario, path) => {
      await operation("destination", scenario, path);
      await expectPromotesAsToday();
    },
  );

  it("an operation this box holds as the source answers as today", async () => {
    await operation("source", "controlled");
    await expectPromotesAsToday();
  });

  it("another box's operation in the same file answers as today", async () => {
    await operation("destination", "controlled", [], { nodeId: OTHER_BOX });
    await expectPromotesAsToday();
  });

  it("names the open operation, not an earlier closed one", async () => {
    await operation("destination", "controlled", ["abandoned"]);
    await operation("destination", "controlled", [], { operationId: LATER_OP });
    await expectRefusedNamingOperation(LATER_OP);
  });
});

describe("on a mirror, promotion answers only the box itself", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const binding = {
    module: "test-regime",
    action: "promote",
    eventId: "event-1",
    sourceId: "promotion-1",
    targetNodeId: NODE,
  };

  function mirrorApp(fromBox: boolean | undefined, isMirror = true) {
    const run = vi.fn(async (): Promise<PromoteRunResult> => ({
      alreadyPrimary: false,
      restarting: true,
    }));
    const prepare = vi.fn(async () => ({ prepared: true }));
    const app = new Hono();
    mountPromoteApi(app, {
      appDb: fakeDb,
      nodeDb: fakeNode,
      nodeId: NODE,
      run,
      credentialKeyRing: TOTP_KEY_RING,
      nodePreparation: {
        prepare,
        withPromotion: vi.fn(),
      } as unknown as PromoteApiDeps["nodePreparation"],
      ...(fromBox === undefined
        ? {}
        : { requestFromBox: () => fromBox, requestProvenFromBox: () => fromBox }),
      isMirror,
    });
    return { app, run, prepare };
  }

  async function overHttps(app: Hono, path: string, body: unknown): Promise<Response> {
    const socket = new TLSSocket(new Socket());
    try {
      return await app.request(
        `https://box.test/management-api/promote${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { incoming: { socket } },
      );
    } finally {
      socket.destroy();
    }
  }

  const REFUSAL = { error: { code: "promotion.from_box_only", params: {} } };

  it("a mirror refuses promotion from another address, promotes nothing and reads no password", async () => {
    const { app, run } = mirrorApp(false);
    const res = await post(app, { oldNodeNeutralised: true, personId: PERSON, password: "pw" });
    expect([res.status, await res.json()]).toEqual([403, REFUSAL]);
    expect(checkManagerPassword).not.toHaveBeenCalled();
    expect(loginManagerById).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("a mirror refuses promotion from another address before reading the body", async () => {
    const { app, run } = mirrorApp(false);
    let read = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          read = true;
          controller.error(new Error("the body was read"));
        },
      },
      { highWaterMark: 0 },
    );
    const res = await app.request(
      new Request("http://box.test/management-api/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect([res.status, await res.json(), read]).toEqual([403, REFUSAL, false]);
    expect(run).not.toHaveBeenCalled();
  });

  it("a mirror refuses a recovery key from another address without checking it", async () => {
    const { app, run } = mirrorApp(false);
    const res = await post(app, { oldNodeNeutralised: true, breakGlass: GOOD_SECRET });
    expect([res.status, await res.json()]).toEqual([403, REFUSAL]);
    expect(verifyBreakGlass).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("a mirror still accepts promotion from the box itself", async () => {
    const { app, run } = mirrorApp(true);
    const res = await post(app, { oldNodeNeutralised: true, personId: PERSON, password: "pw" });
    expect([res.status, await res.json()]).toEqual([
      200,
      { alreadyPrimary: false, restarting: true },
    ]);
    expect(checkManagerPassword).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: true });
  });

  it("a mirror refuses preparation from another address and reads no password", async () => {
    const { app, prepare } = mirrorApp(false);
    const res = await overHttps(app, "/preparation", {
      moduleOperation: { binding, input: null },
      personId: PERSON,
      password: "pw",
    });
    expect([res.status, await res.json()]).toEqual([403, REFUSAL]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("a mirror refuses preparation from another address before its HTTPS check", async () => {
    const { app, prepare } = mirrorApp(false);
    const res = await app.request("/management-api/promote/preparation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect([res.status, await res.json()]).toEqual([403, REFUSAL]);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("a mirror still accepts preparation from the box itself", async () => {
    const { app, prepare } = mirrorApp(true);
    const res = await overHttps(app, "/preparation", {
      moduleOperation: { binding, input: null },
      personId: PERSON,
      password: "pw",
    });
    expect([res.status, await res.json()]).toEqual([200, { prepared: true }]);
    expect((prepare.mock.calls[0] as unknown[])[4]).toEqual({ onBox: true });
  });

  it("a mirror's from-box refusal and the preparation's on-box answer are two checks", async () => {
    const prepare = vi.fn(async () => ({ prepared: true }));
    const app = new Hono();
    mountPromoteApi(app, {
      appDb: fakeDb,
      nodeDb: fakeNode,
      nodeId: NODE,
      run: vi.fn(),
      credentialKeyRing: TOTP_KEY_RING,
      nodePreparation: {
        prepare,
        withPromotion: vi.fn(),
      } as unknown as PromoteApiDeps["nodePreparation"],
      requestProvenFromBox: () => true,
      requestFromBox: () => false,
      isMirror: true,
    });
    const res = await overHttps(app, "/preparation", {
      moduleOperation: { binding, input: null },
      personId: PERSON,
      password: "pw",
    });
    expect([res.status, await res.json()]).toEqual([200, { prepared: true }]);
    expect((prepare.mock.calls[0] as unknown[])[4]).toEqual({ onBox: false });
  });

  describe("over a real connection the client resets before the route runs", () => {
    const material = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date(),
    });
    const listening: ServerType[] = [];
    afterEach(() => {
      for (const server of listening.splice(0)) if (server !== undefined) server.close();
    });

    async function listen(app: Hono, tls: boolean) {
      const reset = resetObserver();
      const server = serve({
        fetch: reset.wrap(app.fetch),
        port: 0,
        hostname: "127.0.0.1",
        ...(tls
          ? {
              createServer: createHttpsServer,
              serverOptions: { key: material.serverKeyPem, cert: material.serverCertPem },
            }
          : {}),
      });
      listening.push(server);
      await once(server, "listening");
      const port = (server.address() as AddressInfo).port;
      return (path: string, body: unknown) => {
        const text = JSON.stringify(body);
        const host = `127.0.0.1:${port}`;
        return reset.sendThenReset(
          port,
          `POST /management-api/promote${path} HTTP/1.1\r\nHost: ${host}\r\n` +
            `Origin: ${tls ? "https" : "http"}://${host}\r\nContent-Type: application/json\r\n` +
            `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
          { tls },
        );
      };
    }

    it("a mirror's promotion is refused, its password unread", async () => {
      const { app, run } = mirrorApp(undefined);
      const send = await listen(app, false);
      const answer = await send("", { oldNodeNeutralised: true, personId: PERSON, password: "pw" });
      expect([answer.status, JSON.parse(answer.body)]).toEqual([403, REFUSAL]);
      expect(checkManagerPassword).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    });

    it("a mirror's preparation is refused over HTTPS, its password unread", async () => {
      const { app, prepare } = mirrorApp(undefined);
      const send = await listen(app, true);
      const answer = await send("/preparation", {
        moduleOperation: { binding, input: null },
        personId: PERSON,
        password: "pw",
      });
      expect([answer.status, JSON.parse(answer.body)]).toEqual([403, REFUSAL]);
      expect(prepare).not.toHaveBeenCalled();
    });

    it("a box that is not a mirror still promotes", async () => {
      const { app, run } = mirrorApp(undefined, false);
      const send = await listen(app, false);
      const answer = await send("", { oldNodeNeutralised: true, personId: PERSON, password: "pw" });
      expect(answer.status).toBe(200);
      expect(run).toHaveBeenCalledWith({ oldNodeNeutralised: true });
    });
  });

  it("a fenced box's promotion refusal is unchanged", async () => {
    const { app, run } = mirrorApp(false, false);
    run.mockRejectedValueOnce(new AppError("promotion.node_fenced", { standing: "sell-only" }));
    const res = await post(app, { oldNodeNeutralised: true, personId: PERSON, password: "pw" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("promotion.node_fenced");
    expect(checkManagerPassword).toHaveBeenCalled();
  });
});
