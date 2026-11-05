import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { CORE_MIGRATIONS, withNodeTransaction, writeNodeMembership } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  nodeSigningPublicKey,
  type KeyRing,
} from "@waitron/credentials";
import {
  signEnvelope,
  verifyEnvelope,
  type FinalStateIndicator,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  endorseKey,
  signDocumentBody,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import { NODE_MIGRATIONS, recordHandoverRestrictionTx } from "@waitron/node-db";
import { captureFinalCopy, type CaptureDeps } from "./handover-capture.js";
import { mountHandoverSourceApi } from "./handover-source-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi } from "./peer-status-api.js";

const files = vi.hoisted(() => ({ rename: vi.fn(), open: vi.fn(), rm: vi.fn() }));
vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  files.rename.mockImplementation(real.rename);
  files.open.mockImplementation(real.open);
  files.rm.mockImplementation(real.rm);
  return { ...real, rename: files.rename, open: files.open, rm: files.rm };
});

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x6).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NONCE = "n".repeat(24);

const MODULES = [
  {
    name: "core",
    version: "1.2.3",
    tier: "mandatory",
    migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
  },
] as const satisfies readonly WaitronModule[];

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
  setup: async (db) => {
    db.run(sql`create table handover_probe (n integer not null)`);
  },
});

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-source-api-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

interface Boxes {
  self: string;
  selfKey: string;
  destination: { nodeId: string; privateKey: string };
  bystander: { nodeId: string; privateKey: string };
  deps: CaptureDeps;
  app: Hono;
}

/** This box, stepped down for OP to `destination`, with a chart listing it and one other box. */
async function boxes({
  steppedDown = true,
  modules = MODULES as readonly WaitronModule[],
  log = (() => {}) as Logger,
} = {}): Promise<Boxes> {
  const db = suite.db;
  await seedVenue(db);
  const self = await seedNode(db);
  const destination = await seedNode(db);
  const bystander = await seedNode(db);
  for (const nodeId of [self, destination, bystander])
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  const selfKey = await readNodeIdentityKey(suite.node, RING, self);
  const destinationKey = await readNodeIdentityKey(suite.node, RING, destination);
  const bystanderKey = await readNodeIdentityKey(suite.node, RING, bystander);
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: self, contactUrl: "https://box-0", standing: "serving-primary" },
      { nodeId: destination, contactUrl: "https://box-1", standing: "serving-secondary" },
      { nodeId: bystander, contactUrl: "https://box-2", standing: "serving-secondary" },
    ],
  };
  const held: SignedMembershipDocument = {
    body,
    signerNodeId: self,
    signature: signDocumentBody(body, selfKey),
    endorsements: [
      endorseKey(destination, nodeSigningPublicKey(destinationKey), self, selfKey),
      endorseKey(bystander, nodeSigningPublicKey(bystanderKey), self, selfKey),
    ],
  };
  await writeNodeMembership(db, held);
  const store = { node: suite.node, nodeId: self };
  await beginHandover(
    store,
    {
      operationId: OP,
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
      sourceNodeId: self,
      destinationNodeId: destination,
      membership: { term: 3, digest: "a".repeat(64) },
    },
    "source",
  );
  if (steppedDown) {
    await advanceHandover(store, OP, "source_stepped_down", {});
    await withNodeTransaction(suite.node, (tx) =>
      recordHandoverRestrictionTx(tx, {
        nodeId: self,
        operationId: OP,
        kind: "handed-over",
        successorNodeId: destination,
        membershipTerm: 3,
      }),
    );
  }
  const deps: CaptureDeps = {
    venue: db,
    node: suite.node,
    stateDir,
    ring: RING,
    nodeId: self,
    modules,
  };
  const app = new Hono();
  mountHandoverSourceApi(app, deps, log);
  return {
    self,
    selfKey,
    destination: { nodeId: destination, privateKey: destinationKey },
    bystander: { nodeId: bystander, privateKey: bystanderKey },
    deps,
    app,
  };
}

function ask(
  app: Hono,
  route: "indicator" | "final-copy",
  signer: { nodeId: string; privateKey: string },
  operationId = OP,
  body: Record<string, string | number> = { nonce: NONCE, atMs: 1, operationId, purpose: route },
): Promise<Response> {
  return Promise.resolve(
    app.request(`/api/node/handover/${operationId}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signEnvelope("query", body, signer)),
    }),
  );
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const copyPath = () => join(stateDir, "handover", OP, "venue.db");

describe("the final copy and its indicator, served to the selected box only", () => {
  it("the destination gets the indicator and the copy, and the copy's digest matches", async () => {
    const { app, self, selfKey, destination } = await boxes();
    const indicatorResponse = await ask(app, "indicator", destination);
    expect(indicatorResponse.status).toBe(200);
    const indicator =
      (await indicatorResponse.json()) as SignedHandoverEnvelope<FinalStateIndicator>;
    const selfPublic = nodeSigningPublicKey(selfKey);
    const verdict = verifyEnvelope<FinalStateIndicator>(indicator, "final-state", (id) =>
      id === self ? selfPublic : undefined,
    );
    expect(verdict.valid).toBe(true);
    expect(indicator.body.binding.operationId).toBe(OP);
    expect(indicator.body.binding.destinationNodeId).toBe(destination.nodeId);

    const copyResponse = await ask(app, "final-copy", destination);
    expect(copyResponse.status).toBe(200);
    expect(copyResponse.headers.get("content-type")).toBe("application/octet-stream");
    expect(copyResponse.headers.get("content-length")).toBe(String(indicator.body.snapshot.bytes));
    const bytes = new Uint8Array(await copyResponse.arrayBuffer());
    expect(bytes.length).toBe(indicator.body.snapshot.bytes);
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
  });

  it("one signed query opens only the route its purpose names", async () => {
    const { app, deps, destination } = await boxes();
    mountPeerStatusApi(
      app,
      { db: deps.venue, node: deps.node, ring: deps.ring, nodeId: deps.nodeId },
      () => {},
    );
    const routes = {
      status: "/api/node/peer-status",
      indicator: `/api/node/handover/${OP}/indicator`,
      "final-copy": `/api/node/handover/${OP}/final-copy`,
    } as const;
    const answers: Record<
      string,
      Record<string, { status: number; code: unknown; field: unknown }>
    > = {};
    for (const purpose of Object.keys(routes)) {
      const envelope = JSON.stringify(
        signEnvelope("query", { nonce: NONCE, atMs: 1, operationId: OP, purpose }, destination),
      );
      const seen: (typeof answers)[string] = {};
      for (const [name, path] of Object.entries(routes)) {
        const response = await app.request(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: envelope,
        });
        let error: { code: string; params: { field: string } } | undefined;
        if (response.status === 200) await response.body?.cancel();
        else error = ((await response.json()) as { error: typeof error }).error;
        seen[name] = { status: response.status, code: error?.code, field: error?.params.field };
      }
      answers[purpose] = seen;
    }
    const passes = { status: 200, code: undefined, field: undefined };
    const refused = { status: 400, code: "handover.request_invalid", field: "purpose" };
    expect(answers).toEqual({
      status: { status: passes, indicator: refused, "final-copy": refused },
      indicator: { status: refused, indicator: passes, "final-copy": refused },
      "final-copy": { status: refused, indicator: refused, "final-copy": passes },
    });
  });

  it("the same signed query opens its own route again", async () => {
    const { app, destination } = await boxes();
    const envelope = JSON.stringify(
      signEnvelope(
        "query",
        { nonce: NONCE, atMs: 1, operationId: OP, purpose: "final-copy" },
        destination,
      ),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.request(`/api/node/handover/${OP}/final-copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: envelope,
      });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
  });

  it("the copy asked for first is the one the indicator then names", async () => {
    const { app, destination } = await boxes();
    const bytes = new Uint8Array(await (await ask(app, "final-copy", destination)).arrayBuffer());
    const indicator = (await (
      await ask(app, "indicator", destination)
    ).json()) as SignedHandoverEnvelope<FinalStateIndicator>;
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
  });

  for (const route of ["indicator", "final-copy"] as const) {
    it(`another listed box is refused the ${route}`, async () => {
      const { app, bystander } = await boxes();
      const response = await ask(app, route, bystander);
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
    });

    it(`an unknown operation is 404 for the ${route}`, async () => {
      const { app, destination } = await boxes();
      const response = await ask(app, route, destination, OTHER_OP);
      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe("handover.operation_unknown");
    });

    it(`a query naming another operation than the path is refused for the ${route}`, async () => {
      const { app, destination } = await boxes();
      const response = await ask(app, route, destination, OP, {
        nonce: NONCE,
        atMs: 1,
        operationId: OTHER_OP,
        purpose: route,
      });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("handover.request_invalid");
    });

    it(`a query naming no operation is refused for the ${route}`, async () => {
      const { app, destination } = await boxes();
      const response = await ask(app, route, destination, OP, { nonce: NONCE, atMs: 1 });
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("handover.request_invalid");
    });

    it(`a query naming no purpose is refused for the ${route}`, async () => {
      const { app, destination } = await boxes();
      const response = await ask(app, route, destination, OP, {
        nonce: NONCE,
        atMs: 1,
        operationId: OP,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "handover.request_invalid", params: { field: "purpose" } },
      });
    });

    it(`a purpose no route has is refused when the query is read, for the ${route}`, async () => {
      const { app, bystander } = await boxes();
      const response = await ask(app, route, bystander, OP, {
        nonce: NONCE,
        atMs: 1,
        operationId: OTHER_OP,
        purpose: "anything-else",
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "handover.request_invalid", params: { field: "purpose" } },
      });
    });

    it(`a signer no stored key vouches for is refused the ${route}`, async () => {
      const { app, destination, bystander } = await boxes();
      const response = await ask(app, route, {
        nodeId: destination.nodeId,
        privateKey: bystander.privateKey,
      });
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("handover.peer_unknown");
    });

    it(`a module summary that fails is a 500 for the ${route}`, async () => {
      const failing: WaitronModule = {
        ...MODULES[0],
        handover: {
          summarise: () => Promise.reject(new Error("the module's tables could not be read")),
        },
      };
      const { app, destination } = await boxes({ modules: [failing] });
      const response = await ask(app, route, destination);
      expect(response.status).toBe(500);
      expect(await errorCode(response)).toBe("handover.summary_failed");
    });
  }

  it("a damaged retained-selections file is named in the log, and not in the answer", async () => {
    const lines: { event: string; fields: Record<string, unknown> | undefined }[] = [];
    const { app, destination } = await boxes({
      log: (_level, event, fields) => lines.push({ event, fields }),
    });
    await writeFile(join(stateDir, "module-preparation-state.json"), "{ not json");

    const response = await ask(app, "indicator", destination);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "setup.attempt_invalid", params: {} },
    });
    const line = lines.find((entry) => entry.event === "setup.attempt_invalid");
    expect(line?.fields?.logReason).toContain("module-preparation-state.json");
  });

  it("a retake left behind by an earlier crash is removed when the copy is taken again", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    await rm(copyPath());
    await writeFile(`${copyPath()}.retake-crashed`, "a crashed retake");
    await writeFile(`${copyPath()}.retake-crashed.partial`, "a crashed copy");
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(200);
    expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(
      indicator.body.snapshot.sha256,
    );
    expect(await readdir(join(stateDir, "handover", OP))).toEqual(["venue.db"]);
  });

  it("a request made while another retakes the copy leaves that retake alone, and both are served", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    await rm(copyPath());
    const realOpen = files.open.getMockImplementation()!;
    const realRm = files.rm.getMockImplementation()!;
    // Once the first request's retake is written, the second request is sent and the first
    // holds the retake unopened until something removes it or a fifth of a second has passed.
    // The working `.partial` file archiveTo clears is not the retake, so its removal does not
    // count. While the retakes take turns the second request waits and the timer ends the hold;
    // without the turn the second removes the first's retake and the first is refused.
    let second: Promise<Response> | undefined;
    let removedRetake: () => void = () => {};
    const removed = new Promise<void>((resolve) => (removedRetake = resolve));
    let held = false;
    const archives = vi.spyOn(deps.venue, "archiveTo");
    files.rm.mockImplementation(async (path: string, ...rest: unknown[]) => {
      await realRm(path, ...rest);
      if (path.includes(".retake-") && !path.endsWith(".partial")) removedRetake();
    });
    files.open.mockImplementation(async (path: string, ...rest: unknown[]) => {
      if (!held && path.includes(".retake-")) {
        held = true;
        second = ask(app, "final-copy", destination);
        await Promise.race([removed, new Promise((resolve) => setTimeout(resolve, 200))]);
      }
      return realOpen(path, ...rest);
    });
    let responses: Response[];
    let copiesTaken: number;
    try {
      const first = await ask(app, "final-copy", destination);
      responses = [first, await second!];
      copiesTaken = archives.mock.calls.length;
    } finally {
      files.open.mockImplementation(realOpen);
      files.rm.mockImplementation(realRm);
      archives.mockRestore();
    }
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(
        indicator.body.snapshot.sha256,
      );
    }
    // The waiting request finds the first's copy in place and takes none of its own.
    expect(copiesTaken).toBe(1);
    expect(await readdir(join(stateDir, "handover", OP))).toEqual(["venue.db"]);
  });

  it("a retake whose rename fails closes the file it opened and leaves no retake", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    const opened: FileHandle[] = [];
    const realOpen = files.open.getMockImplementation()!;
    const realRename = files.rename.getMockImplementation()!;
    files.open.mockImplementation(async (...args: unknown[]) => {
      const handle = (await realOpen(...args)) as FileHandle;
      opened.push(handle);
      return handle;
    });
    files.rename.mockImplementation(async (from: string, to: string) => {
      if (from.includes(".retake-") && to === copyPath()) throw new Error("the disk refused");
      return realRename(from, to);
    });
    try {
      const response = await ask(app, "final-copy", destination);
      expect(response.status).toBe(500);
      expect(await errorCode(response)).toBe("server.internal");
    } finally {
      files.open.mockImplementation(realOpen);
      files.rename.mockImplementation(realRename);
    }
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.map((handle) => handle.fd)).toEqual(opened.map(() => -1));
    expect(await readdir(join(stateDir, "handover", OP))).toEqual([]);
  });

  it("a copy file that went missing is taken again and served when it matches the indicator", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    await rm(copyPath());
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
    expect(sha256(await readFile(copyPath()))).toBe(indicator.body.snapshot.sha256);
  });

  it("a copy folder that went missing is made again and the copy taken again and served", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    await rm(join(stateDir, "handover", OP), { recursive: true });
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(200);
    expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(
      indicator.body.snapshot.sha256,
    );
    expect(await readdir(join(stateDir, "handover", OP))).toEqual(["venue.db"]);
  });

  it("a copy taken again is readable by its owner alone, under a permissive mask", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    // Under this mask a file created with no stated mode comes out 644.
    const mask = process.umask(0o022);
    try {
      const response = await ask(app, "final-copy", destination);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    } finally {
      process.umask(mask);
    }
    expect((await stat(copyPath())).mode & 0o777).toBe(0o600);
  });

  it("a copy folder that went missing after venue.db changed is refused, not served", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(join(stateDir, "handover", OP), { recursive: true });
    suite.db.run(sql`insert into handover_probe (n) values (1)`);
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("handover.final_copy_changed");
  });

  it("a copy file that went missing after venue.db changed is refused, not served", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    suite.db.run(sql`insert into handover_probe (n) values (1)`);
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("handover.final_copy_changed");
  });

  it("a copy file that cannot be opened is reported as a fault, not retaken", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await chmod(copyPath(), 0o000);
    try {
      const response = await ask(app, "final-copy", destination);
      expect(response.status).toBe(500);
      expect(await errorCode(response)).toBe("server.internal");
    } finally {
      await chmod(copyPath(), 0o600);
    }
  });

  it("a copy path that cannot be read is reported as a fault", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    await mkdir(copyPath());
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("server.internal");
  });

  it("a box that has not stepped down for the operation is refused", async () => {
    const { app, destination } = await boxes({ steppedDown: false });
    const response = await ask(app, "indicator", destination);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("handover.not_stepped_down");
  });
});

describe("every file the copy route opens is closed", () => {
  const closers: (() => Promise<unknown> | void)[] = [];
  let faults: MockInstance<typeof console.error>;
  beforeEach(() => {
    faults = vi.spyOn(console, "error");
  });
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
    // What the listener prints when a stream it is writing fails.
    expect(faults).not.toHaveBeenCalled();
    faults.mockRestore();
  });

  /** Keeps each handle `open` gives out, until the end of the test. */
  function keepHandles(): FileHandle[] {
    const opened: FileHandle[] = [];
    const realOpen = files.open.getMockImplementation()!;
    files.open.mockImplementation(async (...args: unknown[]) => {
      const handle = (await realOpen(...args)) as FileHandle;
      opened.push(handle);
      return handle;
    });
    closers.push(() => void files.open.mockImplementation(realOpen));
    return opened;
  }

  const expectAllClosed = (opened: FileHandle[]) =>
    vi.waitFor(() => expect(opened.map((handle) => handle.fd)).toEqual(opened.map(() => -1)));

  /**
   * The app on a real listener, as boot serves it. `beforeWriting` runs once the route has answered
   * and before the listener writes the answer.
   */
  async function listen(app: Hono, beforeWriting: () => Promise<void> = async () => {}) {
    const answering: ServerResponse[] = [];
    const listener = getRequestListener(async (request, env) => {
      answering.push(env.outgoing as ServerResponse);
      const response = await app.fetch(request, env);
      await beforeWriting();
      return response;
    });
    const server = createServer((req, res) => void listener(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    );
    return { port: (server.address() as AddressInfo).port, answering };
  }

  function post(
    port: number,
    signer: { nodeId: string; privateKey: string },
    onAnswer: (response: IncomingMessage) => void = () => {},
  ): ClientRequest {
    const body = JSON.stringify(
      signEnvelope(
        "query",
        { nonce: NONCE, atMs: 1, operationId: OP, purpose: "final-copy" },
        signer,
      ),
    );
    const client = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        agent: false,
        path: `/api/node/handover/${OP}/final-copy`,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      onAnswer,
    );
    client.on("error", () => {});
    client.end(body);
    return client;
  }

  /** Ends the connection and waits until the server has seen it end. */
  async function loseConnection(client: ClientRequest, answer: ServerResponse): Promise<void> {
    const closed = new Promise((resolve) => answer.once("close", resolve));
    client.destroy();
    await closed;
  }

  it("a download read to its end closes the file", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    const opened = keepHandles();
    const { port } = await listen(app);
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      post(port, destination, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      });
    });
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
    expect(opened.length).toBeGreaterThan(0);
    await expectAllClosed(opened);
  });

  it("a connection lost after the route answered and before the answer is written closes the file", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    const opened = keepHandles();
    const served = await listen(app, async () => {
      // Failing case: the route has given up the file too soon, or never holds it.
      expect(opened.at(-1)!.fd).toBeGreaterThan(-1);
      await loseConnection(client, served.answering[0]!);
    });
    const client = post(served.port, destination);
    await vi.waitFor(() => expect(served.answering).toHaveLength(1));
    await vi.waitFor(() => expect(client.destroyed).toBe(true));
    expect(opened.length).toBeGreaterThan(0);
    await expectAllClosed(opened);
  });

  it("a connection lost before the file was opened closes the file", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    const realOpen = files.open.getMockImplementation()!;
    let lost = false;
    files.open.mockImplementation(async (...args: unknown[]) => {
      if (!lost && args[0] === copyPath()) {
        lost = true;
        await loseConnection(client, served.answering[0]!);
      }
      return realOpen(...args);
    });
    closers.push(() => void files.open.mockImplementation(realOpen));
    const opened = keepHandles();
    const served = await listen(app);
    const client = post(served.port, destination);
    await vi.waitFor(() => expect(lost).toBe(true));
    await vi.waitFor(() => expect(opened.length).toBeGreaterThan(0));
    await expectAllClosed(opened);
  });

  it("a connection lost partway through the answer closes the file", async () => {
    const { app, deps, destination } = await boxes();
    // Far more than the sockets between the two ends hold, so the file is still being read.
    suite.db.run(sql`create table handover_bulk (bytes blob not null)`);
    suite.db.run(sql`insert into handover_bulk (bytes) values (randomblob(${32 * 1024 * 1024}))`);
    await captureFinalCopy(deps, OP);
    const opened = keepHandles();
    const served = await listen(app);
    const client = post(served.port, destination, (response) => {
      response.once("data", () => {
        response.pause();
        // Failing case: the whole file was read already, which would prove nothing below.
        expect(opened.at(-1)!.fd).toBeGreaterThan(-1);
        void loseConnection(client, served.answering[0]!);
      });
    });
    await vi.waitFor(() => expect(client.destroyed).toBe(true), { timeout: 30_000 });
    await expectAllClosed(opened);
    // Past the stream's own end, which is what would report a fault.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it("a close that fails after a lost connection is logged, and ends nothing else", async () => {
    const lines: string[] = [];
    const { app, deps, destination } = await boxes({
      log: (_level, event) => lines.push(event),
    });
    await captureFinalCopy(deps, OP);
    const realOpen = files.open.getMockImplementation()!;
    files.open.mockImplementation(async (...args: unknown[]) => {
      const handle = (await realOpen(...args)) as FileHandle;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        await close();
        throw new Error("the disk refused");
      };
      return handle;
    });
    closers.push(() => void files.open.mockImplementation(realOpen));
    const served = await listen(app, () => loseConnection(client, served.answering[0]!));
    const client = post(served.port, destination);
    await vi.waitFor(() => expect(lines).toContain("handover-source.close_failed"));
  });

  it("a retake's own clean-up failing after the file reached its name leaves nothing open", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    await rm(copyPath());
    const opened = keepHandles();
    const realRename = files.rename.getMockImplementation()!;
    const realRm = files.rm.getMockImplementation()!;
    let renamed = false;
    files.rename.mockImplementation(async (from: string, to: string) => {
      await realRename(from, to);
      if (from.includes(".retake-") && to === copyPath()) renamed = true;
    });
    files.rm.mockImplementation(async (...args: unknown[]) => {
      if (renamed) throw new Error("the disk refused");
      return realRm(...args);
    });
    closers.push(() => {
      files.rename.mockImplementation(realRename);
      files.rm.mockImplementation(realRm);
    });
    const response = await ask(app, "final-copy", destination);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(opened.length).toBeGreaterThan(0);
    await expectAllClosed(opened);
    expect(response.status).toBe(200);
    expect(sha256(bytes)).toBe(indicator.body.snapshot.sha256);
  });

  it("a retake that does not match the indicator closes what it opened", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    suite.db.run(sql`insert into handover_probe (n) values (1)`);
    const opened = keepHandles();
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(409);
    expect(await errorCode(response)).toBe("handover.final_copy_changed");
    expect(opened.length).toBeGreaterThan(0);
    await expectAllClosed(opened);
  });

  it("a copy that cannot be read closes what it opened", async () => {
    const { app, deps, destination } = await boxes();
    await captureFinalCopy(deps, OP);
    await rm(copyPath());
    await mkdir(copyPath());
    const opened = keepHandles();
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(500);
    await response.arrayBuffer();
    expect(opened.length).toBeGreaterThan(0);
    await expectAllClosed(opened);
  });

  it("a copy holding other bytes is closed, and the answer comes from the retake", async () => {
    const { app, deps, destination } = await boxes();
    const indicator = await captureFinalCopy(deps, OP);
    await writeFile(copyPath(), "other bytes");
    const opened = keepHandles();
    const response = await ask(app, "final-copy", destination);
    expect(response.status).toBe(200);
    expect(sha256(new Uint8Array(await response.arrayBuffer()))).toBe(
      indicator.body.snapshot.sha256,
    );
    await expectAllClosed(opened);
  });
});
