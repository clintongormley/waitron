import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { enqueuePrintJob, esc } from "@waitron/printing";
import type { Logger } from "./logger.js";
import { mountPrintApi } from "./print-api.js";
import {
  ENROL_RATE_MAX,
  ENROL_RATE_WINDOW_MS,
  createEnrolRateLimiter,
  type EnrolRateLimiter,
} from "./enrol-rate-limit.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import "./errors.js";

// PGlite, not real Postgres: this suite proves the ROUTES — the request/response boundary, the body +
// id screens, the agent Bearer guard, the claim/report logic, the management-gate wiring and the STATUS
// map — end to end in-process, the same way `purchasing-api.test.ts` proves the purchase routes. The
// agent-scope filters (cross-agent claim → empty, cross-agent report → no-op) and the revocation filter
// (`active = true`) are QUERY predicates, so PGlite shows them faithfully. The three properties PGlite
// CANNOT show — RLS isolation as the non-owner app role, the gate proven by DELETION under FORCE RLS,
// and the claim's `for update … skip locked` under true concurrency — live in `print-api.rls.test.ts`
// against real Postgres (CLAUDE.md §4). Each `it` seeds its own tenant, so its reads are its alone and
// order-independent across the shared PGlite.
const noopLog: Logger = () => {};

let tenantId: string;
let locationId: string;
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
    const { managerSid, staffSid } = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      const stf = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
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

function mountApp(enrolRateLimiter?: EnrolRateLimiter): Hono {
  const app = new Hono();
  mountPrintApi(app, { db: suite.db, cfg: { tenantId, locationId }, enrolRateLimiter }, noopLog);
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

/** Mint an agent pairing code (management route) and redeem it (unauth enrol), returning the agent's
 * id + Bearer token. */
async function enrolAgent(
  app: Hono,
  label = "Cocina agent",
): Promise<{ agentId: string; token: string }> {
  const codeRes = await send(app, "POST", "/management-api/print-agents/codes", {
    cookie: managerCookie,
    body: { label },
  });
  expect(codeRes.status).toBe(201);
  const { code } = (await codeRes.json()) as { code: string };
  const enrol = await send(app, "POST", "/print-api/agent/enrol", { body: { code } });
  expect(enrol.status).toBe(200);
  return (await enrol.json()) as { agentId: string; token: string };
}

/** Create a network_tcp printer bound to `agentId` via the management route, returning its id. */
async function createPrinterVia(app: Hono, agentId: string, name = "Cocina"): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "network_tcp", agentId, host: "10.0.0.9" },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
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

describe("mountPrintApi — agent enrol", () => {
  it("mints a code (manager) and enrols an agent (unauth) → { agentId, token }", async () => {
    const app = mountApp();
    const { agentId, token } = await enrolAgent(app);
    expect(agentId).toMatch(/^[0-9a-f-]{36}$/);
    // The token is `${agentId}.${secret}` — the selector half is the agent id, the secret half rides
    // after the first dot and is never otherwise disclosed.
    expect(token.startsWith(`${agentId}.`)).toBe(true);
  });

  it("enrol with an unknown code → 404 agent.pairing_invalid; a missing code → 400", async () => {
    const app = mountApp();
    const unknown = await send(app, "POST", "/print-api/agent/enrol", { body: { code: "nope" } });
    expect(unknown.status).toBe(404);
    expect((await unknown.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "agent.pairing_invalid" },
    });
    const missing = await send(app, "POST", "/print-api/agent/enrol", { body: {} });
    expect(missing.status).toBe(400);
    expect(
      (await missing.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "code" } } });
  });

  it("enrol with an EMPTY or MALFORMED or null body → 400, never a 500", async () => {
    const app = mountApp();
    const empty = await app.request("/print-api/agent/enrol", { method: "POST" });
    expect(empty.status).toBe(400);
    const malformed = await app.request("/print-api/agent/enrol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const nullBody = await send(app, "POST", "/print-api/agent/enrol", { body: null });
    expect(nullBody.status).toBe(400);
  });

  it("rate-limits enrol: the (cap+1)th attempt is 429 BEFORE the DB, then the window resets", async () => {
    // THE GUARD (proven by deletion): a per-process GLOBAL fixed-window counter checked at the TOP of the
    // enrol handler, before the body parse and the pairing-code DELETE. Deleting `enrolLimiter.check()`
    // from print-api.ts's enrol route makes the (cap+1)th attempt redeem/400 instead of 429.
    let fakeNow = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => fakeNow });
    const app = mountApp(limiter);
    // Pre-fill to one below the cap in-process, so the next HTTP attempt is the (cap+1)th → 429.
    for (let i = 0; i < ENROL_RATE_MAX; i++) limiter.check();
    const limited = await send(app, "POST", "/print-api/agent/enrol", { body: { code: "x" } });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "device.pairing_rate_limited" },
    });
    // Advance past the window — the counter resets and a well-formed enrol reaches the handler again
    // (a 404 for the junk code, i.e. it got PAST the limiter to the DB).
    fakeNow += ENROL_RATE_WINDOW_MS + 1;
    const after = await send(app, "POST", "/print-api/agent/enrol", { body: { code: "x" } });
    expect(after.status).toBe(404);
  });
});

describe("mountPrintApi — agent claim + report", () => {
  it("claims this agent's queued jobs (payload as base64), marking them printing (committed)", async () => {
    const app = mountApp();
    const { agentId, token } = await enrolAgent(app);
    const printerId = await createPrinterVia(app, agentId);
    const payload = esc().text("Mesa 4").cut().bytes();
    const jobId = await enqueue(printerId, payload);

    const res = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(res.status).toBe(200);
    const { jobs } = (await res.json()) as {
      jobs: {
        id: string;
        printerId: string;
        transport: string;
        host: string | null;
        port: number | null;
        usbPath: string | null;
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
      usbPath: null,
    });
    // The opaque bytes round-trip through base64 exactly.
    expect(Buffer.from(jobs[0]!.payload, "base64").equals(Buffer.from(payload))).toBe(true);
    // The claim COMMITTED within the request: a fresh read sees the job as `printing`, and a SECOND
    // claim returns nothing (it is no longer `queued`).
    expect((await jobRow(jobId)).status).toBe("printing");
    const again = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(((await again.json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
  });

  it("claims ONLY the calling agent's own printers' jobs (cross-agent → empty)", async () => {
    const app = mountApp();
    const mine = await enrolAgent(app, "Mine");
    const other = await enrolAgent(app, "Other");
    const otherPrinter = await createPrinterVia(app, other.agentId, "Other printer");
    const jobId = await enqueue(otherPrinter, new Uint8Array([1]));

    // My token must see nothing — the job is on the other agent's printer.
    const res = await send(app, "GET", "/print-api/agent/jobs", { bearer: mine.token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
    expect((await jobRow(jobId)).status).toBe("queued"); // untouched, still the other agent's
  });

  it("reports done → the job is done with delivered_at; failed → failed with attempts++ and last_error", async () => {
    const app = mountApp();
    const { agentId, token } = await enrolAgent(app);
    const printerId = await createPrinterVia(app, agentId);
    const doneJob = await enqueue(printerId, new Uint8Array([1]));
    const failJob = await enqueue(printerId, new Uint8Array([2]));
    // Claim both so they are `printing` (the state a real agent reports from).
    await send(app, "GET", "/print-api/agent/jobs", { bearer: token });

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
    const { agentId, token } = await enrolAgent(app);
    const printerId = await createPrinterVia(app, agentId);
    const jobId = await enqueue(printerId, new Uint8Array([1]));
    await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
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
    // THE GUARD (proven by deletion): `reportPrintJob`'s `and p.agent_id = ${agentId}` join scopes the
    // report to the caller's own printers. Deleting that predicate makes this cross-agent report mutate
    // agent A's job (status → done), flipping the `toBe("queued")` assertion red.
    const app = mountApp();
    const mine = await enrolAgent(app, "Mine");
    const other = await enrolAgent(app, "Other");
    const otherPrinter = await createPrinterVia(app, other.agentId, "Other printer");
    const jobId = await enqueue(otherPrinter, new Uint8Array([1]));

    const res = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: mine.token,
      body: { status: "done" },
    });
    expect(res.status).toBe(204); // idempotent sink — no oracle
    expect((await jobRow(jobId)).status).toBe("queued"); // the other agent's job is untouched
  });

  it("report screens the status (a bad/absent status → 400) and the job id shape (non-uuid → 400)", async () => {
    const app = mountApp();
    const { token } = await enrolAgent(app);
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
    const { agentId, token } = await enrolAgent(app);
    await createPrinterVia(app, agentId);
    const res = await send(app, "POST", `/print-api/agent/jobs/${randomUUID()}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(res.status).toBe(204);
  });

  it("the agent routes refuse a missing / malformed Bearer with 401 agent.unauthorized", async () => {
    const app = mountApp();
    const noAuth = await send(app, "GET", "/print-api/agent/jobs");
    expect(noAuth.status).toBe(401);
    expect((await noAuth.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "agent.unauthorized" },
    });
    const garbage = await send(app, "GET", "/print-api/agent/jobs", { bearer: "not.a.token" });
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
    const { agentId, token } = await enrolAgent(app);
    const printerId = await createPrinterVia(app, agentId);
    const jobId = await enqueue(printerId, new Uint8Array([1]));
    // Works before revoke.
    expect((await send(app, "GET", "/print-api/agent/jobs", { bearer: token })).status).toBe(200);

    const revoke = await send(app, "POST", `/management-api/print-agents/${agentId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revoke.status).toBe(204);

    const claim = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(claim.status).toBe(401);
    const report = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(report.status).toBe(401);
  });
});

describe("mountPrintApi — management: agents", () => {
  it("lists this tenant's agents (newest first) without the token hash", async () => {
    const app = mountApp();
    const { agentId } = await enrolAgent(app, "Listed agent");
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

  it("agent-codes screens the body (a missing label → 400)", async () => {
    const app = mountApp();
    const res = await send(app, "POST", "/management-api/print-agents/codes", {
      cookie: managerCookie,
      body: {},
    });
    expect(res.status).toBe(400);
    expect(
      (await res.json()) as { error: { code: string; params: { field: string } } },
    ).toMatchObject({ error: { code: "management.request_invalid", params: { field: "label" } } });
  });
});

describe("mountPrintApi — management: printers CRUD", () => {
  it("creates, lists, updates and deactivates a printer", async () => {
    const app = mountApp();
    const { agentId } = await enrolAgent(app);
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

  it("creates each transport's shape (usb with usb_path, cloud_poll with poll_id, tcp with explicit port)", async () => {
    const app = mountApp();
    const { agentId } = await enrolAgent(app);
    const usb = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "USB", transport: "usb", agentId, usbPath: "/dev/usb/lp0" },
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
    const { agentId } = await enrolAgent(app);
    const printerId = await createPrinterVia(app, agentId, "Full patch");
    const res = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: {
        transport: "network_tcp", // unchanged, but exercises the transport patch-branch
        port: 9300,
        usbPath: null, // clear (nullable)
        pollId: null, // clear (nullable)
        ticketScope: "order",
        active: true,
      },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string; port: number; ticketScope: string; usbPath: string | null }[];
    const row = rows.find((r) => r.id === printerId)!;
    expect(row).toMatchObject({ port: 9300, ticketScope: "order", usbPath: null });
  });

  it("update rejects a non-boolean active → 400", async () => {
    const app = mountApp();
    const { agentId } = await enrolAgent(app);
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
    const { agentId } = await enrolAgent(app);
    const printerId = await createPrinterVia(app, agentId);
    // agent-codes + printers create screen a null body to a 400 (naming the first missing field).
    expect(
      (
        await send(app, "POST", "/management-api/print-agents/codes", {
          cookie: managerCookie,
          body: null,
        })
      ).status,
    ).toBe(400);
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
    const { agentId } = await enrolAgent(app);
    // usb requires agentId + usbPath; supplying the agent but omitting usbPath is invalid config.
    const res = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Bad usb", transport: "usb", agentId },
    });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "printer.invalid_config" },
    });
  });

  it("create bound to an unknown agent id → 404 agent.not_found (the composite FK, mapped friendly)", async () => {
    const app = mountApp();
    const ghost = randomUUID();
    const res = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Ghost", transport: "network_tcp", agentId: ghost, host: "10.0.0.1" },
    });
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: { code: string; params: { id: string } } }).toMatchObject(
      { error: { code: "agent.not_found", params: { id: ghost } } },
    );
  });

  it("create screens the body (missing name → 400; bad transport → 400; non-uuid agentId → 400)", async () => {
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

    const badAgent = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "X", transport: "network_tcp", agentId: "not-a-uuid", host: "10.0.0.1" },
    });
    expect(badAgent.status).toBe(400);

    const badPort = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "X",
        transport: "network_tcp",
        agentId: randomUUID(),
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

  it("update clears a connection field with an explicit null and re-binds the agent", async () => {
    const app = mountApp();
    const first = await enrolAgent(app, "First");
    const second = await enrolAgent(app, "Second");
    const printerId = await createPrinterVia(app, first.agentId, "Movable");
    // Re-bind to the second agent and move host — an explicit set of both fields.
    const res = await send(app, "PATCH", `/management-api/printers/${printerId}`, {
      cookie: managerCookie,
      body: { agentId: second.agentId, host: "10.0.0.30" },
    });
    expect(res.status).toBe(204);
    const rows = (await (
      await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string; agentId: string; host: string }[];
    expect(rows.find((r) => r.id === printerId)).toMatchObject({
      agentId: second.agentId,
      host: "10.0.0.30",
    });
  });
});

describe("mountPrintApi — management: recent jobs", () => {
  it("lists recent jobs newest-first without the payload", async () => {
    const app = mountApp();
    const { agentId } = await enrolAgent(app);
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
    ["POST", "/management-api/print-agents/codes", { label: "X" }],
    ["GET", "/management-api/print-agents"],
    ["POST", `/management-api/print-agents/${DUMMY}/revoke`],
    ["POST", "/management-api/printers", { name: "X", transport: "network_tcp", host: "10.0.0.1" }],
    ["GET", "/management-api/printers"],
    ["PATCH", `/management-api/printers/${DUMMY}`, { name: "X" }],
    ["POST", `/management-api/printers/${DUMMY}/deactivate`],
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
