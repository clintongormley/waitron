import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { expect, it, vi } from "vitest";
// First: hour-recovery-host's vi.mock of the internet clock and hour-release reaches only modules loaded after it.
import { fixture, recovery } from "../test/first-setup-backup-recovery-fixture.js";
import { external, root, suite } from "../test/hour-recovery-host.js";
import { ALL_MODULES } from "@waitron/composition";
import { LOG_FILE_NAME, lockVenueDatabase, readVenueHolder } from "@waitron/db";
import {
  chooseStartAgainLeftovers,
  readStartAgainMarker,
  readStartAgainNote,
  START_AGAIN_CHOICES_DIR,
  START_AGAIN_NOTE_FILE,
  START_AGAIN_SET_ASIDE_DIR,
  surveyStartAgainLeftovers,
} from "@waitron/provisioning";
import {
  START_AGAIN_ADMIN_PASSWORD,
  startAgainAttempt,
} from "@waitron/provisioning/testing/start-again-attempt";
import { MINUTE_MS } from "@waitron/fiscal-verifactu/src/hour-identity.js";

import { PASSWORD, request } from "../test/first-fiscal.js";
import { BACKUP_KEY_PREFIX } from "./backup-keys.js";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { clearReplacedDatabases, restoreDatabase, restoreSecrets } from "./restore.js";
import { BACKUP_STAGING_DIR, START_FREE_SPACE_FLOOR, freeSpaceAtStart } from "./start-space.js";
import { createFakeTimersHourClock, selectPastWaits } from "./testing/hour-test-clock.js";

vi.mock("./first-setup-backup-source.js", { spy: true });

async function filesUnder(path: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(path);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    const child = join(path, name);
    if ((await lstat(child)).isDirectory()) out.push(...(await filesUnder(child)));
    else out.push(child);
  }
  return out;
}

it("recover from a backup after a Move", async () => {
  let unreadable = "";
  const moved = new Map<string, { bytes: Buffer; ino: number }>();
  const f = await fixture(true, {
    prepareBox: async (roots) => {
      const attempt = await startAgainAttempt(dirname(roots.stateDir));
      await writeFile(join(attempt.roots.venueDir, "venue.db"), "found venue database bytes");
      await writeFile(join(attempt.roots.venueDir, "node.db"), "found node database bytes");
      const survey = await surveyStartAgainLeftovers(attempt.roots);
      if (survey?.kind !== "choice") throw new Error(`expected choice, got ${survey?.kind}`);
      const chosen = await chooseStartAgainLeftovers({
        roots: attempt.roots,
        password: START_AGAIN_ADMIN_PASSWORD,
        choice: "move",
        listed: survey.digest,
        now: () => new Date(),
      });
      expect(chosen.choice).toBe("move");
      for (const root of new Set(Object.values(attempt.roots)))
        for (const path of await filesUnder(join(root, START_AGAIN_SET_ASIDE_DIR)))
          moved.set(path, { bytes: await readFile(path), ino: (await lstat(path)).ino });
      expect([...moved.values()].map(({ bytes }) => bytes.toString()).sort()).toEqual([
        "found node database bytes",
        "found venue database bytes",
      ]);
      unreadable = [...moved.keys()][0]!;
      await chmod(unreadable, 0o000);
    },
  });
  try {
    const service = recovery(f.options);
    const session = await service.open(f.request, { onBox: false });
    await service.prepare(session.sessionId, { action: "clock-challenge" }, { onBox: false });
    expect((await f.workspace.read()).at(-1)).toMatchObject({ phase: "prepared" });
  } finally {
    await chmod(unreadable, 0o600);
  }
  for (const [path, before] of moved) {
    expect(await readFile(path)).toEqual(before.bytes);
    expect((await lstat(path)).ino).toBe(before.ino);
  }
  const evidence = (
    await Promise.all([...new Set(Object.values(f.roots))].map((root) => filesUnder(root)))
  )
    .flat()
    .filter((path) => path.split("/").includes("evidence"));
  for (const path of evidence)
    for (const { bytes } of moved.values())
      expect((await readFile(path)).equals(bytes)).toBe(false);
});

const NOTE_FLOOR_MS = Date.parse("2026-10-16T11:00:00Z");

/** A box after a real Move of a found venue.db and node.db, with a note the Move may raise. */
async function movedBox(foundAt?: Date) {
  const attempt = await startAgainAttempt(root, {
    note: { floorMs: NOTE_FLOOR_MS, lastName: "EARLIER", module: "fiscal-verifactu" },
  });
  for (const name of ["venue.db", "node.db"]) {
    const path = join(attempt.roots.venueDir, name);
    await writeFile(path, `found ${name} bytes`);
    if (foundAt !== undefined) await utimes(path, foundAt, foundAt);
  }
  const survey = await surveyStartAgainLeftovers(attempt.roots);
  if (survey?.kind !== "choice") throw new Error(`expected choice, got ${survey?.kind}`);
  const chosen = await chooseStartAgainLeftovers({
    roots: attempt.roots,
    password: START_AGAIN_ADMIN_PASSWORD,
    choice: "move",
    listed: survey.digest,
    now: () => new Date(),
  });
  expect(chosen.choice).toBe("move");
  expect(await readStartAgainMarker(attempt.roots.venueDir)).toBeNull();
  const roots = attempt.roots;
  const before = await kept(roots);
  expect(
    [...before.entries()]
      .filter(([path, entry]) => path.includes(START_AGAIN_SET_ASIDE_DIR) && "bytes" in entry)
      .map(([, entry]) => ("bytes" in entry ? entry.bytes.toString() : ""))
      .sort(),
  ).toEqual(["found node.db bytes", "found venue.db bytes"]);
  expect([...before.keys()].some((path) => path.includes(START_AGAIN_CHOICES_DIR))).toBe(true);
  expect(before.has(join(roots.stateDir, START_AGAIN_NOTE_FILE))).toBe(true);
  return { roots, before };
}

type Kept = { ino: number; bytes: Buffer } | { ino: number; names: string[] };

/** Every file and folder of the set-aside folders and the choices folder, and the note. */
async function kept(roots: { venueDir: string; stateDir: string }) {
  const out = new Map<string, Kept>();
  const walk = async (path: string) => {
    let info;
    try {
      info = await lstat(path);
    } catch {
      return;
    }
    if (info.isDirectory()) {
      const names = (await readdir(path)).sort();
      out.set(path, { ino: info.ino, names });
      for (const name of names) await walk(join(path, name));
    } else out.set(path, { ino: info.ino, bytes: await readFile(path) });
  };
  for (const dir of new Set([roots.venueDir, roots.stateDir]))
    await walk(join(dir, START_AGAIN_SET_ASIDE_DIR));
  await walk(join(roots.stateDir, START_AGAIN_CHOICES_DIR));
  await walk(join(roots.stateDir, START_AGAIN_NOTE_FILE));
  return out;
}

async function claimed(roots: { venueDir: string; stateDir: string }) {
  const host = createFirstSetupModuleHost({ ...roots, modules: ALL_MODULES, environment: {} });
  await host.owner.claimFirstSetup(
    { environment: "production", request },
    randomBytes(32).toString("base64url"),
  );
  return host;
}

it("lifetime: after a Move the next start is ordinary, and the next first setup claims", async () => {
  const { roots, before } = await movedBox();
  expect((await resolveFirstSetupEntry(roots, {})).kind).toBe("normal");
  const host = await claimed(roots);
  expect((await host.store.read())?.frozen.request.admin.email).toBe(request.admin.email);
  expect(await kept(roots)).toEqual(before);
});

it("lifetime: clearing replaced databases and freeing space at start leave the moved files", async () => {
  const { roots, before } = await movedBox();
  const replaced = join(roots.venueDir, ".venue.db-replaced-empty");
  await mkdir(replaced);
  const logDir = join(roots.stateDir, "logs");
  await mkdir(logDir);
  const rotated = join(logDir, `${LOG_FILE_NAME}.3`);
  await writeFile(rotated, "old log");
  await mkdir(join(roots.stateDir, BACKUP_STAGING_DIR));
  const dump = join(
    roots.stateDir,
    BACKUP_STAGING_DIR,
    `${BACKUP_KEY_PREFIX}20261016T114000Z.dump`,
  );
  await writeFile(dump, "staged dump");
  await clearReplacedDatabases(roots.venueDir, () => {});
  await freeSpaceAtStart({
    ...roots,
    logDir,
    floor: START_FREE_SPACE_FLOOR,
    force: true,
    now: () => new Date(),
    lockVenue: lockVenueDatabase,
    readVenueHolder,
    log: () => {},
  });
  for (const swept of [replaced, rotated, dump])
    await expect(lstat(swept), swept).rejects.toMatchObject({ code: "ENOENT" });
  expect(await kept(roots)).toEqual(before);
});

it("lifetime: that setup's own Start again leaves the moved files", async () => {
  const { roots, before } = await movedBox();
  const host = await claimed(roots);
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const recovered = await host.owner.recoverFirstSetupOwner({
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    password: PASSWORD,
  });
  const current = await host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: current.inspectionId,
    revision: current.revision!,
    ownerGeneration: current.ownerGeneration!,
  };
  const owner = {
    attemptId: recovered.state.attemptId,
    revision: recovered.state.revision,
    ownerGeneration: recovered.state.ownerGeneration,
    capability: recovered.capability,
  };
  const actions = createFirstSetupResolutionActions({ ...roots, host });
  const shown = await actions.startAgainSummary({ ...ids, owner });
  await actions.startAgainFirstSetup({
    ...ids,
    owner,
    confirmMissingDatabase: { nothingFiledOrSold: true, shown },
  });
  await expect(lstat(join(roots.stateDir, "first-setup.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
  expect(await kept(roots)).toEqual(before);
});

it("lifetime: a restore placement leaves the moved files, and a backup naming one is refused", async () => {
  const { roots, before } = await movedBox();
  const staged = join(root, "staged");
  await mkdir(staged);
  await writeFile(join(staged, "venue.db"), "restored venue database");
  await restoreDatabase({
    databasePath: join(staged, "venue.db"),
    venueDir: roots.venueDir,
    stateDir: roots.stateDir,
    log: () => {},
  });
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("restored venue database");
  const moved = [...before.entries()].find(
    ([path, entry]) => path.endsWith("venue.db") && "bytes" in entry,
  )![0];
  await expect(
    restoreSecrets({
      entries: [
        {
          name: `secrets/${relative(roots.stateDir, moved)}`,
          bytes: Buffer.from("from the backup"),
        },
      ],
      stateDir: roots.stateDir,
      log: () => {},
    }),
  ).rejects.toMatchObject({ code: "recovery.bundle_invalid" });
  expect(await kept(roots)).toEqual(before);
});

type Host = ReturnType<typeof createFirstSetupModuleHost>;

async function compareAndSelect(host: Host, owner: Parameters<Host["preparation"]["select"]>[0]) {
  const compared = (await host.preparation.prepare(
    owner,
    "fiscal-verifactu",
    { action: "compare-clocks", browser: null },
    { onBox: true },
  )) as { id: string };
  return host.preparation.select(
    owner,
    "fiscal-verifactu",
    { comparisonId: compared.id },
    await host.owner.reconfirm(owner, PASSWORD, "block-use"),
  );
}

it("lifetime: the next setup's name is later than the note a Move raised", async () => {
  const foundAt = new Date("2026-10-16T13:00:00Z");
  const { roots, before } = await movedBox(foundAt);
  const floorMs = (await readStartAgainNote(roots.stateDir))!.floorMs;
  expect(floorMs).toBeGreaterThan(foundAt.getTime());
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
  const host = createFirstSetupModuleHost({
    ...roots,
    modules: ALL_MODULES.filter((module) =>
      ["core", "fiscal-verifactu", "fiscal-none"].includes(module.name),
    ),
    environment: {},
    database: () => suite.db,
  });
  const claim = await host.owner.claimFirstSetup(
    { environment: "preproduction", request },
    randomBytes(32).toString("base64url"),
  );
  const owner = { ...claim.state, capability: claim.capability };
  await expect(compareAndSelect(host, owner)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "minute_not_later", allowedFromMs: floorMs },
  });
  vi.setSystemTime(floorMs + 5 * MINUTE_MS);
  await selectPastWaits(createFakeTimersHourClock(), () => compareAndSelect(host, owner), 1);
  expect(await kept(roots)).toEqual(before);
});
