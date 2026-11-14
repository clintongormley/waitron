import { dirname, join } from "node:path";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { BACKUP_ROOM_NOTE_FILE, BACKUP_ROOM_START_DELETED_FILE } from "@waitron/store";
import { stagedPath } from "./fs-atomic.js";
import { removeAndSync } from "./folder-sync.js";
import {
  START_AGAIN_MARKER_FILE,
  assertStartAgainAllowedOnDisk,
  collectStartAgainFindings,
  deleteMarkedAttempt,
  finishStartAgainDeletion,
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "./first-setup-start-again-deletion.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const RECORDS = "first-setup-resolutions";
const recordId = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
const attempt = { attemptId: "7c1f0b55-3f1e-4a52-9d2b-5a0d1c2e3f40", frozenDigest: "e".repeat(64) };

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!isAppError(error)) throw new Error(`expected a refusal, got ${String(error)}`);
  const params = error.params as Record<string, unknown>;
  return Object.keys(params).length === 0
    ? { code: error.code, reason: error.reason }
    : { code: error.code, params, reason: error.reason };
}

async function box() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "start-again-deletion-")));
  directories.push(root);
  const roots = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  for (const path of Object.values(roots)) await mkdir(path);
  await mkdir(join(roots.stateDir, "flows/setup"), { recursive: true });
  await mkdir(dirname(join(roots.stateDir, "flows/setup/record.json")), { recursive: true });
  await writeFile(join(roots.stateDir, "flows/setup/record.json"), "attempt record");
  await writeFile(join(roots.venueDir, "venue.db"), "attempt database bytes");
  (await lockVenueDatabase(roots.venueDir)).release();
  return roots;
}

it("refuses an unknown folder inside flows/setup", async () => {
  const roots = await box();
  await mkdir(join(roots.stateDir, "flows/setup/unexpected"));
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    params: { cause: "unexpected" },
    reason: "layout unexpected: flows/setup/unexpected",
  });
});

it("refuses a crash record that fingerprints the guesses side file", async () => {
  const roots = await box();
  const marker = await startAgainMarkerFor(roots, attempt);
  marker.files.push({
    root: "state",
    name: "flows/setup/start-again-guesses.json",
    size: 0,
    sha256: "c".repeat(64),
  });
  expect(await refusal(writeStartAgainMarker(roots, marker))).toEqual({
    code: "setup.start_again_incomplete",
    reason: "marker damaged",
  });
});

async function flowBox() {
  const roots = await box();
  for (const folder of ["documents", "import"])
    await mkdir(join(roots.stateDir, "flows/setup", folder), { recursive: true });
  for (const name of [
    "documents/probe.json",
    "import/artifact",
    "import/key",
    "import/marker.json",
    "readiness.json",
    "key.json",
    "public.json",
  ]) {
    await mkdir(dirname(join(roots.stateDir, "flows/setup", name)), { recursive: true });
    await writeFile(join(roots.stateDir, "flows/setup", name), name);
  }
  return roots;
}

it("Start again removes flows/setup with its import, readiness and guesses", async () => {
  const roots = await flowBox();
  const marker = await startAgainMarkerFor(roots, attempt);
  await writeStartAgainMarker(roots, marker);
  await mkdir(dirname(join(roots.stateDir, "flows/setup/start-again-guesses.json")), {
    recursive: true,
  });
  await writeFile(join(roots.stateDir, "flows/setup/start-again-guesses.json"), "guesses");
  expect(marker.files.map((file) => file.name)).toContain("flows/setup/import/key");
  expect(marker.files.map((file) => file.name)).toContain("flows/setup/readiness.json");
  expect((await collectStartAgainFindings(roots))?.findings).toEqual([]);
  await finishStartAgainDeletion(roots);
  expect(await exists(join(roots.stateDir, "flows/setup"))).toBe(false);
  expect(await readdir(join(roots.stateDir, "flows"))).toEqual([]);
  expect(await exists(join(roots.venueDir, START_AGAIN_MARKER_FILE))).toBe(false);
});

it.each(["documents/probe.json", "key.json"])(
  "a deletion cut before %s finishes at the next start and clears its crash record",
  async (cutAt) => {
    const roots = await flowBox();
    const marker = await startAgainMarkerFor(roots, attempt);
    await writeStartAgainMarker(roots, marker);
    const cut = join(roots.stateDir, "flows/setup", cutAt);
    await expect(
      deleteMarkedAttempt(roots, marker, async (path, kind) => {
        if (path === cut) throw Object.assign(new Error("cut"), { code: "EIO" });
        await removeAndSync(path, kind);
      }),
    ).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
    expect(await exists(join(roots.venueDir, "venue.db"))).toBe(false);
    expect(await readFile(cut, "utf8")).toBe(cutAt);
    await finishStartAgainDeletion(roots);
    expect(await readdir(join(roots.stateDir, "flows"))).toEqual([]);
    expect(await exists(join(roots.venueDir, START_AGAIN_MARKER_FILE))).toBe(false);
  },
);

it("an unlisted file in flows/setup is reported and kept", async () => {
  const roots = await flowBox();
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt));
  const stray = join(roots.stateDir, "flows/setup/stray.json");
  await mkdir(dirname(stray), { recursive: true });
  await writeFile(stray, "unlisted");
  expect(await refusal(finishStartAgainDeletion(roots))).toEqual({
    code: "setup.start_again_incomplete",
    reason: "unlisted file: state/flows/setup/stray.json",
  });
  expect(await readFile(stray, "utf8")).toBe("unlisted");
  expect(await readFile(join(roots.stateDir, "flows/setup/record.json"), "utf8")).toBe(
    "attempt record",
  );
});

it("a file that appears after the checks is never deleted", async () => {
  const roots = await flowBox();
  const marker = await startAgainMarkerFor(roots, attempt);
  const late = join(roots.stateDir, "flows/setup/late.json");
  await expect(
    deleteMarkedAttempt(roots, marker, async (path, kind) => {
      if (path === join(roots.stateDir, "flows/setup") && kind === "folder") {
        await mkdir(dirname(late), { recursive: true });
        await writeFile(late, "arrived after the checks");
      }
      await removeAndSync(path, kind);
    }),
  ).rejects.toMatchObject({ code: "setup.start_again_incomplete" });
  expect(await readFile(late, "utf8")).toBe("arrived after the checks");
});

it("reports a records folder that is a file as an unexpected layout when building the marker", async () => {
  const roots = await box();
  await writeFile(join(roots.stateDir, RECORDS), "not a folder");
  expect(await refusal(startAgainMarkerFor(roots, attempt))).toEqual({
    code: "setup.start_again_incomplete",
    reason: `layout unexpected: ${join(roots.stateDir, RECORDS)}`,
  });
});

it("reports a first-setup record folder it cannot read as a failed check, naming the error and the path", async () => {
  const roots = await box();
  const record = join(roots.stateDir, RECORDS, recordId);
  await mkdir(record, { recursive: true });
  await chmod(record, 0o000);
  try {
    expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
      code: "setup.not_ready",
      params: { cause: "unreadable" },
      reason: `check failed: EACCES ${record}`,
    });
  } finally {
    await chmod(record, 0o700);
  }
});

const marked = (marker: Awaited<ReturnType<typeof startAgainMarkerFor>>) =>
  marker.files.map((file) => `${file.root}/${file.name}`).sort();

it.each([
  ["a node.db-wal holding pages", "node.db-wal holds pages", "unexpected"],
  ["a node.db that is not a database", "node.db unreadable", "unreadable"],
] as const)("the disk check refuses %s and names its cause", async (name, reason, cause) => {
  const roots = await box();
  await writeFile(join(roots.venueDir, "node.db"), "not a database");
  if (name.includes("-wal")) await writeFile(join(roots.venueDir, "node.db-wal"), "pages");
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    params: { cause },
    reason,
  });
});

it("the disk check refuses an unexpected folder in the venue's documents as an unexpected layout", async () => {
  const roots = await box();
  await mkdir(join(roots.stateDir, "flows/setup/documents", "inner"), { recursive: true });
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    params: { cause: "unexpected" },
    reason: "layout unexpected: flows/setup/documents/inner",
  });
});

it("a marker not naming trading.env still finds it a refused artifact, and the finisher deletes nothing", async () => {
  const roots = await box();
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt));
  await writeFile(join(roots.stateDir, "trading.env"), '{"modules":{}}\n');
  expect((await collectStartAgainFindings(roots))?.findings).toEqual([
    { kind: "refused-artifact", root: "state", name: "trading.env" },
  ]);
  expect(await refusal(finishStartAgainDeletion(roots))).toEqual({
    code: "setup.start_again_incomplete",
    reason: "refused artifact present: state/trading.env",
  });
  expect(await exists(join(roots.stateDir, "trading.env"))).toBe(true);
  expect(await exists(join(roots.stateDir, "flows/setup/record.json"))).toBe(true);
});

it("a trading.env changed after the marker named it is a changed finding, and the finisher deletes nothing", async () => {
  const roots = await tradingBox(["trading.env"]);
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt, { held: true }));
  await writeFile(join(roots.stateDir, "trading.env"), '{"modules":{"other":{}}}\n');
  expect((await collectStartAgainFindings(roots))?.findings).toEqual([
    { kind: "changed", root: "state", name: "trading.env" },
  ]);
  expect(await refusal(finishStartAgainDeletion(roots))).toEqual({
    code: "setup.start_again_incomplete",
    reason: "size or hash differs: state/trading.env",
  });
  expect(await exists(join(roots.stateDir, "trading.env"))).toBe(true);
  expect(await exists(join(roots.stateDir, "flows/setup/record.json"))).toBe(true);
});

const TRADING = "state/trading.env";
async function tradingBox(names: readonly string[]) {
  const roots = await box();
  if (names.includes("trading.env")) await writeFile(join(roots.stateDir, "trading.env"), "X=1\n");
  return roots;
}

it("with held, the disk check accepts the setup's trading.env; without it, refuses", async () => {
  const roots = await tradingBox(["trading.env"]);
  await assertStartAgainAllowedOnDisk(roots, { held: true });
  expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
    code: "setup.not_ready",
    params: { cause: "unexpected" },
    reason: "refused artifact: state/trading.env",
  });
});

it("the marker names and fingerprints trading.env only with held", async () => {
  const roots = await tradingBox(["trading.env"]);
  const marker = await startAgainMarkerFor(roots, attempt, { held: true });
  expect(marker.files.find((file) => file.name === "trading.env")).toMatchObject({
    size: 4,
    sha256: createHash("sha256").update("X=1\n").digest("hex"),
  });
  expect(marked(await startAgainMarkerFor(roots, attempt))).not.toContain(TRADING);
});

it.each([[["trading.env"]]] as const)(
  "a marker naming %o is read as held, finished, and deletes them",
  async (names) => {
    const roots = await tradingBox(names);
    await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt, { held: true }));
    expect(await collectStartAgainFindings(roots)).toMatchObject({ findings: [], blocker: null });
    await finishStartAgainDeletion(roots);
    for (const name of [...names, "flows/setup/record.json"])
      expect(await exists(join(roots.stateDir, name))).toBe(false);
    expect(await exists(join(roots.venueDir, START_AGAIN_MARKER_FILE))).toBe(false);
  },
);

it("deleting the marked attempt deletes the backup room note first", async () => {
  const roots = await box();
  const marker = await startAgainMarkerFor(roots, attempt);
  await writeFile(join(roots.stateDir, BACKUP_ROOM_NOTE_FILE), "{}");
  await deleteMarkedAttempt(roots, marker);
  expect(await exists(join(roots.stateDir, BACKUP_ROOM_NOTE_FILE))).toBe(false);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(false);
});

it("the backup room's files written after the marker are no finding, and Start again finishes", async () => {
  const roots = await box();
  await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt));
  const temporary = stagedPath(BACKUP_ROOM_NOTE_FILE);
  const recordTemporary = `${BACKUP_ROOM_START_DELETED_FILE}.tmp`;
  for (const name of [
    BACKUP_ROOM_NOTE_FILE,
    temporary,
    BACKUP_ROOM_START_DELETED_FILE,
    recordTemporary,
  ])
    await writeFile(join(roots.stateDir, name), '{"version":1}');
  expect((await collectStartAgainFindings(roots))?.findings).toEqual([]);
  await finishStartAgainDeletion(roots);
  expect(await exists(join(roots.venueDir, START_AGAIN_MARKER_FILE))).toBe(false);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(false);
  expect((await readdir(roots.stateDir)).sort()).toEqual(
    [BACKUP_ROOM_START_DELETED_FILE, temporary, recordTemporary, "flows"].sort(),
  );
});

it("a backup room note that cannot be deleted stops the deletion before the venue folder changes", async () => {
  const roots = await box();
  const marker = await startAgainMarkerFor(roots, attempt);
  await mkdir(join(roots.stateDir, BACKUP_ROOM_NOTE_FILE));
  const before = (await readdir(roots.venueDir)).sort();
  const refused = await refusal(deleteMarkedAttempt(roots, marker));
  expect(refused.code).toBe("setup.start_again_incomplete");
  expect(refused.reason).toMatch(/^deletion failed: E(PERM|ISDIR) .*backup-room-note\.json$/);
  expect((await readdir(roots.venueDir)).sort()).toEqual(before);
  expect(await exists(join(roots.venueDir, "venue.db"))).toBe(true);
});

it.each(["staged", "placing"] as const)(
  "refuses Start again while a restore is %s, including a resumed deletion",
  async (phase) => {
    const roots = await box();
    await writeStartAgainMarker(roots, await startAgainMarkerFor(roots, attempt));
    await mkdir(join(roots.stateDir, "flows/restore"), { recursive: true });
    await writeFile(
      join(roots.stateDir, "flows/restore/record.json"),
      JSON.stringify({ version: 1, phase }),
    );
    expect(await refusal(assertStartAgainAllowedOnDisk(roots))).toEqual({
      code: "setup.not_ready",
      params: { cause: "unexpected" },
      reason: "refused artifact: state/flows/restore/record.json",
    });
    expect((await collectStartAgainFindings(roots))?.findings).toEqual([
      { kind: "refused-artifact", root: "state", name: "flows/restore/record.json" },
    ]);
    expect(await refusal(finishStartAgainDeletion(roots))).toEqual({
      code: "setup.start_again_incomplete",
      reason: "refused artifact present: state/flows/restore/record.json",
    });
    expect(await exists(join(roots.venueDir, "venue.db"))).toBe(true);
    expect(await exists(join(roots.stateDir, "flows/setup/record.json"))).toBe(true);
  },
);

it("Start again empties prepared and keeps every module's retained history", async () => {
  const roots = await box();
  const { writeDurableHostJson } = await import("./durable-host-json.js");
  const path = (module: string) => join(roots.stateDir, `module-records/${module}.json`);
  for (const module of ["fiscal-verifactu", "payments"])
    await writeDurableHostJson(
      path(module),
      {
        version: 1,
        prepared: [{ selected: "AAAAA" }],
        retained: { archive: { names: [module] } },
      },
      1024 * 1024,
    );
  const marker = await startAgainMarkerFor(roots, attempt);
  await deleteMarkedAttempt(roots, marker);
  for (const module of ["fiscal-verifactu", "payments"])
    expect(JSON.parse(await readFile(path(module), "utf8"))).toEqual({
      version: 1,
      prepared: [],
      retained: { archive: { names: [module] } },
    });
});
