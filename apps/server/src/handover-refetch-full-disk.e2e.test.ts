// Needs its own filesystem of 64 MiB or less: the folder WAITRON_FULL_DISK_DIR_HANDOVER names, or on
// macOS a disk image the harness makes with hdiutil (`./testing/full-disk.ts`). Without one each case
// is reported SKIPPED; with CI=true or WAITRON_REQUIRE_FULL_DISK=1 it FAILS instead (testing-guide.md,
// "The full-disk start tests run on a small filesystem").
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  nodeSigningPublicKey,
  type KeyRing,
} from "@waitron/credentials";
import { signEnvelope, type HandoverBinding } from "@waitron/handover";
import { endorseKey, signDocumentBody, type MembershipDocumentBody } from "@waitron/membership";
import {
  NODE_MIGRATIONS,
  readHandoverOperation,
  recordHandoverRestrictionTx,
  setNodeMode,
  writeMirrorLink,
} from "@waitron/node-db";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { startHandoverDestinationDuty } from "./handover-destination-duty.js";
import { advanceHandover, beginHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { REQUIRE_FULL_DISK, openSmallDisk, type SmallDisk } from "./testing/full-disk.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x6).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COPY = Buffer.alloc(4 * 1024 * 1024, 2);

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
});

let opened: ReturnType<typeof openSmallDisk> | undefined;
let disk: SmallDisk | undefined;
const closers: (() => Promise<unknown>)[] = [];

beforeAll(() => {
  opened = openSmallDisk("WAITRON_FULL_DISK_DIR_HANDOVER", 32);
  if (opened.ok) disk = opened.disk;
  else if (!REQUIRE_FULL_DISK) console.warn(`handover full-disk tests SKIPPED: ${opened.reason}`);
});
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  disk?.unfill();
});
afterAll(() => disk?.close());

/** The small disk, or the case is skipped (or fails where the disk is required). */
function needDisk(ctx: { skip: (note?: string) => never }): SmallDisk {
  if (disk !== undefined) return disk;
  const reason = opened !== undefined && !opened.ok ? opened.reason : "the disk was not opened";
  if (REQUIRE_FULL_DISK) throw new Error(`full-disk tests cannot run: ${reason}`);
  return ctx.skip(reason);
}

/**
 * Only the state folder is on the small disk. An old box that has stepped down serves `COPY` over
 * real http to the real duty and the real `acceptFinalCopy`; the comparison is a stand-in, as the
 * disk is what these cases are about.
 */
async function rig(small: SmallDisk, name: string) {
  const db = suite.db;
  await seedVenue(db);
  await stampDeployment(db, "preproduction");
  const m1 = await seedNode(db);
  const m2 = await seedNode(db);
  for (const nodeId of [m1, m2]) {
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
  }
  const m1Key = await readNodeIdentityKey(suite.node, RING, m1);
  const m2Key = await readNodeIdentityKey(suite.node, RING, m2);
  await pinMainBoxKey(suite.node, m2, { nodeId: m1, publicKey: nodeSigningPublicKey(m1Key) });

  const binding: HandoverBinding = {
    operationId: OP,
    scenario: "controlled",
    venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
    sourceNodeId: m1,
    destinationNodeId: m2,
    membership: { term: 3, digest: "a".repeat(64) },
  };
  await beginHandover({ node: suite.node, nodeId: m1 }, binding, "source");
  await beginHandover({ node: suite.node, nodeId: m2 }, binding, "destination");
  await advanceHandover({ node: suite.node, nodeId: m1 }, OP, "source_stepped_down", {});
  await withNodeTransaction(suite.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: m1,
      operationId: OP,
      kind: "handed-over",
      successorNodeId: m2,
      membershipTerm: 3,
    }),
  );
  await setNodeMode({ venue: db, node: suite.node }, m2, "mirror");
  await writeMirrorLink(suite.node, m2, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "box.local",
    boxCaPem: "no certificate",
    originNodeId: m1,
  });

  const indicator = signEnvelope(
    "final-state",
    { stand: "in" },
    {
      nodeId: m1,
      privateKey: m1Key,
    },
  );
  const app = new Hono();
  mountPeerStatusApi(app, { db, node: suite.node, ring: RING, nodeId: m1 }, () => {});
  const status = getRequestListener(app.fetch);
  const server = createServer((req, res) => {
    if (req.url!.endsWith("/indicator")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(indicator));
    } else if (req.url!.endsWith("/final-copy")) {
      res.writeHead(200, { "content-length": String(COPY.length) });
      res.end(COPY);
    } else {
      void status(req, res);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      {
        nodeId: m1,
        contactUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        standing: "serving-primary",
      },
      { nodeId: m2, contactUrl: "https://box-1", standing: "serving-secondary" },
    ],
  };
  await writeNodeMembership(db, {
    body,
    signerNodeId: m1,
    signature: signDocumentBody(body, m1Key),
    endorsements: [endorseKey(m2, nodeSigningPublicKey(m2Key), m1, m1Key)],
  });

  const stateDir = join(small.folder(name), "state");
  const accepted = acceptedCopyPath(stateDir, OP);
  await mkdir(dirname(accepted), { recursive: true });
  closers.push(() => rm(dirname(stateDir), { recursive: true, force: true }));

  const fetchFailures: string[] = [];
  const log: Logger = (_level, event, detail) => {
    if (event === "handover-destination.fetch_failed") {
      fetchFailures.push(String((detail as { error?: unknown }).error));
    }
  };
  return {
    accepted,
    fetchFailures,
    row: async () => (await readHandoverOperation(suite.node, m2, OP))!,
    start: async () => {
      const duty = await startHandoverDestinationDuty({
        db,
        node: suite.node,
        ring: RING,
        nodeId: m2,
        stateDir,
        log,
        restart: () => {},
        tickMs: 20,
        compare: async () => ({ ok: true }),
      });
      closers.push(() => duty!.stop());
    },
  };
}

it("a file left by a crash does not keep out the copy when the disk has room for only one", async (ctx) => {
  const small = needDisk(ctx);
  const r = await rig(small, "leftover");
  small.fill(Math.floor(COPY.length * 1.3));
  await writeFile(r.accepted, Buffer.alloc(COPY.length, 1));
  expect(small.free()).toBeLessThan(COPY.length);

  await r.start();
  await vi.waitFor(
    async () => {
      const row = await r.row();
      expect(row.state === "copy_accepted" || row.waitingReason !== null).toBe(true);
    },
    { timeout: 15_000 },
  );
  // Failing case, keeping the file: prepared, on handover.source_unreachable, with ENOSPC logged.
  const row = await r.row();
  expect(row.state, `${row.state} ${row.waitingReason} ${r.fetchFailures.join(" ")}`).toBe(
    "copy_accepted",
  );
  expect((await readFile(r.accepted)).equals(COPY)).toBe(true);
}, 60_000);

it("control: a copy the disk has no room for is refused by the disk", async (ctx) => {
  const small = needDisk(ctx);
  const r = await rig(small, "no-room");
  small.fill(Math.floor(COPY.length / 2));

  await r.start();
  await vi.waitFor(
    async () => expect((await r.row()).waitingReason).toBe("handover.source_unreachable"),
    { timeout: 15_000 },
  );
  expect((await r.row()).state).toBe("prepared");
  expect(r.fetchFailures[0]).toContain("ENOSPC");
}, 60_000);
