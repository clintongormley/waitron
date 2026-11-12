import { setBuiltInRoleForTest } from "@waitron/identity/test/person-rows.js";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  openVenueDatabase,
  readNodeMembership,
  writeNodeMembership,
  type VenueDatabase,
} from "@waitron/db";
import { signDocumentBody } from "@waitron/membership";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { managementSessions, persons } from "@waitron/identity";
import { signEnvelope, verifyEnvelope } from "@waitron/handover";
import { nodeSigningPublicKey } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverOperation, readOpenHandoverOperation } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { createPasswordThrottle } from "./password-throttle.js";
import { checkEmergencyCopy } from "./handover-emergency-check.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mintBoxAuthority, startBoxServer } from "./testing/box-authority.js";
import {
  ADMIN_EMAIL,
  PASSWORD,
  OPERATION,
  fiscalModules,
  primary,
  standby,
  ring,
  placedSpareFixture,
} from "./testing/handover-placed-copy.js";

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
  const post = async (body: unknown = request, https = true, step = "declare") => {
    const socket = new TLSSocket(new Socket());
    sockets.push(socket);
    const response = await app.request(
      `${origin}/api/node/handover/emergency/${step}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      },
      https ? { incoming: { socket } } : {},
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: (response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : {}) as {
        sourceNodeId?: string;
        destinationNodeId?: string;
        sourceServersUrl?: string;
        copy?: { identifier: string; lastChangeAtMs: number | null };
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

it("previews the checked spare copy without recording a declaration", async () => {
  const s = service();
  const before = placed.node.all(sql`select * from node_handover_events`);
  const answer = await s.post({ signIn: request.signIn }, true, "preview");
  expect(answer.status).toBe(200);
  expect(answer.cache).toBe("no-store");
  expect(answer.body).toEqual({
    sourceNodeId: primary.nodeId,
    destinationNodeId: standby.nodeId,
    sourceServersUrl: "https://main.example/manage/servers",
    copy: {
      source: "mirror-copy",
      identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      lastChangeAtMs: null,
    },
    operation: null,
  });
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
  expect(placed.node.all(sql`select * from node_handover_events`)).toEqual(before);
});

it.each([
  [{ email: ADMIN_EMAIL, password: "wrong" }, true, "password.invalid"],
  [request.signIn, false, "authorization.not_permitted"],
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
  expect(
    await placed.venue.select({ endedAt: managementSessions.endedAt }).from(managementSessions),
  ).toEqual([{ endedAt: expect.any(String) }]);
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

it("requires HTTPS on the box's own origin", async () => {
  expect((await service().post(request, false)).body.error?.code).toBe(
    "authorization.not_permitted",
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
  expect(preview.body.error?.params?.sourceServersUrl).toBe("https://main.example/manage/servers");
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
