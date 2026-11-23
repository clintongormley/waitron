import { access, cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invoiceSeries, nodes, openVenueDatabase, taxpayer, withTransaction } from "@waitron/db";
import {
  applyMigrations,
  manifestSets,
  migrationOptionsFor,
  type MigrationSet,
} from "@waitron/migrations";
import { seedBusinessDay, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { buildManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";
import { previewRecoveryArchive } from "./recovery-backup-preview.js";
import { restoreFromArtifactFile } from "./restore.js";
import { runRestore } from "./restore-command.js";
import {
  runStagedRestore,
  stageRestoreRequest,
  validateArchiveForStaging,
} from "./restore-request.js";
import { nodeDumpEntry } from "./testing/node-copy.js";

const RECOVERY_KEY = "rebuilt-baseline-recovery-key";
const NODE_ID = "a1b20000-0000-4000-8000-000000000001";
const VAULT_KEY = Buffer.alloc(32, 7).toString("base64");

let scratch: string;
/** Every set's shipped files, with core's starting migration as it read before a rebuild: same
 * schema, another hash, an earlier `when`. */
let oldRoot: string;
/** The same, as a later rebuild would ship it: another hash and a later `when`. */
let newRoot: string;

/** The shipped migrations as a migrations root, for the command line's `WAITRON_MIGRATIONS_DIR`. */
let shippedRoot: string;

async function copyShipped(name: string): Promise<string> {
  const root = join(scratch, name);
  const shipped = migrationOptionsFor(manifestSets(), null);
  for (const [index, set] of manifestSets().entries())
    await cp(shipped[index]!.migrationsFolder, join(root, set.name), { recursive: true });
  return root;
}

/** A copy of the shipped migrations whose core starting migration has another hash, its journal
 * times moved by `shiftMs`. */
async function rebuiltRoot(name: string, shiftMs: number): Promise<string> {
  const root = await copyShipped(name);
  const core = join(root, coreSet().name);
  const baseline = join(core, "0000_baseline.sql");
  const text = await readFile(baseline, "utf8");
  const rebuilt = text.replace("CREATE TABLE `activity_log`", "CREATE TABLE  `activity_log`");
  expect(rebuilt).not.toBe(text);
  await writeFile(baseline, rebuilt);
  const journalPath = join(core, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: { when: number }[];
  };
  for (const entry of journal.entries) entry.when += shiftMs;
  await writeFile(journalPath, JSON.stringify(journal));
  return root;
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "restore-rebuilt-baseline-"));
  oldRoot = await rebuiltRoot("old-migrations", -60_000);
  newRoot = await rebuiltRoot("new-migrations", 60_000);
  shippedRoot = await copyShipped("shipped-migrations");
}, 120_000);

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function coreSet(): MigrationSet {
  return manifestSets().find((set) => set.name === "core")!;
}

/** A venue folder migrated from `root`, told apart by its legal name. */
async function venueFolder(root: string | null, legalName: string): Promise<string> {
  const directory = await mkdtemp(join(scratch, "venue-"));
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), root));
  const store = await openVenueDatabase(directory);
  try {
    await withTransaction(store.venue, async (tx) => {
      await tx.insert(taxpayer).values({ id: 1, country: "ES", taxId: "89890001K", legalName });
      await seedVenueSettings(tx, { name: legalName, invoiceLocales: ["es"] });
      await seedBusinessDay(tx);
      await tx.insert(nodes).values({ id: NODE_ID, name: "Archive node" });
      await seedPersons(tx, {
        displayName: "Archive administrator",
        role: "admin",
        status: "active",
        passwordHash: "archive-admin-hash",
      });
      for (const [code, purpose] of [
        ["FA", "standard"],
        ["FF", "full"],
        ["RE", "corrective"],
      ] as const)
        await tx.insert(invoiceSeries).values({ nodeId: NODE_ID, code, purpose });
    });
  } finally {
    await store.close();
  }
  return directory;
}

async function archiveOf(source: string): Promise<string> {
  const store = await openVenueDatabase(source);
  try {
    const database = join(source, "copy.db");
    await store.venue.archiveTo(database);
    const manifest = await buildManifest({
      db: store.venue,
      node: store.node,
      modules: ALL_MODULES,
      environment: "preproduction",
      now: new Date("2026-11-01T03:00:00Z"),
    });
    const path = join(source, "backup.enc");
    await writeFile(
      path,
      encryptArtifact(
        packArchive([
          { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
          { name: "db.dump", bytes: await readFile(database) },
          await nodeDumpEntry(store.node, source),
          { name: "secrets/trading.env", bytes: Buffer.from(`WAITRON_NODE_ID=${NODE_ID}\n`) },
          {
            name: "secrets/secrets.env",
            bytes: Buffer.from(
              `WAITRON_CREDENTIALS_KEY=${VAULT_KEY}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
            ),
          },
        ]),
        RECOVERY_KEY,
      ),
    );
    return path;
  } finally {
    await store.close();
  }
}

type Outcome = { refusal: string } | "restored";

/** The two ways an operator restores an archive file with no recovery operation. */
const ENTRIES: Record<
  string,
  (artifactPath: string, stateDir: string, venueDir: string) => Promise<Outcome>
> = {
  "the command line": async (artifactPath, stateDir, venueDir) => {
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", artifactPath, "--confirm-old-box-gone"],
      env: {
        WAITRON_STATE_DIR: stateDir,
        WAITRON_VENUE_DIR: venueDir,
        WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
      },
      out: (line) => out.push(line),
      restore: (request) => restoreFromArtifactFile({ ...request, migrationsRoot: null }),
    });
    return code === 0 ? "restored" : { refusal: out.at(-1)! };
  },
  "the setup page's restore, run at the next start": async (artifactPath, stateDir, venueDir) => {
    await stageRestoreRequest(stateDir, {
      artifact: await readFile(artifactPath),
      recoveryKey: RECOVERY_KEY,
      environment: "preproduction",
    });
    try {
      await runStagedRestore({ stateDir, venueDir, migrationsRoot: null, log: () => {} });
      return "restored";
    } catch (error) {
      return { refusal: (error as { code?: string }).code ?? String(error) };
    }
  },
};

async function restoreOver(entry: string | (typeof ENTRIES)[string], artifactPath: string) {
  const stateDir = await mkdtemp(join(scratch, "state-"));
  const venueDir = join(stateDir, "venue");
  await cp(await venueFolder(null, "Current destination"), venueDir, { recursive: true });
  await writeFile(join(stateDir, "trading.env"), "original destination identity");
  const outcome = await (typeof entry === "string" ? ENTRIES[entry]! : entry)(
    artifactPath,
    stateDir,
    venueDir,
  );
  const store = await openVenueDatabase(venueDir);
  let legalNames: string[];
  try {
    legalNames = (await store.venue.select().from(taxpayer)).map((row) => row.legalName);
  } finally {
    await store.close();
  }
  return {
    outcome,
    legalNames,
    identity: await readFile(join(stateDir, "trading.env"), "utf8").catch(() => null),
  };
}

describe.each(Object.keys(ENTRIES))("an archive restored through %s", (entry) => {
  it.each([
    ["before", () => oldRoot],
    ["after", () => newRoot],
  ])(
    "is refused before placement when made %s a rebuild of a starting migration",
    async (_, root) => {
      const result = await restoreOver(
        entry,
        await archiveOf(await venueFolder(root(), "Other version")),
      );
      expect(result.legalNames).toEqual(["Current destination"]);
      expect(result.outcome).toEqual({
        refusal: expect.stringContaining("provisioning.database_ahead"),
      });
      expect(result.identity).toBe("original destination identity");
    },
    120_000,
  );

  it("restores when this version made it", async () => {
    const result = await restoreOver(
      entry,
      await archiveOf(await venueFolder(null, "Archive venue")),
    );
    expect(result.outcome).toBe("restored");
    expect(result.legalNames).toEqual(["Archive venue"]);
  }, 120_000);
});

/** With a recovery operation the command line first reviews the archive, so the refusal comes from
 * the review; the operation file only has to parse, as the review runs before it is used. */
it.each([
  ["before", () => oldRoot],
  ["after", () => newRoot],
])(
  "is refused at the review on the command line with a recovery operation when made %s a rebuild",
  async (_, root) => {
    const operationPath = join(scratch, "recovery-operation.json");
    await writeFile(
      operationPath,
      JSON.stringify({
        binding: {
          module: "fiscal-verifactu",
          action: "restore",
          eventId: "rebuilt-baseline-event",
          sourceId: "rebuilt-baseline-source",
          targetNodeId: NODE_ID,
        },
        input: {},
      }),
    );
    const result = await restoreOver(
      async (artifactPath, stateDir, venueDir) => {
        const out: string[] = [];
        const code = await runRestore({
          argv: ["restore", artifactPath, "--confirm-old-box-gone", "--confirm-sole-recovery"],
          env: {
            WAITRON_STATE_DIR: stateDir,
            WAITRON_VENUE_DIR: venueDir,
            WAITRON_BACKUP_RECOVERY_KEY: RECOVERY_KEY,
            WAITRON_RECOVERY_OPERATION_FILE: operationPath,
            WAITRON_NODE_RECOVERY_KEY: "rebuilt-baseline-node-key",
            WAITRON_MIGRATIONS_DIR: shippedRoot,
          },
          out: (line) => out.push(line),
        });
        return code === 0 ? "restored" : { refusal: out.at(-1)! };
      },
      await archiveOf(await venueFolder(root(), "Other version")),
    );
    expect(result).toEqual({
      outcome: {
        refusal: expect.stringContaining(
          "provisioning.database_ahead — this backup was made by a different version of Waitron",
        ),
      },
      legalNames: ["Current destination"],
      identity: "original destination identity",
    });
  },
  120_000,
);

describe("the setup page staging an archive file", () => {
  async function stage(artifactPath: string) {
    const stateDir = await mkdtemp(join(scratch, "state-"));
    const staged = await stageRestoreRequest(
      stateDir,
      {
        kind: "archive-file",
        artifactPath,
        recoveryKey: RECOVERY_KEY,
        environment: "preproduction",
      },
      (candidate) =>
        validateArchiveForStaging(candidate, {
          stateDir,
          migrationsRoot: null,
          modules: ALL_MODULES,
          oldBoxGone: true,
          now: () => new Date(),
        }),
    ).then(
      () => "staged" as const,
      (error: unknown) => ({ refusal: (error as { code?: string }).code ?? String(error) }),
    );
    const recorded = await access(join(stateDir, "flows/restore/record.json")).then(
      () => true,
      () => false,
    );
    return { staged, recorded };
  }

  it.each([
    ["before", () => oldRoot],
    ["after", () => newRoot],
  ])(
    "refuses one made %s a rebuild of a starting migration, staging nothing",
    async (_, root) => {
      const result = await stage(await archiveOf(await venueFolder(root(), "Other version")));
      expect(result).toEqual({
        staged: { refusal: "provisioning.database_ahead" },
        recorded: false,
      });
    },
    120_000,
  );

  it("stages one this version made", async () => {
    const result = await stage(await archiveOf(await venueFolder(null, "Archive venue")));
    expect(result).toEqual({ staged: "staged", recorded: true });
  }, 120_000);
});

describe("the review of an archive file", () => {
  async function review(artifactPath: string) {
    const stateDir = await mkdtemp(join(scratch, "state-"));
    const stagingDir = join(stateDir, "staging");
    const reviewed = await previewRecoveryArchive({
      artifactPath,
      recoveryKey: RECOVERY_KEY,
      environment: "preproduction",
      stateDir,
      stagingDir,
      migrationsRoot: null,
      modules: ALL_MODULES,
    }).then(
      (preview) => ({ legalName: preview.taxpayer.legalName }),
      (error: unknown) => ({ refusal: (error as { code?: string }).code ?? String(error) }),
    );
    return { reviewed, leftInStaging: await readdir(stagingDir) };
  }

  it.each([
    ["before", () => oldRoot],
    ["after", () => newRoot],
  ])(
    "refuses one made %s a rebuild of a starting migration, keeping no private copy",
    async (_, root) => {
      const result = await review(await archiveOf(await venueFolder(root(), "Other version")));
      expect(result).toEqual({
        reviewed: { refusal: "provisioning.database_ahead" },
        leftInStaging: [],
      });
    },
    120_000,
  );

  it("reviews one this version made", async () => {
    const result = await review(await archiveOf(await venueFolder(null, "Archive venue")));
    expect(result).toEqual({ reviewed: { legalName: "Archive venue" }, leftInStaging: [] });
  }, 120_000);
});
