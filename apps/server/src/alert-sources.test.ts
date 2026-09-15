import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { TenantId } from "@waitron/shared";
import {
  awaitingCertAlertSource,
  backupAlertSource,
  type BackupOutcomeHolder,
  printingAlertSource,
  recordBackupOutcome,
} from "./alert-sources.js";
import type { BackupStatus } from "./backup-status.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const ctx = { tx: {} as never, tenantId: "t1" as never, now: NOW };

function src(status: BackupStatus, outcomes: BackupOutcomeHolder) {
  return backupAlertSource({ listStatus: async () => status, outcomes, now: () => NOW });
}

describe("backupAlertSource", () => {
  it("raises backup.disabled when not configured", async () => {
    const alerts = await src({ configured: false }, { failed: new Map() }).read(ctx);
    expect(alerts.map((a) => a.code)).toEqual(["backup.disabled"]);
    expect(alerts[0].severity).toBe("warning");
  });

  it("raises destination_overdue for a stale destination, with the last good backup as since", async () => {
    const status: BackupStatus = {
      configured: true,
      destinations: [
        { id: "local", lastBackupAt: "2026-09-10T00:00:00Z", ageSeconds: 999999, stale: true },
      ],
    };
    const alerts = await src(status, { failed: new Map() }).read(ctx);
    const overdue = alerts.find((a) => a.code === "backup.destination_overdue");
    expect(overdue).toMatchObject({
      key: "backup.destination_overdue:local",
      severity: "error",
      since: "2026-09-10T00:00:00Z",
      screen: "backup",
      params: { destination: "local" },
    });
  });

  it("raises nothing for a fresh, non-failed destination", async () => {
    const status: BackupStatus = {
      configured: true,
      destinations: [{ id: "local", lastBackupAt: NOW.toISOString(), ageSeconds: 5, stale: false }],
    };
    expect(await src(status, { failed: new Map() }).read(ctx)).toEqual([]);
  });

  it("raises destination_failed from the outcome holder, cleared by a success", async () => {
    const outcomes: BackupOutcomeHolder = { failed: new Map() };
    recordBackupOutcome(outcomes, "local", false, "2026-09-15T11:59:00Z");
    const status: BackupStatus = {
      configured: true,
      destinations: [{ id: "local", lastBackupAt: NOW.toISOString(), ageSeconds: 5, stale: false }],
    };
    let alerts = await src(status, outcomes).read(ctx);
    expect(alerts).toMatchObject([
      {
        code: "backup.destination_failed",
        severity: "warning",
        since: "2026-09-15T11:59:00Z",
        params: { destination: "local" },
      },
    ]);
    recordBackupOutcome(outcomes, "local", true, NOW.toISOString());
    alerts = await src(status, outcomes).read(ctx);
    expect(alerts).toEqual([]);
  });
});

describe("awaitingCertAlertSource", () => {
  it("is silent while the certificate is present", async () => {
    expect(await awaitingCertAlertSource({ current: false }).read(ctx)).toEqual([]);
  });

  it("raises fiscal.awaiting_certificate while waiting", async () => {
    const [a] = await awaitingCertAlertSource({ current: true }).read(ctx);
    expect(a).toMatchObject({
      key: "fiscal.awaiting_certificate",
      code: "fiscal.awaiting_certificate",
      severity: "error",
    });
  });
});

// The printing source reads three real tables (printers, print_agents, print_jobs), so it runs on
// PGlite as the app role — a grant assertion that forgot `asAppUser(tx)` would silently pass as the
// owner (CLAUDE.md §4). PGlite fits: these are plain SELECTs with no contention to prove.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

/** Minutes before NOW as an ISO string — the shape `last_seen_at` / `created_at` compare against. */
function minsAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60_000).toISOString();
}

async function seedLocation(tenantId: TenantId): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Counter', array['es-ES'], 'Retail') returning id`);
  return rows[0]!.id;
}

async function seedPrinter(t: {
  tenantId: TenantId;
  locationId: string;
  name: string;
  active?: boolean;
}): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into printers (tenant_id, location_id, name, transport, host, active)
    values (${t.tenantId}, ${t.locationId}, ${t.name}, 'network_tcp', '10.0.0.1', ${t.active ?? true})
    returning id`);
  return rows[0]!.id;
}

async function seedAgent(t: {
  tenantId: TenantId;
  locationId: string;
  name: string;
  lastSeenAt: string | null;
  active?: boolean;
}): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash, active, last_seen_at)
    values (${t.tenantId}, ${t.locationId}, ${t.name}, 'hash', ${t.active ?? true}, ${t.lastSeenAt})
    returning id`);
  return rows[0]!.id;
}

async function seedJob(t: {
  tenantId: TenantId;
  locationId: string;
  printerId: string;
  createdAt: string;
  kind?: "document" | "drawer";
  status?: "queued" | "printing" | "done" | "failed";
  attempts?: number;
}): Promise<void> {
  await suite.db.execute(sql`
    insert into print_jobs (tenant_id, location_id, printer_id, payload, kind, status, attempts, created_at)
    values (${t.tenantId}, ${t.locationId}, ${t.printerId}, decode('01', 'hex'),
            ${t.kind ?? "document"}, ${t.status ?? "queued"}, ${t.attempts ?? 0}, ${t.createdAt})`);
}

/** Run the source as the app role in the tenant's own transaction, exactly as the registry does. */
async function readAlerts(tenantId: TenantId, now = NOW) {
  return withTenant(suite.db, tenantId, async (tx) => {
    await asAppUser(tx);
    return printingAlertSource().read({ tx, tenantId, now });
  });
}

describe("printingAlertSource — agent.silent", () => {
  it("stays quiet for an agent seen 4 minutes ago", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    await seedAgent({ tenantId, locationId, name: "Cocina", lastSeenAt: minsAgo(4) });
    expect(await readAlerts(tenantId)).toEqual([]);
  });

  it("raises agent.silent for an agent seen 6 minutes ago, then clears on a fresh pull", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    const agentId = await seedAgent({
      tenantId,
      locationId,
      name: "Cocina",
      lastSeenAt: minsAgo(6),
    });

    expect(await readAlerts(tenantId)).toMatchObject([
      {
        key: `agent.silent:${agentId}`,
        code: "agent.silent",
        params: { agent: "Cocina" },
        severity: "warning",
        since: minsAgo(6),
        screen: "printers",
      },
    ]);

    // A fresh check-in moves last_seen_at to now, so the next read finds nothing.
    await suite.db.execute(
      sql`update print_agents set last_seen_at = ${NOW.toISOString()} where tenant_id = ${tenantId}`,
    );
    expect(await readAlerts(tenantId)).toEqual([]);
  });

  it("gives two silent agents that share a name two distinct alerts", async () => {
    // Names are not unique; keying the alert on the name would collide these two into one and hide a
    // down agent. The key must be per-agent-id, so both silent agents surface.
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    const first = await seedAgent({ tenantId, locationId, name: "Cocina", lastSeenAt: minsAgo(6) });
    const second = await seedAgent({
      tenantId,
      locationId,
      name: "Cocina",
      lastSeenAt: minsAgo(7),
    });

    const alerts = await readAlerts(tenantId);
    expect(alerts.every((a) => a.code === "agent.silent")).toBe(true);
    expect(new Set(alerts.map((a) => a.key))).toEqual(
      new Set([`agent.silent:${first}`, `agent.silent:${second}`]),
    );
  });

  it("ignores a deactivated silent agent and a never-seen agent", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    await seedAgent({
      tenantId,
      locationId,
      name: "Retired",
      lastSeenAt: minsAgo(30),
      active: false,
    });
    await seedAgent({ tenantId, locationId, name: "Never", lastSeenAt: null });
    expect(await readAlerts(tenantId)).toEqual([]);
  });
});

describe("printingAlertSource — printer.jobs_waiting", () => {
  it("raises for a document job queued 3 minutes ago, with the printer name and count", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    const printerId = await seedPrinter({ tenantId, locationId, name: "Barra" });
    await seedJob({ tenantId, locationId, printerId, createdAt: minsAgo(3) });
    await seedJob({ tenantId, locationId, printerId, createdAt: minsAgo(5) });

    expect(await readAlerts(tenantId)).toMatchObject([
      {
        key: `printer.jobs_waiting:${printerId}`,
        code: "printer.jobs_waiting",
        params: { printer: "Barra", count: 2 },
        severity: "error",
        since: minsAgo(5), // the oldest waiting job
        screen: "printers",
      },
    ]);
  });

  it("stays quiet for a job only 1 minute old", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    const printerId = await seedPrinter({ tenantId, locationId, name: "Barra" });
    await seedJob({ tenantId, locationId, printerId, createdAt: minsAgo(1) });
    expect(await readAlerts(tenantId)).toEqual([]);
  });

  it("never counts a drawer job, however old", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    const printerId = await seedPrinter({ tenantId, locationId, name: "Barra" });
    await seedJob({ tenantId, locationId, printerId, createdAt: minsAgo(30), kind: "drawer" });
    expect(await readAlerts(tenantId)).toEqual([]);
  });

  it("raises for a fresh failed job that has hit the delivery-attempt ceiling", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    const printerId = await seedPrinter({ tenantId, locationId, name: "Barra" });
    // 1 minute old — below the stuck-time threshold — but exhausted, so it will never print again.
    await seedJob({
      tenantId,
      locationId,
      printerId,
      createdAt: minsAgo(1),
      status: "failed",
      attempts: 5,
    });
    expect(await readAlerts(tenantId)).toMatchObject([
      { code: "printer.jobs_waiting", params: { printer: "Barra", count: 1 } },
    ]);
  });

  it("ignores jobs on a deactivated printer", async () => {
    const tenantId = await seedTenant(suite.db);
    const locationId = await seedLocation(tenantId);
    const printerId = await seedPrinter({ tenantId, locationId, name: "Off", active: false });
    await seedJob({ tenantId, locationId, printerId, createdAt: minsAgo(10) });
    expect(await readAlerts(tenantId)).toEqual([]);
  });
});

describe("printingAlertSource — tenant scoping", () => {
  it("reads only its own tenant's silent agents and waiting jobs", async () => {
    const other = await seedTenant(suite.db);
    const otherLocation = await seedLocation(other);
    await seedAgent({
      tenantId: other,
      locationId: otherLocation,
      name: "Foreign",
      lastSeenAt: minsAgo(30),
    });
    const otherPrinter = await seedPrinter({
      tenantId: other,
      locationId: otherLocation,
      name: "Foreign",
    });
    await seedJob({
      tenantId: other,
      locationId: otherLocation,
      printerId: otherPrinter,
      createdAt: minsAgo(30),
    });

    // The other tenant's rows exist and would fire for their own tenant (control)…
    expect((await readAlerts(other)).map((a) => a.code).sort()).toEqual([
      "agent.silent",
      "printer.jobs_waiting",
    ]);

    // …but a different tenant, with nothing of its own, sees none of them.
    const mine = await seedTenant(suite.db);
    await seedLocation(mine);
    expect(await readAlerts(mine)).toEqual([]);
  });
});
