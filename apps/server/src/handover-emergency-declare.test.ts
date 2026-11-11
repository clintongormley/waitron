import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openVenueDatabase, type VenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { managementSessions } from "@waitron/identity";
import { signEnvelope, verifyEnvelope } from "@waitron/handover";
import { nodeSigningPublicKey } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverOperation, readOpenHandoverOperation } from "@waitron/node-db";
import { createPasswordThrottle } from "./password-throttle.js";
import { mountHandoverEmergencyApi } from "./handover-emergency-api.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
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
  restriction: undefined as
    undefined | { kind: "superseded"; successorNodeId: string; operationId: string | null },
  calls: 0,
};
const request = {
  operationId: OPERATION,
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
  external.fault = "ECONNREFUSED";
  external.restriction = undefined;
  external.calls = 0;
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await placed?.close();
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

function service() {
  const app = new Hono();
  const log = vi.fn();
  const emergency = mountHandoverEmergencyApi(
    app,
    {
      db: placed.venue,
      node: placed.node,
      nodeId: standby.nodeId,
      ring,
      venueDir: dirs().spareVenue,
      modules: fiscalModules,
      origin: "https://spare.example",
      credentialKeyRing: TOTP_KEY_RING,
      passwordThrottle: createPasswordThrottle(),
      fetch: async (_url, init) => {
        external.calls += 1;
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
    },
    log,
  );
  const post = async (body: unknown = request, https = true) => {
    const socket = new TLSSocket(new Socket());
    sockets.push(socket);
    const response = await app.request(
      "https://spare.example/api/node/handover/emergency/declare",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://spare.example" },
        body: JSON.stringify(body),
      },
      https ? { incoming: { socket } } : {},
    );
    return {
      status: response.status,
      body: (await response.json()) as {
        declaration?: {
          body: {
            binding: unknown;
            lastCopy: { identifier: string; lastChangeAtMs: number | null };
          };
        };
        error?: { code: string };
      },
    };
  };
  return { post, emergency, log };
}

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

it("refuses an uncertain transport failure rather than declaring the source stopped", async () => {
  external.fault = "CERT_HAS_EXPIRED";
  expect((await service().post()).body.error?.code).toBe("handover.source_not_established");
  expect(await readOpenHandoverOperation(placed.node, standby.nodeId)).toBeNull();
});

it("requires a new process to recheck the copy, and refuses changed activity", async () => {
  const first = await service().post();
  const restarted = service();
  const operation = (await readHandoverOperation(placed.node, standby.nodeId, OPERATION))!;
  await expect(restarted.emergency.assertMayActivate(operation)).rejects.toMatchObject({
    code: "handover.copy_mismatch",
  });
  expect(await restarted.post()).toEqual(first);
  await expect(restarted.emergency.assertMayActivate(operation)).resolves.toBeUndefined();
  await seedWorkingOrder(placed.venue, { openedAt: "2026-10-16T12:00:00Z" });
  expect((await service().post()).body.error?.code).toBe("handover.copy_mismatch");
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
    const answer = await service().post();
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
