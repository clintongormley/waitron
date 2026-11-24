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
async function trialUnderAnotherProducer(
  noted: Record<string, unknown> | null,
  runningProducer: string = OTHER_PRODUCER_TAX_ID,
) {
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
  vi.stubEnv("WAITRON_PRODUCER_TAX_ID", runningProducer);
  try {
    return await runUpgradeChecks(
      {
        ...TEST_PRODUCER,
        WAITRON_PRODUCER_TAX_ID: runningProducer,
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

describe("the note an upgrade's host works out over a live one, judged by the new release's trial", () => {
  useTestProducer();
  const FIRST = TEST_PRODUCER.WAITRON_PRODUCER_TAX_ID;
  const THIRD_PRODUCER_TAX_ID = "22222222J";

  /** The host names the new release 1.4.1; a server run from source calls itself something else. */
  async function hostNote(running: string, next: string, live: Record<string, unknown> | null) {
    const { identityChangeNote } = (await import(
      new URL("../../../scripts/box/upgrades/host.mjs", import.meta.url).href
    )) as {
      identityChangeNote: (
        oldImage: string,
        nextImage: string,
        stateDirectory: string,
        run: (file: string, args: string[]) => Promise<{ stdout: string }>,
      ) => Promise<Record<string, unknown> | null>;
    };
    const stateDir = join(root, "live");
    await mkdir(stateDir);
    if (live !== null)
      await writeFile(join(stateDir, "identity-change.json"), JSON.stringify(live));
    const images: Record<string, { producer: string; ref: string }> = {
      "sha256:old": { producer: running, ref: "v1.4.0" },
      "sha256:next": { producer: next, ref: "v1.4.1" },
    };
    const note = await identityChangeNote(
      "sha256:old",
      "sha256:next",
      stateDir,
      async (_file, args) => ({
        stdout: JSON.stringify({
          Env: [`WAITRON_PRODUCER_TAX_ID=${images[args[2]!]!.producer}`],
          Labels: { "org.opencontainers.image.ref.name": images[args[2]!]!.ref },
        }),
      }),
    );
    if (note === null) return null;
    expect(note.release).toBe("1.4.1");
    return { ...note, release: softwareVersion() };
  }
  const leftBy = (release: string, producerTaxId: string, fromProducerTaxId: string) => ({
    version: 1,
    release,
    producerTaxId,
    fromProducerTaxId,
  });
  const waiting = () => leftBy("1.4.0", OTHER_PRODUCER_TAX_ID, FIRST);

  it("accepts a fixed release by the producer still waiting, as a change from the first one", async () => {
    const note = await hostNote(OTHER_PRODUCER_TAX_ID, OTHER_PRODUCER_TAX_ID, waiting());
    expect(await trialUnderAnotherProducer(note)).toMatchObject({ identityChange: "pending" });
  });

  it.each([
    ["with no live note", () => null],
    [
      "with a live note naming another producer than the running one",
      () => leftBy("1.4.0", THIRD_PRODUCER_TAX_ID, FIRST),
    ],
    [
      "with a live note naming another release than the running one",
      () => leftBy("1.3.0", OTHER_PRODUCER_TAX_ID, FIRST),
    ],
    ["with a misshapen live note", () => ({ ...waiting(), more: "x" })],
  ])("refuses that release %s, which gives it no note", async (_label, live) => {
    const note = await hostNote(OTHER_PRODUCER_TAX_ID, OTHER_PRODUCER_TAX_ID, live());
    expect(note).toBeNull();
    await expect(trialUnderAnotherProducer(note)).rejects.toMatchObject({
      code: "sif.producer_changed",
    });
  });

  it("accepts a third producer over the one waiting, as a change from the first one", async () => {
    const note = await hostNote(OTHER_PRODUCER_TAX_ID, THIRD_PRODUCER_TAX_ID, waiting());
    expect(await trialUnderAnotherProducer(note, THIRD_PRODUCER_TAX_ID)).toMatchObject({
      identityChange: "pending",
    });
  });

  it("refuses that third producer as a change from the one waiting, which filed nothing", async () => {
    const note = leftBy(softwareVersion(), THIRD_PRODUCER_TAX_ID, OTHER_PRODUCER_TAX_ID);
    await expect(trialUnderAnotherProducer(note, THIRD_PRODUCER_TAX_ID)).rejects.toMatchObject({
      code: "sif.producer_changed",
    });
  });

  describe("a live note left over, the latest record already under its producer", () => {
    const leftOver = () => leftBy("1.4.0", FIRST, OTHER_PRODUCER_TAX_ID);

    it("opens nothing for a release by the same producer", async () => {
      const note = await hostNote(FIRST, FIRST, leftOver());
      expect(note).toMatchObject({ fromProducerTaxId: OTHER_PRODUCER_TAX_ID });
      const report = await trialUnderAnotherProducer(note, FIRST);
      expect(report).toMatchObject({ mode: "trading", fiscalRecords: 2 });
      expect(report).not.toHaveProperty("identityChange");
    });

    it("refuses a third producer until the running release's start deletes it", async () => {
      const note = await hostNote(FIRST, THIRD_PRODUCER_TAX_ID, leftOver());
      expect(note).toMatchObject({ fromProducerTaxId: OTHER_PRODUCER_TAX_ID });
      await expect(trialUnderAnotherProducer(note, THIRD_PRODUCER_TAX_ID)).rejects.toMatchObject({
        code: "sif.producer_changed",
      });
    });

    it("accepts that third producer once it is deleted", async () => {
      const note = await hostNote(FIRST, THIRD_PRODUCER_TAX_ID, null);
      expect(await trialUnderAnotherProducer(note, THIRD_PRODUCER_TAX_ID)).toMatchObject({
        identityChange: "pending",
      });
    });
  });
});
