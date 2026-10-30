import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import {
  START_AGAIN_MARKER_FILE,
  START_AGAIN_MARKER_LIMIT,
  assertNoStartAgainDeletion,
  assertStartAgainAllowedOnDisk,
  clearStartAgainMarker,
  deleteMarkedAttempt,
  finishStartAgainDeletion,
  markerSize,
  readStartAgainMarker,
  startAgainMarkerFor,
  writeStartAgainMarker,
} from "./first-setup-start-again-deletion.js";
import { hashPassword, hashPin } from "@waitron/identity";
import {
  assertVenueFirstSetupAllowed,
  createFirstSetupCoordinator,
  createFirstSetupStore,
  type FirstSetupFrozen,
} from "./first-setup-state.js";
import { createFirstSetupResolutionStore } from "./first-setup-resolution.js";

const dirs: string[] = [];
async function stateDir() {
  const dir = await mkdtemp(join(tmpdir(), "start-again-marker-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const incomplete = { code: "setup.start_again_incomplete", params: {} };
const RECORD = randomUUID();
const ATTEMPT = { attemptId: randomUUID(), frozenDigest: "a".repeat(64) };
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const VENUE_FILES: Record<string, string> = {
  "venue.db": "main database",
  "node.db": "node database",
  "venue.db-shm": "shared memory",
  "first-setup-claim.json": "{}",
};
const STATE_FILES: Record<string, string> = {
  "module-preparation-state.json": "{}",
  "first-fiscal-documents/a.json": "document",
  [`first-fiscal-documents/.first-setup-${randomUUID()}.tmp`]: "half-written",
  "first-setup-node-key.json": "key",
  "module-operation-public.json": "public",
  [`first-setup-resolutions/${RECORD}/000001.json`]: "record",
  [`first-setup-resolutions/${RECORD}/manifest.json`]: "manifest",
  [`first-setup-resolutions/${RECORD}/.first-setup-${randomUUID()}.tmp`]: "half-written",
  [`first-setup-resolutions/${RECORD}/step-000003/original-1.json`]: "chunk",
  [`first-setup-resolutions/${RECORD}/step-000003/manifest.json`]: "step manifest",
  "first-setup.json": "state",
};
const KEPT_STATE: Record<string, string> = {
  "first-setup-start-again-confirmations/1-x.json": "confirmation",
  "tls/cert.pem": "certificate",
};
const LOCK = /^venue\.(lock|holder)/;

async function attemptFolders(
  venue: Record<string, string> = VENUE_FILES,
  state: Record<string, string> = STATE_FILES,
) {
  const base = await stateDir();
  const roots = { venueDir: join(base, "venue"), stateDir: join(base, "state") };
  const put = async (dir: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), text);
    }
  };
  await mkdir(roots.venueDir, { recursive: true });
  await put(roots.venueDir, venue);
  await put(roots.stateDir, { ...state, ...KEPT_STATE });
  return roots;
}

async function tree(dir: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let names: string[];
  try {
    names = await fs.readdir(join(dir, prefix));
  } catch {
    return result;
  }
  for (const name of names.sort()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (prefix === "" && LOCK.test(name)) continue;
    const info = await fs.lstat(join(dir, relative));
    if (info.isDirectory()) {
      result[`${relative}/`] = "";
      Object.assign(result, await tree(dir, relative));
    } else result[relative] = sha(await readFile(join(dir, relative)));
  }
  return result;
}
const snapshot = async (roots: { venueDir: string; stateDir: string }) => ({
  venue: await tree(roots.venueDir),
  state: await tree(roots.stateDir),
});

async function expectOnlyKept(roots: { venueDir: string; stateDir: string }) {
  expect(Object.keys(await tree(roots.venueDir))).toEqual([]);
  expect(await tree(roots.stateDir)).toEqual({
    "first-setup-start-again-confirmations/": "",
    "first-setup-start-again-confirmations/1-x.json": sha("confirmation"),
    "tls/": "",
    "tls/cert.pem": sha("certificate"),
  });
}

async function marked(roots: { venueDir: string; stateDir: string }) {
  const marker = await startAgainMarkerFor(roots, ATTEMPT);
  await writeStartAgainMarker(roots, marker);
  return marker;
}

function cutAt(cut: number | null, calls: string[] = []) {
  return async (path: string, kind: "file" | "folder") => {
    calls.push(path);
    if (calls.length === cut) throw new Error("power cut");
    await (kind === "file" ? fs.unlink(path) : fs.rmdir(path));
  };
}

async function removalCount() {
  const roots = await attemptFolders();
  const calls: string[] = [];
  await deleteMarkedAttempt(roots, await marked(roots), cutAt(null, calls));
  return calls.length;
}

it("no marker does nothing", async () => {
  const roots = await attemptFolders();
  const before = await snapshot(roots);
  await finishStartAgainDeletion(roots);
  expect(await snapshot(roots)).toEqual(before);
  await expect(assertNoStartAgainDeletion(roots.venueDir)).resolves.toBeUndefined();
  expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
});

it("a marker names every listed file, records the side files' state, and reads back", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, "venue.db-wal"), "wal bytes");
  const marker = await marked(roots);
  expect(marker.venueDir).toBe(await fs.realpath(roots.venueDir));
  expect(marker.stateDir).toBe(await fs.realpath(roots.stateDir));
  expect(marker.files.map((entry) => `${entry.root}:${entry.name}`).sort()).toEqual(
    [
      ...["venue.db", "node.db", "first-setup-claim.json"].map((name) => `venue:${name}`),
      ...Object.keys(STATE_FILES).map((name) => `state:${name}`),
    ].sort(),
  );
  expect(marker.files.find((entry) => entry.name === "venue.db")).toEqual({
    root: "venue",
    name: "venue.db",
    size: "main database".length,
    sha256: sha("main database"),
  });
  expect(marker.wal).toEqual({
    "venue.db-wal": { size: "wal bytes".length, sha256: sha("wal bytes") },
    "node.db-wal": null,
  });
  expect(await readStartAgainMarker(roots.venueDir)).toEqual(marker);
  await expect(assertNoStartAgainDeletion(roots.venueDir)).rejects.toMatchObject(incomplete);
  await expect(writeStartAgainMarker(roots, marker)).rejects.toMatchObject(incomplete);
});

it.each([
  ["after the marker", 1],
  ["after the first deletion", 2],
  ["after the middle deletion", "middle"],
  ["after the last deletion", null],
] as const)("a marked deletion cut %s is finished", async (_name, cut) => {
  const count = await removalCount();
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const at = cut === "middle" ? Math.ceil(count / 2) : cut;
  const deletion = deleteMarkedAttempt(roots, marker, cutAt(at));
  if (at === null) await deletion;
  else await expect(deletion).rejects.toMatchObject(incomplete);
  expect(await readStartAgainMarker(roots.venueDir)).toEqual(marker);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
  expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
});

it("an attempt that never chose a name is finished from the marker alone", async () => {
  const roots = await attemptFolders(
    { "first-setup-claim.json": "{}" },
    { "first-setup.json": "state" },
  );
  const marker = await marked(roots);
  expect(marker.files.map((entry) => entry.name).sort()).toEqual([
    "first-setup-claim.json",
    "first-setup.json",
  ]);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a record folder with a step-000003/ subfolder is finished, subfolder first", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const calls: string[] = [];
  await deleteMarkedAttempt(roots, marker, cutAt(null, calls));
  const state = await fs.realpath(roots.stateDir);
  const venue = await fs.realpath(roots.venueDir);
  const record = join(state, "first-setup-resolutions", RECORD);
  const at = (path: string) => calls.indexOf(path);
  expect(at(join(venue, "venue.db"))).toBe(0);
  expect(at(join(venue, "node.db"))).toBe(1);
  expect(at(join(venue, "venue.db-shm"))).toBe(2);
  expect(at(join(record, "step-000003", "manifest.json"))).toBeLessThan(
    at(join(record, "step-000003")),
  );
  expect(at(join(record, "step-000003"))).toBeLessThan(at(join(record, "000001.json")));
  expect(at(join(record, "000001.json"))).toBeLessThan(at(record));
  expect(at(record)).toBeLessThan(at(join(state, "first-setup-resolutions")));
  expect(calls.slice(-2)).toEqual([
    join(venue, "first-setup-claim.json"),
    join(state, "first-setup.json"),
  ]);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a leftover .first-setup-<uuid>.tmp in a listed folder is removed with it", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  expect(marker.files.filter((entry) => entry.name.includes("/.first-setup-"))).toHaveLength(2);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a side file recreated by a read after its main file was deleted is removed", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, "venue.db-wal"), "recorded wal");
  const marker = await marked(roots);
  await expect(deleteMarkedAttempt(roots, marker, cutAt(4))).rejects.toMatchObject(incomplete);
  await expect(fs.lstat(join(roots.venueDir, "venue.db"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await writeFile(join(roots.venueDir, "venue.db-wal"), "");
  await writeFile(join(roots.venueDir, "venue.db-shm"), "rewritten by a read");
  await writeFile(join(roots.venueDir, "node.db-shm"), "new");
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

const JOURNALS = { "venue.db-journal": "venue journal", "node.db-journal": "node journal" };

it("Start again's deletion removes a venue.db-journal and a node.db-journal beside the databases", async () => {
  const roots = await attemptFolders({ ...VENUE_FILES, ...JOURNALS });
  const marker = await marked(roots);
  await deleteMarkedAttempt(roots, marker);
  for (const name of Object.keys(JOURNALS))
    await expect(fs.lstat(join(roots.venueDir, name)), name).rejects.toMatchObject({
      code: "ENOENT",
    });
});

it("finishing an interrupted deletion removes a leftover journal too", async () => {
  const roots = await attemptFolders({ ...VENUE_FILES, ...JOURNALS });
  const marker = await marked(roots);
  await expect(deleteMarkedAttempt(roots, marker, cutAt(1))).rejects.toMatchObject(incomplete);
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("a zero-length -wal is accepted", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  await writeFile(join(roots.venueDir, "venue.db-wal"), "");
  await writeFile(join(roots.venueDir, "node.db-wal"), "");
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("folders given through a symbolic link are canonicalised before they are compared with the marker", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  const elsewhere = await stateDir();
  await symlink(dirname(roots.venueDir), join(elsewhere, "link"));
  const linked = {
    venueDir: join(elsewhere, "link", "venue"),
    stateDir: join(elsewhere, "link", "state"),
  };
  await finishStartAgainDeletion(linked);
  await expectOnlyKept(roots);
});

async function walRow(roots: { venueDir: string }) {
  const path = join(roots.venueDir, "venue.db");
  await fs.unlink(path);
  const first = new DatabaseSync(path);
  first.exec("pragma journal_mode = wal; create table t(x); insert into t values (1);");
  first.close();
  return path;
}

it.each<[string, (roots: { venueDir: string; stateDir: string }) => Promise<void>]>([
  ["beside trading.env", (roots) => writeFile(join(roots.stateDir, "trading.env"), "X=1")],
  ["beside a streamed folder", (roots) => mkdir(join(roots.venueDir, ".venue.db-litestream"))],
  [
    "beside an A731 journal",
    (roots) => mkdir(join(roots.stateDir, "first-setup-resolutions", "backup-recovery")),
  ],
  [
    "beside a venue.db whose bytes differ from the marker",
    (roots) => writeFile(join(roots.venueDir, "venue.db"), "main databasf"),
  ],
  [
    "beside a -wal that is neither empty nor the recorded bytes",
    (roots) => writeFile(join(roots.venueDir, "venue.db-wal"), "x"),
  ],
  [
    "beside a file newly added inside first-fiscal-documents/",
    (roots) => writeFile(join(roots.stateDir, "first-fiscal-documents", "b.json"), "new"),
  ],
  [
    "with a marker naming other folders",
    async (roots) => {
      const marker = (await readStartAgainMarker(roots.venueDir))!;
      await writeFile(
        join(roots.venueDir, START_AGAIN_MARKER_FILE),
        JSON.stringify({ ...marker, stateDir: `${marker.stateDir}-other` }),
      );
    },
  ],
  [
    "beside a symbolic link in place of venue.db",
    async (roots) => {
      await fs.unlink(join(roots.venueDir, "venue.db"));
      await symlink(join(roots.stateDir, "first-setup.json"), join(roots.venueDir, "venue.db"));
    },
  ],
  [
    "beside a folder inside first-fiscal-documents/",
    (roots) => mkdir(join(roots.stateDir, "first-fiscal-documents", "inner")),
  ],
  [
    "beside a record subfolder not named step-NNNNNN",
    (roots) => mkdir(join(roots.stateDir, "first-setup-resolutions", RECORD, "other")),
  ],
  [
    "beside a symbolic link inside a record folder",
    (roots) =>
      symlink(
        join(roots.stateDir, "first-setup.json"),
        join(roots.stateDir, "first-setup-resolutions", RECORD, "link.json"),
      ),
  ],
  [
    "beside a file directly in first-setup-resolutions/",
    (roots) => writeFile(join(roots.stateDir, "first-setup-resolutions", "loose.json"), "x"),
  ],
  [
    "beside first-fiscal-documents as a file",
    async (roots) => {
      await rm(join(roots.stateDir, "first-fiscal-documents"), { recursive: true });
      await writeFile(join(roots.stateDir, "first-fiscal-documents"), "x");
    },
  ],
])("a pending deletion %s is refused, and nothing is deleted", async (_name, change) => {
  const roots = await attemptFolders();
  await marked(roots);
  await change(roots);
  const before = await snapshot(roots);
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
  expect(await snapshot(roots)).toEqual(before);
  expect(before.venue[START_AGAIN_MARKER_FILE]).toBeDefined();
});

it("a row written into venue.db-wal after the cut is refused, and nothing is deleted", async () => {
  const roots = await attemptFolders();
  const path = await walRow(roots);
  const main = await readFile(path);
  await marked(roots);
  const writer = new DatabaseSync(path);
  writer.exec("pragma wal_autocheckpoint = 0; insert into t values (2);");
  const wal = await readFile(`${path}-wal`);
  writer.close();
  await writeFile(path, main);
  await writeFile(`${path}-wal`, wal);
  expect(wal.length).toBeGreaterThan(0);
  const before = await snapshot(roots);
  expect(before.venue["venue.db"]).toBe(sha(main));
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
  expect(await snapshot(roots)).toEqual(before);
  const reader = new DatabaseSync(path, { readOnly: true });
  expect(reader.prepare("select count(*) as n from t").get()).toEqual({ n: 2 });
  reader.close();
});

it("a file newly added inside first-fiscal-documents/ stops the folder's rmdir and is kept", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const added = join(roots.stateDir, "first-fiscal-documents", "b.json");
  await writeFile(added, "new");
  await expect(deleteMarkedAttempt(roots, marker)).rejects.toMatchObject(incomplete);
  expect(await readFile(added, "utf8")).toBe("new");
  expect(await readStartAgainMarker(roots.venueDir)).toEqual(marker);
});

it("a marker over 1 MiB is refused setup.not_ready before anything is written", async () => {
  const roots = await attemptFolders();
  const marker = await startAgainMarkerFor(roots, ATTEMPT);
  const files = Array.from({ length: 6000 }, (_, index) => ({
    root: "state" as const,
    name: `first-fiscal-documents/${String(index).padStart(100, "0")}.json`,
    size: 1,
    sha256: "b".repeat(64),
  }));
  const large = { ...marker, files: [...marker.files, ...files] };
  expect(markerSize(large)).toBeGreaterThan(1024 * 1024);
  const before = await snapshot(roots);
  await expect(writeStartAgainMarker(roots, large)).rejects.toMatchObject({
    code: "setup.not_ready",
    params: {},
  });
  expect(await snapshot(roots)).toEqual(before);
});

it.each([
  ["state", "first-setup-start-again-confirmations/1-x.json"],
  ["state", "tls/cert.pem"],
  ["state", "../venue/venue.db"],
  ["venue", "venue.lock"],
] as const)(
  "a marker that names %s:%s is refused by the writer and by the finisher, and nothing is deleted",
  async (root, name) => {
    const roots = await attemptFolders();
    const marker = await startAgainMarkerFor(roots, ATTEMPT);
    const damaged = {
      ...marker,
      files: [...marker.files, { root, name, size: 1, sha256: "c".repeat(64) }],
    };
    const before = await snapshot(roots);
    await expect(writeStartAgainMarker(roots, damaged)).rejects.toMatchObject(incomplete);
    expect(await snapshot(roots)).toEqual(before);
    await writeFile(join(roots.venueDir, START_AGAIN_MARKER_FILE), JSON.stringify(damaged));
    const written = await snapshot(roots);
    await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
    await expect(deleteMarkedAttempt(roots, damaged)).rejects.toMatchObject(incomplete);
    expect(await snapshot(roots)).toEqual(written);
  },
);

it("a damaged marker file is refused, not read as absent", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, START_AGAIN_MARKER_FILE), "{");
  await expect(readStartAgainMarker(roots.venueDir)).rejects.toMatchObject(incomplete);
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject(incomplete);
  await expect(assertNoStartAgainDeletion(roots.venueDir)).rejects.toMatchObject(incomplete);
});

it("a pending deletion beside a folder it cannot read is refused, and nothing is deleted", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  const documents = join(roots.stateDir, "first-fiscal-documents");
  await fs.chmod(documents, 0o000);
  try {
    await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
      ...incomplete,
      reason: `check failed: EACCES ${join(await fs.realpath(roots.stateDir), "first-fiscal-documents")}`,
    });
  } finally {
    await fs.chmod(documents, 0o700);
  }
  expect(await readStartAgainMarker(roots.venueDir)).not.toBeNull();
  expect(await readFile(join(roots.venueDir, "venue.db"), "utf8")).toBe("main database");
});

it("the writer and the deleter refuse folders other than the marker's", async () => {
  const roots = await attemptFolders();
  const other = await attemptFolders();
  const marker = await startAgainMarkerFor(roots, ATTEMPT);
  const before = await snapshot(other);
  await expect(writeStartAgainMarker(other, marker)).rejects.toMatchObject(incomplete);
  await expect(deleteMarkedAttempt(other, marker)).rejects.toMatchObject(incomplete);
  expect(await snapshot(other)).toEqual(before);
});

it("a recorded node.db-wal is finished when its bytes are unchanged", async () => {
  const roots = await attemptFolders();
  await writeFile(join(roots.venueDir, "node.db-wal"), "node wal");
  const marker = await marked(roots);
  expect(marker.wal["node.db-wal"]).toEqual({ size: 8, sha256: sha("node wal") });
  await finishStartAgainDeletion(roots);
  await expectOnlyKept(roots);
});

it("an unreadable marker path is refused by the pending-deletion check", async () => {
  const base = await stateDir();
  await writeFile(join(base, "file"), "x");
  await expect(assertNoStartAgainDeletion(join(base, "file"))).rejects.toMatchObject(incomplete);
});

const markerJson = {
  version: 1,
  attemptId: ATTEMPT.attemptId,
  frozenDigest: ATTEMPT.frozenDigest,
  venueDir: "/v",
  stateDir: "/s",
  files: [{ root: "venue", name: "venue.db", size: 1, sha256: "d".repeat(64) }],
  wal: { "venue.db-wal": null, "node.db-wal": null },
};
const file0 = markerJson.files[0]!;
it.each<[string, unknown]>([
  ["an array", []],
  ["a missing key", { ...markerJson, wal: undefined }],
  ["an extra key", { ...markerJson, extra: 1 }],
  ["a wrong version", { ...markerJson, version: 2 }],
  ["an attempt id that is not a UUID", { ...markerJson, attemptId: "x" }],
  ["a digest that is not a hash", { ...markerJson, frozenDigest: "x" }],
  ["a relative venue folder", { ...markerJson, venueDir: "v" }],
  ["a relative state folder", { ...markerJson, stateDir: "s" }],
  ["files that are not a list", { ...markerJson, files: {} }],
  ["side files that are not an object", { ...markerJson, wal: [] }],
  ["side files with an extra name", { ...markerJson, wal: { ...markerJson.wal, x: null } }],
  ["a file entry that is not an object", { ...markerJson, files: [1] }],
  ["a file entry with an extra key", { ...markerJson, files: [{ ...file0, x: 1 }] }],
  ["a file entry with an unknown root", { ...markerJson, files: [{ ...file0, root: "tls" }] }],
  ["a file entry with a numeric name", { ...markerJson, files: [{ ...file0, name: 1 }] }],
  ["a file listed twice", { ...markerJson, files: [file0, file0] }],
  ["a negative size", { ...markerJson, files: [{ ...file0, size: -1 }] }],
  ["a fractional size", { ...markerJson, files: [{ ...file0, size: 1.5 }] }],
  ["a short hash", { ...markerJson, files: [{ ...file0, sha256: "d" }] }],
  ["a numeric hash", { ...markerJson, files: [{ ...file0, sha256: 1 }] }],
  [
    "a side file fingerprint with an extra key",
    {
      ...markerJson,
      wal: { ...markerJson.wal, "node.db-wal": { size: 1, sha256: "d".repeat(64), x: 1 } },
    },
  ],
  [
    "a side file fingerprint that is text",
    { ...markerJson, wal: { ...markerJson.wal, "venue.db-wal": "x" } },
  ],
  [
    "a record file outside a UUID folder",
    {
      ...markerJson,
      files: [{ ...file0, root: "state", name: "first-setup-resolutions/backup-recovery/x.json" }],
    },
  ],
  [
    "a record file two folders down",
    {
      ...markerJson,
      files: [
        { ...file0, root: "state", name: `first-setup-resolutions/${RECORD}/step-000003/x/y.json` },
      ],
    },
  ],
  [
    "a document in a subfolder",
    {
      ...markerJson,
      files: [{ ...file0, root: "state", name: "first-fiscal-documents/x/y.json" }],
    },
  ],
  [
    "an empty path segment",
    { ...markerJson, files: [{ ...file0, root: "state", name: "first-fiscal-documents//y.json" }] },
  ],
  ["a venue name not on the list", { ...markerJson, files: [{ ...file0, name: "venue.db-shm" }] }],
])("a marker with %s is refused as damaged", async (_name, value) => {
  const base = await stateDir();
  await writeFile(join(base, START_AGAIN_MARKER_FILE), JSON.stringify(value));
  await expect(readStartAgainMarker(base)).rejects.toMatchObject(incomplete);
});

it.each([
  ["placed", true],
  ["not placed", false],
])(
  "an attempt whose marker names no venue.db: a venue.db %s after the marker",
  async (_name, placed) => {
    const roots = await attemptFolders(
      { "first-setup-claim.json": "{}" },
      { "first-setup.json": "state" },
    );
    const marker = await marked(roots);
    expect(marker.files.some((entry) => entry.name === "venue.db")).toBe(false);
    if (!placed) {
      await finishStartAgainDeletion(roots);
      await expectOnlyKept(roots);
      return;
    }
    await writeFile(join(roots.venueDir, "venue.db"), "a restored database");
    const before = await snapshot(roots);
    await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
      ...incomplete,
      reason: "unlisted file: venue/venue.db",
    });
    expect(await snapshot(roots)).toEqual(before);
  },
);

it("a refusal names the check that failed, in its log-only reason", async () => {
  const roots = await attemptFolders();
  await marked(roots);
  await writeFile(join(roots.venueDir, "venue.db-wal"), "x");
  await expect(finishStartAgainDeletion(roots)).rejects.toMatchObject({
    ...incomplete,
    reason: "unexpected -wal: venue/venue.db-wal",
  });
  await fs.unlink(join(roots.venueDir, "venue.db-wal"));
  await writeFile(join(roots.venueDir, "venue.db"), "main databasf");
  const error: unknown = await finishStartAgainDeletion(roots).catch((caught: unknown) => caught);
  expect(error).toMatchObject({ ...incomplete, reason: "size or hash differs: venue/venue.db" });
  expect(JSON.stringify(error)).not.toContain("reason");
});

it("a deletion that throws names the error's code and path in its reason", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const venue = await fs.realpath(roots.venueDir);
  const refuse = async () => {
    throw Object.assign(new Error("refused"), { code: "EACCES" });
  };
  await expect(deleteMarkedAttempt(roots, marker, refuse)).rejects.toMatchObject({
    ...incomplete,
    reason: `deletion failed: EACCES ${join(venue, "venue.db")}`,
  });
});

it("a deletion that meets an unexpected layout names it, and deletes nothing", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const link = join(roots.stateDir, "first-fiscal-documents", "link.json");
  await symlink(join(roots.stateDir, "first-setup.json"), link);
  const before = await snapshot(roots);
  await expect(deleteMarkedAttempt(roots, marker)).rejects.toMatchObject({
    ...incomplete,
    reason: `layout unexpected: ${join(await fs.realpath(roots.stateDir), "first-fiscal-documents", "link.json")}`,
  });
  expect(await snapshot(roots)).toEqual(before);
});

it("a deletion whose walk cannot read a folder names that folder in its reason", async () => {
  const roots = await attemptFolders();
  const marker = await marked(roots);
  const documents = join(roots.stateDir, "first-fiscal-documents");
  await fs.chmod(documents, 0o000);
  try {
    await expect(deleteMarkedAttempt(roots, marker)).rejects.toMatchObject({
      ...incomplete,
      reason: `deletion failed: EACCES ${join(await fs.realpath(roots.stateDir), "first-fiscal-documents")}`,
    });
  } finally {
    await fs.chmod(documents, 0o700);
  }
});

async function startableFolders() {
  const roots = await attemptFolders({ ...VENUE_FILES, "node.db": "" });
  await rm(join(roots.venueDir, "node.db"));
  const node = new DatabaseSync(join(roots.venueDir, "node.db"));
  node.exec("pragma journal_mode = wal");
  node.close();
  return roots;
}
const notReady = { code: "setup.not_ready", params: {} };
const unsupported = { code: "setup.workspace_unsupported", params: {} };

it("an attempt with an empty node.db may start again, and the folders come back canonical", async () => {
  const roots = await startableFolders();
  const before = await snapshot(roots);
  expect(await assertStartAgainAllowedOnDisk(roots)).toEqual({
    venueDir: await fs.realpath(roots.venueDir),
    stateDir: await fs.realpath(roots.stateDir),
  });
  expect(await snapshot(roots)).toEqual(before);
});

it("an attempt with no node.db may start again, and none is created", async () => {
  const roots = await startableFolders();
  await rm(join(roots.venueDir, "node.db"));
  await assertStartAgainAllowedOnDisk(roots);
  await expect(stat(join(roots.venueDir, "node.db"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each<[string, object, (roots: { venueDir: string; stateDir: string }) => Promise<unknown>]>([
  ...[
    "trading.env",
    "setup-operation.json",
    "restore-request.json",
    "reset-request.json",
    "modules.json",
    "cloud-replacement.json",
  ].map(
    (
      name,
    ): [string, object, (roots: { venueDir: string; stateDir: string }) => Promise<unknown>] => [
      `beside state/${name}`,
      notReady,
      (roots) => writeFile(join(roots.stateDir, name), "x"),
    ],
  ),
  [
    "beside a streamed folder",
    notReady,
    (roots) => mkdir(join(roots.venueDir, ".venue.db-litestream")),
  ],
  [
    "beside an A731 journal in the state folder",
    notReady,
    (roots) => mkdir(join(roots.stateDir, "first-setup-resolutions", "backup-recovery")),
  ],
  [
    "beside an A731 journal in the venue folder",
    notReady,
    (roots) =>
      mkdir(join(roots.venueDir, "first-setup-resolutions", "backup-recovery"), {
        recursive: true,
      }),
  ],
  [
    "beside a record subfolder not named step-NNNNNN",
    notReady,
    (roots) => mkdir(join(roots.stateDir, "first-setup-resolutions", RECORD, "other")),
  ],
  [
    "beside a node.db holding a table",
    notReady,
    async (roots) => {
      const node = new DatabaseSync(join(roots.venueDir, "node.db"));
      node.exec("create table t(x)");
      node.close();
    },
  ],
  [
    "beside a node.db-wal holding pages",
    notReady,
    (roots) => writeFile(join(roots.venueDir, "node.db-wal"), "pages"),
  ],
  [
    "beside a node.db that is not a database",
    notReady,
    (roots) => writeFile(join(roots.venueDir, "node.db"), "not a database"),
  ],
  ...(["state", "venue"] as const).flatMap((root) =>
    [
      "first-setup-workspaces",
      "first-setup-selection.json",
      "first-setup-retirement.json",
      "first-setup-workspace.json",
    ].map(
      (
        name,
      ): [string, object, (roots: { venueDir: string; stateDir: string }) => Promise<unknown>] => [
        `beside ${root}/${name} from an earlier Waitron`,
        unsupported,
        (roots) => writeFile(join(root === "state" ? roots.stateDir : roots.venueDir, name), "x"),
      ],
    ),
  ),
  [
    "beside a pending deletion marker",
    incomplete,
    async (roots) => writeStartAgainMarker(roots, await startAgainMarkerFor(roots, ATTEMPT)),
  ],
])("Start again %s is refused, and nothing changes", async (_name, code, change) => {
  const roots = await startableFolders();
  await change(roots);
  const before = await snapshot(roots);
  await expect(assertStartAgainAllowedOnDisk(roots)).rejects.toMatchObject(code);
  expect(await snapshot(roots)).toEqual(before);
});

it("a venue folder inside an earlier Waitron's workspace is refused as unsupported", async () => {
  const base = await stateDir();
  const roots = {
    stateDir: join(base, "state"),
    venueDir: join(base, "state", "first-setup-workspaces", randomUUID(), "venue"),
  };
  await mkdir(roots.venueDir, { recursive: true });
  await expect(assertStartAgainAllowedOnDisk(roots)).rejects.toMatchObject(unsupported);
});

it("a state folder inside an earlier Waitron's workspace is refused as unsupported", async () => {
  const base = await stateDir();
  const roots = {
    stateDir: join(base, "anchor", "first-setup-workspaces", randomUUID(), "state"),
    venueDir: join(base, "venue"),
  };
  await mkdir(roots.venueDir, { recursive: true });
  await mkdir(roots.stateDir, { recursive: true });
  await expect(assertStartAgainAllowedOnDisk(roots)).rejects.toMatchObject(unsupported);
});

it("folders inside a backup recovery's target are refused", async () => {
  const base = await stateDir();
  const target = join(
    base,
    "state",
    "first-setup-resolutions",
    "backup-recovery",
    randomUUID(),
    "target",
  );
  const roots = { stateDir: join(target, "state"), venueDir: join(target, "venue") };
  await mkdir(roots.venueDir, { recursive: true });
  await mkdir(roots.stateDir, { recursive: true });
  await expect(assertStartAgainAllowedOnDisk(roots)).rejects.toMatchObject(notReady);
});

it("a folder whose entries cannot be checked is refused, not read as absent", async () => {
  const roots = await startableFolders();
  await fs.chmod(roots.venueDir, 0o600);
  try {
    await expect(assertStartAgainAllowedOnDisk(roots)).rejects.toMatchObject(notReady);
  } finally {
    await fs.chmod(roots.venueDir, 0o700);
  }
});

it("the marker is cleared, and clearing is refused when there is none", async () => {
  const roots = await startableFolders();
  await marked(roots);
  await clearStartAgainMarker(roots.venueDir);
  expect(await readStartAgainMarker(roots.venueDir)).toBeNull();
  await expect(clearStartAgainMarker(roots.venueDir)).rejects.toMatchObject(incomplete);
});

it("the marker limit the writer enforces is exported for a check before anything is written", () => {
  expect(START_AGAIN_MARKER_LIMIT).toBe(1024 * 1024);
});

it("node.db is read wherever the venue folder is, even under a name holding # and ?", async () => {
  const base = await stateDir();
  const roots = { venueDir: join(base, "v #1?x"), stateDir: join(base, "state") };
  await mkdir(roots.venueDir);
  await mkdir(roots.stateDir);
  const node = new DatabaseSync(join(roots.venueDir, "node.db"));
  node.exec("pragma journal_mode = wal; create table t(x)");
  node.close();
  await expect(assertStartAgainAllowedOnDisk(roots)).rejects.toMatchObject({
    ...notReady,
    reason: "node.db holds a table",
  });
});

const ownerVerifier = hashPassword("owner-password");
const digestOf = (value: string) => createHash("sha256").update(value).digest("hex");
function frozenAttempt(): FirstSetupFrozen {
  const attemptId = randomUUID();
  return {
    attemptId,
    nodeId: randomUUID(),
    administratorId: randomUUID(),
    sourceId: `first-setup:${attemptId}`,
    environment: "production",
    modules: [
      {
        module: "probe",
        version: "0.1.0",
        eventId: randomUUID(),
        request: { bases: ["S000001-W1-A"], purposes: ["simplified"] },
      },
    ],
    request: {
      country: "ES",
      taxId: "B12345678",
      legalName: "Olivo SL",
      taxpayerDomicile: "Calle Fiscal 1",
      location: {
        name: "Olivo",
        fiscalTerritory: "ES-common",
        invoiceLocales: ["es-ES"],
        operationDescription: "Restaurante",
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28001",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "06:00",
      },
      seriesCode: "A",
      fullSeriesCode: "F",
      rectificativeSeriesCode: "R",
      admin: {
        displayName: "Elena",
        email: "elena@example.test",
        pinHash: hashPin("4826"),
        passwordHash: ownerVerifier,
      },
    },
  };
}

async function pendingDeletion(abandon: boolean) {
  const base = await stateDir();
  const roots = { venueDir: join(base, "venue"), stateDir: join(base, "state") };
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...roots, coordinator });
  const records = createFirstSetupResolutionStore({ ...roots, coordinator });
  const claim = () =>
    store.claim(frozenAttempt(), ownerVerifier, digestOf("capability"), digestOf("nonce"));
  const claimed = await claim();
  const input = {
    resolutionId: randomUUID(),
    attemptId: claimed.frozen.attemptId,
    observedRevision: 1,
    observedOwnerGeneration: 1,
    database: "empty-preactivation" as const,
    authority: "original-password" as const,
    register: {
      kind: "current-master" as const,
      status: "Consumed" as const,
      custodian: "Elena",
      reference: "b".repeat(64),
      consultedAt: "2026-10-16T02:00:00.000Z",
    },
    action: "retire" as const,
    nextWorkspace: null,
  };
  const originals = [{ name: "venue.db", bytes: null }];
  const prepared = await records.prepare(input, originals);
  const current = abandon
    ? await store.update(claimed.frozen.attemptId, 1, { kind: "abandoned" })
    : claimed;
  await writeStartAgainMarker(
    roots,
    await startAgainMarkerFor(roots, {
      attemptId: claimed.frozen.attemptId,
      frozenDigest: claimed.frozenDigest,
    }),
  );
  return { roots, store, records, claim, current, input, originals, prepared };
}

it.each<[string, boolean, (f: Awaited<ReturnType<typeof pendingDeletion>>) => Promise<unknown>]>([
  ["a claim", true, (f) => f.claim()],
  [
    "an abandon",
    false,
    (f) => f.store.update(f.current.frozen.attemptId, 1, { kind: "abandoned" }),
  ],
  [
    "an ownership recovery",
    false,
    (f) =>
      f.store.update(f.current.frozen.attemptId, f.current.revision, {
        kind: "recover",
        capabilityHash: digestOf("recovered"),
        claimNonceHash: digestOf("recovered-nonce"),
      }),
  ],
  [
    "a record-store prepare",
    false,
    (f) => f.records.prepare({ ...f.input, resolutionId: randomUUID() }, f.originals),
  ],
  ["a record-store apply", false, (f) => f.records.apply(f.prepared)],
  [
    "the venue check restore, reset and provisioning call",
    true,
    (f) => assertVenueFirstSetupAllowed(f.roots.venueDir),
  ],
])(
  "while a deletion is pending, %s is refused and the marked files are unchanged",
  async (_name, abandon, act) => {
    const f = await pendingDeletion(abandon);
    const before = await snapshot(f.roots);
    await expect(act(f)).rejects.toMatchObject(incomplete);
    expect(await snapshot(f.roots)).toEqual(before);
  },
);

it("while a deletion is pending, a marker repair is refused and the marked files are unchanged", async () => {
  const base = await stateDir();
  const roots = { venueDir: join(base, "venue"), stateDir: join(base, "state") };
  const store = createFirstSetupStore({ ...roots, coordinator: createFirstSetupCoordinator() });
  const claimed = await store.claim(
    frozenAttempt(),
    ownerVerifier,
    digestOf("capability"),
    digestOf("nonce"),
  );
  const claimPath = join(roots.venueDir, "first-setup-claim.json");
  const claimMarker = JSON.parse(await readFile(claimPath, "utf8"));
  await writeFile(claimPath, JSON.stringify({ ...claimMarker, status: "claiming" }));
  const expected = (await store.readForRepair())!;
  expect(expected.repairMarker).toBe("active");
  await writeStartAgainMarker(
    roots,
    await startAgainMarkerFor(roots, {
      attemptId: claimed.frozen.attemptId,
      frozenDigest: claimed.frozenDigest,
    }),
  );
  const before = await snapshot(roots);
  await expect(store.repairMarker(expected, async () => {})).rejects.toMatchObject(incomplete);
  expect(await snapshot(roots)).toEqual(before);
});
