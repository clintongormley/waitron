import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, joinRequests, printAgents, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { enqueuePrintJob, esc } from "@waitron/printing";
import type { NetworkProbe } from "@waitron/print-agent";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountPrintApi } from "./print-api.js";
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

// PGlite, not real Postgres: this suite proves the ROUTES — the request/response boundary, the body +
// id screens, the agent Bearer guard, the claim/report logic, the management-gate wiring and the STATUS
// map — end to end in-process, the same way `purchasing-api.test.ts` proves the purchase routes. The
// agent-scope filters (cross-agent claim → empty, cross-agent report → no-op) and the revocation filter
// (`active = true`) are QUERY predicates, so PGlite shows them faithfully. The two properties PGlite
// CANNOT show — the routes running as the non-owner app role with only its grants (the gate proven by
// DELETION there) and the claim's `for update … skip locked` under true concurrency — live in
// `print-api.pg.test.ts` against real Postgres (CLAUDE.md §4). Tests share the seeded tenant and
// create their own printers; assertions about tenant-wide results must account for other tests' jobs.
const noopLog: Logger = () => {};

// The venue's routable servers the pull route echoes (via `readMembership` → `routableServers`).
// A held chart with a primary + a secondary, so the pull test asserts the mapped, primary-first list.
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

let tenantId: string;
let locationId: string;
let cfg: TillConfig;
let managerCookie: string;
let staffCookie: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    locationId = loc.rows[0]!.id;
    // The FULL TillConfig the print verbs are typed on (branded ids). Only tenantId/locationId are read
    // by the join verbs and the routes; nodeId is echoed on the pull; the other fiscal ids are unused
    // here, so a branded random uuid stands in.
    cfg = {
      tenantId: brandTenantId(tenantId),
      tillId: brandTillId(randomUUID()),
      nodeId: brandNodeId(randomUUID()),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
      orderFlow: "ticket_then_pay",
    };
    const { managerSid, staffSid } = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
      const managerSession = await startManagementSession(tx, {
        tenantId,
        personId: mgr.rows[0]!.id,
      });
      const staffSession = await startManagementSession(tx, {
        tenantId,
        personId: stf.rows[0]!.id,
      });
      return { managerSid: managerSession.id, staffSid: staffSession.id };
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
    staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
  },
});

/** Mount the print API. The pairing window is OPEN by default so `joinAndAccept`'s knock is admitted;
 *  `pairingOpen: false` proves the shut-window refusal. `readMembership` returns the fixture above so
 *  the pull route can echo `servers`. */
function mountApp(opts: { pairingOpen?: boolean; enrolRateLimiter?: EnrolRateLimiter } = {}): Hono {
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
    },
    noopLog,
  );
  return app;
}

/** JSON request helper. `cookie` sends a management session; `bearer` sends an agent token; neither is
 * sent unless named (each caller is explicit about which auth it exercises). */
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

/** Knock (unauth, window-gated) then accept the join in-process (via the verb, as `enqueue` does — the
 * accept ROUTE lives in `join-api.ts` and is proven there), returning the enrolled agent's id + Bearer
 * token. The agent's Bearer is exactly the knock's `${joinId}.${secret}`, and `joinId` becomes the
 * agent id (accept carries it onto the `print_agents` row). */
async function joinAndAccept(
  app: Hono,
  label = "Cocina agent",
): Promise<{ agentId: string; token: string }> {
  const { token, verificationNumber, joinId } = await knock(app, label);
  await withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const result = await acceptPrintAgentJoinRequest(tx, cfg, joinId, {
      choice: verificationNumber,
    });
    expect(result.ok).toBe(true);
  });
  return { agentId: joinId, token };
}

/** Knock the unauthenticated join route (window must be open) and return its reply plus the parsed
 * joinId (the selector half of the token). */
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

/** Create a network_tcp printer via the management route, returning its id. The `agentId` is passed in
 * the body but IGNORED by the create route (which agent serves a printer is derived at run time, never
 * stored — design §3); it is kept here so callers read naturally against a just-enrolled agent. */
async function createPrinterVia(app: Hono, agentId: string, name = "Cocina"): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "network_tcp", agentId, host: "10.0.0.9" },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Create a usb printer keyed on `localKey` (the USB serial) via the management route. */
async function createUsbPrinter(app: Hono, localKey: string, name = "USB"): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "usb", localKey },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Create a network_tcp printer on host:port via the management route, returning its id. */
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

/** POST the agent pull carrying an inventory (`visible`/`scanned` default to empty), asserting 200 and
 * returning the parsed reply. The pull is a POST (design §8): the body carries the box's live inventory. */
async function pull(
  app: Hono,
  token: string,
  inventory: { visible?: unknown; scanned?: unknown } = {},
): Promise<PullReply> {
  const res = await send(app, "POST", "/print-api/agent/jobs", { bearer: token, body: inventory });
  expect(res.status).toBe(200);
  return (await res.json()) as PullReply;
}

/** Enqueue one job on `printerId` (directly via the outbox verb — there is no enqueue ROUTE in this
 * slice; a fire/sale enqueues in-process). Returns the job id. */
async function enqueue(printerId: string, payload: Uint8Array): Promise<string> {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    const { jobId } = await enqueuePrintJob(tx, { tenantId, locationId }, printerId, payload);
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
    // Nothing was written — the window guard runs before any DB work.
    const rows = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
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
    // `${joinId}.${secret}` — a uuid selector, a dot, then the base64url secret.
    expect(body.token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    const joinId = body.token.slice(0, body.token.indexOf("."));
    const [pending] = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select({ kind: joinRequests.kind })
        .from(joinRequests)
        .where(eq(joinRequests.id, joinId));
    });
    expect(pending).toMatchObject({ kind: "print_agent" });
    // The knock alone never creates the real row — that is the admin's accept.
    const agents = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
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
    // THE GUARD (proven by deletion): a per-process GLOBAL fixed-window counter checked at the TOP of the
    // knock handler, before the body parse and the window check. Deleting `enrolLimiter.check()` from
    // print-api.ts's knock route makes the (cap+1)th attempt reach the handler (201) instead of 429.
    let fakeNow = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => fakeNow });
    const app = mountApp({ pairingOpen: true, enrolRateLimiter: limiter });
    for (let i = 0; i < ENROL_RATE_MAX; i++) limiter.check();
    const limited = await send(app, "POST", "/print-api/agent/join", { body: { name: "x" } });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.join_rate_limited" },
    });
    // Past the window — the counter resets and a well-formed knock reaches the handler (201).
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

    // Accept in-process (the route is proven in join-api.pg.test.ts).
    await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const r = await acceptPrintAgentJoinRequest(tx, cfg, joinId, { choice: verificationNumber });
      expect(r.ok).toBe(true);
    });
    const approved = await send(app, "GET", "/print-api/agent/join/status", { bearer: token });
    expect((await approved.json()) as { status: string }).toEqual({ status: "approved" });

    // A non-uuid selector is guarded to `not_approved`, never a 22P02 → 500.
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
    // The opaque bytes round-trip through base64 exactly.
    expect(Buffer.from(jobs[0]!.payload, "base64").equals(Buffer.from(payload))).toBe(true);
    // The claim COMMITTED within the request: a fresh read sees the job as `printing`, and a SECOND
    // claim returns nothing (it is no longer `queued`).
    expect((await jobRow(jobId)).status).toBe("printing");
    const again = await send(app, "POST", "/print-api/agent/jobs", { bearer: token });
    expect(((await again.json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
  });

  it("does NOT claim a usb job whose key the pulling box cannot see (derived eligibility)", async () => {
    // Derived eligibility (design §3/§5): a usb printer's job is claimable ONLY by the box that
    // currently SEES its local_key. `mine` pulls WITHOUT that key visible, so the usb job stays queued —
    // the replacement for the old agent-bound scope (network_tcp is now location-scoped, so a
    // cross-agent claim of a network printer is expected, not a leak; the key-scope is the isolation).
    const app = mountApp();
    const mine = await joinAndAccept(app, "Mine");
    const serial = `SN-${randomUUID()}`;
    const usbPrinter = await createUsbPrinter(app, serial, "Other USB");
    const jobId = await enqueue(usbPrinter, new Uint8Array([1]));

    const res = await pull(app, mine.token, { visible: [], scanned: [] });
    expect(res.jobs).toHaveLength(0);
    expect((await jobRow(jobId)).status).toBe("queued"); // untouched — the key is not visible
  });

  it("reports done → the job is done with delivered_at; failed → failed with attempts++ and last_error", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const doneJob = await enqueue(printerId, new Uint8Array([1]));
    const failJob = await enqueue(printerId, new Uint8Array([2]));
    // Claim both so they are `printing` (the state a real agent reports from).
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
      body: { status: "failed" }, // no `error` — the route defaults it to ""
    });
    expect(res.status).toBe(204);
    const row = await jobRow(jobId);
    expect(row.status).toBe("failed");
    expect(row.last_error).toBe("");
  });

  it("a report for another agent's job is an idempotent no-op (204, the job is NOT mutated)", async () => {
    // THE GUARD (proven by deletion): `reportPrintJob`'s `and print_jobs.claimed_by = ${agentId}`
    // predicate scopes the report to the agent that CLAIMED the job (design §5). The OTHER agent CLAIMS
    // the job first so it is `printing` and stamped `claimed_by = other` — otherwise the idempotency
    // guard (`status = 'printing'`) alone would block the report and the claimer-scope deletion would
    // FALSE-pass. With the job `printing`, deleting the `claimed_by` predicate makes this cross-agent
    // report mutate the other agent's job (status → done), flipping the `toBe("printing")` assertion red.
    const app = mountApp();
    const mine = await joinAndAccept(app, "Mine");
    const other = await joinAndAccept(app, "Other");
    const otherPrinter = await createPrinterVia(app, other.agentId, "Other printer");
    const jobId = await enqueue(otherPrinter, new Uint8Array([1]));
    await send(app, "POST", "/print-api/agent/jobs", { bearer: other.token }); // other claims → printing

    const res = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: mine.token,
      body: { status: "done" },
    });
    expect(res.status).toBe(204); // idempotent sink — no oracle
    expect((await jobRow(jobId)).status).toBe("printing"); // the other agent's claimed job is untouched
  });

  it("a duplicated failed report is idempotent — attempts is bumped ONCE (the status='printing' guard)", async () => {
    // THE GUARD (proven by deletion): the `and print_jobs.status = 'printing'` predicate makes a report
    // apply only to a currently-claimed job. Deleting it from `reportPrintJob`'s failed path lets the
    // SECOND failed report bump `attempts` to 2, flipping the `toBe(1)` assertion red — a retried report
    // would otherwise burn the 5-attempt cap faster than deliveries warrant.
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app);
    const printerId = await createPrinterVia(app, agentId);
    const jobId = await enqueue(printerId, new Uint8Array([1]));
    await send(app, "POST", "/print-api/agent/jobs", { bearer: token }); // claim → printing

    const first = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "failed", error: "offline" },
    });
    expect(first.status).toBe(204);
    // The retried report — same job, now `failed` (not `printing`) — is a 204 no-op.
    const second = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "failed", error: "offline again" },
    });
    expect(second.status).toBe(204);
    const row = await jobRow(jobId);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(1); // bumped ONCE despite two failed reports
    expect(row.last_error).toBe("offline"); // the second report changed nothing
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
    // A revoked-shaped but valid uuid selector with a bad secret also folds to the same 401.
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
    // Works before revoke.
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
    // A unique serial per test — the suite shares one tenant/location and the partial UNIQUE is on
    // (tenant_id, location_id, local_key), so a fixed key would clash with a sibling test's printer.
    const serial = `SN-${randomUUID()}`;
    const printerId = await createUsbPrinter(app, serial, "Cocina USB");
    const payload = esc().text("Mesa 4").cut().bytes();
    const jobId = await enqueue(printerId, payload);

    // NOT visible → NOT eligible (design §3): the usb job stays queued when its key is absent from the
    // reported inventory — an empty visible set degenerates the local branch to `false`.
    const blind = await pull(app, token, { visible: [], scanned: [] });
    expect(blind.jobs).toHaveLength(0);
    expect((await jobRow(jobId)).status).toBe("queued");

    // Visible → claimed, the wire job carrying the printer's local_key (not a usb_path).
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
    // Window shut → the pull reply carries null.
    expect((await pull(app, token)).discoveryUntil).toBeNull();

    const start = await send(app, "POST", "/management-api/printer-discovery/start", {
      cookie: managerCookie,
    });
    expect(start.status).toBe(200);
    const { discoveryUntil } = (await start.json()) as { discoveryUntil: number };
    expect(discoveryUntil).toBeGreaterThan(Date.now());

    // The agent's next pull carries the same window end so the box knows to scan until it.
    expect((await pull(app, token)).discoveryUntil).toBe(discoveryUntil);
  });

  it("GET /management-api/discovered-printers lists reported devices, marking registered ones", async () => {
    const app = mountApp();
    const { agentId, token } = await joinAndAccept(app, "Inventory agent");
    const registeredSerial = `SN-${randomUUID()}`;
    const unregisteredSerial = `SN-${randomUUID()}`;
    // The agent reports two visible usb devices on its pull.
    await pull(app, token, {
      visible: [
        { transport: "usb", localKey: registeredSerial, make: "Epson", model: "TM-T20" },
        { transport: "usb", localKey: unregisteredSerial, make: "Star" },
      ],
      scanned: [],
    });
    // Register only the first.
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
    // A network printer has no local key — it is keyed on host:port — so the scan result of one that is
    // already registered carries that printer's id (the dashboard hides it from the results and shows
    // "seen" against the registered row). Same host on another port is a different printer.
    const app = mountApp();
    const { token } = await joinAndAccept(app, "Inventory agent");
    // Each `it` mounts its own app and tenant; the random octets only keep two rows apart in the log.
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
    // The report time travels as an ISO instant, like every other timestamp on the management wire.
    expect(Date.parse(matched.lastSeenAt)).toBeGreaterThanOrEqual(before);
    expect(rows.find((r) => r.host === host && r.port === 9101)).toMatchObject({
      alreadyRegistered: false,
      printerId: null,
    });
  });

  it("GET /management-api/discovered-printers matches a registered printer whose port is null on 9100", async () => {
    // A cleared port is stored as null and printing treats it as 9100 (the transport's default), so a
    // scan on 9100 must still match it — otherwise a working printer reappears as unregistered.
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
    // usb with NO localKey — the (ignored) agentId/usbPath do not satisfy the requirement → 422.
    const missing = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bad usb", transport: "usb", agentId, usbPath: "/dev/usb/lp0" },
    });
    expect(missing.status).toBe(422);
    expect((await missing.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "printer.invalid_config" },
    });
    // With localKey present the ignored fields are harmless → 201.
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
        transport: "network_tcp", // unchanged, but exercises the transport patch-branch
        port: 9300,
        localKey: null, // clear (nullable) — network_tcp carries no local_key
        pollId: null, // clear (nullable)
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
    // printers create screens a null body to a 400 (naming the first missing field).
    expect(
      (await send(app, "POST", "/management-api/printers", { cookie: managerCookie, body: null }))
        .status,
    ).toBe(400);
    // A null body on PATCH is an empty patch → a 204 no-op on an existing printer (never a 500).
    const patch = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: null,
    });
    expect(patch.status).toBe(204);
    // An EMPTY (no content-type) body on printers create likewise reaches the name screen → 400.
    const emptyCreate = await app.request("/management-api/printers", {
      method: "POST",
      headers: { cookie: managerCookie },
    });
    expect(emptyCreate.status).toBe(400);
  });

  it("create with a transport short of its required fields → 422 printer.invalid_config", async () => {
    const app = mountApp();
    await joinAndAccept(app);
    // usb requires local_key; omitting it is invalid config (the app-layer required-field pre-check).
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
    // Re-key to a new device serial (a usb printer swapped for a replacement unit).
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
});

describe("mountPrintApi — management: test-print", () => {
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
    // The enqueued job is a real `queued` outbox row on THIS printer — the never-block outbox path a
    // fire/sale uses, driven by the dashboard's diagnostic button.
    const row = await jobRow(jobId);
    expect(row.status).toBe("queued");
    const jobs = (await (
      await send(app, "GET", "/management-api/print-jobs", { cookie: managerCookie })
    ).json()) as { id: string; printerId: string }[];
    expect(jobs.find((j) => j.id === jobId)?.printerId).toBe(printerId);
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
});

describe("mountPrintApi — management: recent jobs", () => {
  it("returns a tenant-scoped preview only to printer managers", async () => {
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

  it("returns an ISO last-print timestamp regardless of database date display settings", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused", "Timestamp printer");
    await suite.db.execute(sql`
      insert into print_jobs (tenant_id, location_id, printer_id, payload, status, delivered_at)
      values (${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex'), 'done',
        '2020-01-02T03:04:05.678+02:00')`);
    try {
      await suite.db.execute(sql`set datestyle = 'SQL, DMY'`);
      await suite.db.execute(sql`set timezone = 'Europe/Madrid'`);
      const result = await send(app, "GET", "/management-api/printers", { cookie: managerCookie });
      expect(result.status).toBe(200);
      const rows = (await result.json()) as { id: string; lastPrintAt: string | null }[];
      expect(rows.find((row) => row.id === printerId)?.lastPrintAt).toBe(
        "2020-01-02T01:04:05.678Z",
      );
    } finally {
      await suite.db.execute(sql`set datestyle = 'ISO, MDY'`);
      await suite.db.execute(sql`set timezone = 'UTC'`);
    }
  });

  it("summarises all printer jobs and excludes foreign tenant activity", async () => {
    const app = mountApp();
    const printerId = await createPrinterVia(app, "unused", "Summary printer");
    const emptyId = await createPrinterVia(app, "unused", "Empty printer");
    await suite.db.execute(sql`
      insert into print_jobs (tenant_id, location_id, printer_id, payload)
      select ${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex') from generate_series(1, 101)`);
    await suite.db.execute(sql`
      insert into print_jobs (tenant_id, location_id, printer_id, payload, status, attempts, created_at, delivered_at)
      values (${tenantId}, ${locationId}, ${printerId}, decode('01','hex'), 'done', 0, '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z'),
             (${tenantId}, ${locationId}, ${printerId}, decode('01','hex'), 'failed', 4, now(), null),
             (${tenantId}, ${locationId}, ${printerId}, decode('01','hex'), 'failed', 5, now(), null),
             (${tenantId}, ${locationId}, ${printerId}, decode('01','hex'), 'printing', 0, now(), null)`);
    const foreignTenant = await seedTenant(suite.db);
    const foreignLocation = randomUUID();
    const foreignPrinter = randomUUID();
    const foreignJob = randomUUID();
    await suite.db
      .execute(sql`insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values (${foreignLocation}, ${foreignTenant}, 'Other', array['es-ES'], 'Other')`);
    await suite.db
      .execute(sql`insert into printers (id, tenant_id, location_id, name, transport, host)
      values (${foreignPrinter}, ${foreignTenant}, ${foreignLocation}, 'Other', 'network_tcp', 'other.local')`);
    await suite.db
      .execute(sql`insert into print_jobs (id, tenant_id, location_id, printer_id, payload)
      values (${foreignJob}, ${foreignTenant}, ${foreignLocation}, ${foreignPrinter}, decode('01','hex'))`);
    await suite.db.execute(sql`
      insert into print_jobs (tenant_id, location_id, printer_id, payload, status, delivered_at)
      select ${foreignTenant}, ${foreignLocation}, ${foreignPrinter}, decode('01','hex'), 'done', '2199-01-01'
      from generate_series(1, 101)`);
    await suite.db.execute(sql`
      insert into print_jobs (tenant_id, location_id, printer_id, payload, status, attempts, created_at)
      select ${foreignTenant}, ${foreignLocation}, ${foreignPrinter}, decode('01','hex'), 'failed', 5, '2199-01-01'
      from generate_series(1, 101)`);
    const foreignPreview = await send(
      app,
      "GET",
      `/management-api/print-jobs/${foreignJob}/preview`,
      { cookie: managerCookie },
    );
    expect(foreignPreview.status).toBe(404);
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
    expect(printers.some((p) => p.id === foreignPrinter)).toBe(false);
    const jobsResult = await send(app, "GET", "/management-api/print-jobs", {
      cookie: managerCookie,
    });
    const jobs = (await jobsResult.json()) as { id: string; printerId: string }[];
    expect(jobs.filter((job) => job.printerId === printerId)).toHaveLength(105);
    expect(jobs.some((j) => j.id === foreignJob)).toBe(false);
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
      const pending = await suite.db.execute<{ id: string }>(sql`
        insert into print_jobs (tenant_id, location_id, printer_id, payload, status, attempts, created_at)
        select ${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex'), status::print_job_status,
          attempts, '2020-01-01T00:00:00Z'
        from (values ('queued', 0), ('printing', 0), ('failed', 4), ('failed', 5)) as jobs(status, attempts)
        returning id`);
      const completed = await suite.db.execute<{ id: string; delivered_at: string }>(sql`
        insert into print_jobs (tenant_id, location_id, printer_id, payload, status, created_at, delivered_at)
        select ${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex'), 'done',
          '2021-01-01T00:00:00Z'::timestamptz - n * interval '1 second',
          '2099-01-01T00:00:00Z'::timestamptz + n * interval '1 second'
        from generate_series(1, 101) as jobs(n)
        returning id, delivered_at`);
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
      ).toEqual([...existingPending, ...pending.rows].map((job) => job.id).sort());
      expect(
        jobs
          .filter((job) => job.status === "done")
          .map((job) => job.id)
          .sort(),
      ).toEqual(
        completed.rows
          .sort((a, b) => Date.parse(b.delivered_at) - Date.parse(a.delivered_at))
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
      const pending = await suite.db.execute<{ id: string }>(sql`
        insert into print_jobs (tenant_id, location_id, printer_id, payload, status, attempts, created_at)
        select ${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex'), status::print_job_status,
          attempts, '2020-01-01'
        from (values ('queued', 0), ('printing', 0), ('failed', 4)) as jobs(status, attempts)
        cross join generate_series(1, 101)
        returning id`);
      const failed = await suite.db.execute<{ id: string; created_at: string }>(sql`
        insert into print_jobs (tenant_id, location_id, printer_id, payload, status, attempts, created_at)
        select ${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex'), 'failed', 5,
          '2099-01-01'::timestamptz + n * interval '1 second'
        from generate_series(1, 101) as jobs(n)
        returning id, created_at`);
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
      ).toEqual(pending.rows.map((row) => row.id).sort());
      expect(
        mine
          .filter((row) => row.status === "failed" && row.attempts >= 5)
          .map((row) => row.id)
          .sort(),
      ).toEqual(
        failed.rows
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
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
      await suite.db.execute(sql`
        insert into print_jobs (tenant_id, location_id, printer_id, payload, status)
        select ${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex'), 'done'
        from generate_series(1, 101)`);
      const completed = await suite.db.execute<{ id: string }>(sql`
        insert into print_jobs (tenant_id, location_id, printer_id, payload, status, delivered_at)
        values (${tenantId}, ${locationId}, ${printerId}, decode('01', 'hex'), 'done', '2099-01-01')
        returning id`);
      const response = await send(app, "GET", "/management-api/print-jobs", {
        cookie: managerCookie,
      });
      expect(response.status).toBe(200);
      const rows = (await response.json()) as { id: string; status: string }[];
      expect(rows.some((row) => row.id === completed.rows[0]!.id)).toBe(true);
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

  // Every gated route, as [method, path, body].
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
    // THE GUARD: a `staff`-role session holds no `printer.manage`, so `authorizeManager` (inside
    // print-api's `gated`) throws `authorization.not_permitted` before any op runs. Deleting the
    // `authorizeManager(...)` call from print-api.ts's `gated` makes every staff request below succeed
    // (201/200/404/422/204), flipping the `toBe(403)` assertions red; restoring it turns them green.
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
