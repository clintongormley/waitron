import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  asAppUser,
  CORE_MIGRATIONS,
  locations,
  printAgents,
  printJobs,
  printers,
  type Database,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { AlertSource } from "@waitron/module";
import {
  cardReaders,
  type CardProviderContribution,
  type CardProviderRuntimeDeps,
  PAYMENTS_MIGRATIONS,
  type ReaderStatus,
} from "@waitron/payments";
import {
  awaitingCertAlertSource,
  backupAlertSource,
  type BackupOutcomeHolder,
  batteryAlertSource,
  BATTERY_ERROR,
  BATTERY_WARN,
  printingAlertSource,
  recordBackupOutcome,
} from "./alert-sources.js";
import type { BackupStatus } from "./backup-status.js";
import { createTtlCache } from "./ttl-cache.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const ctx = { tx: {} as never, now: NOW };

function src(status: BackupStatus, outcomes: BackupOutcomeHolder) {
  return backupAlertSource({ listStatus: async () => status, outcomes, now: () => NOW });
}

describe("backupAlertSource", () => {
  it("raises backup.disabled when not configured", async () => {
    const alerts = await src({ configured: false }, { failed: new Map() }).read(ctx);
    expect(alerts.map((a) => a.code)).toEqual(["backup.disabled"]);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].screen).toBe("backup");
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
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

/** Minutes before NOW as an ISO string — the shape `last_seen_at` / `created_at` compare against. */
function minsAgo(mins: number): string {
  return new Date(NOW.getTime() - mins * 60_000).toISOString();
}

// Every seed below inserts through its table definition rather than as raw SQL, the change
// `apps/server/src/testing/fiscal-fixtures.ts` took. Two reasons, both fatal to the raw form on
// this engine: each table's `id` (and `print_jobs.created_at`, `print_agents.enrolled_at`) is a
// `$defaultFn` generator a raw insert never reaches while the column is NOT NULL, and
// `invoice_locales` is a JSON array in a text column, which refused the `array[...]` constructor
// with `near "['es-ES']": syntax error`. `print_jobs.payload` is a blob here, so the one-byte
// payload is bound as bytes instead of through PostgreSQL's `decode('01', 'hex')`
// (`no such function: decode`).
async function seedLocation(): Promise<string> {
  const [row] = await suite.db
    .insert(locations)
    .values({ name: "Counter", invoiceLocales: ["es-ES"], operationDescription: "Retail" })
    .returning({ id: locations.id });
  return row!.id;
}

async function seedPrinter(t: {
  locationId: string;
  name: string;
  active?: boolean;
}): Promise<string> {
  const [row] = await suite.db
    .insert(printers)
    .values({
      locationId: t.locationId,
      name: t.name,
      transport: "network_tcp",
      host: "10.0.0.1",
      active: t.active ?? true,
    })
    .returning({ id: printers.id });
  return row!.id;
}

async function seedAgent(t: {
  locationId: string;
  name: string;
  lastSeenAt: string | null;
  active?: boolean;
}): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({
      locationId: t.locationId,
      name: t.name,
      tokenHash: "hash",
      active: t.active ?? true,
      lastSeenAt: t.lastSeenAt,
    })
    .returning({ id: printAgents.id });
  return row!.id;
}

async function seedJob(t: {
  locationId: string;
  printerId: string;
  createdAt: string;
  kind?: "document" | "drawer";
  status?: "queued" | "printing" | "done" | "failed";
  attempts?: number;
}): Promise<void> {
  await suite.db.insert(printJobs).values({
    locationId: t.locationId,
    printerId: t.printerId,
    payload: Uint8Array.from([0x01]),
    kind: t.kind ?? "document",
    status: t.status ?? "queued",
    attempts: t.attempts ?? 0,
    createdAt: t.createdAt,
  });
}

/** Run the source as the app role in one transaction, exactly as the registry does. */
async function readAlerts(now = NOW) {
  return withTransaction(suite.db, async (tx) => {
    await asAppUser(tx);
    return printingAlertSource().read({ tx, now });
  });
}

describe("printingAlertSource — agent.silent", () => {
  it("stays quiet for an agent seen 4 minutes ago", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    await seedAgent({ locationId, name: "Cocina", lastSeenAt: minsAgo(4) });
    expect(await readAlerts()).toEqual([]);
  });

  it("raises agent.silent for an agent seen 6 minutes ago, then clears on a fresh pull", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const agentId = await seedAgent({
      locationId,
      name: "Cocina",
      lastSeenAt: minsAgo(6),
    });

    expect(await readAlerts()).toMatchObject([
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
    await suite.db.execute(sql`update print_agents set last_seen_at = ${NOW.toISOString()} `);
    expect(await readAlerts()).toEqual([]);
  });

  it("gives two silent agents that share a name two distinct alerts", async () => {
    // Names are not unique; keying the alert on the name would collide these two into one and hide a
    // down agent. The key must be per-agent-id, so both silent agents surface.
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const first = await seedAgent({ locationId, name: "Cocina", lastSeenAt: minsAgo(6) });
    const second = await seedAgent({
      locationId,
      name: "Cocina",
      lastSeenAt: minsAgo(7),
    });

    const alerts = await readAlerts();
    expect(alerts.every((a) => a.code === "agent.silent")).toBe(true);
    expect(new Set(alerts.map((a) => a.key))).toEqual(
      new Set([`agent.silent:${first}`, `agent.silent:${second}`]),
    );
  });

  it("ignores a deactivated silent agent and a never-seen agent", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    await seedAgent({
      locationId,
      name: "Retired",
      lastSeenAt: minsAgo(30),
      active: false,
    });
    await seedAgent({ locationId, name: "Never", lastSeenAt: null });
    expect(await readAlerts()).toEqual([]);
  });
});

describe("printingAlertSource — printer.jobs_waiting", () => {
  it("raises for a document job queued 3 minutes ago, with the printer name and count", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const printerId = await seedPrinter({ locationId, name: "Barra" });
    await seedJob({ locationId, printerId, createdAt: minsAgo(3) });
    await seedJob({ locationId, printerId, createdAt: minsAgo(5) });

    expect(await readAlerts()).toMatchObject([
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
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const printerId = await seedPrinter({ locationId, name: "Barra" });
    await seedJob({ locationId, printerId, createdAt: minsAgo(1) });
    expect(await readAlerts()).toEqual([]);
  });

  it("never counts a drawer job, however old", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const printerId = await seedPrinter({ locationId, name: "Barra" });
    await seedJob({ locationId, printerId, createdAt: minsAgo(30), kind: "drawer" });
    expect(await readAlerts()).toEqual([]);
  });

  it("raises for a fresh failed job that has hit the delivery-attempt ceiling", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const printerId = await seedPrinter({ locationId, name: "Barra" });
    // 1 minute old — below the stuck-time threshold — but exhausted, so it will never print again.
    await seedJob({
      locationId,
      printerId,
      createdAt: minsAgo(1),
      status: "failed",
      attempts: 5,
    });
    expect(await readAlerts()).toMatchObject([
      { code: "printer.jobs_waiting", params: { printer: "Barra", count: 1 } },
    ]);
  });

  it("ignores jobs on a deactivated printer", async () => {
    await seedTenant(suite.db);
    const locationId = await seedLocation();
    const printerId = await seedPrinter({ locationId, name: "Off", active: false });
    await seedJob({ locationId, printerId, createdAt: minsAgo(10) });
    expect(await readAlerts()).toEqual([]);
  });
});

// The battery source reads `card_readers` (a payments-module table) and calls the card-provider seat,
// so this suite migrates the payments set on top of core and runs as the app role, like the printing
// block. The provider is a stub — no SumUp server — so a `batteryPercent` is whatever the test sets.
const batterySuite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

async function seedReader(t: {
  provider?: string;
  providerRef: string;
  name: string;
  active?: boolean;
}): Promise<string> {
  // Through the table definition, like the printing seeds above. `card_readers.id` and
  // `created_at` are `$defaultFn` generators, and `active` is an integer column here, so a raw
  // template binding a JavaScript boolean was refused outright with
  // `TypeError: Provided value cannot be bound to SQLite parameter 4`.
  const [row] = await batterySuite.db
    .insert(cardReaders)
    .values({
      provider: t.provider ?? "stub",
      providerRef: t.providerRef,
      name: t.name,
      active: t.active ?? true,
    })
    .returning({ id: cardReaders.id });
  return row!.id;
}

/** A card-provider seat whose only live method is `readers.status`: it returns the battery reading a
 * test configures per providerRef and counts each call, so a test can prove the TTL cache. Every other
 * method throws — the source never reaches them. */
function stubProvider(opts: {
  id?: string;
  battery: (ref: string) => number | undefined;
  calls: { n: number };
}): CardProviderContribution {
  const unused = (): never => {
    throw new Error("stubProvider: this method is not used by the battery source");
  };
  return {
    providerId: opts.id ?? "stub",
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
      status: async (_deps: CardProviderRuntimeDeps, ref: string): Promise<ReaderStatus> => {
        opts.calls.n += 1;
        const percent = opts.battery(ref);
        return percent === undefined ? { online: true } : { online: true, batteryPercent: percent };
      },
    },
  };
}

const stubRuntimeDeps = (db: Database) => (): CardProviderRuntimeDeps => ({
  db,
  ring: {} as never,
});

async function readBattery(source: AlertSource, now = NOW) {
  return withTransaction(batterySuite.db, async (tx) => {
    await asAppUser(tx);
    return source.read({ tx, now });
  });
}

describe("batteryAlertSource", () => {
  it("warns at the warning floor, errors at the error floor, and is silent above or absent", async () => {
    await seedTenant(batterySuite.db);
    const at25 = await seedReader({ providerRef: "p25", name: "R25" });
    const at20 = await seedReader({ providerRef: "p20", name: "R20" });
    const at10 = await seedReader({ providerRef: "p10", name: "R10" });
    await seedReader({ providerRef: "pNone", name: "RNone" });

    const percentByRef: Record<string, number | undefined> = {
      p25: 25,
      p20: BATTERY_WARN,
      p10: BATTERY_ERROR,
      pNone: undefined,
    };
    const calls = { n: 0 };
    const source = batteryAlertSource({
      providers: [stubProvider({ battery: (ref) => percentByRef[ref], calls })],
      runtimeDeps: stubRuntimeDeps(batterySuite.db),
      cache: createTtlCache<number | null>({ ttlMs: 5 * 60_000, now: () => NOW }),
    });

    const alerts = await readBattery(source);
    // 25 is above the warning floor and pNone reports no battery, so neither raises anything.
    const byKey = new Map(alerts.map((a) => [a.key, a]));
    expect(new Set(byKey.keys())).toEqual(
      new Set([`reader.battery_low:${at10}`, `reader.battery_low:${at20}`]),
    );
    expect(byKey.get(`reader.battery_low:${at20}`)).toMatchObject({
      code: "reader.battery_low",
      severity: "warning",
      since: null,
      screen: "payments",
      params: { reader: "R20", percent: BATTERY_WARN },
    });
    expect(byKey.get(`reader.battery_low:${at10}`)).toMatchObject({
      code: "reader.battery_low",
      severity: "error",
      params: { reader: "R10", percent: BATTERY_ERROR },
    });
    // A reader at 25 is above the warning floor — assert it was skipped, not merely absent.
    expect(byKey.has(`reader.battery_low:${at25}`)).toBe(false);
  });

  it("reuses one provider status read for five minutes, then reads again", async () => {
    await seedTenant(batterySuite.db);
    await seedReader({ providerRef: "p1", name: "R1" });

    let clock = NOW;
    const calls = { n: 0 };
    const source = batteryAlertSource({
      providers: [stubProvider({ battery: () => 5, calls })],
      runtimeDeps: stubRuntimeDeps(batterySuite.db),
      cache: createTtlCache<number | null>({ ttlMs: 5 * 60_000, now: () => clock }),
    });

    await readBattery(source, clock);
    // A second read four minutes later stays inside the 5-minute window: still one provider call.
    clock = new Date(NOW.getTime() + 4 * 60_000);
    await readBattery(source, clock);
    expect(calls.n).toBe(1);

    // Six minutes on, the cached reading has expired, so the source asks the provider again.
    clock = new Date(NOW.getTime() + 6 * 60_000);
    await readBattery(source, clock);
    expect(calls.n).toBe(2);
  });

  it("ignores a deactivated low reader", async () => {
    await seedTenant(batterySuite.db);
    await seedReader({ providerRef: "pOff", name: "Retired", active: false });
    const calls = { n: 0 };
    const source = batteryAlertSource({
      providers: [stubProvider({ battery: () => 5, calls })],
      runtimeDeps: stubRuntimeDeps(batterySuite.db),
      cache: createTtlCache<number | null>({ ttlMs: 5 * 60_000, now: () => NOW }),
    });
    expect(await readBattery(source)).toEqual([]);
    // The disabled reader was never enumerated, so the provider was never asked.
    expect(calls.n).toBe(0);
  });
});
