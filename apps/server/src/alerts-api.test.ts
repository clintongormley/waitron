// PGlite: route authorization over one transaction per request; no concurrency and no
// connection-role question, and grants are enforced once the session assumes app_user.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { listOpenIncidents, recordIncident } from "@waitron/core";
import { hashPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { AppError, tillId as brandTillId, type TenantId, type TillId } from "@waitron/shared";
import { mountAlertsApi } from "./alerts-api.js";

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
    withTenant(db, tenantId, async (tx) => {
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
  return withTenant(db, v.tenantId, async (tx) => {
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

  it("answers not visible and empty to another tenant's manager", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    await raise(a, "payment.offline_forward_declined");
    const res = await get(appFor(a), "/management-api/alerts", b.manager);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ visible: false, alerts: [] });
  });

  it("answers not visible and empty to another tenant's manager asking for handled alerts", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const id = await raise(a, "payment.offline_forward_declined");
    const app = appFor(a);
    expect(
      (await post(app, `/management-api/alerts/incidents/${id}/handled`, a.manager)).status,
    ).toBe(204);
    const res = await get(app, "/management-api/alerts/handled", b.manager);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ visible: false, alerts: [] });
  });

  it("refuses another tenant's manager to handle this tenant's incident, leaving it open", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const id = await raise(a, "payment.offline_forward_declined");
    const res = await post(appFor(a), `/management-api/alerts/incidents/${id}/handled`, b.manager);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("alert.not_found");
    const stillOpen = await withTenant(db, a.tenantId, async (tx) => {
      await asAppUser(tx);
      return listOpenIncidents(tx, a.tenantId);
    });
    expect(stillOpen.map((i) => i.id)).toEqual([id]);
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
      ((await (await get(app, "/management-api/alerts/handled", v.manager)).json()) as {
        alerts: unknown[];
      }).alerts,
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

  it("answers alert.not_found for an unknown, a malformed, and another tenant's id", async () => {
    const a = await seedVenue();
    const b = await seedVenue();
    const theirs = await raise(b, "payment.offline_forward_declined");
    const app = appFor(a);
    for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", theirs]) {
      const res = await post(app, `/management-api/alerts/incidents/${id}/handled`, a.manager);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "alert.not_found",
      );
    }
    const stillOpen = await withTenant(db, b.tenantId, async (tx) => {
      await asAppUser(tx);
      return listOpenIncidents(tx, b.tenantId);
    });
    expect(stillOpen.map((i) => i.id)).toEqual([theirs]);
  });
});
