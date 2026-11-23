import { gzipSync } from "node:zlib";
import * as freeSpace from "./free-bytes.js";
import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openVenueDatabase,
  readNodeMembership,
  withNodeTransaction,
  writeNodeMembership,
  type VenueDatabase,
} from "@waitron/db";
import { signDocumentBody } from "@waitron/membership";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { dashboardSessions, persons, webauthnCredentials } from "@waitron/identity";
import { signingPasskey } from "@waitron/identity/test/passkey-signer.js";
import { signEnvelope, verifyEnvelope } from "@waitron/handover";
import { nodeSigningPublicKey, setPairLinkStateTx, writePairLinkTx } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverOperation, readOpenHandoverOperation } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { createPasswordThrottle } from "./password-throttle.js";
import { checkEmergencyCopy } from "./handover-emergency-check.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { buildManifest } from "./backup-manifest.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { placeFirstCopy } from "./spare-copy-placement.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { SWITCH_PROOF_COOKIE, makeSwitchProof } from "./handover-switch-proof.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { confineTo } from "./testing/session-holding.js";
import { mintBoxAuthority, startBoxServer } from "./testing/box-authority.js";
import {
  ADMIN,
  ADMIN_EMAIL,
  PASSWORD,
  OPERATION,
  fiscalModules,
  primary,
  standby,
  ring,
  placedSpareFixture,
} from "./testing/handover-placed-copy.js";

vi.mock("./handover-emergency-check.js", { spy: true });

const migrations = migrationOptionsFor(manifestSets(), null);
const mainBox = useVenueDb({ migrations });
const spareBefore = useVenueDb({ migrations });
let root: string;
let placed: VenueDatabase;
let mainKey: string;
let spareKey: string;
const dirs = () => ({
  mainState: join(root, "main-state"),
  spareState: join(root, "spare-state"),
  spareVenue: join(root, "spare-venue"),
});
const fixture = placedSpareFixture({ mainBox, spareBefore, dirs });
const external = {
  fault: "ECONNREFUSED",
  thrown: undefined as Error | undefined,
  restriction: undefined as
    undefined | { kind: "superseded"; successorNodeId: string; operationId: string | null },
  calls: 0,
};
const request = {
  operationId: OPERATION,
  expectedCopy: { identifier: "", lastChangeAtMs: null as number | null },
  signIn: { email: ADMIN_EMAIL, password: PASSWORD },
  statements: { sourceSwitchedOff: true, noParallelRecovery: true, missingTailAccepted: true },
  reason: "Synthetic lost source",
  locale: "en",
};
const sockets: TLSSocket[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emergency-declare-"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  ({ mainKey, spareKey } = await fixture.setupBoxes());
  mainBox.db.run(sql`vacuum into ${join(dirs().spareVenue, "venue.db")}`);
  spareBefore.node.run(sql`vacuum into ${join(dirs().spareVenue, "node.db")}`);
  placed = await openVenueDatabase(dirs().spareVenue);
  request.expectedCopy = await checkEmergencyCopy({
    venueDir: dirs().spareVenue,
    modules: fiscalModules,
  });
  external.fault = "ECONNREFUSED";
  external.thrown = undefined;
  external.restriction = undefined;
  external.calls = 0;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await placed?.close();
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

function service(
  origin = "https://spare.example",
  overrides: Partial<Parameters<typeof mountHandoverEmergencyApi>[1]> = {},
) {
  const app = new Hono();
  const log = vi.fn();
  const emergency = mountHandoverEmergencyApi(
    app,
    {
      db: placed.venue,
      node: placed.node,
      nodeId: standby.nodeId,
      ring,
      stateDir: dirs().spareState,
      venueDir: dirs().spareVenue,
      modules: fiscalModules,
      origin,
      rpId: "spare.example",
      credentialKeyRing: TOTP_KEY_RING,
      passwordThrottle: createPasswordThrottle(),
      fetch: async (_url, init) => {
        external.calls += 1;
        if (external.thrown !== undefined) throw external.thrown;
        if (external.restriction === undefined)
          throw Object.assign(new Error("synthetic transport fault"), { code: external.fault });
        const query = JSON.parse(init!.body as string) as { body: { nonce: string } };
        return new Response(
          JSON.stringify(
            signEnvelope(
              "status",
              {
                nonce: query.body.nonce,
                heldMembership: null,
                restriction: external.restriction,
                openOperation: null,
                requestedOperation: null,
              },
              { nodeId: primary.nodeId, privateKey: mainKey },
            ),
          ),
        );
      },
      ...overrides,
    },
    log,
  );
  const post = async (
    body: unknown = request,
    https = true,
    step = "declare",
    headers: Record<string, string> = {},
  ) => {
    const socket = new TLSSocket(new Socket());
    sockets.push(socket);
    const response = await app.request(
      `${origin}/api/node/handover/emergency/${step}`,
      {
        method: "POST",
        headers:
          body instanceof FormData
            ? { origin, ...headers }
            : { "content-type": "application/json", origin, ...headers },
        body: body instanceof FormData ? body : JSON.stringify(body),
      },
      https ? { incoming: { socket } } : {},
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      setCookie: response.headers.get("set-cookie"),
      body: (response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : {}) as {
        sourceNodeId?: string;
        destinationNodeId?: string;
        sourceServersUrl?: string;
        copy?: { identifier: string; lastChangeAtMs: number | null };
        joinedAtMs?: number | null;
        options?: { challenge: string };
        operation?: { operationId: string; reason: string; declaredAtMs: number } | null;
        declaration?: {
          body: {
            binding: unknown;
            lastCopy: { identifier: string; lastChangeAtMs: number | null };
          };
        };
        error?: { code: string; params?: { operationId?: string; sourceServersUrl?: string } };
      },
    };
  };
  return { post, emergency, log };
}

const backupKey = "synthetic-selected-backup-key";
const upload = (payload: unknown, artifact: Uint8Array = new Uint8Array([1])) => {
  const body = new FormData();
  body.append("request", JSON.stringify(payload));
  body.append("artifact", new Blob([new Uint8Array(artifact)]), "venue.enc");
  return body;
};

it("uploads a checked archive, waits for restart, then signs its provenance and refuses a changed source id", async () => {
  await seedWorkingOrder(mainBox.db, { openedAt: "2026-10-16T10:30:00Z" });
  const path = join(root, "archive.db");
  await mainBox.db.archiveTo(path);
  const manifest = await buildManifest({
    db: mainBox.db,
    node: mainBox.node,
    modules: fiscalModules,
    environment: "preproduction",
    now: new Date(),
  });
  const artifact = encryptArtifact(
    packArchive([
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: await readFile(path) },
      await nodeDumpEntry(mainBox.node, root),
    ]),
    backupKey,
  );
  const restart = vi.fn();
  const s = service("https://spare.example", {
    backup: {
      readRecoveryKey: async () => backupKey,
      environment: "preproduction",
      migrationsRoot: null,
      restart,
    },
  });
  expect(
    (await s.post(upload({ signIn: request.signIn }, artifact), true, "backup")).body,
  ).toMatchObject({ restarting: true });
  await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  expect((await s.post({ signIn: request.signIn }, true, "preview")).body.error?.code).toBe(
    "handover.copy_mismatch",
  );
  expect((await s.post()).body.error?.code).toBe("handover.copy_mismatch");
  await placed.close();
  expect(
    await placeFirstCopy({
      stateDir: dirs().spareState,
      venueDir: dirs().spareVenue,
      nodeId: standby.nodeId,
      log: () => {},
    }),
  ).toBe(true);
  placed = await openVenueDatabase(dirs().spareVenue);
  expect(await readNodeIdentityKey(placed.node, ring, standby.nodeId)).toBe(spareKey);
  const resumed = service();
  const shown = await resumed.post({ signIn: request.signIn }, true, "preview");
  expect(shown.body.copy).toMatchObject({ source: "selected-backup" });
  expect(shown.body.copy?.lastChangeAtMs).toBe(Date.parse("2026-10-16T10:30:00Z"));
  const declared = await resumed.post({ ...request, expectedCopy: shown.body.copy });
  expect(declared.status).toBe(200);
  expect(declared.body.declaration?.body.lastCopy).toEqual(shown.body.copy);
  expect(
    verifyEnvelope(declared.body.declaration, "declaration", () => nodeSigningPublicKey(spareKey))
      .valid,
  ).toBe(true);
  const other = { ...shown.body.copy, sourceId: "b".repeat(64) };
  expect((await resumed.post({ ...request, expectedCopy: other })).body.error?.code).toBe(
    "handover.request_invalid",
  );
});

it.each(["invalid", "unsupported"])("answers an %s backup manifest with 422", async (reason) => {
  const s = service("https://spare.example", {
    backup: {
      readRecoveryKey: async () => backupKey,
      environment: "preproduction",
      migrationsRoot: null,
      restart: vi.fn(),
    },
  });
  const bytes = encryptArtifact(
    packArchive([
      {
        name: "manifest.json",
        bytes: Buffer.from(
          reason === "invalid" ? "invalid JSON" : JSON.stringify({ manifestVersion: 2 }),
        ),
      },
    ]),
    backupKey,
  );
  const answer = await s.post(upload({ signIn: request.signIn }, bytes), true, "backup");
  expect(answer.status).toBe(422);
  expect(answer.body.error).toEqual({ code: "restore.manifest_invalid", params: { reason } });
});

it("answers a too-short typed backup key with 400, naming the key the request sent", async () => {
  const restart = vi.fn();
  const s = service("https://spare.example", {
    backup: {
      readRecoveryKey: async () => backupKey,
      environment: "preproduction",
      migrationsRoot: null,
      restart,
    },
  });
  const answer = await s.post(
    upload({ signIn: request.signIn, recoveryKey: "short" }),
    true,
    "backup",
  );
  expect(answer.status).toBe(400);
  expect(answer.body.error).toEqual({
    code: "backup.new_recovery_key_too_short",
    params: { min: 12 },
  });
  expect(restart).not.toHaveBeenCalled();
});

it("answers a compressed-backup capacity refusal with 507", async () => {
  const space = vi.spyOn(freeSpace, "freeBytes").mockResolvedValue(0);
  try {
    const s = service("https://spare.example", {
      backup: {
        readRecoveryKey: async () => backupKey,
        environment: "preproduction",
        migrationsRoot: null,
        restart: vi.fn(),
      },
    });
    const bytes = encryptArtifact(gzipSync(packArchive([])), backupKey);
    const answer = await s.post(upload({ signIn: request.signIn }, bytes), true, "backup");
    expect(answer.status).toBe(507);
    expect(answer.body.error?.code).toBe("restore.archive_resource_limit");
  } finally {
    space.mockRestore();
  }
});
it.each(["https", "password", "operation", "source"])(
  "refuses a backup at the %s boundary without staging",
  async (boundary) => {
    const s = service();
    if (boundary === "operation")
      await beginHandover(
        { node: placed.node, nodeId: standby.nodeId },
        {
          operationId: OPERATION,
          scenario: "controlled",
          venue: { country: "ES", taxId: "89890001K", environment: "preproduction" },
          sourceNodeId: primary.nodeId,
          destinationNodeId: standby.nodeId,
          membership: { term: 1, digest: "a".repeat(64) },
        },
        "destination",
      );
    if (boundary === "source") external.fault = "CERT_HAS_EXPIRED";
    const answer = await s.post(
      upload({
        signIn: boundary === "password" ? { ...request.signIn, password: "wrong" } : request.signIn,
      }),
      boundary !== "https",
      "backup",
    );
    expect(answer.body.error?.code).toBe(
      {
        https: "node.operation_page_required",
        password: "password.invalid",
        operation: "handover.controlled_unresolved",
        source: "handover.source_not_established",
      }[boundary],
    );
    await expect(
      readFile(join(dirs().spareState, "pair-copy", "ready.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("previews the checked spare copy without recording a declaration", async () => {
  const s = service();
  const before = placed.node.all(sql`select * from node_handover_events`);
  const answer = await s.post({ signIn: request.signIn }, true, "preview");
  expect(answer.status).toBe(200);
  expect(answer.cache).toBe("no-store");
  expect(answer.body).toEqual({
    sourceNodeId: primary.nodeId,
    destinationNodeId: standby.nodeId,
    sourceServersUrl: "https://main.example/servers",
    copy: {
      source: "mirror-copy",
      identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      lastChangeAtMs: null,
    },
    joinedAtMs: null,
    operation: null,
  });
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
  expect(placed.node.all(sql`select * from node_handover_events`)).toEqual(before);
});

it("previews when this spare's held copy arrived, from its pair link's copied state", async () => {
  const pairLink = {
    role: "serves" as const,
    peerNodeId: primary.nodeId,
    peerPublicKey: "main-public-key",
    storeUrl: "https://main.example:7443",
    venueId: "venue-1",
    accessKeyId: "waitron0123456789abcdef",
    secretAccessKey: "ab".repeat(32),
  };
  await withNodeTransaction(placed.node, (tx) =>
    writePairLinkTx(tx, ring, standby.nodeId, { ...pairLink, state: "awaiting_copy" }),
  );
  expect((await service().post({ signIn: request.signIn }, true, "preview")).body.joinedAtMs).toBe(
    null,
  );
  vi.setSystemTime(new Date("2026-10-16T12:05:00Z"));
  await withNodeTransaction(placed.node, (tx) => setPairLinkStateTx(tx, standby.nodeId, "copied"));
  vi.setSystemTime(new Date("2026-10-30T09:00:00Z"));
  expect((await service().post({ signIn: request.signIn }, true, "preview")).body.joinedAtMs).toBe(
    Date.parse("2026-10-16T12:05:00Z"),
  );
});

it("previews no joining date for a box whose pair link is the main box's side", async () => {
  await withNodeTransaction(placed.node, (tx) =>
    writePairLinkTx(tx, ring, standby.nodeId, {
      role: "streams",
      state: "streaming",
      peerNodeId: primary.nodeId,
      peerPublicKey: "spare-public-key",
      storeUrl: "https://spare.example:7443",
      venueId: "venue-1",
      accessKeyId: "waitron0123456789abcdef",
      secretAccessKey: "ab".repeat(32),
    }),
  );
  const answer = await service().post({ signIn: request.signIn }, true, "preview");
  expect(answer.status).toBe(200);
  expect(answer.body.joinedAtMs).toBeNull();
});

it.each([
  [{ email: ADMIN_EMAIL, password: "wrong" }, true, "password.invalid"],
  [request.signIn, false, "node.operation_page_required"],
])("protects preview before exposing the copy or saved reason %#", async (signIn, https, code) => {
  const s = service();
  expect((await s.post()).status).toBe(200);
  const answer = await s.post({ signIn }, https, "preview");
  expect(answer.body.error?.code).toBe(code);
  expect(answer.body.operation).toBeUndefined();
  expect(answer.body.copy).toBeUndefined();
});

it("previews a saved declaration after restart and refuses changed activity", async () => {
  expect((await service().post()).status).toBe(200);
  const before = placed.node.all(sql`select * from node_handover_events`);
  const restarted = service();
  const answer = await restarted.post({ signIn: request.signIn }, true, "preview");
  expect(answer.status).toBe(200);
  expect(answer.body.operation).toEqual({
    operationId: OPERATION,
    reason: request.reason,
    declaredAtMs: Date.now(),
  });
  expect(placed.node.all(sql`select * from node_handover_events`)).toEqual(before);
  await seedWorkingOrder(placed.venue, { openedAt: "2026-10-16T12:00:00Z" });
  expect((await restarted.post({ signIn: request.signIn }, true, "preview")).body.error?.code).toBe(
    "handover.copy_mismatch",
  );
});

it("records a signed declaration before answering, then replays without asking the source", async () => {
  const s = service();
  const first = await s.post();
  expect(first.status).toBe(200);
  expect(
    verifyEnvelope(first.body.declaration, "declaration", () => nodeSigningPublicKey(spareKey))
      .valid,
  ).toBe(true);
  expect((await readHandoverOperation(placed.node, standby.nodeId, OPERATION))?.state).toBe(
    "emergency_declared",
  );
  expect(await placed.venue.select().from(dashboardSessions)).toEqual([]);
  const history = await placed.venue.execute<{ kind: string; data: string }>(
    sql`select kind, data from activity_log order by rowid desc limit 2`,
  );
  expect(
    history.rows.reverse().map((row) => ({ kind: row.kind, data: JSON.parse(row.data) })),
  ).toEqual([
    { kind: "dashboard.signed_in", data: { method: "password" } },
    { kind: "dashboard.signed_out", data: { reason: "operation_finished" } },
  ]);
  expect(await s.post()).toEqual(first);
  expect(external.calls).toBe(1);
  expect(JSON.stringify(s.log.mock.calls)).not.toContain(request.reason);
  const changed = await s.post({ ...request, reason: "Different reason" });
  expect(changed.body.error?.code).toBe("handover.request_invalid");
});

it.each([
  [{ signIn: { email: ADMIN_EMAIL, password: "wrong" } }, "password.invalid"],
  [
    { statements: { ...request.statements, missingTailAccepted: false } },
    "handover.request_invalid",
  ],
  [{ reason: "" }, "handover.request_invalid"],
  [{ reason: "x".repeat(501) }, "handover.request_invalid"],
  [{ statements: { ...request.statements, unrecognised: true } }, "handover.request_invalid"],
  [{ provider: "cloud" }, "handover.request_invalid"],
] as const)("refuses invalid input %j before any operation is recorded", async (change, code) => {
  expect((await service().post({ ...request, ...change })).body.error?.code).toBe(code);
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it.each(["backup", "passkey-challenge"])(
  "refuses insecure %s before reading input",
  async (step) => {
    const answer = await service().post({}, false, step);
    expect(answer.status).toBe(403);
    expect(answer.body).toEqual({ error: { code: "node.operation_page_required", params: {} } });
  },
);

it("requires HTTPS on the box's own origin", async () => {
  expect((await service().post(request, false)).body.error?.code).toBe(
    "node.operation_page_required",
  );
});

it("requires promotion permission in the copy", async () => {
  const [person] = await placed.venue
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.email, ADMIN_EMAIL));
  await setBuiltInRoleForTest(placed.venue, person!.id, "staff");
  expect((await service().post()).body.error?.code).toBe("authorization.not_permitted");
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it("refuses a password holding only invoice.inspect in the copy as lacking node.manage", async () => {
  const [person] = await placed.venue
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.email, ADMIN_EMAIL));
  await confineTo(placed.venue, person!.id, ["invoice.inspect"]);
  expect((await service().post()).body.error).toEqual({
    code: "authorization.not_permitted",
    params: { permission: "node.manage" },
  });
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it("two declarations at once record one signed answer", async () => {
  const s = service();
  const [left, right] = await Promise.all([s.post(), s.post()]);
  expect(left.status).toBe(200);
  expect(right).toEqual(left);
  expect(
    placed.node.all<{ n: number }>(
      sql`select count(*) as n from node_handover_events where kind = 'emergency_declared'`,
    ),
  ).toEqual([{ n: 1 }]);
  expect(external.calls).toBe(1);
});

it("a failed declaration record rolls back the controlled replacement", async () => {
  const oldId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await beginHandover(
    { node: placed.node, nodeId: standby.nodeId },
    {
      operationId: oldId,
      scenario: "controlled",
      venue: { country: "ES", taxId: "89890001K", environment: "preproduction" },
      sourceNodeId: primary.nodeId,
      destinationNodeId: standby.nodeId,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    "destination",
  );
  placed.node.run(
    sql`create trigger refuse_emergency before insert on node_handover_events when new.kind = 'emergency_declared' begin select raise(abort, 'synthetic record failure'); end`,
  );
  try {
    expect((await service().post()).status).toBe(500);
    expect((await readHandoverOperation(placed.node, standby.nodeId, oldId))?.state).toBe(
      "prepared",
    );
    expect(await readHandoverOperation(placed.node, standby.nodeId, OPERATION)).toBeNull();
  } finally {
    placed.node.run(sql`drop trigger refuse_emergency`);
  }
});

it("refuses an uncertain transport failure rather than declaring the source stopped", async () => {
  external.fault = "CERT_HAS_EXPIRED";
  expect((await service().post()).body.error?.code).toBe("handover.source_not_established");
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it("refuses declaration when the old main box's name finds no box on the network", async () => {
  external.thrown = new AppError("mirror.peer_unresolved", {});
  expect((await service().post()).body.error?.code).toBe("handover.source_not_established");
  expect(external.calls).toBe(1);
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it("refuses declaration even when the answering source is restricted to this spare", async () => {
  external.restriction = { kind: "superseded", successorNodeId: standby.nodeId, operationId: null };
  expect((await service().post()).body.error?.code).toBe("handover.source_still_answering");
  const preview = await service().post({ signIn: request.signIn }, true, "preview");
  expect(preview.body.error?.params?.sourceServersUrl).toBe("https://main.example/servers");
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it.each(["https://spare.example", "https://dashboard.example"])(
  "does not ask its own address %s",
  async (sourceUrl) => {
    const held = (await readNodeMembership(placed.venue))!;
    const body = {
      ...held.body,
      nodes: held.body.nodes.map((node) =>
        node.nodeId === primary.nodeId ? { ...node, contactUrl: sourceUrl } : node,
      ),
    };
    await writeNodeMembership(placed.venue, {
      ...held,
      body,
      signature: signDocumentBody(body, mainKey),
    });
    expect((await service("https://dashboard.example").post()).body.error?.code).toBe(
      "handover.source_not_established",
    );
    expect(external.calls).toBe(0);
    expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
  },
);

it.each([
  ["the venue authority it holds signed", true, "handover.source_still_answering"],
  ["another authority signed", false, "handover.source_not_established"],
])(
  "asks its source only under the venue authority it holds: a source whose certificate %s",
  async (_label, venueSigned, code) => {
    const [venue, other] = await Promise.all([mintBoxAuthority(), mintBoxAuthority()]);
    await mkdir(join(dirs().spareState, "tls"), { recursive: true });
    await writeFile(join(dirs().spareState, "tls", "ca.crt"), venue.caPem);
    const source = await startBoxServer(venueSigned ? venue : other, (req) => {
      const query = JSON.parse(req.body) as { body: { nonce: string } };
      const status = {
        nonce: query.body.nonce,
        heldMembership: null,
        restriction: null,
        openOperation: null,
        requestedOperation: null,
      };
      return {
        status: 200,
        body: JSON.stringify(
          signEnvelope("status", status, { nodeId: primary.nodeId, privateKey: mainKey }),
        ),
      };
    });
    try {
      const held = (await readNodeMembership(placed.venue))!;
      const body = {
        ...held.body,
        nodes: held.body.nodes.map((node) =>
          node.nodeId === primary.nodeId ? { ...node, contactUrl: source.url } : node,
        ),
      };
      await writeNodeMembership(placed.venue, {
        ...held,
        body,
        signature: signDocumentBody(body, mainKey),
      });
      const answer = await service(undefined, { fetch: undefined }).post();
      expect(answer.body.error?.code).toBe(code);
      expect(source.requests).toHaveLength(venueSigned ? 1 : 0);
      expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
    } finally {
      await source.close();
    }
  },
);

it("replays its saved binding after the held chart changes", async () => {
  const s = service();
  const first = await s.post();
  const held = (await readNodeMembership(placed.venue))!;
  const body = { ...held.body, term: 2 };
  await writeNodeMembership(placed.venue, {
    ...held,
    body,
    signature: signDocumentBody(body, mainKey),
  });
  expect(await s.post()).toEqual(first);
  expect(external.calls).toBe(1);
});

it("activation rechecks a saved declaration after restart, and refuses changed activity", async () => {
  const first = await service().post();
  const restarted = service();
  const operation = (await readHandoverOperation(placed.node, standby.nodeId, OPERATION))!;
  await expect(restarted.emergency.assertMayActivate(operation)).resolves.toBeUndefined();
  expect(await restarted.post()).toEqual(first);
  await expect(restarted.emergency.assertMayActivate(operation)).resolves.toBeUndefined();
  await seedWorkingOrder(placed.venue, { openedAt: "2026-10-16T12:00:00Z" });
  expect((await service().post()).body.error?.code).toBe("handover.copy_mismatch");
  await expect(service().emergency.assertMayActivate(operation)).rejects.toMatchObject({
    code: "handover.copy_mismatch",
  });
});

it.each([null, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"])(
  "activation accepts the verified source restriction naming this spare with operation %s",
  async (operationId) => {
    const s = service();
    expect((await s.post()).status).toBe(200);
    external.restriction = { kind: "superseded", successorNodeId: standby.nodeId, operationId };
    const operation = (await readHandoverOperation(placed.node, standby.nodeId, OPERATION))!;
    await expect(s.emergency.assertMayActivate(operation)).resolves.toBeUndefined();
    external.restriction.successorNodeId = "another-box";
    await expect(s.emergency.assertMayActivate(operation)).rejects.toMatchObject({
      code: "handover.source_still_answering",
    });
  },
);

it.each(["prepared", "copy_accepted"] as const)(
  "replaces a controlled destination only at prepared, not %s",
  async (state) => {
    const oldId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const binding = {
      operationId: oldId,
      scenario: "controlled" as const,
      venue: { country: "ES", taxId: "89890001K", environment: "preproduction" as const },
      sourceNodeId: primary.nodeId,
      destinationNodeId: standby.nodeId,
      membership: { term: 1, digest: "a".repeat(64) },
    };
    await beginHandover({ node: placed.node, nodeId: standby.nodeId }, binding, "destination");
    if (state === "copy_accepted")
      await advanceHandover({ node: placed.node, nodeId: standby.nodeId }, oldId, state, {});
    const s = service();
    const preview = await s.post({ signIn: request.signIn }, true, "preview");
    if (state === "prepared") {
      expect(preview.status).toBe(200);
      expect(preview.body.operation).toEqual({
        operationId: oldId,
        reason: null,
        declaredAtMs: null,
      });
    } else {
      expect(preview.body.error).toMatchObject({
        code: "handover.controlled_unresolved",
        params: { operationId: oldId },
      });
    }
    const answer = await s.post();
    if (state === "prepared") {
      expect(answer.status).toBe(200);
      expect((await readHandoverOperation(placed.node, standby.nodeId, oldId))?.state).toBe(
        "replaced",
      );
    } else {
      expect(answer.body.error?.code).toBe("handover.controlled_unresolved");
      expect(await readHandoverOperation(placed.node, standby.nodeId, OPERATION)).toBeNull();
    }
  },
);

it("refuses a prepared controlled operation from another source before offering a declaration", async () => {
  const operationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await beginHandover(
    { node: placed.node, nodeId: standby.nodeId },
    {
      operationId,
      scenario: "controlled",
      venue: { country: "ES", taxId: "89890001K", environment: "preproduction" },
      sourceNodeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      destinationNodeId: standby.nodeId,
      membership: { term: 1, digest: "a".repeat(64) },
    },
    "destination",
  );
  const s = service();
  const expected = { code: "handover.controlled_unresolved", params: { operationId } };
  expect((await s.post({ signIn: request.signIn }, true, "preview")).body.error).toMatchObject(
    expected,
  );
  expect((await s.post()).body.error).toMatchObject(expected);
});

it("refuses a copy changed after the preview the person saw", async () => {
  const s = service();
  const shown = await s.post({ signIn: request.signIn }, true, "preview");
  expect(shown.status).toBe(200);
  await seedWorkingOrder(placed.venue, { openedAt: "2026-10-16T12:00:00Z" });
  const answer = await s.post({ ...request, expectedCopy: shown.body.copy });
  expect(answer.body.error?.code).toBe("handover.copy_mismatch");
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it.each([
  undefined,
  { identifier: "not-a-hash", lastChangeAtMs: null },
  { identifier: "a".repeat(64), lastChangeAtMs: "later" },
])("refuses a malformed expected copy %#", async (expectedCopy) => {
  expect((await service().post({ ...request, expectedCopy })).body.error?.code).toBe(
    "handover.request_invalid",
  );
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it("refuses a different copy identifier even with the same activity date", async () => {
  const identifier =
    request.expectedCopy.identifier === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);
  expect(
    (await service().post({ ...request, expectedCopy: { ...request.expectedCopy, identifier } }))
      .body.error?.code,
  ).toBe("handover.copy_mismatch");
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

describe("the switch's passkey and proof", () => {
  const proofCookie = async (proof?: string) => ({
    cookie: `${SWITCH_PROOF_COOKIE}=${
      proof ??
      (await makeSwitchProof(
        { db: placed.venue, node: placed.node, ring, nodeId: standby.nodeId },
        ADMIN,
      ))
    }`,
  });
  const bodies = {
    preview: () => ({}),
    declare: () => ({ ...request, signIn: undefined }),
    backup: () => upload({}),
  };
  async function enrolledPasskey() {
    const passkey = signingPasskey("spare.example");
    await placed.venue.insert(webauthnCredentials).values({
      personId: ADMIN,
      credentialId: passkey.credentialId,
      publicKey: passkey.publicKey,
      counter: 0,
    });
    return passkey;
  }
  const challenge = async (s: ReturnType<typeof service>) =>
    (await s.post({}, true, "passkey-challenge")).body.options!.challenge;

  it.each(["preview", "declare", "backup"] as const)(
    "%s accepts this box's proof in place of a password, and refuses one that fails its check",
    async (step) => {
      const s = service();
      const accepted = await s.post(bodies[step](), true, step, await proofCookie());
      // A backup step with no backup configured gets past the sign-in to this refusal.
      expect(accepted.body.error?.code ?? accepted.status).toBe(
        step === "backup" ? "handover.backup_key_missing" : 200,
      );
      const refused = await s.post(bodies[step](), true, step, await proofCookie("not-a-proof"));
      expect(refused.body.error?.code).toBe("password.invalid");
    },
  );

  it("a step passed with a passkey sets the proof cookie, which the body never carries", async () => {
    const passkey = await enrolledPasskey();
    const s = service();
    const assertion = passkey.assert(await challenge(s), "https://spare.example");
    const answer = await s.post({ signIn: { passkey: assertion } }, true, "preview");
    expect(answer.status).toBe(200);
    const [pair, ...attributes] = answer.setCookie!.split("; ");
    expect(pair!.startsWith(`${SWITCH_PROOF_COOKIE}=`)).toBe(true);
    expect(attributes.sort()).toEqual(
      ["HttpOnly", "Max-Age=900", "Path=/api/node/handover", "SameSite=Strict", "Secure"].sort(),
    );
    expect(JSON.stringify(answer.body)).not.toContain(pair!.slice(SWITCH_PROOF_COOKIE.length + 1));
    expect((await s.post({}, true, "preview", { cookie: pair! })).status).toBe(200);
  });

  it("a step passed on the proof cookie renews it for another 15 minutes from then", async () => {
    const s = service();
    const first = await proofCookie();
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const renewed = await s.post({}, true, "preview", first);
    expect(renewed.status).toBe(200);
    const [pair] = renewed.setCookie!.split("; ");
    expect(pair!.startsWith(`${SWITCH_PROOF_COOKIE}=`)).toBe(true);
    expect(pair).not.toBe(first.cookie);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect((await s.post({}, true, "preview", first)).body.error?.code).toBe("password.invalid");
    expect((await s.post({}, true, "preview", { cookie: pair! })).status).toBe(200);
  });

  it("refuses a passkey whose person does not hold node.manage", async () => {
    const passkey = await enrolledPasskey();
    await setBuiltInRoleForTest(placed.venue, ADMIN, "staff");
    const s = service();
    const assertion = passkey.assert(await challenge(s), "https://spare.example");
    const answer = await s.post({ signIn: { passkey: assertion } }, true, "preview");
    expect(answer.body.error?.code).toBe("authorization.not_permitted");
    expect(answer.setCookie).toBeNull();
  });

  it("a passkey answer refused for lacking node.manage is used up", async () => {
    const passkey = await enrolledPasskey();
    await setBuiltInRoleForTest(placed.venue, ADMIN, "staff");
    const s = service();
    const signIn = { passkey: passkey.assert(await challenge(s), "https://spare.example") };
    expect((await s.post({ signIn }, true, "preview")).body.error?.code).toBe(
      "authorization.not_permitted",
    );
    expect((await s.post({ signIn }, true, "preview")).body.error?.code).toBe(
      "passkey.challenge_expired",
    );
  });

  it.each([
    ["a passkey that is not an object", { passkey: "answer" }],
    ["an empty sign-in, even beside a proof", {}],
  ])("refuses %s as a wrong password", async (_name, signIn) => {
    const s = service();
    const answer = await s.post({ signIn }, true, "preview", await proofCookie());
    expect(answer.body.error?.code).toBe("password.invalid");
  });

  it("a passkey challenge is used once, and refused once older than two minutes", async () => {
    const passkey = await enrolledPasskey();
    const s = service();
    const once = {
      signIn: { passkey: passkey.assert(await challenge(s), "https://spare.example") },
    };
    expect((await s.post(once, true, "preview")).status).toBe(200);
    expect((await s.post(once, true, "preview")).body.error?.code).toBe(
      "passkey.challenge_expired",
    );
    const late = {
      signIn: { passkey: passkey.assert(await challenge(s), "https://spare.example") },
    };
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect((await s.post(late, true, "preview")).body.error?.code).toBe(
      "passkey.challenge_expired",
    );
  });
});

it("forwards each preview, declaration and activation request's stop to its copy check", async () => {
  const s = service();
  vi.mocked(checkEmergencyCopy).mockClear();
  expect((await s.post({ signIn: request.signIn }, true, "preview")).status).toBe(200);
  expect(vi.mocked(checkEmergencyCopy).mock.lastCall?.[0].signal).toBeInstanceOf(AbortSignal);
  vi.mocked(checkEmergencyCopy).mockClear();
  expect((await s.post()).status).toBe(200);
  expect(vi.mocked(checkEmergencyCopy).mock.lastCall?.[0].signal).toBeInstanceOf(AbortSignal);
  const operation = (await readHandoverOperation(placed.node, standby.nodeId, OPERATION))!;
  const controller = new AbortController();
  vi.mocked(checkEmergencyCopy).mockClear();
  await service().emergency.assertMayActivate(operation, controller.signal);
  expect(vi.mocked(checkEmergencyCopy).mock.lastCall?.[0].signal).toBe(controller.signal);
});
