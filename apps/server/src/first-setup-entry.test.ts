import { CORE_MIGRATIONS, tenants, openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import * as fs from "node:fs/promises";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  START_AGAIN_MARKER_FILE,
  chooseStartAgainLeftovers,
  readStartAgainChoices,
  setAsideFolderPaths,
  startAgainMarkerFor,
  surveyStartAgainLeftovers,
  writeStartAgainMarker,
} from "@waitron/provisioning";
import {
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
} from "@waitron/provisioning/testing/start-again-attempt";
import { startServer } from "./boot.js";
import { writeValidated, validateDatabaseEntries } from "./restore.js";
import { runStagedRestore } from "./restore-request.js";
import { runStagedReset } from "./reset-request.js";
import { freePorts } from "./testing/free-ports.js";
import { holdVenueElsewhere } from "./testing/venue-held-elsewhere.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { resolveFirstSetupBackupEntry } from "./first-setup-backup-entry.js";
import { resumeStartAgainSetAside } from "@waitron/provisioning";

vi.mock("@waitron/provisioning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/provisioning")>();
  return { ...actual, resumeStartAgainSetAside: vi.fn(actual.resumeStartAgainSetAside) };
});
vi.mock("./first-setup-backup-entry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./first-setup-backup-entry.js")>();
  return { ...actual, resolveFirstSetupBackupEntry: vi.fn(actual.resolveFirstSetupBackupEntry) };
});
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const dirs: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "first-entry-"));
  dirs.push(root);
  const venueDir = join(root, "venue");
  const stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  await writeFile(
    join(venueDir, "first-setup-claim.json"),
    JSON.stringify({
      version: 1,
      attemptId: "11111111-1111-4111-8111-111111111111",
      venueDir,
      stateDir,
      status: "claiming",
    }),
  );
  return { root, venueDir, stateDir };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it.each(["same", "different", "omitted"])(
  "the real boot refuses an unresolved fixed marker with %s state root",
  async (root) => {
    const f = await fixture();
    const [port] = await freePorts(1);
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      await expect(
        (async () => {
          server = await startServer({
            WAITRON_VENUE_DIR: f.venueDir,
            WAITRON_STATE_DIR:
              root === "omitted" ? undefined : root === "same" ? f.stateDir : join(f.root, "wrong"),
            WAITRON_HTTP_HOST: "127.0.0.1",
            WAITRON_HTTP_PORT: String(port),
          });
        })(),
      ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    } finally {
      await server?.close();
    }
  },
);
it("checks before archive/bucket placement changes either database or host state", async () => {
  const f = await fixture();
  const path = join(f.venueDir, "venue.db");
  await writeFile(path, "OLD");
  const source = join(f.root, "source");
  await writeFile(source, "NEW");
  await expect(
    writeValidated(
      {
        databasePath: source,
        manifest: {
          manifestVersion: 1,
          createdAt: "2026-10-15T00:00:00.000Z",
          environment: "preproduction",
          modules: {},
        },
        secretEntries: [],
        discard: async () => {},
      },
      {
        venueDir: f.venueDir,
        stateDir: f.stateDir,
        stagingDir: join(f.root, "staging"),
        migrationsRoot: null,
        environment: "preproduction",
        modules: [],
        log: () => {},
      },
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  expect(await readFile(path, "utf8")).toBe("OLD");
  expect(await readFile(source, "utf8")).toBe("NEW");
  await expect(readFile(join(f.stateDir, "rebuild-first-start.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it.each(["restore", "reset"])(
  "staged %s cannot remove credentials or place files across an unresolved claim",
  async (kind) => {
    const f = await fixture();
    await writeFile(join(f.stateDir, `${kind}-request.json`), "{}");
    await writeFile(join(f.stateDir, "restore-request.node-key"), "RECOVERY-SENTINEL");
    let placements = 0;
    const deps = {
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      migrationsRoot: null,
      log: () => {},
    };
    await expect(
      kind === "restore"
        ? runStagedRestore(deps, async () => {
            placements++;
          })
        : runStagedReset(deps),
    ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    expect(placements).toBe(0);
    expect(await readFile(join(f.stateDir, "restore-request.node-key"), "utf8")).toBe(
      "RECOVERY-SENTINEL",
    );
  },
);
it.each(["first-setup.json", "first-setup-claim.json", "module-operation-public.json"])(
  "does not accept %s from an authenticated restore source",
  async (name) => {
    const f = await fixture();
    const entries = [
      {
        name: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({
            manifestVersion: 1,
            createdAt: "2026-10-15T00:00:00.000Z",
            environment: "preproduction",
            modules: {},
          }),
        ),
      },
      { name: `secrets/${name}`, bytes: Buffer.from("{}") },
    ];
    await expect(
      validateDatabaseEntries(entries, join(f.root, "source.db"), {
        stateDir: f.stateDir,
        stagingDir: join(f.root, "staging"),
        migrationsRoot: null,
        environment: "preproduction",
        modules: [],
      }),
    ).rejects.toMatchObject({ code: "restore.unexpected_entry" });
  },
);

it("does not import host claim or enrolment files through the generic recovery bundle writer", async () => {
  const f = await fixture();
  const { unpackBundleToDir } = await import("./state-secrets.js");
  for (const name of [
    "first-setup.json",
    "first-setup-claim.json",
    "module-operation-public.json",
  ]) {
    await expect(
      unpackBundleToDir({ "trading.env": "SHOULD-NOT-WRITE", [name]: "{}" }, f.stateDir),
    ).rejects.toMatchObject({ code: "recovery.bundle_invalid", params: { reason: "unsafe_path" } });
    await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
});
it("the restore command refuses a fixed claim before invoking archive recovery", async () => {
  const f = await fixture();
  const { runRestore } = await import("./restore-command.js");
  const source = join(f.root, "archive");
  await writeFile(source, "unopened-archive");
  let calls = 0;
  const out: string[] = [];
  expect(
    await runRestore({
      argv: ["restore", source],
      env: {
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_BACKUP_RECOVERY_KEY: "SYNTHETIC-SECRET",
      },
      out: (line) => out.push(line),
      restore: async () => {
        calls++;
      },
    }),
  ).toBe(1);
  expect(calls).toBe(0);
  expect(out.join("\n")).toContain("setup.attempt_invalid");
  expect(out.join("\n")).not.toContain("SYNTHETIC-SECRET");
});

async function abandonedConsumedClaim(kind = "consumed-abandoned") {
  const { randomUUID, createHash } = await import("node:crypto");
  const { createFirstSetupStore, createFirstSetupCoordinator } =
    await import("@waitron/provisioning");
  const { hashPassword, hashPin } = await import("@waitron/identity");
  const f = await fixture();
  await rm(join(f.venueDir, "first-setup-claim.json"));
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...f, coordinator });
  const attemptId = randomUUID();
  const verifier = hashPassword("synthetic-password");
  const state = await store.claim(
    {
      attemptId,
      nodeId: randomUUID(),
      administratorId: randomUUID(),
      sourceId: `first-setup:${attemptId}`,
      environment: "preproduction",
      modules: [],
      request: {
        country: "ES",
        taxId: "B12345678",
        legalName: "Olivo",
        location: {
          name: "Olivo",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Restaurante",
          addressLine1: "Mayor 1",
          addressLine2: null,
          postalCode: "28001",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          email: "elena@example.test",
          displayName: "Elena",
          passwordHash: verifier,
          pinHash: hashPin("4826"),
        },
      },
    },
    verifier,
    createHash("sha256").update("capability").digest("hex"),
    createHash("sha256").update("nonce").digest("hex"),
  );
  if (kind === "pre-consumption-abandoned")
    await store.update(attemptId, state.revision, { kind: "abandoned" });
  else {
    let current = await store.update(attemptId, state.revision, { kind: "consumption-intent" });
    if (kind === "complete") {
      for (const change of [
        { kind: "activation-started" },
        { kind: "committed", result: {} },
        { kind: "publication" },
        { kind: "complete" },
      ] as const)
        current = await store.update(attemptId, current.revision, change);
    } else await store.update(attemptId, 2, { kind: "abandoned" });
  }
  return { ...f, store, attemptId };
}
it("does not treat a consumed abandoned marker as permission to trade", async () => {
  const f = await abandonedConsumedClaim();
  const [port] = await freePorts(1);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await expect(
      (async () => {
        server = await startServer({
          WAITRON_VENUE_DIR: f.venueDir,
          WAITRON_STATE_DIR: f.stateDir,
          WAITRON_HTTP_HOST: "127.0.0.1",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_TILL_NODE_ID: "11111111-1111-4111-8111-111111111111",
          WAITRON_TILL_LOCATION_ID: "22222222-2222-4222-8222-222222222222",
        });
      })(),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  } finally {
    await server?.close();
  }
});

it.each(["pre-consumption-abandoned", "complete"])(
  "can place an authenticated archive after a %s claim without importing claim authority",
  async (kind) => {
    const f = await abandonedConsumedClaim(kind);
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "Restored Olivo" });
    const source = join(f.root, "archive-source.db");
    await suite.db.archiveTo(source);
    const artifact = encryptArtifact(
      packArchive([
        {
          name: "manifest.json",
          bytes: Buffer.from(
            JSON.stringify({
              manifestVersion: 1,
              createdAt: "2026-10-15T00:00:00.000Z",
              environment: "preproduction",
              modules: {},
            }),
          ),
        },
        { name: "db.dump", bytes: await readFile(source) },
      ]),
      "synthetic-archive-key",
    );
    const { restoreFromArtifact } = await import("./restore.js");
    await restoreFromArtifact({
      artifact,
      recoveryKey: "synthetic-archive-key",
      venueDir: f.venueDir,
      stateDir: f.stateDir,
      stagingDir: join(f.root, "staging"),
      migrationsRoot: null,
      modules: [],
      environment: "preproduction",
      skipSecrets: true,
      log: () => {},
    });
    const opened = await openVenueDatabase(f.venueDir);
    try {
      expect(await opened.venue.select({ name: tenants.legalName }).from(tenants)).toEqual([
        { name: "Restored Olivo" },
      ]);
    } finally {
      await opened.close();
    }
    expect((await f.store.read())?.frozen.attemptId).toBe(f.attemptId);
    expect((await f.store.read())?.status).toBe(kind === "complete" ? "complete" : "abandoned");
  },
);

it.each([
  "first-setup-node-key.json",
  "first-fiscal-documents/manifest.json",
  "first-fiscal-documents/0-0.json",
  "first-setup-resolutions/id/000001.json",
  "first-setup-workspaces/id/state/first-setup.json",
  "first-setup-selection.json",
  "first-setup-retirement.json",
  "first-setup-workspace.json",
  "first-setup-start-again.json",
  "first-setup-deleting.json",
  "first-setup-start-again-confirmations/x.json",
])("cannot import retirement or current setup authority through %s", async (name) => {
  const f = await fixture();
  const { unpackBundleToDir } = await import("./state-secrets.js");
  await expect(
    unpackBundleToDir({ "trading.env": "SHOULD-NOT-WRITE", [name]: "{}" }, f.stateDir),
  ).rejects.toMatchObject({ code: "recovery.bundle_invalid", params: { reason: "unsafe_path" } });
  await expect(readFile(join(f.stateDir, "trading.env"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    validateDatabaseEntries(
      [
        {
          name: "manifest.json",
          bytes: Buffer.from(
            JSON.stringify({
              manifestVersion: 1,
              createdAt: "2026-10-15T00:00:00.000Z",
              environment: "preproduction",
              modules: {},
            }),
          ),
        },
        { name: `secrets/${name}`, bytes: Buffer.from("{}") },
      ],
      join(f.root, "source.db"),
      {
        stateDir: f.stateDir,
        stagingDir: join(f.root, "staging"),
        migrationsRoot: null,
        environment: "preproduction",
        modules: [],
      },
    ),
  ).rejects.toMatchObject({ code: "restore.unexpected_entry" });
});

async function markedDeletion() {
  const root = await mkdtemp(join(tmpdir(), "first-entry-marked-"));
  dirs.push(root);
  const venueDir = join(root, "venue");
  const stateDir = join(root, "state");
  await mkdir(venueDir);
  await mkdir(stateDir);
  await writeFile(join(stateDir, "first-setup.json"), '{"synthetic":"attempt"}');
  await writeFile(join(venueDir, "first-setup-claim.json"), '{"synthetic":"claim"}');
  const roots = { venueDir, stateDir };
  await writeStartAgainMarker(
    roots,
    await startAgainMarkerFor(roots, {
      attemptId: "33333333-3333-4333-8333-333333333333",
      frozenDigest: "a".repeat(64),
    }),
  );
  return { root, ...roots };
}
const gone = (path: string) => expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });

it("a box holding a pre-A1042 archive is refused setup.workspace_unsupported before A731's entry runs", async () => {
  const f = await fixture();
  await writeFile(join(f.venueDir, "first-setup-retirement.json"), '{"version":1}');
  vi.mocked(resolveFirstSetupBackupEntry).mockClear();
  const entry = await resolveFirstSetupEntry(f, {});
  expect(entry).toMatchObject({ kind: "refused", code: "setup.workspace_unsupported" });
  expect(resolveFirstSetupBackupEntry).not.toHaveBeenCalled();
});

it("an interrupted Start again is finished and setup is served", async () => {
  const f = await markedDeletion();
  const entry = await resolveFirstSetupEntry(f, {});
  expect(entry.kind).toBe("normal");
  await gone(join(f.stateDir, "first-setup.json"));
  await gone(join(f.venueDir, "first-setup-claim.json"));
  await gone(join(f.venueDir, START_AGAIN_MARKER_FILE));
});

it("an unfinishable deletion is refused setup.start_again_incomplete and nothing is deleted", async () => {
  const f = await markedDeletion();
  await writeFile(join(f.stateDir, "first-setup.json"), '{"changed":"after the marker"}');
  vi.mocked(resolveFirstSetupBackupEntry).mockClear();
  const entry = await resolveFirstSetupEntry(f, {});
  expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_incomplete" });
  if (entry.kind !== "refused") throw new Error("expected a refused start");
  expect(entry.error).toMatchObject({
    code: "setup.start_again_incomplete",
    reason: "size or hash differs: state/first-setup.json",
  });
  expect(resolveFirstSetupBackupEntry).not.toHaveBeenCalled();
  expect(await readFile(join(f.stateDir, "first-setup.json"), "utf8")).toBe(
    '{"changed":"after the marker"}',
  );
  expect(await readFile(join(f.venueDir, "first-setup-claim.json"), "utf8")).toBe(
    '{"synthetic":"claim"}',
  );
  expect(await stat(join(f.venueDir, START_AGAIN_MARKER_FILE))).toBeTruthy();
});

it("folders reached through a symbolic link still finish an interrupted Start again", async () => {
  const f = await markedDeletion();
  const link = `${f.root}-link`;
  await symlink(f.root, link);
  dirs.push(link);
  const links = { venueDir: join(link, "venue"), stateDir: join(link, "state") };
  const entry = await resolveFirstSetupEntry(links, {});
  expect(entry.kind).toBe("normal");
  await gone(join(f.stateDir, "first-setup.json"));
  await gone(join(f.venueDir, "first-setup-claim.json"));
  await gone(join(f.venueDir, START_AGAIN_MARKER_FILE));
});

const listing = async (dir: string) =>
  (await readdir(dir, { recursive: true })).filter((name) => name !== "venue.lock").sort();

it("a finishable Start again while another connection holds the venue lock keeps today's answer", async () => {
  const f = await markedDeletion();
  const holder = await holdVenueElsewhere(f.venueDir);
  try {
    const before = { state: await listing(f.stateDir), venue: await listing(f.venueDir) };
    const entry = await resolveFirstSetupEntry(f, {});
    if (entry.kind === "resolution") await entry.dispose();
    expect(entry.kind).toBe("resolution");
    expect({ state: await listing(f.stateDir), venue: await listing(f.venueDir) }).toEqual(before);
  } finally {
    await holder.stop();
  }
});

it("folders that cannot be put in canonical form fall through to today's path", async () => {
  const f = await markedDeletion();
  const linked = join(f.root, "venue-link");
  await symlink(f.venueDir, linked);
  const entry = await resolveFirstSetupEntry({ venueDir: linked, stateDir: f.stateDir }, {});
  expect(entry.kind).toBe("normal");
  expect(await stat(join(f.venueDir, START_AGAIN_MARKER_FILE))).toBeTruthy();
  expect(await readFile(join(f.stateDir, "first-setup.json"), "utf8")).toBe(
    '{"synthetic":"attempt"}',
  );
});

/** A Start again a cut left, with a venue.db placed after the marker: a survey of kind `choice`. */
async function foundAfterMarker() {
  const base = await mkdtemp(join(tmpdir(), "first-entry-found-"));
  dirs.push(base);
  const attempt = await startAgainAttempt(base);
  await writeFile(join(attempt.roots.venueDir, "venue.db"), "found database");
  const survey = await surveyStartAgainLeftovers(attempt.roots);
  if (survey?.kind !== "choice") throw new Error(`expected choice, got ${JSON.stringify(survey)}`);
  return { ...attempt, ...attempt.roots, survey };
}

/** A Move recorded for the found files, cut before its first rename: every unit still in place. */
async function moveRecordedNothingMoved() {
  const f = await foundAfterMarker();
  await expect(
    chooseStartAgainLeftovers({
      roots: f.roots,
      password: START_AGAIN_ADMIN_PASSWORD,
      choice: "move",
      listed: f.survey.digest,
      now: () => new Date(),
      io: {
        lstat: fs.lstat,
        mkdir: fs.mkdir,
        rmdir: fs.rmdir,
        rename: async (from, to) => {
          if (!from.includes(".first-setup-set-aside-probe-")) throw new Error("cut");
          await fs.rename(from, to);
        },
      },
    }),
  ).rejects.toThrow();
  const [record] = await readStartAgainChoices(f.stateDir, f);
  if (record?.choice !== "move" || record.setAside === null) throw new Error("expected a move");
  return { ...f, folders: setAsideFolderPaths(f.roots, record.setAside), record };
}

const fileTree = async (dir: string) =>
  Object.fromEntries(
    await Promise.all(
      (await readdir(dir, { recursive: true }))
        .filter(
          (name) =>
            !/^(venue\.(lock|holder\.json|lock-journal)|migrations\.lock|recovery\.lock)$/.test(
              name,
            ),
        )
        .sort()
        .map(async (name) => {
          const path = join(dir, name);
          const info = await fs.lstat(path);
          return [
            name,
            info.isFile() ? `${info.ino}:${await readFile(path, "utf8")}` : String(info.ino),
          ];
        }),
    ),
  );
const boxTree = async (f: { venueDir: string; stateDir: string }) => ({
  state: await fileTree(f.stateDir),
  venue: await fileTree(f.venueDir),
});

it("a venue.db placed after the marker is refused setup.start_again_files_found, with its survey and nothing changed", async () => {
  const f = await foundAfterMarker();
  const before = await boxTree(f);
  vi.mocked(resolveFirstSetupBackupEntry).mockClear();
  const entry = await resolveFirstSetupEntry(f.roots, {});
  expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_files_found" });
  if (entry.kind !== "refused") throw new Error("expected a refused start");
  expect(entry.error).toMatchObject({ code: "setup.start_again_files_found" });
  expect(entry.error.reason).toMatch(/venue\.db/);
  expect(entry.survey).toEqual(f.survey);
  expect(resolveFirstSetupBackupEntry).not.toHaveBeenCalled();
  expect(await boxTree(f)).toEqual(before);
});

it("a keep record for the marker is refused setup.start_again_kept even after the found files are removed, and the marked files stay", async () => {
  const f = await foundAfterMarker();
  await chooseStartAgainLeftovers({
    roots: f.roots,
    password: START_AGAIN_ADMIN_PASSWORD,
    choice: "keep",
    listed: f.survey.digest,
    now: () => new Date(),
  });
  await rm(join(f.venueDir, "venue.db"));
  const before = await boxTree(f);
  const entry = await resolveFirstSetupEntry(f.roots, {});
  expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_kept" });
  if (entry.kind !== "refused") throw new Error("expected a refused start");
  expect(entry.survey).toBeUndefined();
  expect(await boxTree(f)).toEqual(before);
  expect(await stat(join(f.stateDir, "first-setup.json"))).toBeTruthy();
  expect(await stat(join(f.venueDir, START_AGAIN_MARKER_FILE))).toBeTruthy();
});

it("a move record with every unit still in place is resumed and setup is served", async () => {
  const f = await moveRecordedNothingMoved();
  const entry = await resolveFirstSetupEntry(f.roots, {});
  expect(entry.kind).toBe("normal");
  await gone(join(f.venueDir, START_AGAIN_MARKER_FILE));
  await gone(join(f.stateDir, "first-setup.json"));
  await gone(join(f.venueDir, "venue.db"));
  expect(await readFile(join(f.folders.venue, "venue.db"), "utf8")).toBe("found database");
});

it("a move record whose resume rename fails is refused setup.start_again_incomplete with no survey", async () => {
  const f = await moveRecordedNothingMoved();
  await chmod(f.folders.venue, 0o500);
  try {
    const entry = await resolveFirstSetupEntry(f.roots, {});
    expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_incomplete" });
    if (entry.kind !== "refused") throw new Error("expected a refused start");
    expect(entry.error.reason).toMatch(/^set-aside failed: EACCES venue\/venue\.db$/);
    expect(entry.survey).toBeUndefined();
    expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("found database");
    expect(await stat(join(f.venueDir, START_AGAIN_MARKER_FILE))).toBeTruthy();
    expect(await stat(join(f.stateDir, "first-setup.json"))).toBeTruthy();
  } finally {
    await chmod(f.folders.venue, 0o700);
  }
});

it("a move whose resume fails with an error that is not a refusal is refused setup.start_again_incomplete, and nothing reads the half-moved folder", async () => {
  const f = await moveRecordedNothingMoved();
  const stem = dirname(f.folders.state);
  const before = await boxTree(f);
  vi.mocked(resolveFirstSetupBackupEntry).mockClear();
  await chmod(stem, 0o000);
  let entry: Awaited<ReturnType<typeof resolveFirstSetupEntry>>;
  try {
    entry = await resolveFirstSetupEntry(f.roots, {});
  } finally {
    await chmod(stem, 0o700);
  }
  if (entry.kind === "resolution") await entry.dispose();
  expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_incomplete" });
  if (entry.kind !== "refused") throw new Error("expected a refused start");
  expect(entry.error.reason).toBe(
    `set-aside failed: EACCES state/${relative(await fs.realpath(f.stateDir), await fs.realpath(stem))}`,
  );
  expect(entry.survey).toBeUndefined();
  expect(resolveFirstSetupBackupEntry).not.toHaveBeenCalled();
  expect(await boxTree(f)).toEqual(before);
});

it.each([
  ["an error with no code", () => new Error("no code"), "set-aside failed: unknown"],
  [
    "a path in the venue folder",
    (venue: string) =>
      Object.assign(new Error("io"), { code: "EIO", path: join(venue, "venue.db") }),
    "set-aside failed: EIO venue/venue.db",
  ],
  [
    "a path outside both folders",
    () => Object.assign(new Error("io"), { code: "EIO", path: "/elsewhere/file" }),
    "set-aside failed: EIO /elsewhere/file",
  ],
])(
  "a resume that fails with %s names it in the reason",
  async (_name, error: (venue: string) => Error, reason) => {
    const f = await moveRecordedNothingMoved();
    const venue = await fs.realpath(f.venueDir);
    vi.mocked(resumeStartAgainSetAside).mockRejectedValueOnce(error(venue));
    const entry = await resolveFirstSetupEntry(f.roots, {});
    expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_incomplete" });
    if (entry.kind !== "refused") throw new Error("expected a refused start");
    expect(entry.error.reason).toBe(reason);
  },
);

it("a move to resume while another connection holds the venue lock is refused setup.start_again_incomplete, and nothing moves", async () => {
  const f = await moveRecordedNothingMoved();
  const before = await boxTree(f);
  const holder = await holdVenueElsewhere(f.venueDir);
  let entry: Awaited<ReturnType<typeof resolveFirstSetupEntry>>;
  try {
    entry = await resolveFirstSetupEntry(f.roots, {});
  } finally {
    await holder.stop();
  }
  if (entry.kind === "resolution") await entry.dispose();
  expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_incomplete" });
  if (entry.kind !== "refused") throw new Error("expected a refused start");
  expect(entry.error.reason).toBe("set-aside failed: provisioning.database_in_use");
  expect(await boxTree(f)).toEqual(before);
});

it("the same venue.db beside the existing synthetic record is still refused setup.start_again_incomplete", async () => {
  const f = await markedDeletion();
  await writeFile(join(f.venueDir, "venue.db"), "found database");
  const entry = await resolveFirstSetupEntry(f, {});
  expect(entry).toMatchObject({ kind: "refused", code: "setup.start_again_incomplete" });
  if (entry.kind !== "refused") throw new Error("expected a refused start");
  expect(entry.survey).toBeUndefined();
  expect(await readFile(join(f.venueDir, "venue.db"), "utf8")).toBe("found database");
  expect(await stat(join(f.venueDir, START_AGAIN_MARKER_FILE))).toBeTruthy();
});
