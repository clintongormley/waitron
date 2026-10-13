import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import {
  invoiceSeries,
  locations,
  nodes,
  openVenueDatabase,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { contadoresInstalacion, installationFloor, registroSif } from "@waitron/fiscal-verifactu";
import { hashPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError, jobOrigin } from "@waitron/shared";
import type { BucketConfig, FileCall, S3FileStore } from "@waitron/stream";
import { appendToChain, readChain, workforceChains } from "@waitron/workforce";
import { encryptArtifact } from "./artifact-cipher.js";
import { encodeArchiveRecoveryPack, type ArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { archiveNamespace } from "./archive-settings.js";
import { packArchive } from "./backup-archive.js";
import { backupArchiveKey, dumpFileName } from "./backup-keys.js";
import { buildManifest } from "./backup-manifest.js";
import { ALL_MODULES } from "./modules.js";
import { restoreFromArtifactFile, type RestoreFileDeps } from "./restore.js";
import { runRestore } from "./restore-command.js";
import { readStreamSettings } from "./stream-host.js";

const RECOVERY_KEY = "pack-recovery-key-value-7c1d";
const SECRET_ACCESS_KEY = "pack-secret-access-key-value-93ab";
const VAULT_KEY = Buffer.alloc(32, 5).toString("base64");
const KEY = backupArchiveKey(new Date("2026-10-01T03:00:00Z"));
const COLD_RESTORE_NOTICE =
  "cold restore: use only when no peer (mirror or local secondary) survived — a survivor holds more history and is promoted, not overwritten";
const WRONG_KEY_LINE = "restore failed: wrong recovery key or corrupt artifact";

const ids = {
  location: "a5380000-0000-4000-8000-000000000001",
  node: "a5380000-0000-4000-8000-000000000002",
  series: "a5380000-0000-4000-8000-000000000003",
  sif: "a5380000-0000-4000-8000-000000000004",
};

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

const PACK: ArchiveRecoveryPack = {
  version: 1,
  format: "WBK1",
  venueId: "venue-1",
  bucket: {
    region: "eu-west-1",
    bucket: "owner-bucket",
    prefix: "waitron",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: SECRET_ACCESS_KEY,
  },
  archivePrefix: archiveNamespace("waitron", "venue-1"),
  recoveryKey: RECOVERY_KEY,
};

let scratch: string;
let artifactBytes: Buffer;
let personId: string;
/** Every line any case printed, read once at the end for secrets. */
const printed: string[] = [];

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "restore-command-archive-"));
  await withTransaction(suite.db, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Archive source" });
    await tx.insert(locations).values({
      id: ids.location,
      name: "Archive location",
      invoiceLocales: ["es"],
      operationDescription: "Venta",
    });
    await tx.insert(nodes).values({ id: ids.node, locationId: ids.location, name: "Archive node" });
    await tx
      .insert(invoiceSeries)
      .values({ id: ids.series, nodeId: ids.node, code: "FA", purpose: "standard" });
    await tx
      .insert(invoiceSeries)
      .values({ nodeId: ids.node, code: "RE", purpose: "rectificative" });
    await tx.insert(invoiceSeries).values({ nodeId: ids.node, code: "FF", purpose: "full" });
    await tx
      .insert(contadoresInstalacion)
      .values({ nif: "89890001K", idSistemaInformatico: "W1", proximoNumero: 2 });
    await tx.insert(registroSif).values({
      id: ids.sif,
      nodeId: ids.node,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: 1,
    });
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Ana", pinHash: hashPin("1234") })
      .returning({ id: persons.id });
    personId = person!.id;
  });
  for (const at of ["2026-10-01T09:00:00Z", "2026-10-01T13:00:00Z"]) {
    await suite.db.transaction((tx) =>
      appendToChain(
        tx,
        { nodeId: ids.node, locationId: ids.location },
        {
          personId,
          entryKind: at.endsWith("09:00:00Z") ? "in" : "out",
          eventAt: at,
          eventOffsetMinutes: 0,
          recordedByPersonId: personId,
          origin: jobOrigin("dashboard"),
        },
      ),
    );
  }
  const database = join(scratch, "source.db");
  await suite.db.archiveTo(database);
  const manifest = await buildManifest({
    db: suite.db,
    modules: ALL_MODULES,
    environment: "preproduction",
    now: new Date("2026-10-01T03:00:00Z"),
  });
  artifactBytes = encryptArtifact(
    packArchive([
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "db.dump", bytes: await readFile(database) },
      {
        name: "secrets/trading.env",
        bytes: Buffer.from(
          `WAITRON_TILL_NODE_ID=${ids.node}\nWAITRON_TILL_LOCATION_ID=${ids.location}\n`,
        ),
      },
      {
        name: "secrets/secrets.env",
        bytes: Buffer.from(
          `WAITRON_CREDENTIALS_KEY=${VAULT_KEY}\nWAITRON_CREDENTIALS_KEY_VERSION=1\n`,
        ),
      },
    ]),
    RECOVERY_KEY,
  );
}, 120_000);

afterAll(async () => {
  for (const line of printed) {
    expect(line).not.toContain(SECRET_ACCESS_KEY);
    expect(line).not.toContain(RECOVERY_KEY);
  }
  await rm(scratch, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  stateDir: string;
  venueDir: string;
  bucketDir: string;
  packPath: string;
  storeCalls: string[];
  /** Replaces the default copy in `getFile`. */
  get?: (key: string, outPath: string, call: FileCall) => Promise<void>;
}

let current: Fixture | undefined;

afterEach(async () => {
  if (current === undefined) return;
  const leftovers = await readdir(join(current.stateDir, "restore-staging")).catch(() => []);
  expect(leftovers).toEqual([]);
  current = undefined;
});

async function fixture(pack: ArchiveRecoveryPack = PACK): Promise<Fixture> {
  const root = await mkdtemp(join(scratch, "case-"));
  const f: Fixture = {
    root,
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    bucketDir: join(root, "bucket"),
    packPath: join(root, "pack.txt"),
    storeCalls: [],
  };
  await mkdir(f.stateDir);
  await mkdir(f.bucketDir);
  await writeFile(join(f.bucketDir, KEY), artifactBytes);
  await writeFile(f.packPath, encodeArchiveRecoveryPack(pack));
  current = f;
  return f;
}

/** A live venue at `venueDir`, told apart from the archive by its legal name. */
async function liveVenue(f: Fixture): Promise<void> {
  await mkdir(f.venueDir);
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const live = await openVenueDatabase(f.venueDir);
  try {
    await live.venue.update(tenants).set({ legalName: "Live venue" });
  } finally {
    await live.close();
  }
}

async function venueFiles(f: Fixture): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of (await readdir(f.venueDir)).sort()) {
    const path = join(f.venueDir, name);
    if ((await stat(path)).isFile()) files[name] = (await readFile(path)).toString("base64");
  }
  return files;
}

async function legalName(venueDir: string): Promise<string> {
  const opened = await openVenueDatabase(venueDir);
  try {
    return (await opened.venue.select().from(tenants))[0]!.legalName;
  } finally {
    await opened.close();
  }
}

function openFiles(f: Fixture): (bucket: BucketConfig) => S3FileStore {
  return (config) => {
    f.storeCalls.push(`open:${config.prefix}`);
    const unused = async (): Promise<never> => {
      throw new Error("not used");
    };
    return {
      putFile: unused,
      putBytes: unused,
      readStream: unused,
      deleteMany: unused,
      async list(prefix) {
        f.storeCalls.push(`list:${prefix}`);
        const names = await readdir(f.bucketDir);
        return Promise.all(
          names
            .filter((name) => name.startsWith(prefix))
            .map(async (name) => ({
              key: name,
              size: (await stat(join(f.bucketDir, name))).size,
              lastModified: new Date(),
            })),
        );
      },
      async getFile(key, outPath, call) {
        f.storeCalls.push(`getFile:${key}`);
        if (f.get) return f.get(key, outPath, call);
        await writeFile(outPath, await readFile(join(f.bucketDir, key)));
      },
      close() {},
    };
  };
}

async function run(
  f: Fixture,
  args: string[] = [],
  overrides: Partial<Parameters<typeof runRestore>[0]> = {},
): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const code = await runRestore({
    argv: ["restore", "--from-archive", f.packPath, "--archive-key", KEY, ...args],
    env: { WAITRON_STATE_DIR: f.stateDir, WAITRON_VENUE_DIR: f.venueDir },
    out: (line) => {
      out.push(line);
      printed.push(line);
    },
    restore: (deps: RestoreFileDeps) => restoreFromArtifactFile({ ...deps, migrationsRoot: null }),
    openArchiveFiles: openFiles(f),
    ...overrides,
  });
  return { code, out };
}

describe("waitron-restore restore --from-archive", () => {
  it("restores an archive from a venue that never streamed, with no kit anywhere", async () => {
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: VAULT_KEY,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    expect(await readStreamSettings(suite.db, ring)).toBeNull();
    const expectedTenants = await suite.db.select().from(tenants);
    const expectedLocations = await suite.db.select().from(locations);
    const chainKey = { nodeId: ids.node, locationId: ids.location };
    const expectedChain = await readChain(suite.db, chainKey);
    const expectedHead = await suite.db.select().from(workforceChains);
    expect(expectedChain.map((e) => e.sequenceNo)).toEqual([1, 2]);

    const f = await fixture();
    // The pack carries the recovery key; a different one in the environment is not used.
    const { code, out } = await run(f, [], {
      env: {
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_BACKUP_RECOVERY_KEY: "some-other-key",
      },
    });
    expect(code).toBe(0);
    expect(out[0]).toBe(COLD_RESTORE_NOTICE);
    expect(out.at(-1)).toBe(`restored archive ${KEY} from the bucket named in ${f.packPath}`);
    expect(f.storeCalls).toEqual([`open:${PACK.archivePrefix}`, `list:${KEY}`, `getFile:${KEY}`]);

    const restored = await openVenueDatabase(f.venueDir);
    try {
      const db = restored.venue;
      expect(await db.select().from(tenants)).toEqual(expectedTenants);
      expect(await db.select().from(locations)).toEqual(expectedLocations);
      // A fresh fiscal installation: the old one revoked, a new one at or above today's floor.
      const sifs = await db
        .select({
          numeroInstalacion: registroSif.numeroInstalacion,
          revocadoEn: registroSif.revocadoEn,
        })
        .from(registroSif)
        .where(eq(registroSif.nodeId, ids.node))
        .orderBy(registroSif.numeroInstalacion);
      expect(sifs).toHaveLength(2);
      expect(sifs[0]).toMatchObject({ numeroInstalacion: 1 });
      expect(sifs[0]?.revocadoEn).not.toBeNull();
      expect(sifs[1]?.revocadoEn).toBeNull();
      expect(sifs[1]!.numeroInstalacion).toBeGreaterThanOrEqual(
        installationFloor(new Date(Date.now() - 60_000)),
      );
      // The working-time chain continues from the backup's head.
      expect(await readChain(db, chainKey)).toEqual(expectedChain);
      expect(await db.select().from(workforceChains)).toEqual(expectedHead);
      const appended = await db.transaction((tx) =>
        appendToChain(tx, chainKey, {
          personId,
          entryKind: "in",
          eventAt: "2026-10-02T09:00:00Z",
          eventOffsetMinutes: 0,
          recordedByPersonId: personId,
          origin: jobOrigin("dashboard"),
        }),
      );
      expect(appended.sequenceNo).toBe(3);
    } finally {
      await restored.close();
    }
  });

  it.each<[string, (f: Fixture) => Promise<ArchiveRecoveryPack | void>]>([
    ["a pack holding another recovery key", async () => ({ ...PACK, recoveryKey: "not-the-key" })],
    [
      "an archive with a byte changed in the bucket",
      async (f) => {
        const bytes = Buffer.from(artifactBytes);
        bytes[bytes.length - 20]! ^= 1;
        await writeFile(join(f.bucketDir, KEY), bytes);
      },
    ],
  ])("refuses %s and leaves the live venue unchanged", async (_label, arrange) => {
    let f = await fixture();
    const pack = await arrange(f);
    if (pack) {
      await rm(f.root, { recursive: true, force: true });
      f = await fixture(pack);
    }
    await liveVenue(f);
    const before = await venueFiles(f);
    const { code, out } = await run(f, ["--confirm-old-box-gone"]);
    expect({ code, last: out.at(-1) }).toEqual({ code: 1, last: WRONG_KEY_LINE });
    expect(await venueFiles(f)).toEqual(before);
    expect(await legalName(f.venueDir)).toBe("Live venue");
  });

  it.each(["../x", `${KEY}/../${KEY}`, dumpFileName(new Date("2026-10-01T03:00:00Z"))])(
    "refuses the archive name %j without asking the bucket",
    async (key) => {
      const f = await fixture();
      await liveVenue(f);
      const before = await venueFiles(f);
      const { code, out } = await run(f, [], {
        argv: ["restore", "--from-archive", f.packPath, "--archive-key", key],
      });
      expect(code).toBe(1);
      expect(out.at(-1)).toMatch(/^restore failed: restore\.archive_key_invalid — /);
      expect(f.storeCalls).toEqual([]);
      expect(await venueFiles(f)).toEqual(before);
    },
  );

  it.each([
    [
      "no pack in it",
      "nothing to see here\n",
      "restore failed: backup.archive_pack_invalid — the file holds no archive recovery pack; give the archive recovery pack file saved for this venue",
    ],
    [
      "a damaged pack",
      "WAITRON-ARCHIVE-PACK-1:e30\n",
      "restore failed: backup.archive_pack_invalid — the archive recovery pack in the file is incomplete or damaged, perhaps cut short when it was copied; use the whole pack file as it was saved",
    ],
  ])("refuses a pack file with %s, without printing it", async (_label, text, line) => {
    const f = await fixture();
    await writeFile(f.packPath, text);
    const { code, out } = await run(f);
    expect({ code, out }).toEqual({ code: 1, out: [line] });
    expect(f.storeCalls).toEqual([]);
  });

  it("names the pack path it cannot read", async () => {
    const f = await fixture();
    await rm(f.packPath);
    const { code, out } = await run(f);
    expect({ code, out }).toEqual({ code: 1, out: [`cannot read pack file: ${f.packPath}`] });
  });

  it("reports an invalid WAITRON_ENV by code and downloads nothing", async () => {
    const f = await fixture();
    const { code, out } = await run(f, [], {
      env: { WAITRON_STATE_DIR: f.stateDir, WAITRON_ENV: "staging" },
    });
    expect(code).toBe(1);
    expect(out).toEqual([expect.stringMatching(/^restore failed: /)]);
    expect(f.storeCalls).toEqual([]);
  });

  it("says the bucket holds no archive by that name", async () => {
    const f = await fixture();
    await rm(join(f.bucketDir, KEY));
    const { code, out } = await run(f);
    expect(code).toBe(1);
    expect(out.at(-1)).toMatch(/^restore failed: restore\.archive_missing — /);
  });

  it("says the download failed when the bucket does", async () => {
    const f = await fixture();
    f.get = async () => {
      throw new Error("connection reset");
    };
    const { code, out } = await run(f);
    expect(code).toBe(1);
    expect(out.at(-1)).toMatch(/^restore failed: restore\.archive_download_failed — /);
  });

  it("gives up on a download that outlasts its time limit", async () => {
    const f = await fixture();
    f.get = (_key, _out, call) =>
      new Promise((_resolve, reject) => {
        call.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const { code, out } = await run(f, [], { archiveTimeoutMs: 20 });
    expect(code).toBe(1);
    expect(out.at(-1)).toMatch(/^restore failed: restore\.archive_download_failed — /);
  });

  it("says the disk filled during the download and leaves the live venue unchanged", async () => {
    const f = await fixture();
    await liveVenue(f);
    const before = await venueFiles(f);
    f.get = async (_key, outPath) => {
      await writeFile(outPath, "partial");
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    };
    const { code, out } = await run(f);
    expect(code).toBe(1);
    expect(out.at(-1)).toMatch(/^restore failed: restore\.archive_disk_full — /);
    expect(await venueFiles(f)).toEqual(before);
    expect(await legalName(f.venueDir)).toBe("Live venue");
  });

  it.each<[string, Error, string]>([
    [
      "refuses its folder",
      new AppError("backup.destination_key_invalid", { field: "prefix" }),
      "restore failed: backup.destination_key_invalid",
    ],
    ["throws something unexpected", new Error(`boom ${SECRET_ACCESS_KEY}`), "restore failed"],
  ])("reports a bucket client that %s without its message", async (_label, error, line) => {
    const f = await fixture();
    const { code, out } = await run(f, [], {
      openArchiveFiles: () => {
        throw error;
      },
    });
    expect({ code, last: out.at(-1) }).toEqual({ code: 1, last: line });
  });

  it("removes the download when the restore throws something unexpected", async () => {
    const f = await fixture();
    let seen: string | undefined;
    const { code, out } = await run(f, [], {
      restore: async (deps) => {
        seen = deps.artifactPath;
        expect(await readFile(deps.artifactPath)).toEqual(artifactBytes);
        expect(deps.recoveryKey).toBe(RECOVERY_KEY);
        throw new Error(`boom at ${deps.artifactPath}`);
      },
    });
    expect({ code, last: out.at(-1) }).toEqual({ code: 1, last: "restore failed" });
    await expect(stat(seen!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("hands the restore the old-box check, settled at once with --confirm-old-box-gone", async () => {
    const f = await fixture();
    let check: RestoreFileDeps["checkSourceLive"];
    await run(f, ["--confirm-old-box-gone"], {
      restore: async (deps) => {
        check = deps.checkSourceLive;
      },
    });
    await expect(check!({} as never)).resolves.toBeUndefined();
  });
});

describe("waitron-restore restore --from-archive, the arguments it accepts", () => {
  const PACK_FILE = "<pack>";
  it.each([
    ["--from-archive without --archive-key", ["--from-archive", PACK_FILE]],
    ["--archive-key without --from-archive", ["--archive-key", KEY]],
    ["--from-archive with no value", ["--archive-key", KEY, "--from-archive"]],
    ["--archive-key followed by a flag", ["--from-archive", PACK_FILE, "--archive-key", "--x"]],
    ["a backup file as well", ["--from-archive", PACK_FILE, "--archive-key", KEY, "<file>"]],
    [
      "--from-bucket as well",
      ["--from-archive", PACK_FILE, "--archive-key", KEY, "--from-bucket", PACK_FILE],
    ],
    [
      "--confirm-venue",
      ["--from-archive", PACK_FILE, "--archive-key", KEY, "--confirm-venue", "89890001K"],
    ],
    [
      "--from-archive given twice",
      ["--from-archive", PACK_FILE, "--from-archive", PACK_FILE, "--archive-key", KEY],
    ],
    [
      "--archive-key given twice",
      ["--from-archive", PACK_FILE, "--archive-key", KEY, "--archive-key", KEY],
    ],
  ])("prints the one-line usage and runs nothing for %s", async (_label, args) => {
    const f = await fixture();
    const restore = vi.fn(async () => {});
    const restoreStream = vi.fn(async () => {});
    const out: string[] = [];
    const code = await runRestore({
      argv: ["restore", ...args.map((a) => (a === PACK_FILE ? f.packPath : a))],
      env: { WAITRON_STATE_DIR: f.stateDir },
      out: (line) => {
        out.push(line);
        printed.push(line);
      },
      restore,
      restoreStream,
      openArchiveFiles: openFiles(f),
    });
    expect(code).toBe(2);
    expect(out).toEqual([
      expect.stringMatching(/^usage: .*--from-archive <pack-file> --archive-key <name>/),
    ]);
    expect(restore).not.toHaveBeenCalled();
    expect(restoreStream).not.toHaveBeenCalled();
    expect(f.storeCalls).toEqual([]);
  });
});
