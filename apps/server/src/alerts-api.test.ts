// PGlite: route authorization over one transaction per request; no concurrency and no
// connection-role question, and grants are enforced once the session assumes app_user.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asAppUser, withTransaction, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { listOpenIncidents, recordIncident } from "@waitron/core";
import {
  hashPin,
  resolveManagementSession,
  startManagementSession,
  withPassiveManagementRead,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import type { AlertSource } from "@waitron/module";
import type {
  CardProviderContribution,
  CardProviderRuntimeDeps,
  ReaderStatus,
} from "@waitron/payments";
import { AppError, tillId as brandTillId, type TenantId, type TillId } from "@waitron/shared";
import { mountAlertsApi } from "./alerts-api.js";
import {
  awaitingCertAlertSource,
  backupAlertSource,
  batteryAlertSource,
  printingAlertSource,
} from "./alert-sources.js";
import { createTtlCache } from "./ttl-cache.js";

// No real role holds payments.manage without fiscal.view and diagnostics.view, so a test replaces
// one role's held set while the real alert claims stay in force.
const roleOverride = vi.hoisted(() => new Map<string, string[]>());
vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return {
    ...actual,
    permissionsForRole: (role: Parameters<typeof actual.permissionsForRole>[0]) =>
      roleOverride.get(role) ?? actual.permissionsForRole(role),
  };
});
afterEach(() => {
  roleOverride.clear();
});
import { createAlertRegistry } from "./alerts.js";
import { ALL_ALERT_CLAIMS } from "./modules.js";
import "./errors.js";

const suite = usePgliteDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
});

const NOW = new Date("2026-09-14T12:00:00.000Z");
const noopLog: Logger = () => {};

interface Venue {
  tenantId: TenantId;
  tillId: TillId;
  manager: string;
  supervisor: string;
  admin: string;
}

async function seedVenue(): Promise<Venue> {
  const tenantId = await seedTenant(db);
  const location = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Sala', array['es-ES'], 'Venta en establecimiento') returning id`);
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${tenantId}, ${location.rows[0]!.id}, 'Caja 1') returning id`);
  const cookie = (role: string, name: string) =>
    withTransaction(db, async (tx) => {
      await asAppUser(tx);
      const p = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, ${name}, ${hashPin("1234")}, ${role}) returning id`);
      const session = await startManagementSession(tx, { tenantId, personId: p.rows[0]!.id });
      return `${MANAGEMENT_COOKIE}=${session.id}`;
    });
  return {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    manager: await cookie("manager", "Marta"),
    supervisor: await cookie("supervisor", "Sergio"),
    admin: await cookie("admin", "Ana"),
  };
}

async function raise(
  v: Venue,
  code: string,
  severity: "warning" | "error" = "error",
): Promise<string> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    await recordIncident(tx, {
      tenantId: v.tenantId,
      tillId: v.tillId,
      error: new AppError(code as never, {} as never),
      severity,
      detectedAt: NOW,
    });
    const open = await listOpenIncidents(tx, v.tenantId);
    return open.find((i) => i.code === code)!.id;
  });
}

function appFor(
  v: Pick<Venue, "tenantId">,
  registry = createAlertRegistry({ claims: ALL_ALERT_CLAIMS, sources: [] }),
): Hono {
  const app = new Hono();
  // Mirror boot.ts: a GET carrying `x-waitron-live: 1` runs under a passive read, so an automatic
  // dashboard poll verifies the session without sliding its idle window. Requests without the header
  // are unaffected, so every other test in this file sees the ordinary active-read path.
  app.use("*", async (c, next) => {
    if (c.req.method === "GET" && c.req.header("x-waitron-live") === "1") {
      await withPassiveManagementRead(next);
    } else await next();
  });
  mountAlertsApi(
    app,
    {
      db,
      cfg: { tenantId: v.tenantId },
      registry,
      now: () => NOW,
    },
    noopLog,
  );
  return app;
}

const get = (app: Hono, path: string, cookie?: string) =>
  app.request(path, { method: "GET", headers: cookie === undefined ? {} : { cookie } });
const post = (app: Hono, path: string, cookie: string) =>
  app.request(path, { method: "POST", headers: { cookie } });

describe("alert routes", () => {
  it("refuses a request with no session", async () => {
    const v = await seedVenue();
    const res = await get(appFor(v), "/management-api/alerts");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "management_session.required",
    );
  });

  it("lists open alerts for a manager", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined");
    await raise(v, "chain.verification_failed");
    const res = await get(appFor(v), "/management-api/alerts", v.manager);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visible: boolean; alerts: { code: string }[] };
    expect(body.visible).toBe(true);
    expect(body.alerts.map((a) => a.code).sort()).toEqual([
      "chain.verification_failed",
      "payment.offline_forward_declined",
    ]);
  });

  it("answers not visible and empty to a session holding no alert permission", async () => {
    const v = await seedVenue();
    await raise(v, "payment.offline_forward_declined");
    const res = await get(appFor(v), "/management-api/alerts", v.supervisor);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ visible: false, alerts: [] });
  });

  it("marks an incident handled; it moves from open to handled with who and when", async () => {
    const v = await seedVenue();
    const id = await raise(v, "payment.offline_forward_declined");
    const app = appFor(v);
    const res = await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager);
    expect(res.status).toBe(204);
    expect(
      (
        (await (await get(app, "/management-api/alerts", v.manager)).json()) as {
          alerts: unknown[];
        }
      ).alerts,
    ).toEqual([]);
    const handled = (await (
      await get(app, "/management-api/alerts/handled", v.manager)
    ).json()) as {
      visible: boolean;
      alerts: { key: string; handledBy: string; handledAt: string }[];
    };
    expect(handled.visible).toBe(true);
    expect(handled.alerts).toEqual([
      expect.objectContaining({
        key: `incident:${id}`,
        handledBy: "Marta",
        handledAt: NOW.toISOString(),
      }),
    ]);
  });

  it("succeeds when the incident is already handled", async () => {
    const v = await seedVenue();
    const id = await raise(v, "payment.offline_forward_declined");
    const app = appFor(v);
    expect(
      (await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager)).status,
    ).toBe(204);
    expect(
      (await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager)).status,
    ).toBe(204);
  });

  it("refuses a session that sees some alerts to handle an incident in an area it does not hold", async () => {
    // Every real role that sees alerts holds every alert permission today, so this registry puts
    // fiscal. under an admin-only permission: the manager still sees payments and diagnostics.
    const registry = createAlertRegistry({
      claims: [
        { prefix: "fiscal.", area: "fiscal", permission: "node.promote" },
        { prefix: "payment.", area: "payments", permission: "payments.manage" },
      ],
      sources: [],
    });
    const v = await seedVenue();
    const id = await raise(v, "fiscal.registro_rechazado");
    const app = appFor(v, registry);
    const refused = await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: { code: "authorization.not_permitted", params: { permission: "node.promote" } },
    });
    expect(
      (await post(app, `/management-api/alerts/incidents/${id}/handled`, v.admin)).status,
    ).toBe(204);
  });

  it("shows and lets handle only payment alerts to a session holding payments.manage alone", async () => {
    roleOverride.set("supervisor", ["payments.manage"]);
    const v = await seedVenue();
    const payment = await raise(v, "payment.offline_forward_declined");
    const others = [
      await raise(v, "fiscal.registro_rechazado"),
      await raise(v, "chain.verification_failed"),
      await raise(v, "clock.jump_detected"),
      await raise(v, "printing.mystery"),
    ];
    const app = appFor(v);
    const codes = async (path: string) =>
      ((await (await get(app, path, v.supervisor)).json()) as { alerts: { code: string }[] }).alerts
        .map((a) => a.code)
        .sort();
    expect(await codes("/management-api/alerts")).toEqual(["payment.offline_forward_declined"]);

    const expected = ["fiscal.view", "fiscal.view", "fiscal.view", "diagnostics.view"];
    for (const [i, id] of others.entries()) {
      const res = await post(app, `/management-api/alerts/incidents/${id}/handled`, v.supervisor);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: "authorization.not_permitted", params: { permission: expected[i] } },
      });
    }
    expect(
      (await post(app, `/management-api/alerts/incidents/${payment}/handled`, v.supervisor)).status,
    ).toBe(204);
    // Handled by the full manager, so the handled list has something to hide from this session.
    for (const id of others)
      expect(
        (await post(app, `/management-api/alerts/incidents/${id}/handled`, v.manager)).status,
      ).toBe(204);
    expect(await codes("/management-api/alerts/handled")).toEqual([
      "payment.offline_forward_declined",
    ]);
    expect(
      (
        (await (await get(app, "/management-api/alerts/handled", v.manager)).json()) as {
          alerts: unknown[];
        }
      ).alerts,
    ).toHaveLength(5);
  });

  it("answers alert.not_found to a session holding no alert permission, even for a real id", async () => {
    const v = await seedVenue();
    const id = await raise(v, "fiscal.registro_rechazado");
    const res = await post(
      appFor(v),
      `/management-api/alerts/incidents/${id}/handled`,
      v.supervisor,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("alert.not_found");
  });

  it("answers alert.not_found for an unknown and a malformed id", async () => {
    const a = await seedVenue();
    const app = appFor(a);
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const res = await post(app, `/management-api/alerts/incidents/${id}/handled`, a.manager);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "alert.not_found",
      );
    }
  });
});

// A card-provider seat whose only live method reports a flat 5% battery, so a seeded reader always
// fires `reader.battery_low`. Every other method throws — the battery source never reaches them.
function stubCardProvider(): CardProviderContribution {
  const unused = (): never => {
    throw new Error("stubCardProvider: this method is not used by the battery source");
  };
  return {
    providerId: "stub",
    credentialPurpose: "payments.stripe",
    credentialFields: [],
    readerAdd: { kind: "reference", refLabelKey: "x" },
    connect: unused,
    build: unused,
    readers: {
      canUnpair: false,
      list: unused,
      add: unused,
      remove: unused,
      status: async (): Promise<ReaderStatus> => ({ online: true, batteryPercent: 5 }),
    },
  };
}

const cardRuntimeDeps = (tenantId: TenantId): CardProviderRuntimeDeps => ({
  db,
  ring: {} as never,
  tenantId,
});

/**
 * The four server-owned ongoing sources, wired as boot does, so a route test exercises the real
 * registry composition. By default the two in-memory sources are quiet (backup configured with no
 * destinations, certificate present) and only the two DB sources — printing and
 * card-reader battery — can fire; flip `backupDisabled`/`awaitingCert` to make those two fire too.
 */
function ongoingRegistry(opts: { backupDisabled?: boolean; awaitingCert?: boolean } = {}) {
  return createAlertRegistry({
    claims: ALL_ALERT_CLAIMS,
    sources: [
      backupAlertSource({
        listStatus: async () =>
          opts.backupDisabled ? { configured: false } : { configured: true, destinations: [] },
        outcomes: { failed: new Map() },
        now: () => NOW,
      }),
      awaitingCertAlertSource({ current: opts.awaitingCert ?? false }),
      printingAlertSource(),
      batteryAlertSource({
        providers: [stubCardProvider()],
        runtimeDeps: cardRuntimeDeps,
        cache: createTtlCache<number | null>({ ttlMs: 5 * 60_000, now: () => NOW }),
      }),
    ],
  });
}

async function seedLowReader(tenantId: TenantId, name = "Datafono"): Promise<void> {
  await db.execute(sql`
    insert into card_readers (tenant_id, provider, provider_ref, name, active)
    values (${tenantId}, 'stub', ${`ref-${name}`}, ${name}, true)`);
}

/** A document print job old enough to count as stuck, on an active printer, so `printingAlertSource`
 * fires `printer.jobs_waiting` for this tenant. */
async function seedStuckPrintJob(tenantId: TenantId): Promise<void> {
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Retail') returning id`);
  const printer = await db.execute<{ id: string }>(sql`
    insert into printers (tenant_id, location_id, name, transport, host, active)
    values (${tenantId}, ${loc.rows[0]!.id}, 'Barra', 'network_tcp', '10.0.0.1', true) returning id`);
  await db.execute(sql`
    insert into print_jobs (tenant_id, location_id, printer_id, payload, kind, status, attempts, created_at)
    values (${tenantId}, ${loc.rows[0]!.id}, ${printer.rows[0]!.id}, decode('01', 'hex'),
            'document', 'queued', 0, ${new Date(NOW.getTime() - 5 * 60_000).toISOString()})`);
}

const liveGet = (app: Hono, cookie: string) =>
  app.request("/management-api/alerts", {
    method: "GET",
    headers: { cookie, "x-waitron-live": "1" },
  });

describe("ongoing alert sources through the route", () => {
  it("filters ongoing sources by permission: a payments.manage-only session sees only card_reader alerts", async () => {
    // Give the supervisor exactly the battery source's permission and nothing else, the way branch-1's
    // permission tests do, then fire all four areas.
    roleOverride.set("supervisor", ["payments.manage"]);
    const v = await seedVenue();
    await seedLowReader(v.tenantId);
    await seedStuckPrintJob(v.tenantId);
    const app = appFor(v, ongoingRegistry({ backupDisabled: true, awaitingCert: true }));

    // Control: a manager holds every source permission, so all four areas actually fire — the
    // payments-only assertion below is filtering at work, not four empty sources.
    const managerAreas = (
      (await (await get(app, "/management-api/alerts", v.manager)).json()) as {
        alerts: { area: string }[];
      }
    ).alerts.map((a) => a.area);
    expect(new Set(managerAreas)).toEqual(new Set(["backup", "fiscal", "printing", "card_reader"]));

    // The payments.manage session reads only the source whose permission it holds; the fiscal, backup
    // and printing ongoing alerts — each on a permission it lacks — never reach it.
    const body = (await (await get(app, "/management-api/alerts", v.supervisor)).json()) as {
      alerts: { code: string; area: string }[];
    };
    expect(body.alerts.map((a) => a.area)).toEqual(["card_reader"]);
    expect(body.alerts.map((a) => a.code)).toEqual(["reader.battery_low"]);
  });

  it("isolates a throwing ongoing source: its area yields exactly one alert.source_unavailable and the others survive", async () => {
    const v = await seedVenue();
    const working: AlertSource = {
      area: "printing",
      permission: "printer.manage",
      read: async () => [
        {
          key: "agent.silent:a1",
          code: "agent.silent",
          params: {},
          severity: "warning",
          since: null,
        },
      ],
    };
    const failing: AlertSource = {
      area: "card_reader",
      permission: "payments.manage",
      read: async () => {
        throw new Error("stub battery probe failed");
      },
    };
    const registry = createAlertRegistry({ claims: ALL_ALERT_CLAIMS, sources: [working, failing] });
    const body = (await (
      await get(appFor(v, registry), "/management-api/alerts", v.manager)
    ).json()) as { alerts: { code: string; area: string; params: unknown }[] };

    // The working source's alert is untouched by the other source's failure…
    expect(body.alerts).toContainEqual(
      expect.objectContaining({ code: "agent.silent", area: "printing" }),
    );
    // …and the failing source collapses to a single synthetic naming its own area — not an HTTP error,
    // not silence, and not one-per-attempt.
    expect(body.alerts.filter((a) => a.code === "alert.source_unavailable")).toEqual([
      expect.objectContaining({
        code: "alert.source_unavailable",
        area: "card_reader",
        params: { area: "card_reader" },
      }),
    ]);
  });

  it("polls passively: the x-waitron-live GET does not extend the session, an ordinary GET does", async () => {
    const v = await seedVenue();
    const app = appFor(v, ongoingRegistry());
    const sid = v.manager.slice(MANAGEMENT_COOKIE.length + 1);
    // Age the session so a touch would visibly move its expiry away from the aged baseline.
    await db.execute(
      sql`update management_sessions set last_seen_at = now() - interval '10 minutes' where id = ${sid}`,
    );
    const expiryOf = () =>
      withTransaction(db, (tx) => resolveManagementSession(tx, sid, { touch: false }));
    const before = (await expiryOf()).expiresAt;

    // The live poll verifies the session but does not slide its idle window.
    expect((await liveGet(app, v.manager)).status).toBe(200);
    expect((await expiryOf()).expiresAt).toBe(before);

    // Control: the same GET without the live header counts as human activity and slides it forward.
    expect((await get(app, "/management-api/alerts", v.manager)).status).toBe(200);
    expect(Date.parse((await expiryOf()).expiresAt)).toBeGreaterThan(Date.parse(before));
  });
});
