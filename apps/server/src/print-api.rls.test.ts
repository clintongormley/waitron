import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPin, startManagementSession } from "@waitron/identity";
import { enqueuePrintJob } from "@waitron/printing";
import { mountPrintApi } from "./print-api.js";
import { MANAGEMENT_COOKIE } from "./management-session.js";
import type { Logger } from "./logger.js";
import "./errors.js";

// Real Postgres (a manifest template clone), NOT PGlite — mandatory for THIS surface (CLAUDE.md §4).
// These routes read and write under RLS as `app_user` (the agent guard + claim + report, the management
// list/revoke/CRUD), and the properties this suite is FOR are exactly the ones PGlite's all-superuser,
// single-backend connection FALSE-passes: RLS tenant isolation (a second tenant's rows are invisible),
// the `printer.manage` gate proven by DELETION under FORCE RLS, the claim COMMITTING within the request
// (observed cross-connection), and revocation stopping the Bearer instantly under the real deployment
// role. The claim's `for update … skip locked` under true concurrency is proven separately (by deletion)
// in packages/printing's runtime.race.test.ts; the SERVER path calls that same `claimPrintJobs`.
const noopLog: Logger = () => {};

interface Tenant {
  tenantId: string;
  locationId: string;
}

let tenantA: Tenant;
let tenantB: Tenant;
let managerCookie: string;
let staffCookie: string;

const suite = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared clone and `tenants_country_tax_id_key` is unique, so
// each needs its own NIF — the per-suite counter the sibling RLS suites use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(76_000_000 + nifCounter).padStart(8, "0")}K`;
}

async function seedTenantWithLocation(): Promise<Tenant> {
  const tenantId = randomUUID();
  await suite.admin.execute(sql`
    insert into tenants (id, country, tax_id, legal_name)
    values (${tenantId}, 'ES', ${nextNif()}, 'Deli Test SL')`);
  const loc = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  return { tenantId, locationId: loc.rows[0]!.id };
}

beforeAll(async () => {
  tenantA = await seedTenantWithLocation();
  tenantB = await seedTenantWithLocation();
  const { managerSid, staffSid } = await withTenant(suite.admin, tenantA.tenantId, async (tx) => {
    await asAppUser(tx);
    const mgr = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
    const stf = await tx.execute<{ id: string }>(sql`
      insert into persons (tenant_id, display_name, pin_hash, role)
      values (current_tenant_id(), 'The Clerk', ${hashPin("1234")}, 'staff') returning id`);
    const managerSession = await startManagementSession(tx, {
      tenantId: tenantA.tenantId,
      personId: mgr.rows[0]!.id,
    });
    const staffSession = await startManagementSession(tx, {
      tenantId: tenantA.tenantId,
      personId: stf.rows[0]!.id,
    });
    return { managerSid: managerSession.id, staffSid: staffSession.id };
  });
  managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
  staffCookie = `${MANAGEMENT_COOKIE}=${staffSid}`;
});

/** The print API mounted over the REAL app-role pool (suite.admin), scoped to `tenant`. */
function mountApp(tenant: Tenant): Hono {
  const app = new Hono();
  mountPrintApi(app, { db: suite.admin, cfg: tenant }, noopLog);
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

async function enrolAgent(app: Hono, label: string): Promise<{ agentId: string; token: string }> {
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

async function createPrinter(app: Hono, agentId: string, name: string): Promise<string> {
  const res = await send(app, "POST", "/management-api/printers", {
    cookie: managerCookie,
    body: { name, transport: "network_tcp", agentId, host: "10.0.0.9" },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function enqueue(tenant: Tenant, printerId: string, payload: Uint8Array): Promise<string> {
  return withTenant(suite.admin, tenant.tenantId, async (tx) => {
    await asAppUser(tx);
    const { jobId } = await enqueuePrintJob(tx, tenant, printerId, payload);
    return jobId;
  });
}

/** Seed an agent + a network_tcp printer + a queued job for `tenant` directly (owner SQL), for the
 * isolation control — a foreign tenant's rows tenant A must never see. */
async function seedForeignPrinter(tenant: Tenant): Promise<{ agentId: string; printerId: string }> {
  const agent = await suite.admin.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash)
    values (${tenant.tenantId}, ${tenant.locationId}, 'Foreign agent', 'scrypt$fixture') returning id`);
  const agentId = agent.rows[0]!.id;
  const printer = await suite.admin.execute<{ id: string }>(sql`
    insert into printers (tenant_id, location_id, name, transport, agent_id, host)
    values (${tenant.tenantId}, ${tenant.locationId}, 'Foreign printer', 'network_tcp', ${agentId}, '10.9.9.9')
    returning id`);
  return { agentId, printerId: printer.rows[0]!.id };
}

describe("Print API over real Postgres (app role, FORCE RLS)", () => {
  it("enrol → claim (committed within the request) → report done, all as the app role", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await enrolAgent(app, "Cocina");
    const printerId = await createPrinter(app, agentId, "Cocina real");
    const jobId = await enqueue(tenantA, printerId, new Uint8Array([0x41, 0x42]));

    const claim = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(claim.status).toBe(200);
    expect(((await claim.json()) as { jobs: { id: string }[] }).jobs.map((j) => j.id)).toEqual([
      jobId,
    ]);

    // COMMIT BOUNDARY (Ruling 6): a SEPARATE connection (suite.admin, a distinct pooled backend) sees
    // the claimed job as `printing` the instant the response has returned — proof the claim's
    // transaction COMMITTED within the request and the server holds no lock/tx across the agent's push.
    const seen = await suite.admin.execute<{ status: string }>(
      sql`select status from print_jobs where id = ${jobId}`,
    );
    expect(seen.rows[0]!.status).toBe("printing");

    const report = await send(app, "POST", `/print-api/agent/jobs/${jobId}/result`, {
      bearer: token,
      body: { status: "done" },
    });
    expect(report.status).toBe(204);
    const done = await suite.admin.execute<{ status: string; delivered_at: string | null }>(
      sql`select status, delivered_at from print_jobs where id = ${jobId}`,
    );
    expect(done.rows[0]!.status).toBe("done");
    expect(done.rows[0]!.delivered_at).not.toBeNull();
  });

  it("claims ONLY the calling agent's own printers' jobs under RLS (cross-agent → empty)", async () => {
    const app = mountApp(tenantA);
    const mine = await enrolAgent(app, "Mine RLS");
    const other = await enrolAgent(app, "Other RLS");
    const otherPrinter = await createPrinter(app, other.agentId, "Other printer RLS");
    const jobId = await enqueue(tenantA, otherPrinter, new Uint8Array([1]));

    const res = await send(app, "GET", "/print-api/agent/jobs", { bearer: mine.token });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { jobs: unknown[] }).jobs).toHaveLength(0);
    const untouched = await suite.admin.execute<{ status: string }>(
      sql`select status from print_jobs where id = ${jobId}`,
    );
    expect(untouched.rows[0]!.status).toBe("queued");
  });

  it("a REVOKED agent fails the claim instantly under RLS (401)", async () => {
    const app = mountApp(tenantA);
    const { agentId, token } = await enrolAgent(app, "Revocable");
    await createPrinter(app, agentId, "Revocable printer");
    expect((await send(app, "GET", "/print-api/agent/jobs", { bearer: token })).status).toBe(200);

    const revoke = await send(app, "POST", `/management-api/print-agents/${agentId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revoke.status).toBe(204);
    const afterRevoke = await send(app, "GET", "/print-api/agent/jobs", { bearer: token });
    expect(afterRevoke.status).toBe(401);
  });

  it("RLS isolates the management lists: tenant A never sees tenant B's agents or printers", async () => {
    const appA = mountApp(tenantA);
    const aAgent = await enrolAgent(appA, "A's agent");
    const aPrinter = await createPrinter(appA, aAgent.agentId, "A's printer");
    const foreign = await seedForeignPrinter(tenantB);

    const agents = (await (
      await send(appA, "GET", "/management-api/print-agents", { cookie: managerCookie })
    ).json()) as { id: string }[];
    expect(agents.some((r) => r.id === aAgent.agentId)).toBe(true);
    expect(agents.some((r) => r.id === foreign.agentId)).toBe(false); // B's agent is invisible

    const printers = (await (
      await send(appA, "GET", "/management-api/printers", { cookie: managerCookie })
    ).json()) as { id: string }[];
    expect(printers.some((r) => r.id === aPrinter)).toBe(true);
    expect(printers.some((r) => r.id === foreign.printerId)).toBe(false); // B's printer is invisible
  });

  it("the management routes require printer.manage — 401 unauth, 403 staff, 200 manager (gate proven by deletion)", async () => {
    // THE GUARD, proven by DELETION under FORCE RLS: a `staff`-role session holds no `printer.manage`,
    // so `authorizeManager` (inside print-api's `gated`) throws `authorization.not_permitted` before any
    // op runs. Deleting the `authorizeManager(...)` call from print-api.ts's `gated` makes every staff
    // request below SUCCEED (201/200), flipping the 403 assertions red; restoring it turns them green.
    const app = mountApp(tenantA);

    // Unauthenticated → 401 on a representative gated route.
    const unauth = await send(app, "GET", "/management-api/printers");
    expect(unauth.status).toBe(401);
    expect((await unauth.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "management_session.required" },
    });

    // Staff session → 403 (the gate refuses it).
    const staff = await send(app, "POST", "/management-api/print-agents/codes", {
      cookie: staffCookie,
      body: { label: "nope" },
    });
    expect(staff.status).toBe(403);
    expect((await staff.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "authorization.not_permitted" },
    });

    // Manager session → 201 (the gate admits it).
    const manager = await send(app, "POST", "/management-api/print-agents/codes", {
      cookie: managerCookie,
      body: { label: "Gate OK" },
    });
    expect(manager.status).toBe(201);
  });
});
