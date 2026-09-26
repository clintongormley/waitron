import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  joinRequests,
  locations,
  nowIso,
  printAgents,
  printJobs,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  hashPin,
  hashSessionToken,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { enqueuePrintJob, esc } from "@waitron/printing";
import type { NetworkProbe } from "@waitron/print-agent";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  type SupportedLocale,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountPrintApi } from "./print-api.js";
import { formatTestPage } from "./test-page.js";
import { formatSampleReceipt } from "./sample-receipt.js";
import { formatCharacterTableTest } from "./character-table-test.js";
import { acceptPrintAgentJoinRequest } from "./join-requests.js";
import { createPairingMode } from "./pairing-mode.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import type { TillConfig } from "./till-config.js";
import {
  ENROL_RATE_MAX,
  ENROL_RATE_WINDOW_MS,
  createEnrolRateLimiter,
  type EnrolRateLimiter,
} from "./enrol-rate-limit.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import "./errors.js";

// The print routes end to end in-process. Tests share the seeded tenant and create their own
// printers, so assertions about tenant-wide results must account for other tests' jobs.
const noopLog: Logger = () => {};

const MEMBERSHIP = signedMembershipDoc(3, {
  signerNodeId: "box",
  nodes: [
    { nodeId: "box", contactUrl: "https://box.deli.test", standing: "serving-primary" },
    { nodeId: "cloud", contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
  ],
});
const EXPECTED_SERVERS = [
  { nodeId: "box", url: "https://box.deli.test", standing: "serving-primary" },
  { nodeId: "cloud", url: "https://cloud.deli.test", standing: "serving-secondary" },
];

let locationId: string;
let cfg: TillConfig;
let managerCookie: string;
let staffCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    // Through the table definitions: `locations.id` and `persons.id` are `$defaultFn` generators a
    // raw insert never reaches.
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    locationId = loc!.id;
    // Knock and accept must share this one cfg: every join-request statement filters by node.
    cfg = {
      tillId: brandTillId(randomUUID()),
      nodeId: brandNodeId(randomUUID()),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
      orderFlow: "ticket_then_pay",
    };
    const { managerSid, staffSid } = await withTransaction(db, async (tx) => {
      const [mgr] = await tx
        .insert(persons)
        .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const [stf] = await tx
        .insert(persons)
        .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
        .returning({ id: persons.id });
      const managerSession = await startManagementSession(tx, {
        personId: mgr!.id,
      });
      const staffSession = await startManagementSession(tx, {
        personId: stf!.id,
      });
      return { managerSid: managerSession.token, staffSid: staffSession.token };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

function mountApp(
  opts: {
    pairingOpen?: boolean;
    enrolRateLimiter?: EnrolRateLimiter;
    venueLocale?: SupportedLocale;
    listIpv4?: () => string[];
  } = {},
): Hono {
  const app = new Hono();
  const pairingMode = createPairingMode();
  if (opts.pairingOpen ?? true) pairingMode.open();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg,
      pairingMode,
      readMembership: async () => MEMBERSHIP,
      enrolRateLimiter: opts.enrolRateLimiter,
      venueLocale: opts.venueLocale ?? "es-ES",
      listIpv4: opts.listIpv4,
    },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH",
  path: string,
  opts: { body?: unknown; cookie?: string; bearer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  if (opts.bearer !== undefined) headers["authorization"] = `Bearer ${opts.bearer}`;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

/** Accepts through the verb; the accept route is `join-api.ts`'s. */
async function joinAndAccept(
  app: Hono,
  label = "Cocina agent",
): Promise<{ agentId: string; token: string }> {
  const { token, verificationNumber, joinId } = await knock(app, label);
  await withTransaction(suite.db, async (tx) => {
    const result = await acceptPrintAgentJoinRequest(tx, cfg, joinId, {
      choice: verificationNumber,
    });
    expect(result.ok).toBe(true);
  });
  return { agentId: joinId, token };
}

async function knock(
  app: Hono,
  name = "Cocina agent",
): Promise<{ token: string; verificationNumber: string; joinId: string }> {
  const res = await send(app, "POST", "/print-api/agent/join", { body: { name } });
  expect(res.status).toBe(201);
  const { token, verificationNumber } = (await res.json()) as {
    token: string;
    verificationNumber: string;
  };
  return { token, verificationNumber, joinId: token.slice(0, token.indexOf(".")) };
}

/** The create route ignores `agentId`; no agent binding is stored. */
async function createPrinterVia(app: Hono, agentId: string, name = "Cocina"): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "network_tcp", agentId, host: "10.0.0.9" },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createUsbPrinter(app: Hono, localKey: string, name = "USB"): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "usb", localKey },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createNetworkPrinter(
  app: Hono,
  host: string,
  port: number,
  name = "Network",
): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "network_tcp", host, port },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

interface PullJob {
  id: string;
  printerId: string;
  transport: string;
  host: string | null;
  port: number | null;
  localKey: string | null;
  payload: string;
}
interface PullReply {
  nodeId: string;
  servers: { nodeId: string; url: string; standing: string }[];
  jobs: PullJob[];
  discoveryUntil: number | null;
  networkProbes?: NetworkProbe[];
}

async function pull(
  app: Hono,
  token: string,
  inventory: { visible?: unknown; scanned?: unknown } = {},
): Promise<PullReply> {
  const res = await send(app, "POST", "/print-api/agent/jobs", { bearer: token, body: inventory });
  expect(res.status).toBe(200);
  return (await res.json()) as PullReply;
}

async function enqueue(printerId: string, payload: Uint8Array): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { jobId } = await enqueuePrintJob(tx, { locationId }, printerId, payload);
    return jobId;
  });
}

async function jobRow(jobId: string): Promise<{
  status: string;
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
}> {
  const { rows } = await suite.db.execute<{
    status: string;
    attempts: number;
    last_error: string | null;
    delivered_at: string | null;
  }>(sql`select status, attempts, last_error, delivered_at from print_jobs where id = ${jobId}`);
  return rows[0]!;
}

describe("POST /print-api/agent/join (the knock)", () => {
  it("window shut → 403 device.pairing_closed with no join_requests row created", async () => {
    const app = mountApp({ pairingOpen: false });
    const name = `kitchen-${randomUUID()}`;
    const res = await send(app, "POST", "/print-api/agent/join", { body: { name } });
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_closed" },
    });
    const rows = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(joinRequests).where(eq(joinRequests.label, name));
    });
    expect(rows).toHaveLength(0);
  });

  it("window open → 201 { token, verificationNumber }, a pending join_requests row, no print_agents row", async () => {
    const app = mountApp({ pairingOpen: true });
    const name = `kitchen-${randomUUID()}`;
    const res = await send(app, "POST", "/print-api/agent/join", { body: { name } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; verificationNumber: string };
    expect(body.verificationNumber).toMatch(/^\d{2}$/);
    expect(body.token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    const joinId = body.token.slice(0, body.token.indexOf("."));
    const [pending] = await withTransaction(suite.db, async (tx) => {
      return tx
        .select({ kind: joinRequests.kind })
        .from(joinRequests)
        .where(eq(joinRequests.id, joinId));
    });
    expect(pending).toMatchObject({ kind: "print_agent" });
    const agents = await withTransaction(suite.db, async (tx) => {
      return tx.select().from(printAgents).where(eq(printAgents.name, name));
    });
    expect(agents).toHaveLength(0);
  });

  it("the knock screens the body (a missing name → 400)", async () => {
    const app = mountApp({ pairingOpen: true });
    const res = await send(app, "POST", "/print-api/agent/join", { body: {} });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });
  });

  it("rate-limits the knock: the (cap+1)th attempt is 429 device.join_rate_limited BEFORE the DB, then the window resets", async () => {
    let fakeNow = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => fakeNow });
    const app = mountApp({ pairingOpen: true, enrolRateLimiter: limiter });
    for (let i = 0; i < ENROL_RATE_MAX; i++) limiter.check();
    const limited = await send(app, "POST", "/print-api/agent/join", { body: { name: "x" } });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.join_rate_limited" },
    });
    fakeNow += ENROL_RATE_WINDOW_MS + 1;
    const after = await send(app, "POST", "/print-api/agent/join", { body: { name: "x" } });
    expect(after.status).toBe(201);
  });
});

describe("GET /print-api/agent/join/status", () => {
  it("pending before accept; approved after; not_approved with a garbage token", async () => {
    const app = mountApp({ pairingOpen: true });
    const { token, verificationNumber, joinId } = await knock(app);

    const pending = await send(app, "GET", "/print-api/agent/join/status", { bearer: token });
    expect(pending.status).toBe(200);
    expect((await pending.json()) as { status: string }).toEqual({ status: "pending" });

    await withTransaction(suite.db, async (tx) => {
      const r = await acceptPrintAgentJoinRequest(tx, cfg, joinId, { choice: verificationNumber });
      expect(r.ok).toBe(true);
    });
    const approved = await send(app, "GET", "/print-api/agent/join/status", { bearer: token });
    expect((await approved.json()) as { status: string }).toEqual({ status: "approved" });

    const bad = await send(app, "GET", "/print-api/agent/join/status", { bearer: "nope.nope" });
    expect(bad.status).toBe(200);
    expect((await bad.json()) as { status: string }).toEqual({ status: "not_approved" });
  });
});

describe("the deleted enrol/codes routes are gone", () => {
  it("POST /print-api/agent/enrol → 404; POST /management-api/print-agents/codes → 404", async () => {
    const app = mountApp({ pairingOpen: true });
    const enrol = await send(app, "POST", "/print-api/agent/enrol", { body: { code: "x" } });
    expect(enrol.status).toBe(404);
    const codes = await send(app, "POST", "/management-api/print-agents/codes", {
      cookie: managerCookie,
      body: { label: "x" },
    });
    expect(codes.status).toBe(404);
  });
});

describe("POST /print-api/agent/jobs — the pull carries nodeId + servers", () => {
  it("echoes this node's id and the venue's routable servers (primary first) alongside the jobs", async () => {
    const app = mountApp({ pairingOpen: true });
    const { agentId, token } = await joinAndAccept(app);
    await createPrinterVia(app, agentId);
    const res = await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      nodeId: string;
      servers: { nodeId: string; url: string; standing: string }[];
      jobs: unknown[];
    };
    expect(body.nodeId).toBe(cfg.nodeId);
    expect(body.servers).toEqual(EXPECTED_SERVERS);
  });
});

describe("mountPrintApi — agent claim + report", () => {
  it("claims this agent's queued jobs (payload as base64), marking them printing (committed)", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const payload = esc().text("Mesa 4").cut().bytes();
    const jobId = await enqueue(printerId, payload);

    const res = await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    expect(res.status).toBe(200);
    const { jobs } = (await res.json()) as {
      jobs: {
        id: string;
        printerId: string;
        transport: string;
        host: string | null;
        port: number | null;
        localKey: string | null;
        payload: string;
      }[];
    };
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: jobId,
      printerId,
      transport: "network_tcp",
      host: "10.0.0.9",
      port: 9100,
      localKey: null,
    });
    expect(Buffer.from(jobs[0]!.payload, "base64").equals(Buffer.from(payload))).toBe(true);
    // The claim committed within the request.
    expect((await jobRow(jobId)).status).toBe("printing");
    const again = await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    expect(((await again.json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
  });

  it("does NOT claim a usb job whose key the pulling box cannot see (derived eligibility)", async () => {
    // The visible key is the isolation between boxes: a network_tcp printer is claimable by any box at
    // its location, so a cross-agent claim of one is expected.
    const app = mountApp();
    const mine = await joinAndAccept(app, "Mine");
    const serial = `SN-${randomUUID()}`;
    const usbPrinter = await createUsbPrinter(app, serial, "Other USB");
    const jobId = await enqueue(usbPrinter, new Uint8Array([1]));

    const res = await pull(app, mine.token, { visible: [], scanned: [] });
    expect(res.jobs).toHaveLength(0);
    expect((await jobRow(jobId)).status).toBe("queued");
  });

  it("reports done → the job is done with delivered_at; failed → failed with attempts++ and last_error", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const doneJob = await enqueue(printerId, new Uint8Array([1]));
    const failJob = await enqueue(printerId, new Uint8Array([2]));
    await send(app, "POST", "/print-api/agent/jobs", { bearer: token });

    const doneRes = await send(app, "POST", `/print-api/agent/jobs/${doneJob}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(doneRes.status).toBe(204);
    const done = await jobRow(doneJob);
    expect(done.status).toBe("done");
    expect(done.delivered_at).not.toBeNull();

    const failRes = await send(app, "POST", `/print-api/agent/jobs/${failJob}/result`, {
      bearer: token,
      body: { status: "failed", error: "printer offline" },
    });
    expect(failRes.status).toBe(204);
    const failed = await jobRow(failJob);
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(1);
    expect(failed.last_error).toBe("printer offline");
  });

  it("reports failed with NO error field → 204 (last_error defaults to empty)", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const jobId = await enqueue(printerId, new Uint8Array([1]));
    await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    const res = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "failed" },
    });
    expect(res.status).toBe(204);
    const row = await jobRow(jobId);
    expect(row.status).toBe("failed");
    expect(row.last_error).toBe("");
  });

  it("a report for another agent's job is an idempotent no-op (204, the job is NOT mutated)", async () => {
    // The other agent claims the job first, so only the `claimed_by` predicate, not the
    // `status = 'printing'` one, can stop this report.
    const app = mountApp();
    const mine = await joinAndAccept(app, "Mine");
    const other = await joinAndAccept(app, "Other");
    const otherPrinter = await createPrinterVia(app, other.agentId, "Other printer");
    const jobId = await enqueue(otherPrinter, new Uint8Array([1]));
    await send(app, "POST", "/print-api/agent/jobs", { bearer: other.token });

    const res = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: mine.token,
      body: { status: "done" },
    });
    expect(res.status).toBe(204);
    expect((await jobRow(jobId)).status).toBe("printing");
  });

  it("a duplicated failed report is idempotent — attempts is bumped ONCE (the status='printing' guard)", async () => {
    // A retried report must not burn the attempt cap faster than deliveries warrant.
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const jobId = await enqueue(printerId, new Uint8Array([1]));
    await send(app, "POST", "/print-api/agent/jobs", { bearer: token });

    const first = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "failed", error: "offline" },
    });
    expect(first.status).toBe(204);
    const second = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "failed", error: "offline again" },
    });
    expect(second.status).toBe(204);
    const row = await jobRow(jobId);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("offline");
  });

  it("report screens the status (a bad/absent status → 400) and the job id shape (non-uuid → 400)", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const goodId = randomUUID();
    const badStatus = await send(app, "POST", `/print-api/agent/jobs/${goodId}/result`, {
      bearer: token,
      body: { status: "printing" },
    });
    expect(badStatus.status).toBe(400);
    expect(
      (await badStatus.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "status" } } });

    const badId = await send(app, "POST", "/print-api/agent/jobs/not-a-uuid/result", {
      bearer: token,
      body: { status: "done" },
    });
    expect(badId.status).toBe(400);
    expect((await badId.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "shared.invalid_id" },
    });
  });

  it("a report for an unknown (well-formed) job id is an idempotent 204", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    await createPrinterVia(app, agentId);
    const res = await send(app, "POST", `/print-api/agent/jobs/${randomUUID()}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(res.status).toBe(204);
  });

  it("the agent routes refuse a missing / malformed Bearer with 401 agent.unauthorized", async () => {
    const app = mountApp();
    const noAuth = await send(app, "POST", "/print-api/agent/jobs");
    expect(noAuth.status).toBe(401);
    expect((await noAuth.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "agent.unauthorized" },
    });
    const garbage = await send(app, "POST", "/print-api/agent/jobs", { bearer: "not.a.token" });
    expect(garbage.status).toBe(401);
    const badSecret = await send(app, "POST", `/print-api/agent/jobs/${randomUUID()}/result`, {
      bearer: `${randomUUID()}.deadbeef`,
      body: { status: "done" },
    });
    expect(badSecret.status).toBe(401);
  });

  it("a REVOKED agent fails the claim AND the report with 401 (instant revocation)", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const jobId = await enqueue(printerId, new Uint8Array([1]));
    expect((await send(app, "POST", "/print-api/agent/jobs", { bearer: token })).status).toBe(200);

    const revoke = await send(app, "POST", `/management-api/print-agents/${agentId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revoke.status).toBe(204);

    const claim = await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    expect(claim.status).toBe(401);
    const report = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(report.status).toBe(401);
  });
});

describe("POST /print-api/agent/jobs — inventory pull + discovery window", () => {
  it("carries the inventory and claims by visible key (usb)", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    // Unique per test: the suite shares one location, and `local_key` is unique per location.
    const serial = `SN-${randomUUID()}`;
    const printerId = await createUsbPrinter(app, serial, "Cocina USB");
    const payload = esc().text("Mesa 4").cut().bytes();
    const jobId = await enqueue(printerId, payload);

    const blind = await pull(app, token, { visible: [], scanned: [] });
    expect(blind.jobs).toHaveLength(0);
    expect((await jobRow(jobId)).status).toBe("queued");

    const seen = await pull(app, token, {
      visible: [{ transport: "usb", localKey: serial }],
      scanned: [],
    });
    expect(seen.jobs).toHaveLength(1);
    expect(seen.jobs[0]).toMatchObject({
      id: jobId,
      printerId,
      transport: "usb",
      localKey: serial,
      host: null,
    });
    expect(Buffer.from(seen.jobs[0]!.payload, "base64").equals(Buffer.from(payload))).toBe(true);
    expect((await jobRow(jobId)).status).toBe("printing");
  });

  it("passes an explicitly requested address to agents even outside their local subnet", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const response = await send(app, "POST", "/management-api/printer-discovery/probe", {
      cookie: managerCookie,
      body: { host: "192.168.20.247", port: 9100 },
    });
    expect(response.status).toBe(200);
    const target = (await response.json()) as { host: string; port: number; expiresAt: number };
    expect(target).toEqual({
      host: "192.168.20.247",
      port: 9100,
      requestedAt: expect.any(Number),
      expiresAt: expect.any(Number),
    });
    const reply = await pull(app, token);
    expect(reply).toMatchObject({
      networkProbes: [{ host: target.host, port: target.port, expiresInMs: expect.any(Number) }],
    });
    const probe = reply.networkProbes?.[0];
    expect(probe?.expiresInMs).toBeGreaterThan(0);
    expect(probe?.expiresInMs).toBeLessThanOrEqual(30_000);
  });

  it("returns discoveryUntil after a discovery window is opened", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    expect((await pull(app, token)).discoveryUntil).toBeNull();

    const start = await send(app, "POST", "/management-api/printer-discovery/start", {
      cookie: managerCookie,
    });
    expect(start.status).toBe(200);
    const { discoveryUntil } = (await start.json()) as { discoveryUntil: number };
    expect(discoveryUntil).toBeGreaterThan(Date.now());

    expect((await pull(app, token)).discoveryUntil).toBe(discoveryUntil);
  });

  it("GET /management-api/discovered-printers lists reported devices, marking registered ones", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app, "Inventory agent");
    const registeredSerial = `SN-${randomUUID()}`;
    const unregisteredSerial = `SN-${randomUUID()}`;
    await pull(app, token, {
      visible: [
        { transport: "usb", localKey: registeredSerial, make: "Epson", model: "TM-T20" },
        { transport: "usb", localKey: unregisteredSerial, make: "Star" },
      ],
      scanned: [],
    });
    const registeredId = await createUsbPrinter(app, registeredSerial, "Registered USB");

    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      agentId: string;
      agentName: string | null;
      transport: string;
      localKey?: string;
      make?: string;
      alreadyRegistered: boolean;
      printerId: string | null;
      lastSeenAt: string;
    }[];
    const one = rows.find((r) => r.localKey === registeredSerial)!;
    const two = rows.find((r) => r.localKey === unregisteredSerial)!;
    expect(one).toMatchObject({
      agentId,
      agentName: "Inventory agent",
      transport: "usb",
      make: "Epson",
      alreadyRegistered: true,
      printerId: registeredId,
    });
    expect(two).toMatchObject({
      agentId,
      agentName: "Inventory agent",
      transport: "usb",
      alreadyRegistered: false,
      printerId: null,
    });
    expect(one.lastSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("GET /management-api/discovered-printers marks a scanned network printer registered by host+port", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app, "Inventory agent");
    const [a, b] = randomUUID().split("-")[0]!.match(/../g)!;
    const host = `10.9.${parseInt(a!, 16) % 250}.${parseInt(b!, 16) % 250}`;
    const printerId = await createNetworkPrinter(app, host, 9100, "Counter");
    const before = Date.now();
    await pull(app, token, {
      visible: [],
      scanned: [
        { transport: "network_tcp", host, port: 9100, name: "Epson" },
        { transport: "network_tcp", host, port: 9101 },
      ],
    });

    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as {
      host?: string;
      port?: number;
      alreadyRegistered: boolean;
      printerId: string | null;
      lastSeenAt: string;
    }[];
    const matched = rows.find((r) => r.host === host && r.port === 9100)!;
    expect(matched).toMatchObject({ alreadyRegistered: true, printerId });
    expect(Date.parse(matched.lastSeenAt)).toBeGreaterThanOrEqual(before);
    expect(rows.find((r) => r.host === host && r.port === 9101)).toMatchObject({
      alreadyRegistered: false,
      printerId: null,
    });
  });

  it("GET /management-api/discovered-printers matches a registered printer whose port is null on 9100", async () => {
    // Otherwise a working printer with a cleared port reappears as unregistered.
    const app = mountApp();
    const { token } = await joinAndAccept(app, "Inventory agent");
    const host = "10.9.250.1";
    const printerId = await createNetworkPrinter(app, host, 9100, "Counter");
    const cleared = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: { port: null },
    });
    expect(cleared.status).toBe(204);
    await pull(app, token, {
      visible: [],
      scanned: [{ transport: "network_tcp", host, port: 9100 }],
    });
    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { host?: string; printerId: string | null }[];
    expect(rows.find((r) => r.host === host)).toMatchObject({ printerId });
  });

  it("GET /management-api/discovered-printers marks a scanned office printer only when the agent sent exactly true", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app, "Inventory agent");
    const host = "10.9.251.1";
    await pull(app, token, {
      visible: [],
      scanned: [
        { transport: "network_tcp", host, port: 631, pagePrinter: true },
        { transport: "network_tcp", host, port: 632, pagePrinter: false },
        { transport: "network_tcp", host, port: 633, pagePrinter: "true" },
        { transport: "network_tcp", host, port: 634, pagePrinter: 1 },
        { transport: "network_tcp", host, port: 9100 },
      ],
    });
    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    const byPort = new Map(rows.map((r) => [r.port, r]));
    expect(byPort.get(631)).toMatchObject({ pagePrinter: true });
    for (const port of [632, 633, 634, 9100]) {
      expect(byPort.get(port)).toBeDefined();
      expect(byPort.get(port)).not.toHaveProperty("pagePrinter");
    }
  });

  it("GET /management-api/discovered-printers marks every agent's entry for an address one agent saw as an office printer", async () => {
    const app = mountApp();
    const first = await joinAndAccept(app, "Kitchen agent");
    const second = await joinAndAccept(app, "Bar agent");
    const host = "10.9.252.1";
    await pull(app, first.token, {
      visible: [],
      scanned: [
        { transport: "network_tcp", host, port: 9100, pagePrinter: true },
        { transport: "network_tcp", host: "10.9.252.2", port: 9100 },
      ],
    });
    await pull(app, second.token, {
      visible: [],
      scanned: [
        { transport: "network_tcp", host, port: 9100 },
        { transport: "network_tcp", host, port: 9101 },
        { transport: "network_tcp", host: "10.9.252.2", port: 9100 },
      ],
    });
    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    const at = (agentId: string, h: string, port: number) =>
      rows.find((r) => r.agentId === agentId && r.host === h && r.port === port);
    expect(at(first.agentId, host, 9100)).toMatchObject({ pagePrinter: true });
    // Marked although the second agent reported no mark of its own.
    expect(at(second.agentId, host, 9100)).toMatchObject({ pagePrinter: true });
    expect(at(second.agentId, host, 9101)).not.toHaveProperty("pagePrinter");
    expect(at(first.agentId, "10.9.252.2", 9100)).not.toHaveProperty("pagePrinter");
    expect(at(second.agentId, "10.9.252.2", 9100)).not.toHaveProperty("pagePrinter");
  });

  it("POST /management-api/printers with a duplicate local_key → 409 printer.already_registered", async () => {
    const app = mountApp();
    await joinAndAccept(app);
    const serial = `SN-DUP-${randomUUID()}`;
    await createUsbPrinter(app, serial, "First");
    const dup = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Second", transport: "usb", localKey: serial },
    });
    expect(dup.status).toBe(409);
    expect(
      (await dup.json()) as { error: { code: string; params: { localKey: string } } },
    ).toMatchObject({
      error: { code: "printer.already_registered", params: { localKey: serial } },
    });
  });

  it("create requires localKey for usb (422) and ignores agentId/usbPath", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const missing = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bad usb", transport: "usb", agentId, usbPath: "/dev/usb/lp0" },
    });
    expect(missing.status).toBe(422);
    expect((await missing.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "printer.invalid_config" },
    });
    const ok = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Good usb",
        transport: "usb",
        localKey: `SN-OK-${randomUUID()}`,
        agentId,
        usbPath: "/dev/usb/lp0",
      },
    });
    expect(ok.status).toBe(201);
  });
});

describe("mountPrintApi — management: agents", () => {
  it("stores reported setup metadata, preserves omitted values and clears an explicit null URL", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    for (const body of [{ setupUrl: "http://192.168.10.40:9310/", setupPort: 9210 }, {}]) {
      expect(
        (await send(app, "POST", "/print-api/agent/jobs", { bearer: token, body })).status,
      ).toBe(200);
      const rows = await (
        await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie })
      ).json();
      expect(rows).toContainEqual(
        expect.objectContaining({ id: agentId, setupUrl: "http://192.168.10.40:9310" }),
      );
      expect(
        await suite.db
          .select({ port: printAgents.setupPort })
          .from(printAgents)
          .where(eq(printAgents.id, agentId)),
      ).toEqual([{ port: 9210 }]);
    }
    expect(
      (
        await send(app, "POST", "/print-api/agent/jobs", {
          bearer: token,
          body: { setupUrl: null },
        })
      ).status,
    ).toBe(200);
    const rows = await (
      await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie })
    ).json();
    expect(rows).toContainEqual(expect.objectContaining({ id: agentId, setupUrl: null }));
  });

  it("uses this node's advertised LAN address only for its own agent and actual listener port", async () => {
    const app = mountApp({ listIpv4: () => ["192.168.10.40", "10.0.0.40"] });
    const { agentId, token } = await joinAndAccept(app);
    expect(
      (
        await send(app, "POST", "/print-api/agent/jobs", {
          bearer: token,
          body: { setupUrl: null, setupPort: 9210 },
        })
      ).status,
    ).toBe(200);
    try {
      for (const [nodeId, expected] of [
        [null, null],
        [randomUUID(), null],
        [cfg.nodeId, "http://192.168.10.40:9210"],
      ] as const) {
        await suite.db.update(printAgents).set({ nodeId }).where(eq(printAgents.id, agentId));
        const rows = await (
          await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie })
        ).json();
        expect(rows).toContainEqual(expect.objectContaining({ id: agentId, setupUrl: expected }));
      }
      expect(
        (
          await send(app, "POST", "/print-api/agent/jobs", {
            bearer: token,
            body: { setupUrl: "https://agent.example.test" },
          })
        ).status,
      ).toBe(200);
      const explicit = await (
        await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie })
      ).json();
      expect(explicit).toContainEqual(
        expect.objectContaining({ id: agentId, setupUrl: "https://agent.example.test" }),
      );
      expect(
        (
          await send(app, "POST", "/print-api/agent/jobs", {
            bearer: token,
            body: { setupUrl: null },
          })
        ).status,
      ).toBe(200);
      for (const other of [mountApp(), mountApp({ listIpv4: () => [] })]) {
        const rows = await (
          await send(other, "GET", "/management-api/print-agents", { cookie: managerCookie })
        ).json();
        expect(rows).toContainEqual(expect.objectContaining({ id: agentId, setupUrl: null }));
      }
      await suite.db
        .update(printAgents)
        .set({ setupPort: null })
        .where(eq(printAgents.id, agentId));
      const rows = await (
        await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie })
      ).json();
      expect(rows).toContainEqual(expect.objectContaining({ id: agentId, setupUrl: null }));
    } finally {
      await suite.db.update(printAgents).set({ nodeId: null }).where(eq(printAgents.id, agentId));
    }
  });

  it("refuses malformed setup metadata before changing the authenticated agent", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    for (const [field, values] of [
      [
        "setupUrl",
        [
          42,
          "",
          "not a URL",
          "javascript:alert(1)",
          "http://user:secret@agent.test",
          "http://:secret@agent.test",
          "http://agent.test/path",
          "http://agent.test/?q=x",
          "http://agent.test/#fragment",
          "http://localhost:9110",
          "http://127.2.3.4:9110",
          "http://[::1]:9110",
          "http://[::]:9110",
          "http://0.0.0.0:9110",
        ],
      ],
      ["setupPort", [null, "9110", 0, -1, 65536, 9110.5]],
    ] as const) {
      for (const value of values) {
        const response = await send(app, "POST", "/print-api/agent/jobs", {
          bearer: token,
          body: { [field]: value },
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: "management.request_invalid", params: { field } },
        });
      }
    }
    expect(
      await suite.db
        .select({ setupUrl: printAgents.setupUrl, setupPort: printAgents.setupPort })
        .from(printAgents)
        .where(eq(printAgents.id, agentId)),
    ).toEqual([{ setupUrl: null, setupPort: null }]);
  });

  it("does not rewrite unchanged setup metadata on each poll", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const body = { setupUrl: "https://agent.test", setupPort: 9110 };
    expect((await send(app, "POST", "/print-api/agent/jobs", { bearer: token, body })).status).toBe(
      200,
    );
    await suite.db
      .execute(sql`create trigger reject_unchanged_agent_setup before update of setup_url, setup_port on print_agents
      when old.setup_url is new.setup_url and old.setup_port is new.setup_port
      begin select raise(abort, 'unchanged setup metadata'); end`);
    try {
      expect(
        (await send(app, "POST", "/print-api/agent/jobs", { bearer: token, body })).status,
      ).toBe(200);
    } finally {
      await suite.db.execute(sql`drop trigger reject_unchanged_agent_setup`);
    }
  });

  it("persists the authenticated agent hostname and edits only its display name", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app, "Original");
    const response = await send(app, "POST", "/print-api/agent/jobs", {
      bearer: token,
      body: { visible: [], scanned: [], host: "kitchen-box.local" },
    });
    expect(response.status).toBe(200);
    const edited = await send(app, "PATCH", `/management-api/print-agents/${agentId}`, {
      cookie: managerCookie,
      body: { name: "Kitchen" },
    });
    expect(edited.status).toBe(204);
    const listed = await send(app, "GET", "/management-api/print-agents", {
      cookie: managerCookie,
    });
    expect(await listed.json()).toContainEqual(
      expect.objectContaining({
        id: agentId,
        name: "Kitchen",
        host: "kitchen-box.local",
      }),
    );
    await pull(app, token);
    const again = await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie });
    expect(await again.json()).toContainEqual(
      expect.objectContaining({ id: agentId, host: "kitchen-box.local" }),
    );
  });

  it("normalizes reported hostnames and treats blank reports as not reported", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    for (const [host, expected] of [
      [" kitchen-box.local ", "kitchen-box.local"],
      ["   ", null],
      ["", null],
    ] as const) {
      const response = await send(app, "POST", "/print-api/agent/jobs", {
        bearer: token,
        body: { host },
      });
      expect(response.status).toBe(200);
      const listed = await send(app, "GET", "/management-api/print-agents", {
        cookie: managerCookie,
      });
      expect(await listed.json()).toContainEqual(
        expect.objectContaining({ id: agentId, host: expected }),
      );
    }
  });

  it("rejects unknown agents and invalid names when editing", async () => {
    const app = mountApp();
    const unknown = await send(app, "PATCH", `/management-api/print-agents/${randomUUID()}`, {
      cookie: managerCookie,
      body: { name: "Kitchen" },
    });
    expect(unknown.status).toBe(404);
    const { agentId } = await joinAndAccept(app);
    for (const name of ["", 42, null]) {
      const response = await send(app, "PATCH", `/management-api/print-agents/${agentId}`, {
        cookie: managerCookie,
        body: { name },
      });
      expect(response.status).toBe(400);
    }
  });

  it("lists this tenant's agents (newest first) without the token hash", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app, "Listed agent");
    const res = await send(app, "GET", "/management-api/print-agents", { cookie: managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Record<string, unknown>[];
    const mine = rows.find((r) => r.id === agentId)!;
    expect(mine).toMatchObject({ name: "Listed agent", active: true });
    expect(mine).not.toHaveProperty("tokenHash");
    expect(mine).not.toHaveProperty("token_hash");
  });

  it("revoke of an unknown / malformed agent id → 404 / 400", async () => {
    const app = mountApp();
    const unknown = randomUUID();
    const res = await send(app, "POST", `/management-api/print-agents/${unknown}/revoke`, {
      cookie: managerCookie,
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string; params: { id: string } } }).toMatchObject(
      { error: { code: "agent.not_found", params: { id: unknown } } },
    );

    const malformed = await send(app, "POST", "/management-api/print-agents/not-a-uuid/revoke", {
      cookie: managerCookie,
    });
    expect(malformed.status).toBe(400);
  });
});

describe("mountPrintApi — management: printers CRUD", () => {
  it("creates, lists, updates and deactivates a printer", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId, "Cocina");

    const list = await send(app, "GET", "/management-api/printers", { cookie: managerCookie });
    expect(list.status).toBe(200);
    const rows = (await list.json()) as {
      id: string;
      name: string;
      active: boolean;
      host: string;
    }[];
    const mine = rows.find((r) => r.id === printerId)!;
    expect(mine).toMatchObject({ name: "Cocina", host: "10.0.0.9", active: true });

    const patch = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: { name: "Cocina 2", host: "10.0.0.20", ticketScope: "order" },
    });
    expect(patch.status).toBe(204);
    const afterPatch = await send(app, "GET", "/management-api/printers", {
      cookie: managerCookie,
    });
    const patched = (
      (await afterPatch.json()) as {
        id: string;
        name: string;
        host: string;
        ticketScope: string;
      }[]
    ).find((r) => r.id === printerId)!;
    expect(patched).toMatchObject({ name: "Cocina 2", host: "10.0.0.20", ticketScope: "order" });

    const deactivate = await send(app, "POST", `/management-api/printers/${printerId}/deactivate`, {
      cookie: managerCookie,
    });
    expect(deactivate.status).toBe(204);
    const afterDeactivate = await send(app, "GET", "/management-api/printers", {
      cookie: managerCookie,
    });
    const off = ((await afterDeactivate.json()) as { id: string; active: boolean }[]).find(
      (r) => r.id === printerId,
    )!;
    expect(off.active).toBe(false);
  });

  it("creates each transport's shape (usb keyed on local_key, cloud_poll with poll_id, tcp with explicit port)", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const usb = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "USB", transport: "usb", localKey: `SN-${randomUUID()}` },
    });
    expect(usb.status).toBe(201);
    const cloud = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Nube", transport: "cloud_poll", pollId: "poll-1" },
    });
    expect(cloud.status).toBe(201);
    const tcp = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "TCP", transport: "network_tcp", agentId, host: "10.0.0.5", port: 9200 },
    });
    expect(tcp.status).toBe(201);
    const rows = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { name: string; port: number | null }[];
    expect(rows.find((r) => r.name === "TCP")!.port).toBe(9200);
  });

  it("update writes every editable field and clears nullable ones with explicit null", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId, "Full patch");
    const res = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: {
        transport: "network_tcp",
        port: 9300,
        localKey: null,
        pollId: null,
        ticketScope: "order",
        active: true,
      },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string; port: number; ticketScope: string; localKey: string | null }[];
    const row = rows.find((r) => r.id === printerId)!;
    expect(row).toMatchObject({ port: 9300, ticketScope: "order", localKey: null });
  });

  it("update rejects a non-boolean active → 400", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const res = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: { active: "yes" },
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "active" } } });
  });

  it("null / empty bodies on the management write routes degrade to a clean 400 / no-op, never a 500", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    expect(
      (await send(app, "POST", "/management-api/printers", { cookie: managerCookie, body: null }))
        .status,
    ).toBe(400);
    const patch = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: null,
    });
    expect(patch.status).toBe(204);
    const emptyCreate = await app.request("/management-api/printers", {
      method: "POST",
      headers: { cookie: managerCookie },
    });
    expect(emptyCreate.status).toBe(400);
  });

  it("create with a transport short of its required fields → 422 printer.invalid_config", async () => {
    const app = mountApp();
    await joinAndAccept(app);
    const res = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bad usb", transport: "usb" },
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "printer.invalid_config" },
    });
  });

  it("create screens the body (missing name → 400; bad transport → 400; non-integer port → 400)", async () => {
    const app = mountApp();
    const noName = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { transport: "network_tcp", host: "10.0.0.1" },
    });
    expect(noName.status).toBe(400);
    expect(
      (await noName.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "name" } } });

    const badTransport = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "X", transport: "carrier_pigeon" },
    });
    expect(badTransport.status).toBe(400);
    expect(
      (await badTransport.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "transport" } },
    });

    const badPort = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "X",
        transport: "network_tcp",
        host: "10.0.0.1",
        port: "high",
      },
    });
    expect(badPort.status).toBe(400);
    expect(
      (await badPort.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "port" } } });
  });

  it("update of an unknown printer → 404; a non-uuid id → 400", async () => {
    const app = mountApp();
    const unknown = randomUUID();
    const res = await send(app, "PATCH", `/management-api/printers/${unknown}`, {
      cookie: managerCookie,
      body: { name: "X" },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "printer.not_found" },
    });
    const malformed = await send(app, "PATCH", "/management-api/printers/not-a-uuid", {
      cookie: managerCookie,
      body: { name: "X" },
    });
    expect(malformed.status).toBe(400);
  });

  it("update re-keys a usb printer's local_key", async () => {
    const app = mountApp();
    await joinAndAccept(app);
    const firstSerial = `SN-${randomUUID()}`;
    const secondSerial = `SN-${randomUUID()}`;
    const printerId = await createUsbPrinter(app, firstSerial, "Movable USB");
    const res = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: { localKey: secondSerial },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string; localKey: string }[];
    expect(rows.find((r) => r.id === printerId)).toMatchObject({ localKey: secondSerial });
  });

  it("stores, lists and patches the three layout settings, and rejects an unknown value", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Estrecha",
        transport: "network_tcp",
        host: "10.0.0.31",
        paperWidth: "58mm",
        characterSet: "pc858",
        characterTable: 19,
      },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const defaulted = await createNetworkPrinter(app, "10.0.0.32", 9100, "Por defecto");
    const patched = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { resolution: "203dpi", characterTable: 6 },
    });
    expect(patched.status).toBe(204);
    const listed = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as {
      id: string;
      paperWidth: string;
      resolution: string;
      characterSet: string;
      characterTable: number;
    }[];
    expect(listed.find((p) => p.id === id)).toMatchObject({
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
      characterTable: 6,
    });
    expect(listed.find((p) => p.id === defaulted)).toMatchObject({
      paperWidth: "80mm",
      resolution: "180dpi",
      characterSet: "wpc1252",
      characterTable: 16,
    });
    for (const [method, path, body, field] of [
      [
        "POST",
        "/management-api/printers",
        { name: "Mala", transport: "network_tcp", host: "10.0.0.33", paperWidth: "70mm" },
        "paperWidth",
      ],
      ["PATCH", `/management-api/printers/${id}`, { resolution: "300dpi" }, "resolution"],
      ["PATCH", `/management-api/printers/${id}`, { characterSet: "cp437" }, "characterSet"],
      ["PATCH", `/management-api/printers/${id}`, { characterTable: 256 }, "characterTable"],
      ["PATCH", `/management-api/printers/${id}`, { characterTable: 1.5 }, "characterTable"],
    ] as const) {
      const res = await send(app, method, path, { cookie: managerCookie, body });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });
});

describe("printer cash-drawer calibration", () => {
  it("retains the last delivering agent when a restarted API has no discovery results", async () => {
    const app = mountApp();
    const first = await joinAndAccept(app, "First delivery agent");
    const last = await joinAndAccept(app, "Last delivery agent");
    const id = await createNetworkPrinter(app, "10.0.0.85", 9100, "Delivery history");
    await suite.db.insert(printJobs).values([
      {
        locationId,
        printerId: id,
        payload: new Uint8Array([1]),
        status: "done",
        claimedBy: first.agentId,
        deliveredAt: "2026-09-26T10:00:00.000Z",
      },
      {
        locationId,
        printerId: id,
        payload: new Uint8Array([2]),
        status: "done",
        claimedBy: last.agentId,
        deliveredAt: "2026-09-26T11:00:00.000Z",
      },
      {
        locationId,
        printerId: id,
        payload: new Uint8Array([3]),
        status: "failed",
        claimedBy: first.agentId,
      },
    ]);
    const restarted = mountApp();
    const rows = (await (
      await send(restarted, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as Record<string, unknown>[];
    expect(rows.find((row) => row.id === id)).toMatchObject({
      lastPrintAgentId: last.agentId,
      lastPrintAt: "2026-09-26T11:00:00.000Z",
    });
  });
  it("stores attachment on the printer and refuses non-boolean choices", async () => {
    const app = mountApp();
    const id = await createNetworkPrinter(app, "10.0.0.81", 9100, "Drawer calibration");
    const read = async () => {
      const response = await send(app, "GET", "/management-api/printers", {
        cookie: managerCookie,
      });
      return ((await response.json()) as { id: string; hasCashDrawer: boolean }[]).find(
        (row) => row.id === id,
      );
    };
    expect(await read()).toMatchObject({ hasCashDrawer: false });
    expect(
      (
        await send(app, "PATCH", `/management-api/printers/${id}`, {
          cookie: managerCookie,
          body: { hasCashDrawer: true },
        })
      ).status,
    ).toBe(204);
    expect(await read()).toMatchObject({ hasCashDrawer: true });
    for (const value of [null, "yes", 1, []]) {
      const response = await send(app, "PATCH", `/management-api/printers/${id}`, {
        cookie: managerCookie,
        body: { hasCashDrawer: value },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "hasCashDrawer" } },
      });
    }
    expect(await read()).toMatchObject({ hasCashDrawer: true });
  });

  it("audits a manager's test against an unassigned printer and queues only a non-resendable drawer pulse", async () => {
    const app = mountApp();
    const id = await createNetworkPrinter(app, "10.0.0.82", 9100, "Unassigned drawer");
    const response = await send(app, "POST", `/management-api/printers/${id}/test-drawer`, {
      cookie: managerCookie,
    });
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    const [job] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
    expect(job).toMatchObject({ printerId: id, kind: "drawer", status: "queued" });
    expect([...job!.payload]).toEqual([0x1b, 0x70, 0, 25, 250]);
    const audit = await suite.db.execute<{
      person_id: string;
      till_id: string | null;
      reason: string;
    }>(sql`
      select person_id, till_id, reason from drawer_opens where printer_id = ${id}`);
    const [manager] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.displayName, "The Manager"));
    expect(audit.rows).toEqual([{ person_id: manager!.id, till_id: null, reason: "calibration" }]);
    await suite.db.update(printJobs).set({ status: "done" }).where(eq(printJobs.id, jobId));
    const resend = await send(app, "POST", `/management-api/print-jobs/${jobId}/resend`, {
      cookie: managerCookie,
    });
    expect(resend.status).toBe(409);
    expect(await resend.json()).toMatchObject({ error: { code: "print_job.not_resendable" } });
  });

  it("refuses unauthenticated, unpermitted, missing and inactive printer tests without queuing a pulse", async () => {
    const app = mountApp();
    const id = await createNetworkPrinter(app, "10.0.0.83", 9100, "Disabled drawer");
    for (const [cookie, status, code] of [
      [undefined, 401, "management_session.required"],
      [staffCookie, 403, "authorization.not_permitted"],
    ] as const) {
      const response = await send(app, "POST", `/management-api/printers/${id}/test-drawer`, {
        cookie,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { active: false },
    });
    for (const printerId of [id, randomUUID()]) {
      const response = await send(
        app,
        "POST",
        `/management-api/printers/${printerId}/test-drawer`,
        { cookie: managerCookie },
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "printer.not_found" } });
    }
    expect(await suite.db.select().from(printJobs).where(eq(printJobs.printerId, id))).toEqual([]);
  });
});

describe("mountPrintApi — management: test-print", () => {
  it.each([
    { personLocale: "en-GB", browserLocale: "es", venueLocale: "es-ES", expected: "en-GB" },
    { personLocale: "es-ES", browserLocale: "en", venueLocale: "en-GB", expected: "es-ES" },
    {
      personLocale: null,
      browserLocale: "en-US,en;q=0.9",
      venueLocale: "es-ES",
      expected: "en-GB",
    },
    {
      personLocale: null,
      browserLocale: "es-MX,es;q=0.9",
      venueLocale: "en-GB",
      expected: "es-ES",
    },
  ] as const)(
    "prints instructions in the user's language: $expected ($personLocale / $browserLocale)",
    async ({ personLocale, browserLocale, venueLocale, expected }) => {
      const app = mountApp({ venueLocale });
      const printerId = await createNetworkPrinter(app, "10.0.0.42", 9100, "Language test");
      const token = managerCookie.split("=")[1]!;
      const setLocale = (locale: string | null) =>
        suite.db.execute(sql`
      update persons set locale = ${locale}
      where id = (
        select person_id from management_sessions where token_hash = ${hashSessionToken(token)}
      )`);
      await setLocale(personLocale);
      try {
        const res = await app.request(`/management-api/printers/${printerId}/test-print`, {
          method: "POST",
          headers: { cookie: managerCookie, "accept-language": browserLocale },
        });
        expect(res.status).toBe(202);
        const body = (await res.json()) as { jobId: string };
        const { jobId } = body;
        expect(body).toEqual({ jobId });
        const [job] = await suite.db
          .select({ payload: printJobs.payload })
          .from(printJobs)
          .where(eq(printJobs.id, jobId));
        expect([...new Uint8Array(job!.payload)]).toEqual([
          ...formatTestPage({ locale: expected }),
        ]);
      } finally {
        await setLocale(null);
      }
    },
  );

  it("enqueues a known test payload for the printer and returns { jobId } (202)", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const res = await send(app, "POST", `/management-api/printers/${printerId}/test-print`, {
      cookie: managerCookie,
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    const row = await jobRow(jobId);
    expect(row.status).toBe("queued");
    const jobs = (await (
      await send(app, "GET", "/management-api/print-jobs", { cookie: managerCookie })
    ).json()) as { id: string; printerId: string }[];
    expect(jobs.find((j) => j.id === jobId)?.printerId).toBe(printerId);
  });

  it("prints a sample receipt with the unsaved layout and character-table settings", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.43", 9100, "Sample receipt");
    const settings = {
      paperWidth: "58mm" as const,
      resolution: "203dpi" as const,
      characterSet: "wpc1252" as const,
      characterTable: 6,
    };
    const res = await send(app, "POST", `/management-api/printers/${printerId}/sample-receipt`, {
      cookie: managerCookie,
      body: settings,
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const [job] = await suite.db
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.id, jobId));
    expect([...new Uint8Array(job!.payload)]).toEqual([...formatSampleReceipt(settings)]);
  });

  it("rejects an invalid sample-receipt character table", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.44", 9100, "Bad sample");
    const res = await send(app, "POST", `/management-api/printers/${printerId}/sample-receipt`, {
      cookie: managerCookie,
      body: {
        paperWidth: "80mm",
        resolution: "180dpi",
        characterSet: "wpc1252",
        characterTable: 256,
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "characterTable" } },
    });
  });

  it("prints a sixteen-number character-table finder from the requested starting table", async () => {
    const app = mountApp({ venueLocale: "en-GB" });
    const printerId = await createNetworkPrinter(app, "10.0.0.45", 9100, "Table finder");
    const res = await app.request(`/management-api/printers/${printerId}/character-table-test`, {
      method: "POST",
      headers: {
        cookie: managerCookie,
        "content-type": "application/json",
        "accept-language": "es-ES",
      },
      body: JSON.stringify({ startTable: 5 }),
    });
    expect(res.status).toBe(202);
    const { jobId, calibrationLocale } = (await res.json()) as {
      jobId: string;
      calibrationLocale: SupportedLocale;
    };
    expect(calibrationLocale).toBe("en-GB");
    const [job] = await suite.db
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.id, jobId));
    expect([...new Uint8Array(job!.payload)]).toEqual([
      ...formatCharacterTableTest({
        startTable: 5,
        locale: "es-ES",
        calibrationLocale: "en-GB",
      }),
    ]);
  });

  it("test-print for an unknown printer id → 404 printer.not_found; a non-uuid id → 400", async () => {
    const app = mountApp();
    const unknown = randomUUID();
    const res = await send(app, "POST", `/management-api/printers/${unknown}/test-print`, {
      cookie: managerCookie,
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "printer.not_found" },
    });
    const malformed = await send(app, "POST", "/management-api/printers/not-a-uuid/test-print", {
      cookie: managerCookie,
    });
    expect(malformed.status).toBe(400);
  });

  it.each(["es-ES", "en-GB"] as const)(
    "falls back to the venue language when user and browser have no preference (%s)",
    async (venueLocale) => {
      const app = mountApp({ venueLocale });
      const printerId = await createNetworkPrinter(app, "10.0.0.41", 9100, `Prueba ${venueLocale}`);
      const res = await send(app, "POST", `/management-api/printers/${printerId}/test-print`, {
        cookie: managerCookie,
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: string };
      const [job] = await suite.db
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.id, jobId));
      expect([...new Uint8Array(job!.payload)]).toEqual([
        ...formatTestPage({ locale: venueLocale }),
      ]);
    },
  );
});

describe("mountPrintApi — management: recent jobs", () => {
  it("returns a job preview only to printer managers", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused");
    const jobId = await enqueue(
      printerId,
      esc().init().line("Receipt <safe>").feedAndCut().bytes(),
    );
    const path = `/management-api/print-jobs/${jobId}/preview`;
    const preview = await send(app, "GET", path, { cookie: managerCookie });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ text: "Receipt <safe>\n", qrData: [] });
    expect((await send(app, "GET", path)).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
    expect(
      (
        await send(app, "GET", `/management-api/print-jobs/${randomUUID()}/preview`, {
          cookie: managerCookie,
        })
      ).status,
    ).toBe(404);
  });

  it("previews a job at its printer's current columns and resolution, through its character table", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Vista 58",
        transport: "network_tcp",
        host: "10.0.0.42",
        paperWidth: "58mm",
        resolution: "203dpi",
        characterSet: "wpc1252",
        characterTable: 7,
      },
    });
    const { id: narrow } = (await created.json()) as { id: string };
    const narrowJob = await enqueue(narrow, esc("wpc1252", 7).init().line("Café 12,50 €").bytes());
    const narrowPreview = await send(
      app,
      "GET",
      `/management-api/print-jobs/${narrowJob}/preview`,
      {
        cookie: managerCookie,
      },
    );
    expect(narrowPreview.status).toBe(200);
    expect(await narrowPreview.json()).toMatchObject({
      columns: 30,
      dpi: 203,
      text: "Café 12,50 €\n",
      unsupported: false,
      truncated: false,
    });
    const wide = await createNetworkPrinter(app, "10.0.0.43", 9100, "Vista 80");
    const wideJob = await enqueue(wide, esc().init().line("x").bytes());
    const widePreview = await send(app, "GET", `/management-api/print-jobs/${wideJob}/preview`, {
      cookie: managerCookie,
    });
    expect(await widePreview.json()).toMatchObject({ columns: 42, dpi: 180 });
  });

  it("answers print_job.not_found when previewing an unknown print job id", async () => {
    const app = mountApp();
    const preview = await send(app, "GET", `/management-api/print-jobs/${randomUUID()}/preview`, {
      cookie: managerCookie,
    });
    expect(preview.status).toBe(404);
    expect(await preview.json()).toMatchObject({ error: { code: "print_job.not_found" } });
  });

  it("returns an ISO last-print timestamp regardless of database date display settings", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused", "Timestamp printer");
    // A stored value with a +02:00 offset must still answer the canonical UTC ISO spelling.
    await suite.db.insert(printJobs).values({
      locationId,
      printerId,
      payload: new Uint8Array([0x01]),
      status: "done",
      deliveredAt: "2020-01-02T03:04:05.678+02:00",
    });
    const result = await send(app, "GET", "/management-api/printers", { cookie: managerCookie });
    expect(result.status).toBe(200);
    const rows = (await result.json()) as { id: string; lastPrintAt: string | null }[];
    expect(rows.find((row) => row.id === printerId)?.lastPrintAt).toBe("2020-01-02T01:04:05.678Z");
  });

  it("summarises all printer jobs", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused", "Summary printer");
    const emptyId = await createPrinterVia(app, "unused", "Empty printer");
    const payload = new Uint8Array([0x01]);
    await suite.db
      .insert(printJobs)
      .values(Array.from({ length: 101 }, () => ({ locationId, printerId, payload })));
    const stamped = nowIso();
    await suite.db.insert(printJobs).values([
      {
        locationId,
        printerId,
        payload,
        status: "done",
        attempts: 0,
        createdAt: "2020-01-01T00:00:00.000Z",
        deliveredAt: "2020-01-02T00:00:00.000Z",
      },
      { locationId, printerId, payload, status: "failed", attempts: 4, createdAt: stamped },
      { locationId, printerId, payload, status: "failed", attempts: 5, createdAt: stamped },
      { locationId, printerId, payload, status: "printing", attempts: 0, createdAt: stamped },
    ]);
    const result = await send(app, "GET", "/management-api/printers", { cookie: managerCookie });
    const printers = (await result.json()) as {
      id: string;
      pendingJobs: number;
      lastPrintAt: string | null;
    }[];
    expect(printers.find((p) => p.id === printerId)).toMatchObject({ pendingJobs: 103 });
    expect(printers.find((p) => p.id === printerId)!.lastPrintAt).toBe("2020-01-02T00:00:00.000Z");
    expect(printers.find((p) => p.id === emptyId)).toMatchObject({
      pendingJobs: 0,
      lastPrintAt: null,
    });
    const jobsResult = await send(app, "GET", "/management-api/print-jobs", {
      cookie: managerCookie,
    });
    const jobs = (await jobsResult.json()) as { id: string; printerId: string }[];
    expect(jobs.filter((job) => job.printerId === printerId)).toHaveLength(105);
  });

  it("keeps every unfinished job alongside the last 100 completed jobs by delivery time", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused");
    try {
      const before = await send(app, "GET", "/management-api/print-jobs", {
        cookie: managerCookie,
      });
      const existing = (await before.json()) as { id: string; status: string }[];
      const existingPending = existing.filter((job) => job.status !== "done");
      // Each timestamp binds as the canonical `toISOString()` spelling, which is what makes a text
      // column's comparison a time ordering.
      const payload = new Uint8Array([0x01]);
      const pending = await suite.db
        .insert(printJobs)
        .values(
          (
            [
              ["queued", 0],
              ["printing", 0],
              ["failed", 4],
              ["failed", 5],
            ] as const
          ).map(([status, attempts]) => ({
            locationId,
            printerId,
            payload,
            status,
            attempts,
            createdAt: "2020-01-01T00:00:00.000Z",
          })),
        )
        .returning({ id: printJobs.id });
      const second = 1_000;
      const completed = await suite.db
        .insert(printJobs)
        .values(
          Array.from({ length: 101 }, (_, i) => {
            const n = i + 1;
            return {
              locationId,
              printerId,
              payload,
              status: "done" as const,
              createdAt: new Date(Date.parse("2021-01-01T00:00:00Z") - n * second).toISOString(),
              deliveredAt: new Date(Date.parse("2099-01-01T00:00:00Z") + n * second).toISOString(),
            };
          }),
        )
        .returning({ id: printJobs.id, deliveredAt: printJobs.deliveredAt });
      const result = await send(app, "GET", "/management-api/print-jobs", {
        cookie: managerCookie,
      });
      expect(result.status).toBe(200);
      const jobs = (await result.json()) as { id: string; status: string; createdAt: string }[];
      expect(jobs).toHaveLength(existingPending.length + 104);
      expect(
        jobs
          .filter((job) => job.status !== "done")
          .map((job) => job.id)
          .sort(),
      ).toEqual([...existingPending, ...pending].map((job) => job.id).sort());
      expect(
        jobs
          .filter((job) => job.status === "done")
          .map((job) => job.id)
          .sort(),
      ).toEqual(
        completed
          .sort((a, b) => Date.parse(b.deliveredAt!) - Date.parse(a.deliveredAt!))
          .slice(0, 100)
          .map((job) => job.id)
          .sort(),
      );
      const created = jobs.map((job) => Date.parse(job.createdAt));
      expect(created).toEqual([...created].sort((a, b) => b - a));
      expect(jobs.every((job) => !("payload" in job))).toBe(true);
    } finally {
      await suite.db.execute(sql`delete from print_jobs where printer_id = ${printerId}`);
    }
  });

  it("bounds exhausted failures without hiding queued, printing or retryable jobs", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused");
    try {
      // A date-only spelling would not sort against a full timestamp in this text column.
      const payload = new Uint8Array([0x01]);
      const second = 1_000;
      const pending = await suite.db
        .insert(printJobs)
        .values(
          (
            [
              ["queued", 0],
              ["printing", 0],
              ["failed", 4],
            ] as const
          ).flatMap(([status, attempts]) =>
            Array.from({ length: 101 }, () => ({
              locationId,
              printerId,
              payload,
              status,
              attempts,
              createdAt: "2020-01-01T00:00:00.000Z",
            })),
          ),
        )
        .returning({ id: printJobs.id });
      const failed = await suite.db
        .insert(printJobs)
        .values(
          Array.from({ length: 101 }, (_, i) => ({
            locationId,
            printerId,
            payload,
            status: "failed" as const,
            attempts: 5,
            createdAt: new Date(
              Date.parse("2099-01-01T00:00:00Z") + (i + 1) * second,
            ).toISOString(),
          })),
        )
        .returning({ id: printJobs.id, createdAt: printJobs.createdAt });
      const response = await send(app, "GET", "/management-api/print-jobs", {
        cookie: managerCookie,
      });
      expect(response.status).toBe(200);
      const rows = (await response.json()) as {
        id: string;
        printerId: string;
        status: string;
        attempts: number;
      }[];
      const mine = rows.filter((row) => row.printerId === printerId);
      expect(mine).toHaveLength(403);
      expect(
        mine
          .filter((row) => row.status !== "failed" || row.attempts < 5)
          .map((row) => row.id)
          .sort(),
      ).toEqual(pending.map((row) => row.id).sort());
      expect(
        mine
          .filter((row) => row.status === "failed" && row.attempts >= 5)
          .map((row) => row.id)
          .sort(),
      ).toEqual(
        failed
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, 100)
          .map((row) => row.id)
          .sort(),
      );
    } finally {
      await suite.db.execute(sql`delete from print_jobs where printer_id = ${printerId}`);
    }
  });

  it("does not let missing completion timestamps hide recently delivered jobs", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused");
    try {
      const payload = new Uint8Array([0x01]);
      await suite.db.insert(printJobs).values(
        Array.from({ length: 101 }, () => ({
          locationId,
          printerId,
          payload,
          status: "done" as const,
        })),
      );
      const completed = await suite.db
        .insert(printJobs)
        .values({
          locationId,
          printerId,
          payload,
          status: "done",
          deliveredAt: "2099-01-01T00:00:00.000Z",
        })
        .returning({ id: printJobs.id });
      const response = await send(app, "GET", "/management-api/print-jobs", {
        cookie: managerCookie,
      });
      expect(response.status).toBe(200);
      const rows = (await response.json()) as { id: string; status: string }[];
      expect(rows.some((row) => row.id === completed[0]!.id)).toBe(true);
      expect(rows.filter((row) => row.status === "done")).toHaveLength(100);
    } finally {
      await suite.db.execute(sql`delete from print_jobs where printer_id = ${printerId}`);
    }
  });

  it("lists recent jobs newest-first without the payload", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const jobId = await enqueue(printerId, new Uint8Array([1, 2, 3]));
    const res = await send(app, "GET", "/management-api/print-jobs", { cookie: managerCookie });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; status: string; printerId: string }[];
    const mine = rows.find((r) => r.id === jobId)!;
    expect(mine).toMatchObject({ status: "queued", printerId });
    expect(mine).not.toHaveProperty("payload");
  });
});

describe("mountPrintApi — the printer.manage gate", () => {
  const DUMMY = "00000000-0000-0000-0000-000000000000";

  const routes: ["GET" | "POST" | "PATCH", string, unknown?][] = [
    ["GET", "/management-api/print-agents"],
    ["PATCH", `/management-api/print-agents/${DUMMY}`, { name: "Renamed" }],
    ["POST", `/management-api/print-agents/${DUMMY}/revoke`],
    ["POST", "/management-api/printers", { name: "X", transport: "network_tcp", host: "10.0.0.1" }],
    ["GET", "/management-api/printers"],
    ["PATCH", `/management-api/printers/${DUMMY}`, { name: "X" }],
    ["POST", `/management-api/printers/${DUMMY}/deactivate`],
    ["POST", `/management-api/printers/${DUMMY}/test-print`],
    ["GET", "/management-api/print-jobs"],
  ];

  it("refuses every management route unauthenticated → 401 management_session.required", async () => {
    const app = mountApp();
    for (const [method, path, body] of routes) {
      const res = await send(app, method, path, body === undefined ? {} : { body });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "management_session.required" },
      });
    }
  });

  it("refuses every management route for a staff session → 403 (the gate, proven by deletion)", async () => {
    // A `staff`-role session holds no `printer.manage`.
    const app = mountApp();
    for (const [method, path, body] of routes) {
      const res = await send(app, method, path, {
        cookie: staffCookie,
        ...(body === undefined ? {} : { body }),
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await res.json()) as { error: { code: string } }).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    }
  });
});

describe("agent inventory screening and the discovered-printer list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function discoveredRows(app: Hono): Promise<Record<string, unknown>[]> {
    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>[];
  }

  it("drops malformed inventory entries and keeps the well-formed ones", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app, "Screening agent");
    const btKey = `BT-${randomUUID()}`;
    await pull(app, token, {
      visible: [
        null,
        "usb",
        { transport: "wifi", localKey: "wifi-1" },
        { transport: "usb", localKey: 42 },
        { transport: "bluetooth", localKey: btKey, name: "Bolsillo" },
      ],
      scanned: [
        null,
        7,
        { transport: "carrier_pigeon", host: "10.9.253.9" },
        { transport: "network_tcp", host: "10.9.253.1", port: 91.5 },
      ],
    });

    const rows = await discoveredRows(app);
    expect(rows.map((row) => ({ ...row, lastSeenAt: undefined }))).toEqual([
      {
        agentId,
        agentName: "Screening agent",
        transport: "bluetooth",
        localKey: btKey,
        name: "Bolsillo",
        alreadyRegistered: false,
        printerId: null,
        lastSeenAt: undefined,
      },
      {
        agentId,
        agentName: "Screening agent",
        transport: "network_tcp",
        host: "10.9.253.1",
        alreadyRegistered: false,
        printerId: null,
        lastSeenAt: undefined,
      },
    ]);
  });

  it("claims a bluetooth printer's job once the pulling box sees its key", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const btKey = `BT-${randomUUID()}`;
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bolsillo", transport: "bluetooth", localKey: btKey },
    });
    expect(created.status).toBe(201);
    const { id: printerId } = (await created.json()) as { id: string };
    const jobId = await enqueue(printerId, esc().text("Mesa 2").cut().bytes());

    const blind = await pull(app, token, { visible: [], scanned: [] });
    expect(blind.jobs.filter((job) => job.printerId === printerId)).toEqual([]);
    const seen = await pull(app, token, {
      visible: [{ transport: "bluetooth", localKey: btKey }],
      scanned: [],
    });
    expect(seen.jobs.filter((job) => job.printerId === printerId).map((job) => job.id)).toEqual([
      jobId,
    ]);
  });

  it("marks a port-less office-printer report as the same address as port 9100", async () => {
    const app = mountApp();
    const first = await joinAndAccept(app, "Kitchen agent");
    const second = await joinAndAccept(app, "Bar agent");
    const host = "10.9.254.1";
    await pull(app, first.token, {
      visible: [],
      scanned: [{ transport: "network_tcp", host, pagePrinter: true }],
    });
    await pull(app, second.token, {
      visible: [],
      scanned: [{ transport: "network_tcp", host, port: 9100 }],
    });

    const rows = await discoveredRows(app);
    expect(rows.find((r) => r.agentId === second.agentId && r.host === host)).toMatchObject({
      port: 9100,
      pagePrinter: true,
    });
    const portless = rows.find((r) => r.agentId === first.agentId && r.host === host);
    expect(portless).not.toHaveProperty("port");
    expect(portless).toMatchObject({ pagePrinter: true });
  });

  it("drops a reported device once its last report is older than fifteen seconds", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const serial = `SN-${randomUUID()}`;
    await pull(app, token, { visible: [{ transport: "usb", localKey: serial }], scanned: [] });
    const [row] = (await discoveredRows(app)).filter((r) => r.localKey === serial);
    const reportedAt = Date.parse(row!.lastSeenAt as string);

    vi.spyOn(Date, "now").mockReturnValue(reportedAt + 15_000);
    expect((await discoveredRows(app)).filter((r) => r.localKey === serial)).toHaveLength(1);
    vi.spyOn(Date, "now").mockReturnValue(reportedAt + 15_001);
    expect((await discoveredRows(app)).filter((r) => r.localKey === serial)).toEqual([]);
  });

  it("answers not_approved to a join-status poll with no Bearer, or a pending join's id with no secret", async () => {
    const app = mountApp();
    const bare = await app.request("/print-api/agent/join/status");
    expect(bare.status).toBe(200);
    expect(await bare.json()).toEqual({ status: "not_approved" });
    // The selector of a real pending join, sent without its secret, must not read as pending.
    const { joinId } = await knock(app);
    const dotless = await send(app, "GET", "/print-api/agent/join/status", { bearer: joinId });
    expect(dotless.status).toBe(200);
    expect(await dotless.json()).toEqual({ status: "not_approved" });
  });
});

describe("printer layout and calibration requests", () => {
  it("patches a printer's paper width", async () => {
    const app = mountApp();
    const id = await createNetworkPrinter(app, "10.0.0.46", 9100, "Ancho");
    const patched = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { paperWidth: "58mm" },
    });
    expect(patched.status).toBe(204);
    const listed = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string; paperWidth: string }[];
    expect(listed.find((p) => p.id === id)).toMatchObject({ paperWidth: "58mm" });
  });

  it("refuses a sample receipt with no character table, and a table finder with no start table", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.47", 9100, "Sin tabla");
    const sample = await send(app, "POST", `/management-api/printers/${printerId}/sample-receipt`, {
      cookie: managerCookie,
      body: { paperWidth: "80mm", resolution: "180dpi", characterSet: "wpc1252" },
    });
    expect(sample.status).toBe(400);
    expect(await sample.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "characterTable" } },
    });
    const finder = await send(
      app,
      "POST",
      `/management-api/printers/${printerId}/character-table-test`,
      { cookie: managerCookie, body: {} },
    );
    expect(finder.status).toBe(400);
    expect(await finder.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "startTable" } },
    });
  });
});
