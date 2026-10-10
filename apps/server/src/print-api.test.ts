import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  devices,
  joinRequests,
  locations,
  nowIso,
  printAgents,
  printJobs,
  printerHolders,
  withTransaction,
} from "@waitron/db";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedTenant } from "@waitron/db/testing/seed.js";
import {
  IDENTITY_MIGRATIONS,
  hashPin,
  hashSessionToken,
  persons,
  resolveManagementSession,
  startManagementSession,
} from "@waitron/identity";
import {
  BLUETOOTH_PRINTING_UNAVAILABLE,
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_UNPAIRED,
  enqueuePrintJob,
  esc,
} from "@waitron/printing";
import { PIN_WITHHELD, type BluetoothCommand, type NetworkProbe } from "@waitron/print-agent";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  type SupportedLocale,
} from "@waitron/shared";
import { printingAlertSource } from "./alert-sources.js";
import { JOBS_WAITING_MS } from "./print-job-trouble.js";
import type { Logger } from "./logger.js";
import { mountPrintApi } from "./print-api.js";
import { configureDemoPrinter, deliverDemoPrinterJobs } from "./demo-printer.js";
import { formatTestPage } from "./test-page.js";
import { formatSampleReceipt } from "./sample-receipt.js";
import { formatPrinterTestPage } from "./printer-test-page.js";
import { opensDrawer, printedCommands, printedLines } from "./testing/decode-ticket.js";
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
import { readVenueDetails, writeVenueDetails } from "./venue-details.js";
import "./errors.js";

// The print routes end to end in-process. Tests share the seeded tenant and create their own
// printers, so assertions about tenant-wide results must account for other tests' jobs.
const noopLog: Logger = () => {};
/** A setting to draw opaque job payloads at; the agent and queue never read them. */
const WIDE = { paperWidth: "80mm", resolution: "180dpi" } as const;

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
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
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
      nodeId: brandNodeId(randomUUID()),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
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
    log?: Logger;
    now?: () => Date;
    receiptQrText?: { caption: string; legend: string };
    practiceMode?: boolean;
  } = {},
): Hono {
  const app = new Hono();
  const pairingMode = createPairingMode();
  if (opts.pairingOpen ?? true) pairingMode.open();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg: { ...cfg, practiceMode: opts.practiceMode },
      pairingMode,
      readMembership: async () => MEMBERSHIP,
      enrolRateLimiter: opts.enrolRateLimiter,
      venueLocale: opts.venueLocale ?? "es-ES",
      listIpv4: opts.listIpv4,
      ...(opts.now === undefined ? {} : { now: opts.now }),
      ...(opts.receiptQrText === undefined ? {} : { receiptQrText: opts.receiptQrText }),
    },
    opts.log ?? noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH" | "PUT",
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

it("refuses the retired venue-wide receipt mode write without changing the location", async () => {
  const app = mountApp();
  const before = await suite.db.select().from(locations).where(eq(locations.id, locationId));

  const response = await send(
    app,
    "PATCH",
    `/management-api/locations/${locationId}/receipt-print-mode`,
    { cookie: managerCookie, body: { mode: "never" } },
  );

  expect(response.status).toBe(404);
  expect(await suite.db.select().from(locations).where(eq(locations.id, locationId))).toEqual(
    before,
  );
});

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
  bluetoothCommands?: BluetoothCommand[];
}

async function pull(
  app: Hono,
  token: string,
  inventory: {
    visible?: unknown;
    scanned?: unknown;
    pairedBluetooth?: unknown;
    bluetoothOutcomes?: unknown;
    bluetoothPrinting?: unknown;
  } = {},
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
    const payload = esc(WIDE).line("Mesa 4").cut().bytes();
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
    const payload = esc(WIDE).line("Mesa 4").cut().bytes();
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

  /** A session of its own, so ageing it cannot expire the shared manager cookie. */
  async function ownManagerSession(
    minutesIdle: number,
  ): Promise<{ cookie: string; token: string }> {
    const token = await withTransaction(suite.db, async (tx) => {
      const [mgr] = await tx
        .insert(persons)
        .values({
          displayName: `Renewing Manager ${randomUUID()}`,
          pinHash: hashPin("1234"),
          role: "manager",
        })
        .returning({ id: persons.id });
      return (await startManagementSession(tx, { personId: mgr!.id })).token;
    });
    const seenAt = new Date(Date.now() - minutesIdle * 60_000).toISOString();
    await suite.db.execute(sql`
      update management_sessions set last_seen_at = ${seenAt}
      where token_hash = ${hashSessionToken(token)}`);
    return { cookie: `${MANAGEMENT_COOKIE}=${token}`, token };
  }

  it("renews the discovery window without extending the dashboard session, while opening it does", async () => {
    const app = mountApp();
    const { token: agentToken } = await joinAndAccept(app);
    const { cookie, token } = await ownManagerSession(10);
    const session = () =>
      withTransaction(suite.db, (tx) => resolveManagementSession(tx, token, { touch: false }));
    const before = await session();

    const renewed = await send(app, "POST", "/management-api/printer-discovery/renew", { cookie });
    expect(renewed.status).toBe(200);
    const { discoveryUntil } = (await renewed.json()) as { discoveryUntil: number };
    expect(discoveryUntil).toBeGreaterThan(Date.now());
    expect((await pull(app, agentToken)).discoveryUntil).toBe(discoveryUntil);
    expect((await session()).expiresAt).toBe(before.expiresAt);

    const started = await send(app, "POST", "/management-api/printer-discovery/start", { cookie });
    expect(started.status).toBe(200);
    expect(Date.parse((await session()).expiresAt)).toBeGreaterThan(Date.parse(before.expiresAt));
  });

  it("refuses to renew the discovery window once the dashboard session has expired, leaving it shut", async () => {
    const app = mountApp();
    const { token: agentToken } = await joinAndAccept(app);
    const { cookie } = await ownManagerSession(60);

    const renewed = await send(app, "POST", "/management-api/printer-discovery/renew", { cookie });
    expect(renewed.status).toBe(401);
    expect(((await renewed.json()) as { error: { code: string } }).error.code).toBe(
      "management_session.expired",
    );
    expect((await pull(app, agentToken)).discoveryUntil).toBeNull();
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
  it("answers 404 on the retired watcher routes and lists printers with no watcherId", async () => {
    const app = mountApp();
    const { agentId } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId, "Pass");
    const watcherId = randomUUID();
    for (const [path, body] of [
      [`/management-api/printers/${printerId}/watcher`, { watcherId }],
      [`/management-api/watchers/${watcherId}/printers`, { printerIds: [printerId] }],
    ] as const) {
      expect((await send(app, "PUT", path, { cookie: managerCookie, body })).status, path).toBe(
        404,
      );
    }
    const rows = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as Record<string, unknown>[];
    expect(rows.find((row) => row.id === printerId)).toBeDefined();
    for (const row of rows) expect(row).not.toHaveProperty("watcherId");
    expect(rows.find((row) => row.id === printerId)).not.toHaveProperty("ticketScope");
  });
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
      }[]
    ).find((r) => r.id === printerId)!;
    expect(patched).toMatchObject({ name: "Cocina 2", host: "10.0.0.20" });
    expect(patched).not.toHaveProperty("ticketScope");

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
    ).json()) as { id: string; port: number; localKey: string | null }[];
    const row = rows.find((r) => r.id === printerId)!;
    expect(row).toMatchObject({ port: 9300, localKey: null });
    expect(row).not.toHaveProperty("ticketScope");
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

  it("stores, lists and patches the two layout settings, and rejects an unknown value", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Estrecha",
        transport: "network_tcp",
        host: "10.0.0.31",
        paperWidth: "58mm",
      },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const defaulted = await createNetworkPrinter(app, "10.0.0.32", 9100, "Por defecto");
    const patched = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { resolution: "203dpi" },
    });
    expect(patched.status).toBe(204);
    const listed = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as {
      id: string;
      paperWidth: string;
      resolution: string;
    }[];
    expect(listed.find((p) => p.id === id)).toMatchObject({
      paperWidth: "58mm",
      resolution: "203dpi",
    });
    expect(listed.find((p) => p.id === defaulted)).toMatchObject({
      paperWidth: "80mm",
      resolution: "180dpi",
    });
    for (const row of listed) {
      expect(row).not.toHaveProperty("characterSet");
      expect(row).not.toHaveProperty("characterTable");
    }
    for (const [method, path, body, field] of [
      [
        "POST",
        "/management-api/printers",
        { name: "Mala", transport: "network_tcp", host: "10.0.0.33", paperWidth: "70mm" },
        "paperWidth",
      ],
      ["PATCH", `/management-api/printers/${id}`, { resolution: "300dpi" }, "resolution"],
    ] as const) {
      const res = await send(app, method, path, { cookie: managerCookie, body });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
  });
});

describe("portable printers", () => {
  type Listed = { id: string; portable: boolean; holder: unknown };

  // The suite shares one database, and a later case routes the demo printer onto every profile.
  const seeded: { deviceId: string; profileId: string }[] = [];
  afterEach(async () => {
    for (const { deviceId, profileId } of seeded.splice(0)) {
      await suite.db.delete(printerHolders).where(eq(printerHolders.deviceId, deviceId));
      await suite.db.delete(devices).where(eq(devices.id, deviceId));
      await suite.db.delete(deviceProfiles).where(eq(deviceProfiles.id, profileId));
    }
  });

  async function seedHolder(label?: string): Promise<string> {
    const device = await seedDevice(suite.db, { locationId, ...(label ? { label } : {}) });
    seeded.push(device);
    return device.deviceId;
  }

  async function listed(app: Hono, id: string): Promise<Listed> {
    const response = await send(app, "GET", "/management-api/printers", { cookie: managerCookie });
    return ((await response.json()) as Listed[]).find((row) => row.id === id)!;
  }

  async function addPrinter(app: Hono, body: Record<string, unknown>): Promise<string> {
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Mano", transport: "network_tcp", host: "10.0.0.61", ...body },
    });
    expect(created.status).toBe(201);
    return ((await created.json()) as { id: string }).id;
  }

  it("creates a printer fixed unless asked, and portable when asked", async () => {
    const app = mountApp();
    const fixed = await addPrinter(app, {});
    const portable = await addPrinter(app, { host: "10.0.0.62", portable: true });
    expect(await listed(app, fixed)).toMatchObject({ portable: false, holder: null });
    expect(await listed(app, portable)).toMatchObject({ portable: true, holder: null });
  });

  it("names the device holding a portable printer and who is signed in on it", async () => {
    const app = mountApp();
    const id = await addPrinter(app, { host: "10.0.0.63", portable: true });
    const deviceId = await seedHolder("Mano de Ana");
    await suite.db.insert(printerHolders).values({ printerId: id, deviceId });
    expect((await listed(app, id)).holder).toEqual({
      deviceId,
      deviceName: "Mano de Ana",
      personName: null,
    });
  });

  it("marking a printer portable puts every device that chose it for receipts back on Use default", async () => {
    const app = mountApp();
    const id = await addPrinter(app, { host: "10.0.0.64", hasCashDrawer: true });
    const deviceId = await seedHolder();
    await suite.db
      .update(devices)
      .set({ receiptPrinterId: id, cashDrawerPrinterId: id })
      .where(eq(devices.id, deviceId));
    const patched = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { portable: true },
    });
    expect(patched.status).toBe(204);
    expect((await listed(app, id)).portable).toBe(true);
    const [device] = await suite.db
      .select({ receipt: devices.receiptPrinterId, drawer: devices.cashDrawerPrinterId })
      .from(devices)
      .where(eq(devices.id, deviceId));
    expect(device).toEqual({ receipt: null, drawer: id });
  });

  it("marking a portable printer fixed lets go of its holder", async () => {
    const app = mountApp();
    const id = await addPrinter(app, { host: "10.0.0.65", portable: true });
    const deviceId = await seedHolder();
    await suite.db.insert(printerHolders).values({ printerId: id, deviceId });
    const patched = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { portable: false },
    });
    expect(patched.status).toBe(204);
    expect(await listed(app, id)).toMatchObject({ portable: false, holder: null });
  });

  it("refuses a portable flag that is not true or false", async () => {
    const app = mountApp();
    const id = await addPrinter(app, { host: "10.0.0.66" });
    const res = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { portable: "yes" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "portable" } },
    });
  });
});

describe("printer cash-drawer calibration", () => {
  it("retains the last delivering agent when a restarted API has no discovery results", async () => {
    const app = mountApp();
    const first = await joinAndAccept(app, "First delivery agent");
    const last = await joinAndAccept(app, "Last delivery agent");
    const id = await createNetworkPrinter(app, "10.0.0.85", 9100, "Delivery history");
    const otherId = await createNetworkPrinter(app, "10.0.0.86", 9100, "Other delivery history");
    await suite.db.insert(printJobs).values([
      {
        locationId,
        printerId: otherId,
        payload: new Uint8Array([1]),
        status: "done",
        claimedBy: first.agentId,
        deliveredAt: "2026-09-26T09:00:00.000Z",
      },
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
    expect(rows.find((row) => row.id === otherId)).toMatchObject({
      lastPrintAgentId: first.agentId,
      lastPrintAt: "2026-09-26T09:00:00.000Z",
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
      device_id: string | null;
      reason: string;
    }>(sql`
      select person_id, device_id, reason from drawer_opens where printer_id = ${id}`);
    const [manager] = await suite.db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.displayName, "The Manager"));
    expect(audit.rows).toEqual([
      { person_id: manager!.id, device_id: null, reason: "calibration" },
    ]);
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

  it("prints a sample receipt with the unsaved layout settings", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.43", 9100, "Sample receipt");
    const settings = { paperWidth: "58mm" as const, resolution: "203dpi" as const };
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
    expect([...new Uint8Array(job!.payload)]).toEqual([
      ...formatSampleReceipt(settings, undefined),
    ]);
  });

  it("prints the sample receipt's QR with the venue fiscal backend's words around it", async () => {
    const words = { caption: "CAP-X", legend: "LEG-Y" };
    const app = mountApp({ receiptQrText: words });
    const printerId = await createNetworkPrinter(app, "10.0.0.44", 9100, "Sample with QR");
    const settings = { paperWidth: "80mm" as const, resolution: "203dpi" as const };
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
    const payload = new Uint8Array(job!.payload);
    expect([...payload]).toEqual([...formatSampleReceipt(settings, words)]);
    expect(printedLines(payload).map((line) => line.trim())).toContain("LEG-Y");
  });

  it("rejects an invalid sample-receipt resolution", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.44", 9100, "Bad sample");
    const res = await send(app, "POST", `/management-api/printers/${printerId}/sample-receipt`, {
      cookie: managerCookie,
      body: { paperWidth: "80mm", resolution: "300dpi" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "resolution" } },
    });
  });

  it("has no character-table finder any more", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.45", 9100, "Table finder");
    const res = await send(
      app,
      "POST",
      `/management-api/printers/${printerId}/character-table-test`,
      {
        cookie: managerCookie,
        body: { startTable: 5 },
      },
    );
    expect(res.status).toBe(404);
    expect(
      await suite.db.select().from(printJobs).where(eq(printJobs.printerId, printerId)),
    ).toEqual([]);
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

describe("mountPrintApi — management: print-test-page", () => {
  // 13:05 UTC is 14:05 in the Canaries and 15:05 in Madrid, so the hour shows which zone was used.
  const NOW = new Date("2026-10-01T13:05:00.000Z");

  async function withVenueTimeZone<T>(timeZone: string, fn: () => Promise<T>): Promise<T> {
    const [before] = await suite.db
      .select({ timeZone: locations.timeZone })
      .from(locations)
      .where(eq(locations.id, locationId));
    await suite.db.update(locations).set({ timeZone }).where(eq(locations.id, locationId));
    try {
      return await fn();
    } finally {
      await suite.db
        .update(locations)
        .set({ timeZone: before!.timeZone })
        .where(eq(locations.id, locationId));
    }
  }

  async function savedPrinter(
    app: Hono,
    host: string,
    name: string,
    patch: Record<string, unknown>,
  ): Promise<string> {
    const id = await createNetworkPrinter(app, host, 9100, name);
    const res = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: patch,
    });
    expect(res.status).toBe(204);
    return id;
  }

  async function jobsFor(
    printerId: string,
  ): Promise<{ id: string; kind: string; payload: Uint8Array }[]> {
    const rows = await suite.db
      .select({ id: printJobs.id, kind: printJobs.kind, payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
    return rows.map((row) => ({ ...row, payload: new Uint8Array(row.payload) }));
  }

  it("prints calibration in the committed venue zone without remounting the routes", async () => {
    const app = mountApp({ now: () => NOW });
    const printerId = await createNetworkPrinter(app, "10.0.0.129", 9100, "Clock edit calibration");
    const initial = await withTransaction(suite.db, (tx) => readVenueDetails(tx, { locationId }));
    expect(initial.details.timeZone).toBe("Europe/Madrid");
    const print = async () => {
      const response = await app.request(`/management-api/printers/${printerId}/print-test-page`, {
        method: "POST",
        headers: { cookie: managerCookie, "accept-language": "en-GB" },
      });
      expect(response.status).toBe(202);
      const { jobId } = (await response.json()) as { jobId: string };
      return printedLines((await jobsFor(printerId)).find((job) => job.id === jobId)!.payload).join(
        "\n",
      );
    };
    expect(await print()).toContain("1 Oct 2026, 15:05");
    const saved = await withTransaction(suite.db, (tx) =>
      writeVenueDetails(
        tx,
        { locationId },
        {
          expected: initial.details,
          changes: { timeZone: "UTC" },
        },
      ),
    );
    try {
      expect(await print()).toContain("1 Oct 2026, 13:05");
      await expect(
        withTransaction(suite.db, (tx) =>
          writeVenueDetails(
            tx,
            { locationId },
            {
              expected: saved.model.details,
              changes: { timeZone: "Invalid/Zone" },
            },
          ),
        ),
      ).rejects.toMatchObject({
        code: "venue.detail_invalid",
        params: { field: "timeZone", reason: "time_zone" },
      });
      const noOp = await withTransaction(suite.db, (tx) =>
        writeVenueDetails(
          tx,
          { locationId },
          {
            expected: saved.model.details,
            changes: { timeZone: "UTC" },
          },
        ),
      );
      expect(noOp.changed).toBe(false);
      expect(await print()).toContain("1 Oct 2026, 13:05");
    } finally {
      const latest = await withTransaction(suite.db, (tx) => readVenueDetails(tx, { locationId }));
      await withTransaction(suite.db, (tx) =>
        writeVenueDetails(
          tx,
          { locationId },
          {
            expected: latest.details,
            changes: { timeZone: initial.details.timeZone },
          },
        ),
      );
    }
  });

  it.each([
    { acceptLanguage: "en-GB,en;q=0.9", locale: "en-GB", dateTime: "1 Oct 2026, 14:05" },
    { acceptLanguage: "es-ES,es;q=0.9", locale: "es-ES", dateTime: "1 oct 2026, 14:05" },
  ] as const)(
    "enqueues one document job drawn at the printer's saved setting ($locale)",
    async ({ acceptLanguage, locale, dateTime }) => {
      const app = mountApp({ now: () => NOW });
      const printerId = await savedPrinter(app, "10.0.0.120", `Página ${locale}`, {
        paperWidth: "58mm",
        resolution: "203dpi",
      });
      const res = await withVenueTimeZone("Atlantic/Canary", async () =>
        app.request(`/management-api/printers/${printerId}/print-test-page`, {
          method: "POST",
          headers: { cookie: managerCookie, "accept-language": acceptLanguage },
        }),
      );
      expect(res.status).toBe(202);
      const body = (await res.json()) as { jobId: string };
      expect(body).toEqual({ jobId: body.jobId });
      const jobs = await jobsFor(printerId);
      expect(jobs.map(({ id, kind }) => ({ id, kind }))).toEqual([
        { id: body.jobId, kind: "document" },
      ]);
      expect([...jobs[0]!.payload]).toEqual([
        ...formatPrinterTestPage({
          locale,
          printer: { paperWidth: "58mm", resolution: "203dpi" },
          printerName: `Página ${locale}`,
          now: NOW,
          timeZone: "Atlantic/Canary",
        }),
      ]);
      const text = printedLines(jobs[0]!.payload).join("\n");
      expect(text).toContain(`Página ${locale}`);
      expect(text).toContain("58mm · 203dpi");
      expect(text).toContain(dateTime);
    },
  );

  it("follows the printer's saved paper width: a 58mm and an 80mm printer differ", async () => {
    const app = mountApp({ now: () => NOW });
    const narrow = await savedPrinter(app, "10.0.0.121", "Estrecha", {
      paperWidth: "58mm",
      resolution: "203dpi",
    });
    const wide = await savedPrinter(app, "10.0.0.122", "Ancha", {
      paperWidth: "80mm",
      resolution: "203dpi",
    });
    const widths = async (printerId: string): Promise<Set<number>> => {
      const res = await send(app, "POST", `/management-api/printers/${printerId}/print-test-page`, {
        cookie: managerCookie,
      });
      expect(res.status).toBe(202);
      const [job] = await jobsFor(printerId);
      return new Set(
        printedCommands(job!.payload)
          .filter((command) => command.text !== undefined)
          .map((command) => command.widthDots!),
      );
    };
    expect(await widths(narrow)).toEqual(new Set([384]));
    expect(await widths(wide)).toEqual(new Set([576]));
  });

  it("sends no drawer pulse, even to a printer with a cash drawer attached", async () => {
    const app = mountApp();
    const printerId = await savedPrinter(app, "10.0.0.123", "Con cajón", { hasCashDrawer: true });
    const res = await send(app, "POST", `/management-api/printers/${printerId}/print-test-page`, {
      cookie: managerCookie,
    });
    expect(res.status).toBe(202);
    const jobs = await jobsFor(printerId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.kind).toBe("document");
    expect(opensDrawer(jobs[0]!.payload)).toBe(false);
  });

  it("refuses an unknown or a deactivated printer with 404 printer.not_found", async () => {
    const app = mountApp();
    const deactivated = await createNetworkPrinter(app, "10.0.0.124", 9100, "Apagada");
    const off = await send(app, "POST", `/management-api/printers/${deactivated}/deactivate`, {
      cookie: managerCookie,
    });
    expect(off.status).toBe(204);
    for (const id of [randomUUID(), deactivated]) {
      const res = await send(app, "POST", `/management-api/printers/${id}/print-test-page`, {
        cookie: managerCookie,
      });
      expect(res.status, id).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: "printer.not_found" } });
    }
    expect(await jobsFor(deactivated)).toEqual([]);
  });

  it("refuses a malformed id with 400", async () => {
    const app = mountApp();
    const res = await send(app, "POST", "/management-api/printers/not-a-uuid/print-test-page", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(400);
  });

  it("refuses no session with 401 and a staff session with 403", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.125", 9100, "Sin sesión");
    const path = `/management-api/printers/${printerId}/print-test-page`;
    const anonymous = await send(app, "POST", path);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({
      error: { code: "management_session.required" },
    });
    const staff = await send(app, "POST", path, { cookie: staffCookie });
    expect(staff.status).toBe(403);
    expect(await staff.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await jobsFor(printerId)).toEqual([]);
  });
});

describe("mountPrintApi — management: recent jobs", () => {
  it("shows Demo paper and drawer openings newest first, only to managers in practice mode", async () => {
    const app = mountApp({ practiceMode: true });
    const printerId = await createUsbPrinter(app, "WAITRON-DEMO-PRINTER", "Demo printer");
    await enqueue(printerId, esc(WIDE).line("Kitchen ticket").bytes());
    await enqueue(printerId, esc(WIDE).line("Receipt").bytes());
    await withTransaction(suite.db, (tx) =>
      enqueuePrintJob(tx, { locationId }, printerId, esc().kick().bytes(), "drawer"),
    );
    const demo = await configureDemoPrinter(suite.db, locationId, true);
    await deliverDemoPrinterJobs(suite.db, locationId, demo!);

    const path = "/management-api/demo-printer/jobs";
    const response = await send(app, "GET", path, { cookie: managerCookie });
    expect(response.status).toBe(200);
    const jobs = (await response.json()) as { kind: string; preview: { text: string } | null }[];
    expect(jobs.map(({ kind, preview }) => ({ kind, text: preview?.text ?? null }))).toEqual([
      { kind: "drawer", text: null },
      { kind: "document", text: "Receipt\n" },
      { kind: "document", text: "Kitchen ticket\n" },
    ]);
    expect((await send(app, "GET", path)).status).toBe(401);
    expect((await send(app, "GET", path, { cookie: staffCookie })).status).toBe(403);
    expect(
      (await send(mountApp({ practiceMode: false }), "GET", path, { cookie: managerCookie }))
        .status,
    ).toBe(404);
  });

  it("returns a job preview only to printer managers", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused");
    const jobId = await enqueue(
      printerId,
      esc(WIDE).init().line("Receipt <safe>").feedAndCut().bytes(),
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

  it("previews a job at the width its lines were drawn, with the job's own images and their text", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Vista 58",
        transport: "network_tcp",
        host: "10.0.0.42",
        paperWidth: "58mm",
        resolution: "203dpi",
      },
    });
    const { id: narrow } = (await created.json()) as { id: string };
    const narrowPayload = esc({ paperWidth: "58mm", resolution: "203dpi" })
      .init()
      .line("Café 12,50 €")
      .bytes();
    const narrowJob = await enqueue(narrow, narrowPayload);
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
      widthDots: 384,
      columns: 30,
      text: "Café 12,50 €\n",
      blocks: [
        {
          kind: "image",
          width: 384,
          height: 28,
          data: Buffer.from(narrowPayload.subarray(10)).toString("base64"),
          text: "Café 12,50 €",
        },
      ],
      unsupported: false,
      truncated: false,
    });
    const wide = await createNetworkPrinter(app, "10.0.0.43", 9100, "Vista 80");
    const wideJob = await enqueue(wide, esc(WIDE).init().line("x").bytes());
    const widePreview = await send(app, "GET", `/management-api/print-jobs/${wideJob}/preview`, {
      cookie: managerCookie,
    });
    expect(await widePreview.json()).toMatchObject({ widthDots: 512, columns: 42 });
  });

  it("previews a job drawn before its printer's setting changed at the width it was drawn, and a job with no line at the setting now", async () => {
    const app = mountApp();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Vista 80 nueva",
        transport: "network_tcp",
        host: "10.0.0.44",
        paperWidth: "80mm",
        resolution: "203dpi",
      },
    });
    const { id: printerId } = (await created.json()) as { id: string };
    const drawnAt384 = await enqueue(
      printerId,
      esc({ paperWidth: "58mm", resolution: "203dpi" }).init().line("Café").bytes(),
    );
    const drawerOnly = await enqueue(printerId, esc().init().kick().bytes());
    const preview = async (jobId: string) =>
      (
        await send(app, "GET", `/management-api/print-jobs/${jobId}/preview`, {
          cookie: managerCookie,
        })
      ).json();
    expect(await preview(drawnAt384)).toMatchObject({ widthDots: 384, columns: 30 });
    expect(await preview(drawerOnly)).toMatchObject({ widthDots: 576, columns: 42 });
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
    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 2").cut().bytes());

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

  async function bluetoothPrinterWithJob(app: Hono): Promise<{ mac: string; jobId: string }> {
    const mac = lowerMac().toUpperCase();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bolsillo", transport: "bluetooth", localKey: mac },
    });
    const { id: printerId } = (await created.json()) as { id: string };
    return { mac, jobId: await enqueue(printerId, esc(WIDE).line("Mesa 2").cut().bytes()) };
  }

  it("ends a bluetooth printer's job failed, with its reason, once the box that has it paired says it cannot print over Bluetooth", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const { mac, jobId } = await bluetoothPrinterWithJob(app);

    const reply = await pull(app, token, {
      visible: [],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: false,
    });

    expect(reply.jobs.map((job) => job.id)).not.toContain(jobId);
    expect(await jobRow(jobId)).toEqual({
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
      last_error: BLUETOOTH_PRINTING_UNAVAILABLE,
      delivered_at: null,
    });
  });

  it("leaves a bluetooth printer's job waiting when the box that cannot print over Bluetooth does not have it paired", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const { jobId } = await bluetoothPrinterWithJob(app);

    await pull(app, token, {
      visible: [],
      pairedBluetooth: [{ localKey: lowerMac().toUpperCase() }],
      bluetoothPrinting: false,
    });

    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 0, last_error: null });
  });

  it("claims, and does not end, a paired bluetooth printer's job when the box says it can print over Bluetooth", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const { mac, jobId } = await bluetoothPrinterWithJob(app);

    const reply = await pull(app, token, {
      visible: [{ transport: "bluetooth", localKey: mac }],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: true,
    });

    expect(reply.jobs.map((job) => job.id)).toContain(jobId);
    expect(await jobRow(jobId)).toMatchObject({ status: "printing", last_error: null });
  });

  async function bluetoothPrinter(app: Hono): Promise<{ mac: string; printerId: string }> {
    const mac = lowerMac().toUpperCase();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bolsillo", transport: "bluetooth", localKey: mac },
    });
    return { mac, printerId: ((await created.json()) as { id: string }).id };
  }

  it("leaves a paired bluetooth printer's job for another box that reported it can print to it within fifteen seconds", async () => {
    const app = mountApp();
    const printing = await joinAndAccept(app, "Barra agent");
    const blind = await joinAndAccept(app, "Cocina agent");
    const { mac, printerId } = await bluetoothPrinter(app);
    // The same device in the same pull's scan must not wipe what the visible report said.
    await pull(app, printing.token, {
      visible: [{ transport: "bluetooth", localKey: mac }],
      scanned: [{ transport: "bluetooth", localKey: mac }],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: true,
    });
    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 6").cut().bytes());

    await pull(app, blind.token, {
      visible: [],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: false,
    });
    expect(await jobRow(jobId)).toMatchObject({ status: "queued", attempts: 0, last_error: null });

    const reply = await pull(app, printing.token, {
      visible: [{ transport: "bluetooth", localKey: mac }],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: true,
    });
    expect(reply.jobs.map((job) => job.id)).toContain(jobId);
  });

  it("ends the job once the other box's report that it can print to the printer is older than fifteen seconds", async () => {
    const app = mountApp();
    const printing = await joinAndAccept(app, "Barra agent");
    const blind = await joinAndAccept(app, "Cocina agent");
    const { mac, printerId } = await bluetoothPrinter(app);
    const reportedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(reportedAt);
    await pull(app, printing.token, {
      visible: [{ transport: "bluetooth", localKey: mac }],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: true,
    });
    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 7").cut().bytes());

    vi.spyOn(Date, "now").mockReturnValue(reportedAt + 15_001);
    await pull(app, blind.token, {
      visible: [],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: false,
    });

    expect(await jobRow(jobId)).toMatchObject({
      status: "failed",
      last_error: BLUETOOTH_PRINTING_UNAVAILABLE,
    });
  });

  it("ends the job when the other box reported the printer only paired, not among the devices it can print to", async () => {
    const app = mountApp();
    const other = await joinAndAccept(app, "Barra agent");
    const blind = await joinAndAccept(app, "Cocina agent");
    const { mac, printerId } = await bluetoothPrinter(app);
    await pull(app, other.token, {
      visible: [],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: true,
    });
    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 8").cut().bytes());

    await pull(app, blind.token, {
      visible: [],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothPrinting: false,
    });

    expect(await jobRow(jobId)).toMatchObject({
      status: "failed",
      last_error: BLUETOOTH_PRINTING_UNAVAILABLE,
    });
  });

  function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  /** A pull whose body is sent only on `release`; `reading` settles once the route asks for it. */
  function heldPull(
    app: Hono,
    token: string,
  ): {
    reading: Promise<void>;
    release: (inventory: unknown) => void;
    response: Promise<Response>;
  } {
    const reading = deferred();
    const inventory = deferred<unknown>();
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          reading.resolve();
          controller.enqueue(new TextEncoder().encode(JSON.stringify(await inventory.promise)));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const response = Promise.resolve(
      app.request("/print-api/agent/jobs", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    return { reading: reading.promise, release: inventory.resolve, response };
  }

  it("leaves the job when the other box reports it can print to the printer while this box's pull waits for the write lock", async () => {
    const app = mountApp();
    const printing = await joinAndAccept(app, "Barra agent");
    const blind = await joinAndAccept(app, "Cocina agent");
    const { mac, printerId } = await bluetoothPrinter(app);
    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 9").cut().bytes());

    // Both pulls are past authentication, which takes the write lock, before a writer is held.
    const blindPull = heldPull(app, blind.token);
    const printingPull = heldPull(app, printing.token);
    await Promise.all([blindPull.reading, printingPull.reading]);
    const writerHeld = deferred();
    const releaseWriter = deferred();
    const writer = withTransaction(suite.db, async () => {
      writerHeld.resolve();
      await releaseWriter.promise;
    });
    await writerHeld.promise;

    // A pull that asks for the write lock has recorded its report and now waits behind the writer.
    const withWriteLock = suite.db.withWriteLock.bind(suite.db);
    let lockAsked = deferred();
    const lockSpy = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementation(<T>(body: () => Promise<T>): Promise<T> => {
        lockAsked.resolve();
        return withWriteLock(body);
      });
    try {
      blindPull.release({
        visible: [],
        pairedBluetooth: [{ localKey: mac }],
        bluetoothPrinting: false,
      });
      await lockAsked.promise;
      lockAsked = deferred();
      printingPull.release({
        visible: [{ transport: "bluetooth", localKey: mac }],
        pairedBluetooth: [{ localKey: mac }],
        bluetoothPrinting: true,
      });
      await lockAsked.promise;
    } finally {
      lockSpy.mockRestore();
      releaseWriter.resolve();
    }
    await writer;

    const [blindResponse, printingResponse] = await Promise.all([
      blindPull.response,
      printingPull.response,
    ]);
    expect(blindResponse.status).toBe(200);
    expect(printingResponse.status).toBe(200);
    expect(await jobRow(jobId)).toMatchObject({ status: "printing", last_error: null });
    const reply = (await printingResponse.json()) as PullReply;
    expect(reply.jobs.map((job) => job.id)).toContain(jobId);
  });

  it("refuses a pull whose bluetoothPrinting is not a boolean, naming the field, before recording its pairing report", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = lowerMac().toUpperCase();

    for (const value of ["false", null, 0, [], {}]) {
      const res = await send(app, "POST", "/print-api/agent/jobs", {
        bearer: token,
        body: { visible: [], pairedBluetooth: [{ localKey: mac }], bluetoothPrinting: value },
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "bluetoothPrinting" } },
      });
    }
    expect((await discoveredRows(app)).filter((r) => r.agentId === agentId)).toEqual([]);
  });

  function lowerMac(): string {
    return Array.from(randomBytes(6), (b) => b.toString(16).padStart(2, "0")).join(":");
  }

  async function storedKey(app: Hono, printerId: string): Promise<string | null | undefined> {
    const rows = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string; localKey: string | null }[];
    return rows.find((r) => r.id === printerId)?.localKey;
  }

  async function claimedFor(app: Hono, token: string, printerId: string, mac: string) {
    const reply = await pull(app, token, {
      visible: [{ transport: "bluetooth", localKey: mac }],
      scanned: [],
    });
    return reply.jobs.filter((job) => job.printerId === printerId).map((job) => job.id);
  }

  it("stores a bluetooth printer created with a lower-case address in upper case, so its job is claimed", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const mac = lowerMac();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bolsillo", transport: "bluetooth", localKey: mac },
    });
    expect(created.status).toBe(201);
    const { id: printerId } = (await created.json()) as { id: string };
    expect(await storedKey(app, printerId)).toBe(mac.toUpperCase());

    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());
    expect(await claimedFor(app, token, printerId, mac.toUpperCase())).toEqual([jobId]);
  });

  it("refuses a lower-case address that an upper-case bluetooth printer already holds", async () => {
    const app = mountApp();
    await joinAndAccept(app);
    const mac = lowerMac();
    const first = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "First", transport: "bluetooth", localKey: mac.toUpperCase() },
    });
    expect(first.status).toBe(201);
    const dup = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Second", transport: "bluetooth", localKey: mac },
    });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({
      error: { code: "printer.already_registered", params: { localKey: mac.toUpperCase() } },
    });
  });

  it("stores a lower-case address given to an existing bluetooth printer in upper case, so its job is claimed", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bolsillo", transport: "bluetooth", localKey: `BT-${randomUUID()}` },
    });
    expect(created.status).toBe(201);
    const { id: printerId } = (await created.json()) as { id: string };
    const mac = lowerMac();
    const edited = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: { localKey: mac },
    });
    expect(edited.status).toBe(204);
    expect(await storedKey(app, printerId)).toBe(mac.toUpperCase());

    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 4").cut().bytes());
    expect(await claimedFor(app, token, printerId, mac.toUpperCase())).toEqual([jobId]);
  });

  it("upper-cases an address-shaped key only once the printer's transport is bluetooth", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const mac = lowerMac();
    const printerId = await createUsbPrinter(app, mac, "Was USB");
    expect(await storedKey(app, printerId)).toBe(mac);

    const edited = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: { transport: "bluetooth" },
    });
    expect(edited.status).toBe(204);
    expect(await storedKey(app, printerId)).toBe(mac.toUpperCase());

    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 5").cut().bytes());
    expect(await claimedFor(app, token, printerId, mac.toUpperCase())).toEqual([jobId]);
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

  it("drops a reported device once its last report is older than fifteen seconds, with no discovery window open", async () => {
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

  it("refuses a sample receipt with no resolution", async () => {
    const app = mountApp();
    const printerId = await createNetworkPrinter(app, "10.0.0.47", 9100, "Sin resolucion");
    const sample = await send(app, "POST", `/management-api/printers/${printerId}/sample-receipt`, {
      cookie: managerCookie,
      body: { paperWidth: "80mm" },
    });
    expect(sample.status).toBe(400);
    expect(await sample.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "resolution" } },
    });
  });
});

describe("Bluetooth Pair and Forget commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Distinctive enough that finding it in a body is never a coincidence.
  const PIN = "Zq7#Pw";

  function randomMac(): string {
    return Array.from(randomBytes(6), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(
      ":",
    );
  }

  function scannedMac(mac: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { transport: "bluetooth", localKey: mac, ...extra };
  }

  async function command(
    app: Hono,
    agentId: string,
    kind: "pair" | "forget",
    body: unknown,
  ): Promise<Response> {
    return send(app, "POST", `/management-api/print-agents/${agentId}/bluetooth/${kind}`, {
      cookie: managerCookie,
      body,
    });
  }

  async function discoveredRows(app: Hono): Promise<Record<string, unknown>[]> {
    const res = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>[];
  }

  it("refuses Pair with printer.bluetooth_not_discovered when the agent has not scanned the address", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app, "Pairing agent");
    const mac = randomMac();
    // Reported as paired and visible, but never scanned: neither is a scan.
    await pull(app, token, {
      visible: [{ transport: "bluetooth", localKey: mac }],
      scanned: [],
      pairedBluetooth: [{ localKey: mac }],
    });

    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "printer.bluetooth_not_discovered", params: { address: mac } },
    });
    expect((await pull(app, token)).bluetoothCommands).toBeUndefined();
  });

  it("refuses Pair when only another agent scanned the address", async () => {
    const app = mountApp();
    const scanner = await joinAndAccept(app, "Scanner");
    const other = await joinAndAccept(app, "Other");
    const mac = randomMac();
    await pull(app, scanner.token, { scanned: [scannedMac(mac)] });

    const res = await command(app, other.agentId, "pair", { address: mac, pin: PIN });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "printer.bluetooth_not_discovered", params: { address: mac } },
    });
    expect((await pull(app, other.token)).bluetoothCommands).toBeUndefined();
  });

  it("refuses Pair on a USB scan of the same text, which is not a Bluetooth scan", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { scanned: [{ transport: "usb", localKey: mac }] });

    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "printer.bluetooth_not_discovered" } });
  });

  it("reads a lower-case Bluetooth scan as the upper-case address a Pair names, in one row with its pairing", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, {
      scanned: [scannedMac(mac.toLowerCase(), { printerLike: true })],
      pairedBluetooth: [{ localKey: mac }],
    });

    const rows = (await discoveredRows(app)).filter(
      (r) => r.agentId === agentId && r.transport === "bluetooth",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ localKey: mac, printerLike: true, paired: true });
    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    expect(res.status).toBe(202);
  });

  it("refuses Forget with printer.bluetooth_not_paired when the agent reports no pairing, even one it scanned", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { scanned: [scannedMac(mac)], pairedBluetooth: [] });

    const res = await command(app, agentId, "forget", { address: mac });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "printer.bluetooth_not_paired", params: { address: mac } },
    });
  });

  it("refuses Forget when only another agent reports the pairing", async () => {
    const app = mountApp();
    const holder = await joinAndAccept(app, "Holder");
    const other = await joinAndAccept(app, "Other");
    const mac = randomMac();
    await pull(app, holder.token, { pairedBluetooth: [{ localKey: mac }] });

    const res = await command(app, other.agentId, "forget", { address: mac });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "printer.bluetooth_not_paired", params: { address: mac } },
    });
    expect((await pull(app, other.token)).bluetoothCommands).toBeUndefined();
  });

  it("refuses Pair once the scan is older than the discovered list keeps it, even while the pairing report is fresh", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    const scannedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(scannedAt);
    await pull(app, token, { scanned: [scannedMac(mac)] });

    vi.spyOn(Date, "now").mockReturnValue(scannedAt + 10_000);
    await pull(app, token, { pairedBluetooth: [{ localKey: mac }] });
    vi.spyOn(Date, "now").mockReturnValue(scannedAt + 15_001);
    await pull(app, token, { pairedBluetooth: [{ localKey: mac }] });

    const pair = await command(app, agentId, "pair", { address: mac, pin: PIN });
    expect(pair.status).toBe(409);
    expect(await pair.json()).toMatchObject({
      error: { code: "printer.bluetooth_not_discovered" },
    });
    // The control: the same entry's pairing report is fresh, so Forget is accepted.
    const forget = await command(app, agentId, "forget", { address: mac });
    expect(forget.status).toBe(202);
  });

  it("accepts Pair up to fifteen seconds after the scan, the window the discovered list shows when no discovery window is open", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    const scannedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(scannedAt);
    await pull(app, token, { scanned: [scannedMac(mac)] });
    vi.spyOn(Date, "now").mockReturnValue(scannedAt + 15_000);

    expect((await discoveredRows(app)).filter((r) => r.localKey === mac)).toHaveLength(1);
    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    expect(res.status).toBe(202);
  });

  it("keeps listing devices reported once per slow scan pass for as long as the window is renewed", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const scannedOnly = randomMac();
    const paired = randomMac();
    const host = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    const opened = await send(app, "POST", "/management-api/printer-discovery/start", {
      cookie: managerCookie,
    });
    expect(opened.status).toBe(200);
    const listed = async () =>
      (await discoveredRows(app))
        .filter((r) => r.localKey === scannedOnly || r.localKey === paired || r.host === host)
        .map((r) => ({ key: r.localKey ?? r.host, paired: r.paired ?? false }))
        .sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const everything = [
      { key: scannedOnly, paired: false },
      { key: paired, paired: true },
      { key: host, paired: false },
    ].sort((a, b) => a.key.localeCompare(b.key));

    // Twelve passes of 20 s each: longer than one 15 s report lifetime, and four minutes in all,
    // past the three-minute window one start opens.
    const PASS_MS = 20_000;
    for (let pass = 0; pass < 12; pass++) {
      const reportedAt = start + pass * PASS_MS;
      vi.spyOn(Date, "now").mockReturnValue(reportedAt);
      if (pass > 0 && pass % 3 === 0) {
        const renewed = await send(app, "POST", "/management-api/printer-discovery/renew", {
          cookie: managerCookie,
        });
        expect(renewed.status).toBe(200);
      }
      await pull(app, token, {
        scanned: [scannedMac(scannedOnly), { transport: "network_tcp", host, port: 9100 }],
        pairedBluetooth: [{ localKey: paired }],
      });
      vi.spyOn(Date, "now").mockReturnValue(reportedAt + PASS_MS - 1);
      expect(await listed()).toEqual(everything);
    }
    const lastReport = start + 11 * PASS_MS;
    vi.spyOn(Date, "now").mockReturnValue(lastReport + 45_000);
    expect(await listed()).toEqual(everything);
    expect((await command(app, agentId, "pair", { address: scannedOnly, pin: PIN })).status).toBe(
      202,
    );
    expect((await command(app, agentId, "forget", { address: paired })).status).toBe(202);
    vi.spyOn(Date, "now").mockReturnValue(lastReport + 45_001);
    expect(await listed()).toEqual([]);
  });

  it("refuses the ninth distinct address for one agent with printer.bluetooth_command_busy", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const macs = Array.from({ length: 9 }, randomMac);
    await pull(app, token, { scanned: macs.map((mac) => scannedMac(mac)) });

    for (const mac of macs.slice(0, 8)) {
      expect((await command(app, agentId, "pair", { address: mac, pin: PIN })).status).toBe(202);
    }
    const ninth = await command(app, agentId, "pair", { address: macs[8], pin: PIN });
    expect(ninth.status).toBe(429);
    expect(await ninth.json()).toEqual({
      error: { code: "printer.bluetooth_command_busy", params: {} },
    });
    expect((await pull(app, token)).bluetoothCommands).toHaveLength(8);
  });

  it("refuses a malformed address or PIN with management.request_invalid naming the field", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { scanned: [scannedMac(mac)], pairedBluetooth: [{ localKey: mac }] });

    const refusals: [kind: "pair" | "forget", body: unknown, field: string][] = [
      ["pair", { pin: PIN }, "address"],
      ["pair", { address: "AA:BB:CC:DD:EE", pin: PIN }, "address"],
      ["pair", { address: "*", pin: PIN }, "address"],
      ["pair", { address: 42, pin: PIN }, "address"],
      ["forget", {}, "address"],
      ["forget", { address: `${mac}:00` }, "address"],
      ["pair", { address: mac }, "pin"],
      ["pair", { address: mac, pin: "" }, "pin"],
      ["pair", { address: mac, pin: "12 34" }, "pin"],
      ["pair", { address: mac, pin: "1".repeat(17) }, "pin"],
      ["pair", { address: mac, pin: 1234 }, "pin"],
    ];
    for (const [kind, body, field] of refusals) {
      const res = await command(app, agentId, kind, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    const agentPath = `/management-api/print-agents/not-a-uuid/bluetooth/pair`;
    const badAgent = await send(app, "POST", agentPath, {
      cookie: managerCookie,
      body: { address: mac, pin: PIN },
    });
    expect(badAgent.status).toBe(400);
    expect((await pull(app, token)).bluetoothCommands).toBeUndefined();
  });

  it("normalises a lower-case address to upper case", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { scanned: [scannedMac(mac)] });

    const res = await command(app, agentId, "pair", { address: mac.toLowerCase(), pin: PIN });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { command: { address: string } }).command.address).toBe(mac);
    expect((await pull(app, token)).bluetoothCommands).toEqual([
      { id: expect.any(String), kind: "pair", address: mac, pin: PIN },
    ]);
  });

  it("sends a Pair to the named agent's pulls, and only its pulls, until the pull that carries its outcome", async () => {
    const app = mountApp();
    const target = await joinAndAccept(app, "Target");
    const bystander = await joinAndAccept(app, "Bystander");
    const mac = randomMac();
    await pull(app, target.token, { scanned: [scannedMac(mac, { printerLike: true })] });
    await pull(app, bystander.token, { scanned: [scannedMac(mac)] });

    const res = await command(app, target.agentId, "pair", { address: mac, pin: PIN });
    expect(res.status).toBe(202);
    const { command: queued } = (await res.json()) as { command: { id: string } };
    expect(queued).toEqual({
      id: expect.any(String),
      kind: "pair",
      address: mac,
      state: "pending",
      expiresInMs: 120_000,
    });

    const expected = [{ id: queued.id, kind: "pair", address: mac, pin: PIN }];
    expect((await pull(app, target.token)).bluetoothCommands).toEqual(expected);
    expect((await pull(app, target.token)).bluetoothCommands).toEqual(expected);
    expect((await pull(app, bystander.token)).bluetoothCommands).toBeUndefined();
    // An outcome from another agent naming this id does not settle it.
    await pull(app, bystander.token, { bluetoothOutcomes: [{ id: queued.id, ok: true }] });
    expect((await pull(app, target.token)).bluetoothCommands).toEqual(expected);

    const settled = await pull(app, target.token, {
      scanned: [scannedMac(mac, { printerLike: true })],
      pairedBluetooth: [{ localKey: mac }],
      bluetoothOutcomes: [{ id: queued.id, ok: true }],
    });
    expect(settled.bluetoothCommands).toBeUndefined();
    expect((await pull(app, target.token)).bluetoothCommands).toBeUndefined();

    const row = (await discoveredRows(app)).find(
      (r) => r.agentId === target.agentId && r.localKey === mac,
    );
    expect(row).toMatchObject({
      transport: "bluetooth",
      printerLike: true,
      paired: true,
      bluetoothCommand: { id: queued.id, kind: "pair", address: mac, state: "succeeded" },
    });
    const bystanderRow = (await discoveredRows(app)).find(
      (r) => r.agentId === bystander.agentId && r.localKey === mac,
    );
    expect(bystanderRow).not.toHaveProperty("bluetoothCommand");
    expect(bystanderRow).not.toHaveProperty("paired");
    expect(bystanderRow).not.toHaveProperty("printerLike");
  });

  it("sends a Forget without a PIN, and keeps a failed outcome's reason bounded to 500 characters", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { pairedBluetooth: [{ localKey: mac, name: "Bolsillo" }] });

    const res = await command(app, agentId, "forget", { address: mac, pin: PIN });
    expect(res.status).toBe(202);
    const { command: queued } = (await res.json()) as { command: { id: string } };
    expect((await pull(app, token)).bluetoothCommands).toEqual([
      { id: queued.id, kind: "forget", address: mac },
    ]);

    const reason = `Failed to remove device: ${"x".repeat(600)}`;
    await pull(app, token, {
      pairedBluetooth: [{ localKey: mac, name: "Bolsillo" }],
      bluetoothOutcomes: [{ id: queued.id, ok: false, error: reason }],
    });
    const row = (await discoveredRows(app)).find((r) => r.localKey === mac);
    expect(row).toMatchObject({
      agentId,
      transport: "bluetooth",
      name: "Bolsillo",
      paired: true,
      bluetoothCommand: {
        id: queued.id,
        kind: "forget",
        address: mac,
        state: "failed",
        error: reason.slice(0, 500),
      },
    });
  });

  it("ignores malformed outcomes and paired reports", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { scanned: [scannedMac(mac)] });
    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    const { command: queued } = (await res.json()) as { command: { id: string } };

    const bad = randomMac();
    const reply = await pull(app, token, {
      pairedBluetooth: [null, "x", { localKey: "not-a-mac" }, { localKey: 7 }, { name: bad }],
      bluetoothOutcomes: [
        null,
        { id: queued.id },
        { id: queued.id, ok: "yes" },
        { id: queued.id, ok: true, error: 5 },
        { id: 7, ok: true },
      ],
    });
    expect(reply.bluetoothCommands).toEqual([
      { id: queued.id, kind: "pair", address: mac, pin: PIN },
    ]);
    const rows = await discoveredRows(app);
    expect(rows.filter((r) => r.agentId === agentId && r.paired === true)).toEqual([]);
    expect(rows.filter((r) => r.agentId === agentId).map((r) => r.localKey)).toEqual([mac]);

    // A non-array field is no report at all, and the pull still succeeds.
    const odd = await pull(app, token, { pairedBluetooth: {}, bluetoothOutcomes: "done" });
    expect(odd.bluetoothCommands).toHaveLength(1);
  });

  it("takes at most eight outcomes from one pull", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { scanned: [scannedMac(mac)] });
    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    const { command: queued } = (await res.json()) as { command: { id: string } };

    const filler = Array.from({ length: 8 }, () => ({ id: randomUUID(), ok: true }));
    const late = await pull(app, token, {
      bluetoothOutcomes: [...filler, { id: queued.id, ok: true }],
    });
    expect(late.bluetoothCommands).toHaveLength(1);
    const settled = await pull(app, token, { bluetoothOutcomes: [{ id: queued.id, ok: true }] });
    expect(settled.bluetoothCommands).toBeUndefined();
  });

  it("expires a command two minutes after it was queued and a result a minute after it arrived", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const first = randomMac();
    const second = randomMac();
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    await pull(app, token, { scanned: [scannedMac(first), scannedMac(second)] });
    await command(app, agentId, "pair", { address: first, pin: PIN });
    const res = await command(app, agentId, "pair", { address: second, pin: PIN });
    const { command: queued } = (await res.json()) as { command: { id: string } };
    await pull(app, token, { bluetoothOutcomes: [{ id: queued.id, ok: true }] });

    vi.spyOn(Date, "now").mockReturnValue(start + 59_999);
    await pull(app, token, { scanned: [scannedMac(first), scannedMac(second)] });
    let rows = await discoveredRows(app);
    expect(rows.find((r) => r.localKey === second)).toMatchObject({
      bluetoothCommand: { state: "succeeded" },
    });

    vi.spyOn(Date, "now").mockReturnValue(start + 60_000);
    await pull(app, token, { scanned: [scannedMac(first), scannedMac(second)] });
    rows = await discoveredRows(app);
    expect(rows.find((r) => r.localKey === second)).not.toHaveProperty("bluetoothCommand");
    expect(rows.find((r) => r.localKey === first)).toMatchObject({
      bluetoothCommand: { state: "pending" },
    });

    vi.spyOn(Date, "now").mockReturnValue(start + 120_000);
    const reply = await pull(app, token, { scanned: [scannedMac(first), scannedMac(second)] });
    expect(reply.bluetoothCommands).toBeUndefined();
    rows = await discoveredRows(app);
    expect(rows.find((r) => r.localKey === first)).not.toHaveProperty("bluetoothCommand");
  });

  it("answers agent.not_found for an agent id no row names, on Pair and on Forget", async () => {
    const app = mountApp();
    const unknown = randomUUID();
    const mac = randomMac();
    const attempts = [
      ["pair", { address: mac, pin: PIN }],
      ["forget", { address: mac }],
    ] as const;
    for (const [kind, body] of attempts) {
      const res = await command(app, unknown, kind, body);
      expect(res.status, kind).toBe(404);
      expect(await res.json()).toEqual({
        error: { code: "agent.not_found", params: { id: unknown } },
      });
    }
  });

  it("withholds a failed Pair's whole reason when the agent's outcome carries the PIN", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const plain = randomMac();
    const straddled = randomMac();
    const scanned = [scannedMac(plain), scannedMac(straddled)];
    await pull(app, token, { scanned });
    const ids: string[] = [];
    for (const mac of [plain, straddled]) {
      const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
      expect(res.status).toBe(202);
      ids.push(((await res.json()) as { command: { id: string } }).command.id);
    }

    await pull(app, token, {
      scanned,
      bluetoothOutcomes: [
        { id: ids[0], ok: false, error: `Pair failed for PIN ${PIN}` },
        // Past the 500-character bound, so bounding before withholding would keep "Zq7".
        { id: ids[1], ok: false, error: `${"x".repeat(497)}${PIN}` },
      ],
    });
    const listed = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    const listing = await listed.text();
    expect(listing).not.toContain(PIN.slice(0, 3));
    const rows = (JSON.parse(listing) as Record<string, unknown>[]).filter(
      (r) => r.agentId === agentId,
    );
    for (const mac of [plain, straddled]) {
      expect(rows.find((r) => r.localKey === mac)).toMatchObject({
        bluetoothCommand: { state: "failed", error: PIN_WITHHELD },
      });
    }
  });

  it("tells the dashboard how long a pending command has left, in the 202 and on its row", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    await pull(app, token, { scanned: [scannedMac(mac)] });
    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    const { command: queued } = (await res.json()) as { command: Record<string, unknown> };
    expect(queued).toMatchObject({ state: "pending", expiresInMs: 120_000 });

    vi.spyOn(Date, "now").mockReturnValue(start + 10_000);
    await pull(app, token, { scanned: [scannedMac(mac)] });
    expect((await discoveredRows(app)).find((r) => r.localKey === mac)).toMatchObject({
      bluetoothCommand: { id: queued.id, state: "pending", expiresInMs: 110_000 },
    });

    await pull(app, token, {
      scanned: [scannedMac(mac)],
      bluetoothOutcomes: [{ id: queued.id, ok: true }],
    });
    const row = (await discoveredRows(app)).find((r) => r.localKey === mac);
    expect(row).toMatchObject({ bluetoothCommand: { state: "succeeded" } });
    expect(row).not.toHaveProperty("bluetoothCommand.expiresInMs");
  });

  it("reads a lower-case visible Bluetooth address as upper case: one row with its pairing, and it claims", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bolsillo", transport: "bluetooth", localKey: mac },
    });
    const { id: printerId } = (await created.json()) as { id: string };
    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 7").cut().bytes());

    const reply = await pull(app, token, {
      visible: [{ transport: "bluetooth", localKey: mac.toLowerCase() }],
      pairedBluetooth: [{ localKey: mac }],
    });
    expect(reply.jobs.filter((job) => job.printerId === printerId).map((job) => job.id)).toEqual([
      jobId,
    ]);
    const rows = (await discoveredRows(app)).filter(
      (r) => r.agentId === agentId && r.transport === "bluetooth",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ localKey: mac, paired: true });
  });

  it("never returns or logs the PIN outside the pending command in the named agent's pull", async () => {
    const lines: string[] = [];
    const log: Logger = (...args) => {
      lines.push(JSON.stringify(args));
    };
    const app = mountApp({ log });
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    await pull(app, token, { scanned: [scannedMac(mac)] });

    const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
    expect(res.status).toBe(202);
    const accepted = await res.text();
    expect(accepted).not.toContain(PIN);
    expect(JSON.parse(accepted)).not.toHaveProperty("command.pin");

    const refused = await command(app, agentId, "pair", { address: mac, pin: `${PIN} ` });
    expect(refused.status).toBe(400);
    expect(await refused.text()).not.toContain(PIN);

    const listed = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    const listing = await listed.text();
    expect(listing).toContain(mac);
    expect(listing).not.toContain(PIN);
    expect(listing).not.toContain('"pin"');

    const pulled = await send(app, "POST", "/print-api/agent/jobs", { bearer: token, body: {} });
    expect(await pulled.text()).toContain(PIN);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain(PIN);
  });

  it("lists a paired device no scan reported, matched to its registered printer, and never claims its jobs", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const mac = randomMac();
    const created = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bolsillo", transport: "bluetooth", localKey: mac },
    });
    expect(created.status).toBe(201);
    const { id: printerId } = (await created.json()) as { id: string };
    const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 5").cut().bytes());

    const reply = await pull(app, token, {
      visible: [],
      scanned: [],
      pairedBluetooth: [{ localKey: mac.toLowerCase(), name: "Bolsillo" }],
    });
    expect(reply.jobs.filter((job) => job.printerId === printerId)).toEqual([]);
    expect((await jobRow(jobId)).status).toBe("queued");

    const rows = (await discoveredRows(app)).filter((r) => r.agentId === agentId);
    expect(rows.map((r) => ({ ...r, lastSeenAt: undefined }))).toEqual([
      {
        agentId,
        agentName: "Cocina agent",
        transport: "bluetooth",
        localKey: mac,
        name: "Bolsillo",
        paired: true,
        alreadyRegistered: true,
        printerId,
      },
    ]);
    expect(Date.parse(rows[0]!.lastSeenAt as string)).toBeGreaterThan(0);
  });

  it("keeps a scan's description when a later pairing report arrives, and drops the row once both are stale", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const mac = randomMac();
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    await pull(app, token, {
      scanned: [scannedMac(mac, { name: "Impresora", printerLike: true, make: "Epson" })],
    });
    vi.spyOn(Date, "now").mockReturnValue(start + 10_000);
    await pull(app, token, { pairedBluetooth: [{ localKey: mac, name: "Other name" }] });

    vi.spyOn(Date, "now").mockReturnValue(start + 20_000);
    expect((await discoveredRows(app)).find((r) => r.localKey === mac)).toMatchObject({
      name: "Impresora",
      make: "Epson",
      printerLike: true,
      paired: true,
    });
    vi.spyOn(Date, "now").mockReturnValue(start + 25_001);
    expect((await discoveredRows(app)).filter((r) => r.localKey === mac)).toEqual([]);
  });

  it("marks paired only while the pairing report is fresh", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const mac = randomMac();
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    await pull(app, token, { pairedBluetooth: [{ localKey: mac }] });
    vi.spyOn(Date, "now").mockReturnValue(start + 10_000);
    await pull(app, token, { scanned: [scannedMac(mac)] });

    vi.spyOn(Date, "now").mockReturnValue(start + 15_001);
    const row = (await discoveredRows(app)).find((r) => r.localKey === mac);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("paired");
  });

  it("keeps printerLike only when the agent sent exactly true", async () => {
    const app = mountApp();
    const { token } = await joinAndAccept(app);
    const like = randomMac();
    const unlike = randomMac();
    const host = "10.9.252.1";
    await pull(app, token, {
      scanned: [
        scannedMac(like, { printerLike: true }),
        scannedMac(unlike, { printerLike: "yes" }),
        { transport: "network_tcp", host, port: 9100, printerLike: true },
      ],
    });
    const rows = await discoveredRows(app);
    expect(rows.find((r) => r.localKey === like)).toMatchObject({ printerLike: true });
    expect(rows.find((r) => r.localKey === unlike)).not.toHaveProperty("printerLike");
    // The mark describes Bluetooth devices only.
    expect(rows.find((r) => r.host === host)).not.toHaveProperty("printerLike");
  });
  describe("an unpairing switches its printer off and ends its waiting jobs", () => {
    async function registerBluetooth(app: Hono, mac: string): Promise<string> {
      const created = await send(app, "POST", "/management-api/printers", {
        cookie: managerCookie,
        body: { name: `BT ${mac}`, transport: "bluetooth", localKey: mac },
      });
      expect(created.status).toBe(201);
      return ((await created.json()) as { id: string }).id;
    }

    async function isActive(printerId: string): Promise<boolean> {
      const { rows } = await suite.db.execute<{ active: number }>(
        sql`select active from printers where id = ${printerId}`,
      );
      return Number(rows[0]!.active) === 1;
    }

    /** Queues an Unpair for `mac` on the agent and returns its command id. */
    async function queueUnpair(app: Hono, agentId: string, token: string, mac: string) {
      await pull(app, token, { pairedBluetooth: [{ localKey: mac }] });
      const res = await command(app, agentId, "forget", { address: mac });
      expect(res.status).toBe(202);
      return ((await res.json()) as { command: { id: string } }).command.id;
    }

    it("switches off the printer at the address once the agent reports the unpairing succeeded, and that pull hands out none of its jobs", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const bystanderMac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const bystanderId = await registerBluetooth(app, bystanderMac);
      const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());
      const id = await queueUnpair(app, agentId, token, mac);
      expect(await isActive(printerId)).toBe(true);

      // Still visible in the same pull, so without the switch-off this pull would claim the job.
      const reply = await pull(app, token, {
        visible: [{ transport: "bluetooth", localKey: mac }],
        bluetoothOutcomes: [{ id, ok: true }],
      });

      expect(await isActive(printerId)).toBe(false);
      expect(await isActive(bystanderId)).toBe(true);
      expect(reply.jobs.map((job) => job.id)).not.toContain(jobId);
      expect(await jobRow(jobId)).toMatchObject({
        status: "failed",
        attempts: MAX_DELIVERY_ATTEMPTS,
        last_error: PRINTER_UNPAIRED,
      });
      expect((await discoveredRows(app)).find((r) => r.localKey === mac)).toMatchObject({
        bluetoothCommand: { id, kind: "forget", state: "succeeded" },
      });
    });

    it("leaves the printer switched on when the unpairing failed", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const id = await queueUnpair(app, agentId, token, mac);

      await pull(app, token, { bluetoothOutcomes: [{ id, ok: false, error: "Not available" }] });

      expect(await isActive(printerId)).toBe(true);
    });

    it("leaves the printer switched on when a succeeded pairing, not an unpairing, is reported", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      await pull(app, token, { scanned: [scannedMac(mac)] });
      const res = await command(app, agentId, "pair", { address: mac, pin: PIN });
      const { command: queued } = (await res.json()) as { command: { id: string } };

      await pull(app, token, { bluetoothOutcomes: [{ id: queued.id, ok: true }] });

      expect(await isActive(printerId)).toBe(true);
    });

    it("leaves the printer switched on while another box reports it can print to it", async () => {
      const app = mountApp();
      const holder = await joinAndAccept(app, "Holder");
      const other = await joinAndAccept(app, "Other");
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const id = await queueUnpair(app, holder.agentId, holder.token, mac);
      await pull(app, other.token, {
        visible: [{ transport: "bluetooth", localKey: mac }],
        pairedBluetooth: [{ localKey: mac }],
      });

      await pull(app, holder.token, { bluetoothOutcomes: [{ id, ok: true }] });

      expect(await isActive(printerId)).toBe(true);
    });

    it("switches the printer off when the other box's report is older than fifteen seconds", async () => {
      const app = mountApp();
      const holder = await joinAndAccept(app, "Holder");
      const other = await joinAndAccept(app, "Other");
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const start = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(start);
      await pull(app, other.token, { visible: [{ transport: "bluetooth", localKey: mac }] });
      vi.spyOn(Date, "now").mockReturnValue(start + 15_001);
      const id = await queueUnpair(app, holder.agentId, holder.token, mac);

      await pull(app, holder.token, { bluetoothOutcomes: [{ id, ok: true }] });

      expect(await isActive(printerId)).toBe(false);
    });

    const UNPAIRED_END = {
      status: "failed",
      attempts: MAX_DELIVERY_ATTEMPTS,
      last_error: PRINTER_UNPAIRED,
    };

    it("ends the printer's waiting jobs once the agent reports the unpairing succeeded, and leaves another printer's", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const bystanderId = await registerBluetooth(app, randomMac());
      const first = await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());
      const second = await enqueue(printerId, esc(WIDE).line("Mesa 4").cut().bytes());
      const bystanderJob = await enqueue(bystanderId, esc(WIDE).line("Mesa 5").cut().bytes());
      const id = await queueUnpair(app, agentId, token, mac);

      await pull(app, token, { bluetoothOutcomes: [{ id, ok: true }] });

      expect(await jobRow(first)).toMatchObject(UNPAIRED_END);
      expect(await jobRow(second)).toMatchObject(UNPAIRED_END);
      expect(await jobRow(bystanderJob)).toMatchObject({
        status: "queued",
        attempts: 0,
        last_error: null,
      });
    });

    it("ends a waiting drawer kick for the unpaired printer", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const kick = await withTransaction(suite.db, async (tx) => {
        const { jobId } = await enqueuePrintJob(
          tx,
          { locationId },
          printerId,
          esc().kick().bytes(),
          "drawer",
        );
        return jobId;
      });
      const id = await queueUnpair(app, agentId, token, mac);

      await pull(app, token, { bluetoothOutcomes: [{ id, ok: true }] });

      expect(await jobRow(kick)).toMatchObject(UNPAIRED_END);
    });

    it("ends none of the printer's jobs when the unpairing failed", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());
      const id = await queueUnpair(app, agentId, token, mac);

      await pull(app, token, { bluetoothOutcomes: [{ id, ok: false, error: "Not available" }] });

      expect(await jobRow(jobId)).toMatchObject({
        status: "queued",
        attempts: 0,
        last_error: null,
      });
    });

    it("ends none of the printer's jobs while another box reports it can print to it", async () => {
      const app = mountApp();
      const holder = await joinAndAccept(app, "Holder");
      const other = await joinAndAccept(app, "Other");
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const id = await queueUnpair(app, holder.agentId, holder.token, mac);
      await pull(app, other.token, { visible: [{ transport: "bluetooth", localKey: mac }] });
      // Enqueued after the other box's pull, so that pull has not claimed it.
      const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());

      await pull(app, holder.token, { bluetoothOutcomes: [{ id, ok: true }] });

      expect(await jobRow(jobId)).toMatchObject({
        status: "queued",
        attempts: 0,
        last_error: null,
      });
    });

    it("ends the printer's jobs when the other box's report is older than fifteen seconds", async () => {
      const app = mountApp();
      const holder = await joinAndAccept(app, "Holder");
      const other = await joinAndAccept(app, "Other");
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const start = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(start);
      await pull(app, other.token, { visible: [{ transport: "bluetooth", localKey: mac }] });
      vi.spyOn(Date, "now").mockReturnValue(start + 15_001);
      const id = await queueUnpair(app, holder.agentId, holder.token, mac);
      const jobId = await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());

      await pull(app, holder.token, { bluetoothOutcomes: [{ id, ok: true }] });

      expect(await jobRow(jobId)).toMatchObject(UNPAIRED_END);
    });

    it("raises no printer alert for the ended jobs once the printer is switched back on, while a job stuck after that still raises one", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());
      const id = await queueUnpair(app, agentId, token, mac);
      await pull(app, token, { bluetoothOutcomes: [{ id, ok: true }] });
      const reactivated = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
        cookie: managerCookie,
        body: { active: true },
      });
      expect(reactivated.status).toBe(204);
      const alertsFor = async (now: Date) =>
        (await withTransaction(suite.db, (tx) => printingAlertSource().read({ tx, now }))).filter(
          (a) => a.key === `printer.jobs_waiting:${printerId}`,
        );
      // Past the waiting window, so an ordinary job not yet printed counts as stuck.
      const later = new Date(Date.now() + JOBS_WAITING_MS + 60_000);

      expect(await alertsFor(later)).toEqual([]);

      await enqueue(printerId, esc(WIDE).line("Mesa 4").cut().bytes());
      expect(await alertsFor(later)).toMatchObject([
        { code: "printer.jobs_waiting", params: { count: 1 } },
      ]);
    });

    it("hands out only the calibration test page when the printer is switched back on after the unpairing", async () => {
      const app = mountApp();
      const { agentId, token } = await joinAndAccept(app);
      const mac = randomMac();
      const printerId = await registerBluetooth(app, mac);
      const stale = await enqueue(printerId, esc(WIDE).line("Mesa 3").cut().bytes());
      const id = await queueUnpair(app, agentId, token, mac);
      await pull(app, token, { bluetoothOutcomes: [{ id, ok: true }] });

      // What the dashboard's Enable sends, then the calibration wizard's first print.
      const reactivated = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
        cookie: managerCookie,
        body: { active: true },
      });
      expect(reactivated.status).toBe(204);
      const printed = await send(app, "POST", `/management-api/printers/${printerId}/test-print`, {
        cookie: managerCookie,
      });
      expect(printed.status).toBe(202);
      const { jobId: testPage } = (await printed.json()) as { jobId: string };

      const reply = await pull(app, token, {
        visible: [{ transport: "bluetooth", localKey: mac }],
      });

      expect(reply.jobs.filter((job) => job.printerId === printerId).map((job) => job.id)).toEqual([
        testPage,
      ]);
      expect(await jobRow(stale)).toMatchObject(UNPAIRED_END);
    });
  });
});
