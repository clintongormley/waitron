import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
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
import type { StreamStatus, StreamView } from "@waitron/stream";
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
  sealedStateAlertSource,
  STREAM_BEHIND_AFTER_MS,
} from "./alert-sources.js";
import type { BackupStatus } from "./backup-status.js";
import { createTtlCache } from "./ttl-cache.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const ctx = { tx: {} as never, now: NOW };

const OFF: () => StreamView = () => ({ state: "off" });

function src(
  status: BackupStatus,
  outcomes: BackupOutcomeHolder,
  readStream: () => StreamView = OFF,
  firstStartFailed: () => boolean = () => false,
) {
  return backupAlertSource({
    listStatus: async () => status,
    outcomes,
    now: () => NOW,
    readStream,
    firstStartFailed,
  });
}

const stream = (overrides: Partial<StreamStatus>): StreamStatus => ({
  state: "streaming",
  generation: "gen-0-node-a-20260915T110000Z",
  reason: null,
  stateSince: "2026-09-15T11:00:00.000Z",
  bucketProblem: null,
  lagMs: 0,
  lastConfirmedUploadAt: "2026-09-15T11:59:00.000Z",
  ...overrides,
});

describe("backupAlertSource after a restore whose first start failed", () => {
  const none = { failed: new Map() };

  it("raises restore.first_start_failed while the first start is unfinished, and not otherwise", async () => {
    const failed = await src({ configured: false }, none, OFF, () => true).read(ctx);
    expect(failed).toContainEqual({
      key: "restore.first_start_failed",
      code: "restore.first_start_failed",
      params: {},
      severity: "warning",
      since: null,
      screen: "backup",
    });
    const fine = await src({ configured: false }, none, OFF, () => false).read(ctx);
    expect(fine.map((a) => a.code)).not.toContain("restore.first_start_failed");
  });

  it("raises it beside a configured archive's alerts too", async () => {
    const alerts = await src({ configured: true, destinations: [] }, none, OFF, () => true).read(
      ctx,
    );
    expect(alerts.map((a) => a.code)).toEqual(["restore.first_start_failed"]);
  });
});

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

describe("backupAlertSource and the bucket copy", () => {
  const none = { failed: new Map() };
  const configured: BackupStatus = { configured: true, destinations: [] };
  const codesAndSince = async (view: StreamView, status: BackupStatus = configured) =>
    (await src(status, none, () => view).read(ctx)).map((a) => [a.code, a.since]);

  it("does not raise backup.disabled while the bucket copy is on and current", async () => {
    const alerts = await src({ configured: false }, none, () => stream({})).read(ctx);
    expect(alerts).toEqual([]);
  });

  it("raises backup.stream_behind at fifteen minutes, and backup.disabled with it", async () => {
    const lagMs = 20 * 60_000 + 59_999;
    const alerts = await src({ configured: false }, none, () => stream({ lagMs })).read(ctx);
    expect(alerts.map((a) => a.code)).toEqual(["backup.stream_behind", "backup.disabled"]);
    expect(alerts[0]).toEqual({
      key: "backup.stream_behind",
      code: "backup.stream_behind",
      params: { minutes: 20 },
      severity: "error",
      since: new Date(NOW.getTime() - lagMs).toISOString(),
      screen: "backup",
    });
  });

  it("raises backup.stream_behind at exactly fifteen minutes", async () => {
    const alerts = await src(configured, none, () =>
      stream({ lagMs: STREAM_BEHIND_AFTER_MS }),
    ).read(ctx);
    expect(alerts.map((a) => [a.code, a.params])).toEqual([
      ["backup.stream_behind", { minutes: 15 }],
    ]);
  });

  it("does not raise backup.stream_behind just under fifteen minutes", async () => {
    const alerts = await src(configured, none, () => stream({ lagMs: 15 * 60_000 - 1 })).read(ctx);
    expect(alerts).toEqual([]);
  });

  it("raises paused, refused and bucket-unusable from the copy's state, since when each began", async () => {
    expect(
      await codesAndSince(
        stream({
          state: "paused",
          reason: "side_file_limit",
          stateSince: "2026-09-15T11:30:00.000Z",
        }),
      ),
    ).toEqual([["backup.stream_paused", "2026-09-15T11:30:00.000Z"]]);
    expect(
      await codesAndSince(
        stream({
          state: "refused",
          reason: "pointer_changed",
          stateSince: "2026-09-15T11:40:00.000Z",
        }),
      ),
    ).toEqual([["backup.stream_refused", "2026-09-15T11:40:00.000Z"]]);
    expect(
      await codesAndSince(
        stream({
          bucketProblem: { reason: "create_only_ignored", since: "2026-09-15T11:50:00.000Z" },
        }),
      ),
    ).toEqual([["backup.stream_bucket_unusable", "2026-09-15T11:50:00.000Z"]]);
  });

  it("words a refusal by its reason: another box, or settings it cannot use", async () => {
    const since = "2026-09-15T11:40:00.000Z";
    expect(
      await codesAndSince(
        stream({ state: "refused", reason: "pointer_newer_term", stateSince: since }),
      ),
    ).toEqual([["backup.stream_refused", since]]);
    expect(
      await codesAndSince(stream({ state: "refused", reason: "config_unsafe", stateSince: since })),
    ).toEqual([["backup.stream_settings_unusable", since]]);
  });

  it("raises backup.stream_stopped, naming the reason, for a refusal it has no wording for", async () => {
    const alerts = await src(configured, none, () =>
      stream({ state: "refused", reason: "something_new", stateSince: "2026-09-15T11:40:00.000Z" }),
    ).read(ctx);
    expect(alerts).toEqual([
      {
        key: "backup.stream_stopped",
        code: "backup.stream_stopped",
        params: { reason: "something_new" },
        severity: "error",
        since: "2026-09-15T11:40:00.000Z",
        screen: "backup",
      },
    ]);
  });

  for (const reason of ["supervisor_failed", "litestream_unavailable"]) {
    it(`raises backup.stream_stopped for a copy that stopped itself (${reason}), which is not current`, async () => {
      const failed = stream({ state: "off", reason, stateSince: "2026-09-15T11:45:00.000Z" });
      const alerts = await src({ configured: false }, none, () => failed).read(ctx);
      expect(alerts).toEqual([
        {
          key: "backup.stream_stopped",
          code: "backup.stream_stopped",
          params: { reason },
          severity: "error",
          since: "2026-09-15T11:45:00.000Z",
          screen: "backup",
        },
        expect.objectContaining({ code: "backup.disabled" }),
      ]);
    });
  }

  // Its own alert already says why nothing reaches the bucket; "behind" would point the owner at
  // the internet connection instead.
  const explained: [string, Partial<StreamStatus>, string][] = [
    ["stopped itself", { state: "off", reason: "supervisor_failed" }, "backup.stream_stopped"],
    [
      "refused for another box",
      { state: "refused", reason: "pointer_changed" },
      "backup.stream_refused",
    ],
    [
      "refused its settings",
      { state: "refused", reason: "config_unsafe" },
      "backup.stream_settings_unusable",
    ],
    [
      "refused for no named reason",
      { state: "refused", reason: "something_new" },
      "backup.stream_stopped",
    ],
  ];
  for (const [name, overrides, code] of explained) {
    it(`raises only its own alert, not backup.stream_behind, for a copy that ${name}`, async () => {
      const view = stream({ ...overrides, lagMs: 16 * 60_000 });
      expect((await src(configured, none, () => view).read(ctx)).map((a) => a.code)).toEqual([
        code,
      ]);
    });
  }

  it("raises backup.stream_behind beside a pause or a refusing bucket, which do not say it", async () => {
    const lagMs = 16 * 60_000;
    const paused = stream({ state: "paused", reason: "side_file_limit", lagMs });
    expect((await src(configured, none, () => paused).read(ctx)).map((a) => a.code)).toEqual([
      "backup.stream_behind",
      "backup.stream_paused",
    ]);
    const refusing = stream({
      lagMs,
      bucketProblem: { reason: "access_denied", since: "2026-09-15T11:50:00.000Z" },
    });
    expect((await src(configured, none, () => refusing).read(ctx)).map((a) => a.code)).toEqual([
      "backup.stream_behind",
      "backup.stream_bucket_unusable",
    ]);
  });

  it("raises backup.stream_stopped for a copy set up here that could not start", async () => {
    const notStarted: StreamView = {
      state: "off",
      reason: "no_membership",
      stateSince: "2026-09-15T11:20:00.000Z",
    };
    const alerts = await src({ configured: false }, none, () => notStarted).read(ctx);
    expect(alerts.map((a) => [a.code, a.params, a.since])).toEqual([
      ["backup.stream_stopped", { reason: "no_membership" }, "2026-09-15T11:20:00.000Z"],
      ["backup.disabled", {}, null],
    ]);
  });

  it("raises nothing for a copy that was stopped on purpose, and backup.disabled with no archive", async () => {
    for (const reason of ["stopped", null]) {
      const off = stream({ state: "off", reason });
      expect(await codesAndSince(off)).toEqual([]);
      expect(await codesAndSince(off, { configured: false })).toEqual([["backup.disabled", null]]);
    }
  });

  it("raises nothing for a copy that is not set up, and backup.disabled with no archive", async () => {
    const alerts = await src({ configured: false }, none, OFF).read(ctx);
    expect(alerts.map((a) => a.code)).toEqual(["backup.disabled"]);
  });

  it("keeps the archive's alerts beside the copy's", async () => {
    const status: BackupStatus = {
      configured: true,
      destinations: [
        { id: "local", lastBackupAt: "2026-09-10T00:00:00Z", ageSeconds: 999999, stale: true },
      ],
    };
    const alerts = await src(status, none, () =>
      stream({ state: "paused", reason: "side_file_limit" }),
    ).read(ctx);
    expect(alerts.map((a) => a.code)).toEqual([
      "backup.stream_paused",
      "backup.destination_overdue",
    ]);
  });
});

describe("sealedStateAlertSource", () => {
  it("raises backup.sealed_state_failed while the last refresh failed, and clears after", async () => {
    const holder = { failedSince: null as string | null };
    const source = sealedStateAlertSource(holder);
    expect(source).toMatchObject({ area: "backup", permission: "system.manage" });
    expect(await source.read(ctx)).toEqual([]);
    holder.failedSince = "2026-09-15T11:00:00.000Z";
    expect(await source.read(ctx)).toEqual([
      {
        key: "backup.sealed_state_failed",
        code: "backup.sealed_state_failed",
        params: {},
        severity: "error",
        since: "2026-09-15T11:00:00.000Z",
        screen: "backup",
      },
    ]);
    holder.failedSince = null;
    expect(await source.read(ctx)).toEqual([]);
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

// The printing source reads three real tables (printers, print_agents, print_jobs). These are plain
// SELECTs with no contention to prove.
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

/** Run the source in one transaction, exactly as the registry does. */
async function readAlerts(now = NOW) {
  return withTransaction(suite.db, async (tx) => {
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
// so this suite migrates the payments set on top of core, like the printing block. The provider is
// a stub — no SumUp server — so a `batteryPercent` is whatever the test sets.
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
