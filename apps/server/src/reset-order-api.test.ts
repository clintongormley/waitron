import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handoverActivations,
  invoiceSeries,
  liveBackupQuery,
  readNodeMembership,
  stampDeployment,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { loadKeyRing, nodeSigningPublicKey } from "@waitron/credentials";
import {
  endorseKey,
  MAX_REVOKED,
  signDocumentBody,
  type CanonicalValue,
  type NodeStanding,
} from "@waitron/membership";
import { verifyEnvelope } from "@waitron/handover";
import { beginHandoverOperationTx, nodeHandoverEvents } from "@waitron/node-db";
import type { WaitronModule } from "@waitron/module";
import { VERIFACTU_HANDOVER } from "@waitron/fiscal-verifactu";
import type { BackupStatus } from "./backup-status.js";
import type { Logger } from "./logger.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { signAsThisBox } from "./handover-signing.js";
import { recordReturnBatchTx } from "./return-completion.js";
import { returnDigest, returnVenue } from "./return-records.js";
import { orderReset } from "./reset-order.js";
import { listServers } from "./membership-removal.js";
import { mountResetOrderApi } from "./reset-order-api.js";
import { createOldBoxHoldings, type OldBoxHoldings } from "./old-box-holdings.js";
import { insertFiscalRecord, seedFiscalParents } from "./testing/fiscal-fixtures.js";
import { earlierBoxChain, lackingChainOf } from "@waitron/fiscal-verifactu/src/testing/holdings.js";

const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

/** The fiscal module's real seats, under a short name. */
const modules: WaitronModule[] = [
  { name: "fiscal", version: "1.0.0", tier: "mandatory", handover: VERIFACTU_HANDOVER },
];

const MISSING_CHAIN = earlierBoxChain();
const LACKING_CHAIN = lackingChainOf(MISSING_CHAIN, "record_missing");

let main: string;
let oldBox: string;
let personId: string;
let lines: { level: string; event: string; fields: unknown }[];
let oldBoxHoldings: OldBoxHoldings;

async function holdChart(
  oldStanding: NodeStanding,
  term = 2,
  { other, revoked, revokedIds }: { other?: string; revoked?: boolean; revokedIds?: string[] } = {},
) {
  const mainKey = await readNodeIdentityKey(suite.node, ring, main);
  const listed = other === undefined ? [oldBox] : [oldBox, other];
  const body = {
    term,
    nodes: [
      { nodeId: main, contactUrl: "https://main.test", standing: "serving-primary" as const },
      ...listed.map((nodeId) => ({
        nodeId,
        contactUrl: `https://${nodeId}.test`,
        standing: oldStanding,
      })),
    ],
    ...(revoked === true ? { revoked: [oldBox] } : {}),
    ...(revokedIds === undefined ? {} : { revoked: revokedIds }),
  };
  const oldKey = await readNodeIdentityKey(suite.node, ring, oldBox);
  const endorsements = [endorseKey(main, nodeSigningPublicKey(mainKey), oldBox, oldKey)];
  // The main box vouches for another box's key, as a spare's join does.
  if (other !== undefined) {
    const otherKey = await readNodeIdentityKey(suite.node, ring, other);
    endorsements.push(endorseKey(other, nodeSigningPublicKey(otherKey), main, mainKey));
  }
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: main,
    signature: signDocumentBody(body, mainKey),
    endorsements,
  });
}

beforeEach(async () => {
  lines = [];
  oldBoxHoldings = createOldBoxHoldings();
  await seedVenue(suite.db, { name: "Reset venue" });
  await stampDeployment(suite.db, "preproduction");
  main = await seedNode(suite.db);
  oldBox = await seedNode(suite.db);
  for (const nodeId of [main, oldBox])
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId);
  const oldKey = await readNodeIdentityKey(suite.node, ring, oldBox);
  await pinMainBoxKey(suite.node, main, {
    nodeId: oldBox,
    publicKey: nodeSigningPublicKey(oldKey),
  });
  await holdChart("sell-only");
  const [person] = await withTransaction(suite.db, (tx) =>
    seedPersons(tx, { displayName: "Owner", role: "admin" }),
  );
  personId = person!.id;
});

function app(seats: WaitronModule[] = modules) {
  const log: Logger = (level, event, fields) => lines.push({ level, event, fields });
  const hono = new Hono();
  mountResetOrderApi(
    hono,
    {
      db: suite.db,
      node: suite.node,
      ring,
      nodeId: main,
      modules: seats,
      reloadStream: async () => {},
      oldBoxHoldings,
    },
    log,
  );
  return hono;
}

/** A completed return from the old box to this one, against a closed takeover. */
async function completedReturn(
  scenario: "controlled" | "emergency" = "emergency",
): Promise<string> {
  const operationId = randomUUID();
  const digests = ["first", "second"].map((payload) => returnDigest({ module: "m", payload }));
  const inventory = returnDigest(digests);
  await withTransaction(suite.db, async (tx) => {
    await tx.insert(handoverActivations).values({
      operationId,
      sourceNodeId: oldBox,
      destinationNodeId: main,
      scenario,
      evidence: {
        purpose: "waitron.handover.declaration.v1",
        body: {},
        signerNodeId: main,
        signature: "signature",
      },
      personId,
      activatedAt: "2026-11-12T10:00:00.000Z",
    });
    for (const [index, digest] of digests.entries())
      await recordReturnBatchTx(tx, { operationId, inventory, index, count: 2, digest });
  });
  return operationId;
}

async function ordered() {
  await completedReturn();
  return orderReset(
    { db: suite.db, node: suite.node, nodeId: main },
    { targetNodeId: oldBox, personId, acceptLoss: false },
  );
}

async function queryBody(overrides: Record<string, CanonicalValue> = {}) {
  return {
    venue: (await returnVenue(suite)) as CanonicalValue,
    sourceNodeId: oldBox,
    destinationNodeId: main,
    nonce: "nonce-1",
    holdings: { fiscal: [] },
    ...overrides,
  };
}

async function ask(
  body: Record<string, CanonicalValue>,
  signer: string = oldBox,
  hono: Hono = app(),
): Promise<Response> {
  const envelope = await signAsThisBox(
    { node: suite.node, ring, nodeId: signer },
    "reset-query",
    body,
  );
  return hono.request("/api/node/reset-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
}

async function answerOf(res: Response) {
  const raw = (await res.json()) as unknown;
  const mainKey = nodeSigningPublicKey(await readNodeIdentityKey(suite.node, ring, main));
  const verified = verifyEnvelope<Record<string, CanonicalValue>>(raw, "reset-order", (id) =>
    id === main ? mainKey : undefined,
  );
  expect(verified.valid).toBe(true);
  return verified.valid ? verified.body : null;
}

async function refusalOf(res: Response) {
  expect(res.status).toBe(409);
  return ((await res.json()) as { error: { code: string; params: unknown } }).error;
}

async function activities(kind: string) {
  const { rows } = await suite.db.execute<{ subject_id: string; person_id: string; data: string }>(
    sql`select subject_id, person_id, data from activity_log where kind = ${kind} order by at, rowid`,
  );
  return rows.map((r) => ({ ...r, data: JSON.parse(r.data) as unknown }));
}

async function incidents() {
  const { rows } = await suite.db.execute<{ code: string; params: string }>(
    sql`select code, params from incidents where code = 'chain.set_aside_on_reset'`,
  );
  return rows.map((r) => ({ code: r.code, params: JSON.parse(r.params) as unknown }));
}

function events(kind: string) {
  return suite.node
    .all<{ detail: string }>(
      sql`select detail from node_handover_events where node_id = ${main} and kind = ${kind} order by rowid`,
    )
    .map((r) => JSON.parse(r.detail) as unknown);
}

/** The chart no longer lists the old box and has cleared it, as Clear from list does. */
async function offTheList(): Promise<boolean> {
  const chart = (await readNodeMembership(suite.db))!.body;
  return !chart.nodes.some((n) => n.nodeId === oldBox) && chart.revoked?.includes(oldBox) === true;
}

async function oldStanding(): Promise<string | undefined> {
  return (await readNodeMembership(suite.db))?.body.nodes.find((n) => n.nodeId === oldBox)
    ?.standing;
}

describe("POST /api/node/reset-order refuses", () => {
  it("a bad signature", async () => {
    const envelope = await signAsThisBox(
      { node: suite.node, ring, nodeId: oldBox },
      "reset-query",
      await queryBody(),
    );
    const res = await app().request("/api/node/reset-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...envelope, signature: Buffer.alloc(64).toString("base64") }),
    });
    expect(await refusalOf(res)).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "signature" },
    });
  });

  // The chart vouches for no removed box's key, so its signature is not even checked as its own.
  it.each([
    ["serving-secondary", "standing"],
    ["evicted", "signature"],
  ] as const)("a signer standing %s", async (standing, reason) => {
    await holdChart(standing, 3);
    expect(await refusalOf(await ask(await queryBody()))).toEqual({
      code: "handover.reset_query_refused",
      params: { reason },
    });
  });

  it("a sell-only signer that is not the pinned box", async () => {
    const other = await seedNode(suite.db);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, other);
    await holdChart("sell-only", 3, { other });
    const res = await ask(await queryBody({ sourceNodeId: other }), other);
    expect(await refusalOf(res)).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "binding" },
    });
  });

  it("a revoked signer", async () => {
    await holdChart("sell-only", 3, { revoked: true });
    expect(await refusalOf(await ask(await queryBody()))).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "binding" },
    });
  });

  it.each([
    [
      "the wrong venue",
      { venue: { country: "ES", taxId: "B00000000", environment: "production" } },
    ],
    ["another destination", { destinationNodeId: "another-box" }],
    ["another source", { sourceNodeId: "another-box" }],
  ])("%s", async (_, override) => {
    expect(await refusalOf(await ask(await queryBody(override)))).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "binding" },
    });
  });

  it.each([
    ["no nonce", { nonce: null }],
    ["holdings that are not per module", { holdings: [] }],
    ["an acknowledgement without an order id", { ack: { setAside: false, lacking: {} } }],
    [
      "an acknowledgement naming a module without the seat",
      { ack: { orderId: "o", setAside: true, lacking: { other: [LACKING_CHAIN] } } },
    ],
    [
      "an acknowledgement whose chain is not an object",
      { ack: { orderId: "o", setAside: true, lacking: { fiscal: ["chain"] } } },
    ],
  ])("a malformed request (%s)", async (_, override) => {
    expect(await refusalOf(await ask(await queryBody(override)))).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "request" },
    });
  });

  it.each([
    ["null", null],
    ["a list", []],
    ["a string", "query"],
  ] as const)("a signed body that is %s, as a malformed request", async (_, body) => {
    const envelope = await signAsThisBox(
      { node: suite.node, ring, nodeId: oldBox },
      "reset-query",
      body as unknown as Record<string, CanonicalValue>,
    );
    const res = await app().request("/api/node/reset-order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    expect(await refusalOf(res)).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "request" },
    });
  });

  it("holdings the fiscal seat cannot read, as a refusal rather than a failure", async () => {
    await ordered();
    const res = await ask(await queryBody({ holdings: { fiscal: "not a list" } }));
    expect(await refusalOf(res)).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "holdings" },
    });
  });

  it("nothing for a seat fault that is not malformed holdings: it fails as a server error", async () => {
    const faulty: WaitronModule[] = [
      {
        ...modules[0]!,
        handover: {
          ...VERIFACTU_HANDOVER,
          lacking: async () => {
            throw new Error("disk I/O error");
          },
        },
      },
    ];
    await ordered();
    const res = await ask(await queryBody(), oldBox, app(faulty));
    expect(res.status).toBe(500);
    expect(lines).toEqual([
      expect.objectContaining({ level: "error", event: "reset-order.failed" }),
    ]);
  });

  it("holdings of a module this box does not run", async () => {
    expect(await refusalOf(await ask(await queryBody({ holdings: { other: [] } })))).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "module" },
    });
  });

  it("an acknowledgement naming no order this box wrote", async () => {
    await ordered();
    const res = await ask(
      await queryBody({ ack: { orderId: "not-an-order", setAside: false, lacking: {} } }),
    );
    expect(await refusalOf(res)).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "order" },
    });
    expect(events("reset_acknowledged")).toEqual([]);
    expect(await oldStanding()).toBe("sell-only");
  });
});

describe("POST /api/node/reset-order answers", () => {
  it("no order, bound to the sent nonce, without asking the fiscal seat what this box lacks", async () => {
    const lacking = vi.fn(VERIFACTU_HANDOVER.lacking!);
    const watched: WaitronModule[] = [
      { ...modules[0]!, handover: { ...VERIFACTU_HANDOVER, lacking } },
    ];
    const res = await ask(
      await queryBody({ nonce: "first-ask", holdings: { fiscal: [MISSING_CHAIN] } }),
      oldBox,
      app(watched),
    );
    expect(res.status).toBe(200);
    expect(await answerOf(res)).toEqual({
      nonce: "first-ask",
      sourceNodeId: oldBox,
      order: null,
      lacking: {},
    });
    expect(lacking).not.toHaveBeenCalled();
  });

  it("the standing order, with each chain the fiscal seat says this box lacks", async () => {
    const order = await ordered();
    const res = await ask(
      await queryBody({ nonce: "second-ask", holdings: { fiscal: [MISSING_CHAIN] } }),
    );
    expect(res.status).toBe(200);
    expect(await answerOf(res)).toEqual({
      nonce: "second-ask",
      sourceNodeId: oldBox,
      order: { orderId: order.orderId, acceptLoss: false },
      lacking: { fiscal: [LACKING_CHAIN] },
    });
    expect(events("reset_acknowledged")).toEqual([]);
  });
});

describe("an acknowledgement", () => {
  it("takes the box off the list in the removal's own chart, as Clear from list leaves it", async () => {
    const order = await ordered();
    const before = (await readNodeMembership(suite.db))!.body.term;

    const res = await ask(
      await queryBody({ ack: { orderId: order.orderId, setAside: false, lacking: {} } }),
    );

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const chart = (await readNodeMembership(suite.db))!.body;
    expect(chart.nodes.map((n) => n.nodeId)).toEqual([main]);
    expect(chart.revoked).toEqual([oldBox]);
    expect(chart.term).toBe(before + 1);
    expect(await activities("membership.node_removed")).toEqual([
      expect.objectContaining({ subject_id: oldBox, person_id: personId }),
    ]);
    expect(await activities("membership.node_cleared")).toEqual([
      { subject_id: oldBox, person_id: personId, data: { term: before + 1 } },
    ]);
    expect((await listServers(suite.db, suite.node, main)).nodes.map((n) => n.nodeId)).toEqual([
      main,
    ]);
  });

  it("with the cleared-machine list full still removes the box, leaving its Removed row", async () => {
    const full = Array.from({ length: MAX_REVOKED }, () => randomUUID());
    await holdChart("sell-only", 2, { revokedIds: full });
    const order = await ordered();

    const res = await ask(
      await queryBody({ ack: { orderId: order.orderId, setAside: false, lacking: {} } }),
    );

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await oldStanding()).toBe("evicted");
    expect((await readNodeMembership(suite.db))!.body.revoked).toEqual(full);
    expect(await activities("membership.node_cleared")).toEqual([]);
  });

  it("with nothing lacking records the acknowledgement, removes the box and raises no alert", async () => {
    const order = await ordered();
    const res = await ask(
      await queryBody({ ack: { orderId: order.orderId, setAside: false, lacking: {} } }),
    );
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await answerOf(res))?.order).toEqual(order);
    expect(events("reset_acknowledged")).toEqual([
      { targetNodeId: oldBox, orderId: order.orderId, setAside: false },
    ]);
    expect(await activities("handover.reset_acknowledged")).toEqual([
      {
        subject_id: oldBox,
        person_id: personId,
        data: { orderId: order.orderId, setAside: false, lacking: {} },
      },
    ]);
    expect(await offTheList()).toBe(true);
    expect(await activities("membership.node_removed")).toEqual([
      expect.objectContaining({ subject_id: oldBox, person_id: personId }),
    ]);
    expect(await incidents()).toEqual([]);
  });

  it("still removes the box and raises the alert after the ordering activity entry was pruned", async () => {
    const order = await ordered();
    await suite.db.run(sql`delete from activity_log where kind = 'handover.reset_ordered'`);
    const ack = { orderId: order.orderId, setAside: true, lacking: { fiscal: [LACKING_CHAIN] } };

    const res = await ask(await queryBody({ ack }));

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await offTheList()).toBe(true);
    expect(await activities("handover.reset_acknowledged")).toEqual([
      { subject_id: oldBox, person_id: personId, data: ack },
    ]);
    expect(await incidents()).toHaveLength(1);
  });

  it("a retry after venue.db committed but node.db failed raises no second alert, though the first was handled", async () => {
    const order = await ordered();
    const ack = { orderId: order.orderId, setAside: true, lacking: { fiscal: [LACKING_CHAIN] } };
    suite.node.run(
      sql`create trigger refuse_ack before insert on node_handover_events when new.kind = 'reset_acknowledged' begin select raise(abort, 'test node write failed'); end`,
    );
    try {
      expect((await ask(await queryBody({ ack }))).status).toBe(500);
    } finally {
      suite.node.run(sql`drop trigger refuse_ack`);
    }
    expect(await incidents()).toHaveLength(1);
    expect(await oldStanding()).toBe("sell-only");
    await suite.db.run(sql`update incidents set acknowledged_at = '2026-11-22T10:00:00.000Z'`);

    const retried = await ask(await queryBody({ ack, nonce: "retry" }));

    expect(retried.status, JSON.stringify(await retried.clone().json())).toBe(200);
    expect(await incidents()).toHaveLength(1);
    expect(await activities("handover.reset_acknowledged")).toHaveLength(1);
    expect(events("reset_acknowledged")).toHaveLength(1);
    expect(await offTheList()).toBe(true);
  });

  it("with set-aside chains names them, raises one alert, and a repeat records nothing more", async () => {
    const order = await ordered();
    const ack = { orderId: order.orderId, setAside: true, lacking: { fiscal: [LACKING_CHAIN] } };
    const hono = app();
    const res = await ask(await queryBody({ ack }), oldBox, hono);
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(await activities("handover.reset_acknowledged")).toEqual([
      { subject_id: oldBox, person_id: personId, data: ack },
    ]);
    expect(await incidents()).toEqual([
      {
        code: "chain.set_aside_on_reset",
        params: { nodeId: oldBox, orderId: order.orderId },
      },
    ]);
    expect(await offTheList()).toBe(true);

    // The removed box is refused, so a repeat reaches nothing that writes.
    const repeat = await ask(await queryBody({ ack, nonce: "again" }), oldBox, hono);
    expect(await refusalOf(repeat)).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "signature" },
    });
    expect(await incidents()).toHaveLength(1);
    expect(await activities("handover.reset_acknowledged")).toHaveLength(1);
    expect(await activities("membership.node_removed")).toHaveLength(1);
    expect(events("reset_acknowledged")).toHaveLength(1);
  });

  it("whose removal is refused keeps the acknowledgement, answers, and a repeat adds no second alert", async () => {
    const order = await ordered();
    const operationId = randomUUID();
    await withNodeTransaction(suite.node, (tx) =>
      beginHandoverOperationTx(tx, {
        nodeId: main,
        operationId,
        role: "destination",
        scenario: "controlled",
        sourceNodeId: oldBox,
        destinationNodeId: main,
        binding: {},
        fingerprint: "f",
        state: "copy_accepted",
        waitingReason: null,
      }),
    );
    const ack = { orderId: order.orderId, setAside: true, lacking: { fiscal: [LACKING_CHAIN] } };
    const hono = app();

    const res = await ask(await queryBody({ ack }), oldBox, hono);

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect((await answerOf(res))?.order).toEqual(order);
    expect(events("reset_acknowledged")).toHaveLength(1);
    expect(await oldStanding()).toBe("sell-only");
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "reset-order.removal_refused",
        fields: { nodeId: oldBox, errorCode: "handover.operation_in_progress" },
      }),
    ]);

    // Handled, so the open-incident key no longer absorbs a second raise: only the order does.
    await suite.db.run(sql`update incidents set acknowledged_at = '2026-11-22T10:00:00.000Z'`);
    const repeat = await ask(await queryBody({ ack, nonce: "again" }), oldBox, hono);
    expect(repeat.status).toBe(200);
    expect(await incidents()).toHaveLength(1);
    expect(await activities("handover.reset_acknowledged")).toHaveLength(1);
    expect(events("reset_acknowledged")).toHaveLength(1);
    expect(await oldStanding()).toBe("sell-only");

    // Once the obstacle is gone, the next acknowledgement removes the box and writes no more.
    suite.node.run(
      sql`update node_handover_operations set state = 'abandoned' where operation_id = ${operationId}`,
    );
    const cleared = await ask(await queryBody({ ack, nonce: "cleared" }), oldBox, hono);
    expect(cleared.status, JSON.stringify(await cleared.clone().json())).toBe(200);
    expect(await offTheList()).toBe(true);
    expect(await activities("membership.node_removed")).toHaveLength(1);
    expect(await incidents()).toHaveLength(1);
    expect(await activities("handover.reset_acknowledged")).toHaveLength(1);
    expect(events("reset_acknowledged")).toHaveLength(1);
  });
});

describe("the Servers listing's recoveredRecordsBackup for the old box", () => {
  const COMPLETED_AT = "2026-11-12T11:00:00.000Z";

  /** The `return_complete` step this box recorded, at `at` by this box's clock. */
  async function completionStep(operationId: string, at = COMPLETED_AT) {
    await withNodeTransaction(suite.node, (tx) =>
      tx.insert(nodeHandoverEvents).values({
        nodeId: main,
        operationId,
        kind: "return_complete",
        detail: {},
        envelope: null,
        recordedAt: new Date(at),
      }),
    );
  }

  const destination = (
    lastBackupAt: string | null,
    lastBackupStartedAt: string | null = lastBackupAt,
  ) => ({
    id: lastBackupAt ?? "unread",
    lastBackupAt,
    lastBackupStartedAt,
    ageSeconds: null,
    stale: false,
    readErrorCode: null,
  });

  async function field(backup?: BackupStatus) {
    const listing = await listServers(
      suite.db,
      suite.node,
      main,
      backup === undefined ? undefined : async () => backup,
    );
    return listing.nodes.find((n) => n.nodeId === oldBox)?.recoveredRecordsBackup;
  }

  it("is null while this venue holds no completed return from the box", async () => {
    expect(await field({ configured: false })).toBeNull();
  });

  it("is no-backups when backups are not set up, or their settings could not be used", async () => {
    await completionStep(await completedReturn());
    expect(await field({ configured: false })).toBe("no-backups");
    expect(await field({ configured: false, loadErrorCode: "backup.settings_invalid" })).toBe(
      "no-backups",
    );
  });

  // "Since" compares the box clock's time of the return's `return_complete` step with when a
  // destination's last backup started, strictly after it; one destination holding it is enough.
  it("is backed-up once any destination's last backup started after the return completed", async () => {
    await completionStep(await completedReturn());
    expect(
      await field({
        configured: true,
        destinations: [destination(null), destination("2026-11-12T11:00:00.001Z")],
      }),
    ).toBe("backed-up");
  });

  it("is awaiting-backup when the last backup was published after the return completed but started before it", async () => {
    await completionStep(await completedReturn());
    expect(
      await field({
        configured: true,
        destinations: [destination("2026-11-12T11:00:00.579Z", "2026-11-12T10:59:59.000Z")],
      }),
    ).toBe("awaiting-backup");
    expect(
      await field({
        configured: true,
        destinations: [destination("2026-11-12T11:00:19.000Z", "2026-11-12T11:00:01.000Z")],
      }),
    ).toBe("backed-up");
  });

  it("is awaiting-backup when a destination's last backup has no start time, however late it was published", async () => {
    await completionStep(await completedReturn());
    expect(
      await field({
        configured: true,
        destinations: [destination("2026-11-20T00:00:00.000Z", null)],
      }),
    ).toBe("awaiting-backup");
  });

  it("is awaiting-backup while no destination's last backup started after the return completed", async () => {
    await completionStep(await completedReturn());
    expect(
      await field({
        configured: true,
        destinations: [destination(null), destination(COMPLETED_AT)],
      }),
    ).toBe("awaiting-backup");
  });

  it("is awaiting-backup when this box recorded no completion step to compare, or cannot read backups", async () => {
    await completedReturn();
    const later = {
      configured: true as const,
      destinations: [destination("2026-11-20T00:00:00.000Z")],
    };
    expect(await field(later)).toBe("awaiting-backup");
    expect(await field()).toBe("awaiting-backup");
    expect(
      (
        await listServers(suite.db, suite.node, main, () => Promise.reject(new Error("down")))
      ).nodes.find((n) => n.nodeId === oldBox)?.recoveredRecordsBackup,
    ).toBe("awaiting-backup");
    expect(
      (
        await listServers(suite.db, suite.node, main, () => {
          throw new Error("down");
        })
      ).nodes.find((n) => n.nodeId === oldBox)?.recoveredRecordsBackup,
    ).toBe("awaiting-backup");
  });

  it("takes the latest of two completed returns, and is awaiting-backup if either lacks its step", async () => {
    await completionStep(await completedReturn());
    const second = await completedReturn();
    const between = {
      configured: true as const,
      destinations: [destination("2026-11-12T12:00:00.000Z")],
    };
    expect(await field(between)).toBe("awaiting-backup");
    await completionStep(second, "2026-11-12T13:00:00.000Z");
    expect(await field(between)).toBe("awaiting-backup");
    expect(
      await field({ configured: true, destinations: [destination("2026-11-12T13:00:01.000Z")] }),
    ).toBe("backed-up");
  });
});

describe("the summary a question carries", () => {
  it("is kept once the question is verified, the latest replacing the one before", async () => {
    await ask(await queryBody({ holdings: { fiscal: [] } }));
    const res = await ask(
      await queryBody({ nonce: "later", holdings: { fiscal: [MISSING_CHAIN] } }),
    );
    expect(res.status).toBe(200);
    expect(oldBoxHoldings.latest(oldBox)).toEqual({ fiscal: [MISSING_CHAIN] });
  });

  it("is not kept from a refused question", async () => {
    const res = await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }), main);
    expect(res.status).toBe(409);
    expect(await refusalOf(await ask(await queryBody({ holdings: { other: [] } })))).toEqual({
      code: "handover.reset_query_refused",
      params: { reason: "module" },
    });
    expect(oldBoxHoldings.latest(oldBox)).toBeUndefined();
    expect(oldBoxHoldings.latest(main)).toBeUndefined();
  });
});

describe("the Servers listing's oldBoxHoldsMore for the old box", () => {
  /** The takeover from the old box, by `scenario`, with no return completed. */
  async function replaced(scenario: "controlled" | "emergency") {
    await withTransaction(suite.db, (tx) =>
      tx.insert(handoverActivations).values({
        operationId: randomUUID(),
        sourceNodeId: oldBox,
        destinationNodeId: main,
        scenario,
        evidence: {
          purpose: "waitron.handover.declaration.v1",
          body: {},
          signerNodeId: main,
          signature: "signature",
        },
        personId,
        activatedAt: "2026-11-12T10:00:00.000Z",
      }),
    );
  }

  /** A one-record chain this box holds, as its own summary names it. */
  async function heldChain(): Promise<CanonicalValue> {
    const seriesId = randomUUID();
    await suite.db.insert(invoiceSeries).values({ id: seriesId, nodeId: main, code: "A" });
    const ids = await seedFiscalParents(suite.db, {
      ids: { nodeId: main, seriesId },
      reuseExistingParents: true,
    });
    await insertFiscalRecord(suite.db, ids);
    const held = await VERIFACTU_HANDOVER.holdings!(liveBackupQuery(suite.db));
    expect(held).toHaveLength(1);
    return held;
  }

  async function field(seats: WaitronModule[] = modules) {
    const listing = await listServers(suite.db, suite.node, main, undefined, {
      holdings: oldBoxHoldings,
      modules: seats,
    });
    return listing.nodes.find((n) => n.nodeId === oldBox)?.oldBoxHoldsMore;
  }

  it("is true after a planned handover for a summary naming a chain this box lacks", async () => {
    await completedReturn("controlled");
    await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }));
    expect(await field()).toBe(true);
  });

  it("is false for a summary whose every chain this box holds, or that names none", async () => {
    await completedReturn("controlled");
    await ask(await queryBody({ holdings: { fiscal: await heldChain() } }));
    expect(await field()).toBe(false);
    await ask(await queryBody({ holdings: { fiscal: [] } }));
    expect(await field()).toBe(false);
  });

  it("is true for a summary the fiscal seat cannot read, which no order stood to refuse", async () => {
    await completedReturn("controlled");
    await ask(await queryBody({ holdings: { fiscal: "not a list" } }));
    expect(await field()).toBe(true);
  });

  it("fails the listing on a seat fault that is not an unreadable summary", async () => {
    await completedReturn("controlled");
    await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }));
    const faulty: WaitronModule[] = [
      {
        ...modules[0]!,
        handover: {
          ...VERIFACTU_HANDOVER,
          lacking: async () => {
            throw new Error("disk I/O error");
          },
        },
      },
    ];
    await expect(field(faulty)).rejects.toThrow("disk I/O error");
  });

  it("counts nothing for a module the listing finds no lacking seat for", async () => {
    await completedReturn("controlled");
    await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }));
    expect(await field([{ ...modules[0]!, handover: undefined }])).toBe(false);
  });

  it("is null before the old box's first question since this box started", async () => {
    await completedReturn("controlled");
    expect(await field()).toBeNull();
    expect(
      (await listServers(suite.db, suite.node, main)).nodes.find((n) => n.nodeId === oldBox)
        ?.oldBoxHoldsMore,
    ).toBeNull();
  });

  it("is not worked out after an emergency switch, or with no takeover from the box", async () => {
    const lacking = vi.fn(VERIFACTU_HANDOVER.lacking!);
    const watched: WaitronModule[] = [
      { ...modules[0]!, handover: { ...VERIFACTU_HANDOVER, lacking } },
    ];
    await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }));
    expect(await field(watched)).toBeNull();
    await replaced("emergency");
    expect(await field(watched)).toBeNull();
    expect(lacking).not.toHaveBeenCalled();
  });

  it("is not worked out after a planned handover whose return is not complete, when no wipe can be ordered", async () => {
    await replaced("controlled");
    const lacking = vi.fn(VERIFACTU_HANDOVER.lacking!);
    const watched: WaitronModule[] = [
      { ...modules[0]!, handover: { ...VERIFACTU_HANDOVER, lacking } },
    ];
    await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }));
    expect(await field(watched)).toBeNull();
    expect(lacking).not.toHaveBeenCalled();
  });

  it("is not worked out while an open handover names the box, when no wipe can be ordered", async () => {
    await completedReturn("controlled");
    await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }));
    await withNodeTransaction(suite.node, (tx) =>
      beginHandoverOperationTx(tx, {
        nodeId: main,
        operationId: randomUUID(),
        role: "destination",
        scenario: "controlled",
        sourceNodeId: oldBox,
        destinationNodeId: main,
        binding: {},
        fingerprint: "f",
        state: "copy_accepted",
        waitingReason: null,
      }),
    );
    const lacking = vi.fn(VERIFACTU_HANDOVER.lacking!);
    const watched: WaitronModule[] = [
      { ...modules[0]!, handover: { ...VERIFACTU_HANDOVER, lacking } },
    ];
    const listing = await listServers(suite.db, suite.node, main, undefined, {
      holdings: oldBoxHoldings,
      modules: watched,
    });
    expect(listing.nodes.find((n) => n.nodeId === oldBox)).toMatchObject({
      canReset: false,
      oldBoxHoldsMore: null,
    });
    expect(lacking).not.toHaveBeenCalled();
  });

  it("is not worked out while an order stands, which the question already compares", async () => {
    await completedReturn("controlled");
    await orderReset(
      { db: suite.db, node: suite.node, nodeId: main },
      { targetNodeId: oldBox, personId, acceptLoss: false },
    );
    const lacking = vi.fn(VERIFACTU_HANDOVER.lacking!);
    const watched: WaitronModule[] = [
      { ...modules[0]!, handover: { ...VERIFACTU_HANDOVER, lacking } },
    ];
    await ask(await queryBody({ holdings: { fiscal: [MISSING_CHAIN] } }));
    expect(await field(watched)).toBeNull();
    expect(lacking).not.toHaveBeenCalled();
  });
});
