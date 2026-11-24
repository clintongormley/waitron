import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { stampDeployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import {
  runningIdentity,
  softwareVersion,
} from "@waitron/fiscal-verifactu/src/software-identity.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionOrderVenue, billlessSale, type OrderVenue } from "./testing/order-venue.js";
import { loadConfig } from "./config.js";
import { systemClock } from "./till-backend.js";
import { TEST_PRODUCER, useTestProducer } from "./testing/test-producer.js";

let venue: OrderVenue;
const source = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
});
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upgrade-trial-"));
  venue = await provisionOrderVenue(source.db);
  await billlessSale(venue);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

it("captures committed WAL rows beside an active writer", async () => {
  const { captureUpgradeTrial } = await import("./upgrade-trial.js");
  const venueDir = dirname(source.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
  const stateDir = join(root, "source");
  await mkdir(join(stateDir, "flows/setup"), { recursive: true });
  await writeFile(join(stateDir, "secrets.env"), "WAITRON_TOKEN=private\n");
  await writeFile(join(stateDir, "trading.env"), `WAITRON_NODE_ID=${venue.cfg.nodeId}\n`);
  await writeFile(join(stateDir, "backup.env"), "WAITRON_BACKUP_ENABLED=false\n");
  await writeFile(join(stateDir, "flows/setup/record.json"), "{}");
  const config = loadConfig(
    { ...TEST_PRODUCER, WAITRON_STATE_DIR: stateDir, WAITRON_VENUE_DIR: venueDir },
    stateDir,
    stateDir,
  );
  const out = join(root, "copy");
  const writer = new DatabaseSync(join(venueDir, "venue.db"));
  try {
    writer.exec(
      "pragma wal_autocheckpoint=0; create table upgrade_probe(value text); insert into upgrade_probe values ('committed'); begin immediate; insert into upgrade_probe values ('pending')",
    );
    await captureUpgradeTrial(config, out);
    const copy = new DatabaseSync(join(out, "venue/venue.db"));
    try {
      expect(copy.prepare("select value from upgrade_probe").all()).toEqual([
        { value: "committed" },
      ]);
      copy.exec("create table trial_only(id integer)");
    } finally {
      copy.close();
    }
    writer.exec("rollback");
    await billlessSale(venue);
    expect(writer.prepare("select count(*) as n from sales").get()).toEqual({ n: 2 });
    expect(
      writer.prepare("select name from sqlite_master where name='trial_only'").get(),
    ).toBeUndefined();
    expect((await readdir(join(out, "venue"))).sort()).toEqual(["node.db", "venue.db"]);
    for (const name of ["secrets.env", "trading.env", "backup.env", "flows/setup/record.json"])
      expect(await readFile(join(out, name), "utf8")).toBe(
        await readFile(join(stateDir, name), "utf8"),
      );
  } finally {
    writer.close();
  }
});

it("keeps the source selling while the candidate checks the captured database", async () => {
  const { captureUpgradeTrial } = await import("./upgrade-trial.js");
  const { runUpgradeChecks } = await import("./upgrade-check-entry.js");
  const { copyMigrationsRoot } = await import("./testing/boot-harness.js");
  const { seedModuleSettings } = await import("../test/module-settings.js");
  const { VerifactuBackend } = await import("@waitron/fiscal-verifactu");
  const venueDir = dirname(source.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
  const stateDir = join(root, "source");
  await mkdir(stateDir);
  await seedModuleSettings(source.db, { "fiscal-none": false });
  const config = loadConfig(
    { ...TEST_PRODUCER, WAITRON_STATE_DIR: stateDir, WAITRON_VENUE_DIR: venueDir },
    stateDir,
    stateDir,
  );
  expect(source.db.all(sql`select id from nodes`)).toContainEqual({ id: venue.cfg.nodeId });
  const copy = join(root, "copy");
  await captureUpgradeTrial(config, copy);
  const migrations = join(root, "migrations");
  await copyMigrationsRoot(migrations);
  const journalPath = join(migrations, "core/meta/_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: Math.max(...journal.entries.map((entry: { when: number }) => entry.when)) + 1,
    tag: "9999_upgrade_trial_probe",
    breakpoints: true,
  });
  await writeFile(journalPath, JSON.stringify(journal));
  await writeFile(
    join(migrations, "core/9999_upgrade_trial_probe.sql"),
    "create table upgrade_trial_probe(id integer);",
  );
  let entered!: () => void;
  let release!: () => void;
  const checking = new Promise<void>((done) => {
    entered = done;
  });
  const proceed = new Promise<void>((done) => {
    release = done;
  });
  const original = VerifactuBackend.prototype.checkIntegrity;
  let held = false;
  const reader = vi
    .spyOn(VerifactuBackend.prototype, "checkIntegrity")
    .mockImplementation(async function (this: InstanceType<typeof VerifactuBackend>, ...args) {
      if (!held) {
        held = true;
        entered();
        await proceed;
      }
      return original.apply(this, args);
    });
  const trial = runUpgradeChecks(
    {
      ...TEST_PRODUCER,
      WAITRON_STATE_DIR: copy,
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_MIGRATIONS_DIR: migrations,
    },
    () => {},
    "trial",
  );
  try {
    await Promise.race([
      checking,
      trial.then(() => {
        throw new Error("trial completed before the held check");
      }),
    ]);
    await billlessSale(venue);
    expect(source.db.all(sql`select count(*) as n from sales`)).toEqual([{ n: 2 }]);
  } finally {
    release();
  }
  try {
    expect(await trial).toEqual({ mode: "trading", menus: 3, orders: 1, fiscalRecords: 1 });
    const checked = new DatabaseSync(join(copy, "venue/venue.db"), { readOnly: true });
    try {
      expect(
        checked.prepare("select name from sqlite_master where name='upgrade_trial_probe'").all(),
      ).toEqual([{ name: "upgrade_trial_probe" }]);
    } finally {
      checked.close();
    }
    expect(
      source.db.all(sql`select name from sqlite_master where name='upgrade_trial_probe'`),
    ).toEqual([]);
  } finally {
    reader.mockRestore();
  }
});

const OTHER_PRODUCER_TAX_ID = "11111111H";

/**
 * A copy of a production venue whose latest record was filed under `TEST_PRODUCER`, checked as the
 * trial of a release that files under another producer, with `noted` as the copy's note.
 */
async function trialUnderAnotherProducer(noted: Record<string, unknown> | null) {
  const { captureUpgradeTrial } = await import("./upgrade-trial.js");
  const { runUpgradeChecks } = await import("./upgrade-check-entry.js");
  const { seedModuleSettings } = await import("../test/module-settings.js");
  const { copyMigrationsRoot } = await import("./testing/boot-harness.js");
  const venueDir = dirname(source.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file);
  const stateDir = join(root, "source");
  await mkdir(stateDir);
  await seedModuleSettings(source.db, { "fiscal-none": false });
  await stampDeployment(source.db, "production");
  const backend = new VerifactuBackend({
    identity: runningIdentity("production"),
    clock: systemClock(),
    db: source.db,
    environment: "production",
    deploymentEnvironment: "production",
  });
  await billlessSale({ ...venue, backend });
  const copy = join(root, "copy");
  await captureUpgradeTrial(
    loadConfig(
      { ...TEST_PRODUCER, WAITRON_STATE_DIR: stateDir, WAITRON_VENUE_DIR: venueDir },
      stateDir,
      stateDir,
    ),
    copy,
  );
  if (noted !== null) await writeFile(join(copy, "identity-change.json"), JSON.stringify(noted));
  const migrations = join(root, "migrations");
  await copyMigrationsRoot(migrations);
  // The backend reads its producer from the process's environment.
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", OTHER_PRODUCER_TAX_ID);
  try {
    return await runUpgradeChecks(
      {
        ...TEST_PRODUCER,
        WAITRON_PRODUCER_TAX_ID: OTHER_PRODUCER_TAX_ID,
        WAITRON_ENV: "production",
        WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
        WAITRON_STATE_DIR: copy,
        WAITRON_NODE_ID: venue.cfg.nodeId,
        WAITRON_MIGRATIONS_DIR: migrations,
      },
      () => {},
      "trial",
    );
  } finally {
    vi.unstubAllEnvs();
  }
}

const matchingNote = () => ({
  version: 1,
  release: softwareVersion(),
  producerTaxId: OTHER_PRODUCER_TAX_ID,
  fromProducerTaxId: TEST_PRODUCER.WAITRON_PRODUCER_TAX_ID,
});

describe("a copy whose record another producer filed", () => {
  useTestProducer();

  it("passes a change of producer the copy's note names, and reports it pending", async () => {
    expect(await trialUnderAnotherProducer(matchingNote())).toEqual({
      mode: "trading",
      menus: 3,
      orders: 2,
      fiscalRecords: 2,
      identityChange: "pending",
    });
  });

  it("refuses a change of producer with no note", async () => {
    await expect(trialUnderAnotherProducer(null)).rejects.toMatchObject({
      code: "sif.producer_changed",
    });
  });

  it("refuses a change of producer the copy's note does not name", async () => {
    await expect(
      trialUnderAnotherProducer({ ...matchingNote(), release: "9.9.9" }),
    ).rejects.toMatchObject({ code: "sif.producer_changed" });
  });
});
