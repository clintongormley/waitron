import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { taxpayer, writeNodeMembership } from "@waitron/db";
import { loadKeyRing, nodeSigningPublicKey, type KeyRing } from "@waitron/credentials";
import { verifyEnvelope } from "@waitron/handover";
import type { MembershipDocumentBody, NodeStanding } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { authenticateAgent } from "@waitron/printing";
import { AppError } from "@waitron/shared";
import { nodeId as brandNodeId } from "@waitron/shared";
import { mountNodeEnrolApi } from "./node-enrol-api.js";
import type { EnrolRateLimiter } from "./enrol-rate-limit.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { PRINT_AGENT_ENROL_PATH } from "./print-agent-enrol-api.js";
import {
  mintBoxAuthority,
  startBoxServer,
  type BoxAuthority,
  type BoxServer,
} from "./testing/box-authority.js";
import type { TradingContext } from "./trading-context.js";
import type { Logger } from "./logger.js";
import "./errors.js";

const noopLog: Logger = () => {};

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(78_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function seedTestVenue(): Promise<void> {
  await suite.db
    .insert(taxpayer)
    .values({ id: 1, country: "ES", taxId: nextNif(), legalName: "Deli Test SL" });
  await seedVenue(suite.db, {
    name: "Main room",
    invoiceLocales: ["es-ES"],
  });
}

beforeAll(async () => {
  await seedTestVenue();
});

/** A fresh nodeId per call keeps each mounted app's enrol row independent, because this suite does
 * not reset between tests. */
function cfgOf(): TradingContext {
  return {
    nodeId: brandNodeId(randomUUID()),
    locale: "es-ES",
    simplifiedInvoiceLimit: null,
  };
}

function buildApp(
  opts: {
    isPrimary?: boolean;
    limiter?: EnrolRateLimiter;
    requestProvenFromBox?: (c: Context) => boolean;
  } = {},
): {
  app: Hono;
  cfg: TradingContext;
} {
  const cfg = cfgOf();
  const app = new Hono();
  mountNodeEnrolApi(
    app,
    {
      db: suite.db,
      nodeId: cfg.nodeId,
      isPrimary: opts.isPrimary ?? true,
      enrolRateLimiter: opts.limiter,
      ...(opts.requestProvenFromBox === undefined
        ? {}
        : { requestProvenFromBox: opts.requestProvenFromBox }),
    },
    noopLog,
  );
  return { app, cfg };
}

/** `getConnInfo` reads the peer address from `c.env.incoming.socket.remoteAddress`; the third
 *  `app.request` argument becomes `c.env`. */
async function post(
  app: Hono,
  body: unknown,
  remoteAddress: string | undefined,
): Promise<Response> {
  return app.request(
    "/api/node/enrol-self",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { incoming: { socket: { remoteAddress } } },
  );
}

async function errorCodeOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

/** Resolve a minted agent token through the production auth path. */
async function authenticate(token: string): Promise<{ agentId: string }> {
  return authenticateAgent(suite.db, token);
}

/** Read straight off the table, so the assertion is about what landed, not what the route
 *  returned. */
async function agentRowCount(cfg: TradingContext): Promise<number> {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select cast(count(*) as int) as n from print_agents where node_id = ${cfg.nodeId}`,
  );
  return rows[0]!.n;
}

describe("POST /api/node/enrol-self", () => {
  it("enrols the caller as a print agent over loopback on the primary", async () => {
    const { app } = buildApp();
    const res = await post(app, { name: "box" }, "127.0.0.1");
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };
    expect(typeof token).toBe("string");
    // The token authenticates as a real agent, so the row was written.
    const auth = await authenticate(token);
    expect(auth.agentId).toBeDefined();
  });

  it("refuses a non-loopback caller with node.enrol_not_local (negative control)", async () => {
    const { app, cfg } = buildApp();
    const res = await post(app, { name: "x" }, "192.168.1.50");
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("node.enrol_not_local");
    // Refused before any database work, so no row exists.
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("refuses a request with NO remote address with node.enrol_not_local (fails closed)", async () => {
    // An unknown origin fails closed rather than being treated as loopback.
    const { app, cfg } = buildApp();
    const res = await post(app, { name: "x" }, undefined);
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("node.enrol_not_local");
    // Refused before any database work, so no row exists.
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("asks boot's replaceable from-this-box check, not the caller's address", async () => {
    const trusted = buildApp({ requestProvenFromBox: () => true });
    expect((await post(trusted.app, { name: "box" }, "192.168.1.50")).status).toBe(201);
    const refused = buildApp({ requestProvenFromBox: () => false });
    const res = await post(refused.app, { name: "box" }, "127.0.0.1");
    expect(res.status).toBe(403);
    expect(await errorCodeOf(res)).toBe("node.enrol_not_local");
    expect(await agentRowCount(refused.cfg)).toBe(0);
  });

  it("accepts the IPv6 loopback forms", async () => {
    for (const addr of ["::1", "::ffff:127.0.0.1"]) {
      const { app } = buildApp();
      const res = await post(app, { name: "box" }, addr);
      expect(res.status).toBe(201);
    }
  });

  it("refuses on a non-primary node with node.enrol_unavailable", async () => {
    const { app, cfg } = buildApp({ isPrimary: false });
    const res = await post(app, { name: "x" }, "127.0.0.1");
    expect(res.status).toBe(409);
    expect(await errorCodeOf(res)).toBe("node.enrol_unavailable");
    expect(await agentRowCount(cfg)).toBe(0);
  });

  it("rate-limits a flood BEFORE touching the DB", async () => {
    // A limiter whose window is already full stands in for the request after a flood; a valid
    // loopback request on the primary must still draw a 429 and leave no row.
    const limiter: EnrolRateLimiter = {
      check() {
        throw new AppError("device.join_rate_limited", {});
      },
    };
    const { app, cfg } = buildApp({ limiter });
    const res = await post(app, { name: "box" }, "127.0.0.1");
    expect(res.status).toBe(429);
    expect(await errorCodeOf(res)).toBe("device.join_rate_limited");
    expect(await agentRowCount(cfg)).toBe(0);
  });
});

describe("POST /api/node/enrol-self on the venue's spare", () => {
  const RING: KeyRing = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x7).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  const MAIN_ID = "44444444-4444-4444-8444-444444444444";
  const MAIN_URL = "https://box-main.waitron.local";

  interface Sent {
    url: string;
    body: unknown;
  }

  type Answer = (signal: AbortSignal) => Promise<Response>;

  async function spareApp(
    opts: {
      answer?: Answer;
      mainStanding?: NodeStanding;
      spareStanding?: NodeStanding;
      mainUrl?: string;
      chart?: boolean;
      withFetch?: boolean;
      authority?: string;
      log?: Logger;
    } = {},
  ) {
    const spareId = await seedNode(suite.db);
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, spareId);
    const publicKey = nodeSigningPublicKey(await readNodeIdentityKey(suite.node, RING, spareId));
    const body: MembershipDocumentBody = {
      term: 4,
      nodes: [
        {
          nodeId: MAIN_ID,
          contactUrl: opts.mainUrl ?? MAIN_URL,
          standing: opts.mainStanding ?? "serving-primary",
        },
        {
          nodeId: spareId,
          contactUrl: "https://box-spare",
          standing: opts.spareStanding ?? "serving-secondary",
        },
      ],
    };
    if (opts.chart === false) await suite.db.execute(sql`delete from node_membership`);
    // `readNodeMembership` does not check the signature.
    else
      await writeNodeMembership(suite.db, {
        body,
        signerNodeId: MAIN_ID,
        signature: "placeholder",
        endorsements: [],
      });
    const sent: Sent[] = [];
    const answer: Answer =
      opts.answer ?? (async () => Response.json({ token: "agent-1.secret" }, { status: 201 }));
    const fetchSeam = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return answer(init!.signal!);
    });
    const lookup = vi.fn(async () => ({ addresses: ["127.0.0.1"], remembered: false }));
    const app = new Hono();
    mountNodeEnrolApi(
      app,
      {
        db: suite.db,
        nodeId: spareId,
        isPrimary: false,
        spare: {
          node: suite.node,
          ring: RING,
          exchange: {
            timeoutMs: 100,
            lookup,
            ...(opts.authority === undefined ? {} : { authorityOf: () => opts.authority }),
            ...(opts.withFetch === false ? {} : { fetch: fetchSeam as typeof fetch }),
          },
        },
      },
      opts.log ?? noopLog,
    );
    return { app, spareId, publicKey, sent, fetchSeam, lookup, body };
  }

  async function spareRows(spareId: string): Promise<number> {
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select cast(count(*) as int) as n from print_agents where node_id = ${spareId}`,
    );
    return rows[0]!.n;
  }

  const REFUSED = { status: 409, code: "node.enrol_unavailable" };

  async function outcome(res: Response): Promise<{ status: number; code: string }> {
    return { status: res.status, code: await errorCodeOf(res) };
  }

  it("asks the main box with a request this box signed, and passes its token on", async () => {
    const { app, spareId, publicKey, sent } = await spareApp();
    const res = await post(app, { name: "spare agent" }, "127.0.0.1");
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ token: "agent-1.secret" });
    expect(sent.map(({ url }) => url)).toEqual([`${MAIN_URL}${PRINT_AGENT_ENROL_PATH}`]);
    const verdict = verifyEnvelope(sent[0]!.body, "agent-enrol", (id) =>
      id === spareId ? publicKey : undefined,
    );
    expect(verdict).toMatchObject({
      valid: true,
      signerNodeId: spareId,
      body: { name: "spare agent", toNodeId: MAIN_ID },
    });
    // The spare stores nothing: the row lives on the main box.
    expect(await spareRows(spareId)).toBe(0);
  });

  it("refuses as before when the main box does not answer in time", async () => {
    const { app, sent } = await spareApp({
      answer: (signal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    });
    const res = await post(app, { name: "spare agent" }, "127.0.0.1");
    expect(await outcome(res)).toEqual(REFUSED);
    expect(sent).toHaveLength(1);
  });

  it("refuses as before when the main box cannot be reached", async () => {
    const { app } = await spareApp({
      answer: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await outcome(await post(app, { name: "a" }, "127.0.0.1"))).toEqual(REFUSED);
  });

  it("refuses as before whatever refusal the main box gives", async () => {
    for (const [status, code] of [
      [409, "node.enrol_unavailable"],
      [403, "device.join_revoked"],
      [401, "handover.peer_unknown"],
      [500, "node.failed"],
    ] as const) {
      const { app } = await spareApp({
        answer: async () => Response.json({ error: { code, params: {} } }, { status }),
      });
      expect([code, await outcome(await post(app, { name: "a" }, "127.0.0.1"))]).toEqual([
        code,
        REFUSED,
      ]);
    }
  });

  it("refuses as before when the main box's answer is not a token", async () => {
    for (const answered of [
      () => Response.json({}, { status: 201 }),
      () => Response.json({ token: 7 }, { status: 201 }),
      () => Response.json({ token: "x" }, { status: 200 }),
      () => new Response("not json", { status: 201 }),
    ]) {
      const { app } = await spareApp({ answer: async () => answered() });
      expect(await outcome(await post(app, { name: "a" }, "127.0.0.1"))).toEqual(REFUSED);
    }
  });

  it("refuses a caller that is not on this box before anything is sent", async () => {
    const { app, fetchSeam } = await spareApp();
    const res = await post(app, { name: "a" }, "192.168.1.50");
    expect(await outcome(res)).toEqual({ status: 403, code: "node.enrol_not_local" });
    expect(fetchSeam).not.toHaveBeenCalled();
  });

  it("refuses without asking when the chart names no other main box, or fences this one", async () => {
    for (const opts of [
      { chart: false },
      { spareStanding: "evicted" as const },
      { mainStanding: "serving-secondary" as const },
      { mainUrl: "" },
      { mainStanding: "serving-secondary" as const, spareStanding: "serving-primary" as const },
    ]) {
      const { app, fetchSeam } = await spareApp(opts);
      expect([opts, await outcome(await post(app, { name: "a" }, "127.0.0.1"))]).toEqual([
        opts,
        REFUSED,
      ]);
      expect(fetchSeam).not.toHaveBeenCalled();
    }
  });

  it("sends to the main box only over https", async () => {
    const { app, lookup } = await spareApp({
      withFetch: false,
      mainUrl: "http://box-main.waitron.local",
    });
    expect(await outcome(await post(app, { name: "a" }, "127.0.0.1"))).toEqual(REFUSED);
    expect(lookup).not.toHaveBeenCalled();
  });

  describe("over HTTPS to the main box", () => {
    let authorityX: BoxAuthority;
    let authorityY: BoxAuthority;
    const servers: BoxServer[] = [];
    beforeAll(async () => {
      [authorityX, authorityY] = await Promise.all([mintBoxAuthority(), mintBoxAuthority()]);
    });
    afterEach(async () => {
      while (servers.length > 0) await servers.pop()!.close();
    });

    async function forwardFailures(opts: { authority?: string; server: BoxAuthority }) {
      const server = await startBoxServer(opts.server, () => ({
        status: 201,
        body: JSON.stringify({ token: "agent-1.secret" }),
      }));
      servers.push(server);
      const reasons: unknown[] = [];
      const { app } = await spareApp({
        withFetch: false,
        mainUrl: server.url,
        ...(opts.authority === undefined ? {} : { authority: opts.authority }),
        log: (_level, event, fields) => {
          if (event === "node.enrol_forward_failed") reasons.push(fields);
        },
      });
      const res = await post(app, { name: "a" }, "127.0.0.1");
      return { res, reasons, server };
    }

    it("passes on the token from a main box serving a certificate from this box's authority", async () => {
      const { res } = await forwardFailures({ authority: authorityX.caPem, server: authorityX });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ token: "agent-1.secret" });
    });

    it("logs no_authority, and sends nothing, when this box holds no venue authority", async () => {
      const { res, reasons, server } = await forwardFailures({ server: authorityX });
      expect(await outcome(res)).toEqual(REFUSED);
      expect(reasons).toEqual([{ peerNodeId: MAIN_ID, reason: "no_authority" }]);
      expect(server.requests).toHaveLength(0);
    });

    it("logs certificate, and sends nothing, when the main box's certificate is from another authority", async () => {
      const { res, reasons, server } = await forwardFailures({
        authority: authorityX.caPem,
        server: authorityY,
      });
      expect(await outcome(res)).toEqual(REFUSED);
      expect(reasons).toEqual([{ peerNodeId: MAIN_ID, reason: "certificate" }]);
      expect(server.requests).toHaveLength(0);
    });
  });

  it("logs a failure once until the reason changes or a request gets through", async () => {
    const lines: [string, string, unknown][] = [];
    let answer = async (): Promise<Response> =>
      Response.json({ error: { code: "node.enrol_unavailable", params: {} } }, { status: 409 });
    const { app } = await spareApp({
      answer: () => answer(),
      // The error boundary logs each refusal it answers; only the forwarding lines are counted.
      log: (level, event, fields) => {
        if (event.startsWith("node.enrol_forward")) lines.push([level, event, fields]);
      },
    });
    for (let i = 0; i < 3; i += 1) await post(app, { name: "a" }, "127.0.0.1");
    answer = async () => Response.json({ token: "t.s" }, { status: 201 });
    await post(app, { name: "a" }, "127.0.0.1");
    answer = async () =>
      Response.json({ error: { code: "node.enrol_unavailable", params: {} } }, { status: 409 });
    await post(app, { name: "a" }, "127.0.0.1");
    expect(lines).toEqual([
      [
        "warn",
        "node.enrol_forward_failed",
        { peerNodeId: MAIN_ID, reason: "node.enrol_unavailable" },
      ],
      ["info", "node.enrol_forwarded", { peerNodeId: MAIN_ID }],
      [
        "warn",
        "node.enrol_forward_failed",
        { peerNodeId: MAIN_ID, reason: "node.enrol_unavailable" },
      ],
    ]);
  });

  it("logs the same failure again when the chart names another main box", async () => {
    const OTHER_MAIN = "55555555-5555-4555-8555-555555555555";
    const reasons: unknown[] = [];
    const { app, body } = await spareApp({
      answer: async () =>
        Response.json({ error: { code: "node.enrol_unavailable", params: {} } }, { status: 409 }),
      log: (_level, event, fields) => {
        if (event === "node.enrol_forward_failed") reasons.push(fields);
      },
    });
    await post(app, { name: "a" }, "127.0.0.1");
    await writeNodeMembership(suite.db, {
      body: {
        ...body,
        term: body.term + 1,
        nodes: [
          { ...body.nodes[0]!, standing: "serving-secondary" },
          body.nodes[1]!,
          { nodeId: OTHER_MAIN, contactUrl: MAIN_URL, standing: "serving-primary" },
        ],
      },
      signerNodeId: OTHER_MAIN,
      signature: "placeholder",
      endorsements: [],
    });
    await post(app, { name: "a" }, "127.0.0.1");
    expect(reasons).toEqual([
      { peerNodeId: MAIN_ID, reason: "node.enrol_unavailable" },
      { peerNodeId: OTHER_MAIN, reason: "node.enrol_unavailable" },
    ]);
  });
});
