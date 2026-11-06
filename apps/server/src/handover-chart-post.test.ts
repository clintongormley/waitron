import { sql } from "drizzle-orm";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  nodes,
  readNodeMembership,
  stampDeployment,
  venueLocationId,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  endorseKey,
  generateNodeKeyPair,
  nextStandings,
  signDocumentBody,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import {
  advanceHandoverOperationTx,
  NODE_MIGRATIONS,
  readHandoverRestriction,
  recordHandoverRestrictionTx,
  setNodeMode,
  writeMirrorLink,
  type HandoverOperationState,
} from "@waitron/node-db";
import { postChartToSource } from "./handover-activation.js";
import { currentBinding } from "./handover-signing.js";
import { beginHandover } from "./handover-store.js";
import type { Logger } from "./logger.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { mountNodeMembershipApi } from "./node-membership-api.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x4).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const migrations = [CORE_MIGRATIONS, NODE_MIGRATIONS];

const oldBox = useVenueDb({ migrations });
const newBox = useVenueDb({ migrations });

const servers: HttpsServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

const mintAuthority = () =>
  mintSelfSignedServerCert({ hostnames: ["localhost"], ipAddresses: [], now: new Date() });

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function listen(
  material: ReturnType<typeof mintAuthority>,
  handler: Handler,
): Promise<string> {
  const server = createHttpsServer(
    { key: material.serverKeyPem, cert: material.serverCertPem },
    handler,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `https://localhost:${(server.address() as AddressInfo).port}`;
}

/**
 * Two venue databases, each with its own node.db: M1 holds its chart and is restricted as handed
 * over, and M2 holds the next chart, minted over it by the same calls a promotion makes, and the
 * operation at `state`. M1's address is whatever `address` answers once its key exists.
 */
async function boxes(
  options: {
    state?: HandoverOperationState;
    role?: "source" | "destination";
    mode?: "primary" | "mirror";
    operation?: boolean;
    authority?: ReturnType<typeof mintAuthority>;
    respond?: Handler;
    sourceUrl?: string;
    link?: "pinned" | "none" | "another box";
    sourceInChart?: boolean;
    limitMs?: number;
    signWithUnknownKey?: boolean;
    scenario?: "controlled" | "emergency";
    chart?: "minted" | "none" | "the old box's";
  } = {},
) {
  const material = mintAuthority();
  const requests: string[] = [];
  await seedVenue(oldBox.db);
  await seedVenue(newBox.db);
  const m1 = await seedNode(oldBox.db);
  const m2 = await seedNode(newBox.db);
  await establishNodeIdentity({ ownerDb: oldBox.db, node: oldBox.node, ring: RING }, m1);
  await establishNodeIdentity({ ownerDb: newBox.db, node: newBox.node, ring: RING }, m2);
  const m1Key = await readNodeIdentityKey(oldBox.node, RING, m1);
  const m2Key = await readNodeIdentityKey(newBox.node, RING, m2);
  // M1's own copy of M2's row, which the route's trust set reads (`readMembershipTrustSetTx`).
  await oldBox.db.insert(nodes).values({
    id: m2,
    locationId: await venueLocationId(oldBox.db),
    name: "M2",
    publicKey: nodeSigningPublicKey(m2Key),
  });

  const app = new Hono();
  // As a restricted start mounts it (`boot.ts`, `restrictedStart`): only holds the chart.
  mountNodeMembershipApi(app, { db: oldBox.db, node: oldBox.node, nodeId: m1 }, () => {});
  const real = getRequestListener(app.fetch);
  const url = await listen(options.authority ?? material, (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    (options.respond ?? real)(req, res);
  });

  const heldBody: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: m1, contactUrl: options.sourceUrl ?? url, standing: "serving-primary" },
      { nodeId: m2, contactUrl: "https://spare.test", standing: "serving-secondary" },
    ],
  };
  const held: SignedMembershipDocument = {
    body: heldBody,
    signerNodeId: m1,
    signature: signDocumentBody(heldBody, m1Key),
    endorsements: [endorseKey(m2, nodeSigningPublicKey(m2Key), m1, m1Key)],
  };
  await writeNodeMembership(oldBox.db, held);
  await withNodeTransaction(oldBox.node, (tx) =>
    recordHandoverRestrictionTx(tx, {
      nodeId: m1,
      operationId: OP,
      kind: "handed-over",
      successorNodeId: m2,
      membershipTerm: 3,
    }),
  );

  const minted = await mintNextMembershipDocument(
    { db: newBox.db, node: newBox.node, ring: RING },
    {
      heldDocument: held,
      nodes: nextStandings(
        options.sourceInChart === false
          ? heldBody.nodes.filter((n) => n.nodeId !== m1)
          : heldBody.nodes,
        m2,
      ),
      signerNodeId: m2,
      verifyHeld: "none",
    },
  );
  const stranger = generateNodeKeyPair();
  const chart: SignedMembershipDocument =
    options.signWithUnknownKey === true
      ? {
          ...minted,
          signerNodeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          signature: signDocumentBody(minted.body, stranger.privateKey),
        }
      : minted;
  await writeNodeMembership(newBox.db, options.chart === "the old box's" ? held : chart);

  await stampDeployment(newBox.db, "preproduction");
  if (options.operation !== false) {
    await beginHandover(
      { node: newBox.node, nodeId: m2 },
      await currentBinding({ db: newBox.db }, options.scenario ?? "controlled", m1, m2, OP),
      options.role ?? "destination",
    );
    await withNodeTransaction(newBox.node, (tx) =>
      advanceHandoverOperationTx(tx, m2, OP, options.state ?? "activated", null),
    );
  }
  if (options.chart === "none") await newBox.db.run(sql`delete from node_membership`);
  await setNodeMode({ venue: newBox.db, node: newBox.node }, m2, options.mode ?? "primary");
  if (options.link !== "none") {
    await writeMirrorLink(newBox.node, m2, {
      relayUrl: "http://127.0.0.1:1/",
      boxHostname: "box.local",
      boxCaPem: material.caCertPem,
      originNodeId: options.link === "another box" ? m2 : m1,
    });
  }

  const log = vi.fn<Logger>();
  const start = () =>
    postChartToSource({
      db: newBox.db,
      node: newBox.node,
      nodeId: m2,
      log,
      ...(options.limitMs === undefined ? {} : { limitMs: options.limitMs }),
    });
  const events = () => log.mock.calls.map(([level, event]) => `${level} ${event}`);
  return { m1, m2, held, chart, requests, start, log, events };
}

const MEMBERSHIP_POST = "POST /api/node/membership";

describe("the new main box tells the old box its chart, once per start", () => {
  it("posts to a real old box over the pinned certificate, which holds the chart and stays restricted", async () => {
    const { m1, chart, requests, start, events } = await boxes();
    await start().settled;
    // Failing case: a post with no body under `document`, or to another path, leaves term 3 held.
    expect(requests).toEqual([MEMBERSHIP_POST]);
    expect(await readNodeMembership(oldBox.db)).toEqual(chart);
    expect((await readHandoverRestriction(oldBox.node, m1))?.kind).toBe("handed-over");
    expect(events()).toEqual(["info handover-activation.chart_posted"]);
  });

  it("posts at return_pending, a state after activated that is still open", async () => {
    const { chart, requests, start } = await boxes({ state: "return_pending" });
    await start().settled;
    expect(requests).toEqual([MEMBERSHIP_POST]);
    expect(await readNodeMembership(oldBox.db)).toEqual(chart);
  });

  it("a later start posts again, finding the chart already held, and that is only logged", async () => {
    const { chart, requests, start, events } = await boxes();
    await start().settled;
    await start().settled;
    expect(requests).toEqual([MEMBERSHIP_POST, MEMBERSHIP_POST]);
    expect(await readNodeMembership(oldBox.db)).toEqual(chart);
    expect(events()).toEqual([
      "info handover-activation.chart_posted",
      "warn handover-activation.chart_not_accepted",
    ]);
  });

  it("posts for an emergency operation at activated too", async () => {
    const { chart, requests, start } = await boxes({ scenario: "emergency" });
    await start().settled;
    expect(requests).toEqual([MEMBERSHIP_POST]);
    expect(await readNodeMembership(oldBox.db)).toEqual(chart);
  });

  it("a box still holding the old box's own chart posts it, and the old box changes nothing", async () => {
    const { held, requests, start, events } = await boxes({ chart: "the old box's" });
    await start().settled;
    expect(requests).toEqual([MEMBERSHIP_POST]);
    expect(await readNodeMembership(oldBox.db)).toEqual(held);
    expect(events()).toEqual(["warn handover-activation.chart_not_accepted"]);
  });

  it.each<[string, Parameters<typeof boxes>[0]]>([
    ["no operation", { operation: false }],
    ["the operation at prepared", { state: "prepared" }],
    ["the operation at copy_accepted", { state: "copy_accepted" }],
    ["the operation at filing_assumed", { state: "filing_assumed" }],
    ["the operation closed at return_complete", { state: "return_complete" }],
    ["this box the operation's source", { role: "source" }],
    ["a mirror", { mode: "mirror" }],
    ["the source not in the chart", { sourceInChart: false }],
    ["no chart on this box", { chart: "none" }],
  ])("posts nothing with %s", async (_name, options) => {
    const { held, requests, start, events } = await boxes(options);
    await start().settled;
    expect(requests).toEqual([]);
    expect(await readNodeMembership(oldBox.db)).toEqual(held);
    expect(events()).toEqual([]);
  });

  it.each<[string, Parameters<typeof boxes>[0]]>([
    ["no pinned certificate", { link: "none" }],
    ["a certificate pinned for another box", { link: "another box" }],
    ["a plain http address off this machine", { sourceUrl: "http://192.0.2.1:8080" }],
  ])("posts nothing, and logs it, with %s", async (_name, options) => {
    const { requests, start, events } = await boxes(options);
    await start().settled;
    expect(requests).toEqual([]);
    expect(events()).toEqual(["warn handover-activation.chart_no_address"]);
  });

  it("a certificate from another authority stops the post before the old box hears it", async () => {
    const { held, requests, start, events } = await boxes({ authority: mintAuthority() });
    await start().settled;
    // Failing case, with the pin dropped: M1 holds the new chart.
    expect(requests).toEqual([]);
    expect(await readNodeMembership(oldBox.db)).toEqual(held);
    expect(events()).toEqual(["warn handover-activation.chart_post_failed"]);
  });

  it("the old box refuses a chart signed by a key it does not know, and only a log says so", async () => {
    const { held, requests, start, events } = await boxes({ signWithUnknownKey: true });
    await start().settled;
    expect(requests).toEqual([MEMBERSHIP_POST]);
    expect(await readNodeMembership(oldBox.db)).toEqual(held);
    expect(events()).toEqual(["warn handover-activation.chart_not_accepted"]);
  });

  it("a refusing old box is logged, with its status, and nothing throws", async () => {
    const { start, log } = await boxes({
      respond: (_req, res) => {
        res.statusCode = 502;
        res.end("<html>");
      },
    });
    await start().settled;
    // Failing case, with the status unread: the page fails to parse and logs no status.
    expect(log).toHaveBeenCalledWith(
      "warn",
      "handover-activation.chart_not_accepted",
      expect.objectContaining({ operationId: OP, status: 502 }),
    );
  });

  it("an old box switched off is logged, and nothing throws", async () => {
    const { start, events } = await boxes({ sourceUrl: "https://localhost:1" });
    await start().settled;
    expect(events()).toEqual(["warn handover-activation.chart_post_failed"]);
  });

  it("an answer that is not the route's is logged, and nothing throws", async () => {
    const { start, events } = await boxes({ respond: (_req, res) => res.end("<html>") });
    await start().settled;
    expect(events()).toEqual(["warn handover-activation.chart_post_failed"]);
  });

  it("a store that cannot be read is logged, and nothing throws", async () => {
    const log = vi.fn<Logger>();
    const broken = {
      select: () => {
        throw new Error("no such store");
      },
    } as unknown as typeof newBox.node;
    const post = postChartToSource({ db: newBox.db, node: broken, nodeId: "m2", log });
    await post.settled;
    expect(log.mock.calls.map(([, event]) => event)).toEqual([
      "handover-activation.chart_post_failed",
    ]);
  });

  describe("an old box that never answers", () => {
    function stalling() {
      const closed: Promise<void>[] = [];
      const respond: Handler = (req) => {
        closed.push(new Promise((resolve) => req.socket.once("close", () => resolve())));
      };
      return { closed, respond };
    }

    it("gives up at its limit, and logs it", async () => {
      const { respond } = stalling();
      const { requests, start, events } = await boxes({ respond, limitMs: 200 });
      await start().settled;
      expect(requests).toEqual([MEMBERSHIP_POST]);
      expect(events()).toEqual(["warn handover-activation.chart_post_failed"]);
    });

    it("a stop ends the request at once, far inside the limit, with nothing logged as failed", async () => {
      const { closed, respond } = stalling();
      const { requests, start, events } = await boxes({ respond, limitMs: 60_000 });
      const post = start();
      await vi.waitFor(() => expect(requests).toEqual([MEMBERSHIP_POST]));
      const stoppedAt = performance.now();
      await post.stop();
      // Failing case, with the stop's signal left out of the request: this waits out the minute.
      expect(performance.now() - stoppedAt).toBeLessThan(30_000);
      await closed[0];
      expect(events()).toEqual([]);
    });
  });

  it("a stop before the request goes out sends nothing", async () => {
    const { requests, start, events } = await boxes();
    await start().stop();
    expect(requests).toEqual([]);
    expect(events()).toEqual([]);
  });
});
