import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createFirstSetupCoordinator,
  createFirstSetupResolutionStore,
  type WorkspaceBinding,
} from "./index.js";
import {
  canonicalFirstSetupDirectory,
  firstSetupDirectory,
  validateWorkspaceBinding,
} from "./first-setup-resolution.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "resolution-integrity-")));
  roots.push(root);
  const anchor = { venueDir: join(root, "venue"), stateDir: join(root, "state") };
  const resolutionId = randomUUID();
  const input = {
    resolutionId,
    attemptId: randomUUID(),
    observedRevision: 1,
    observedOwnerGeneration: 1,
    database: "missing" as const,
    authority: "original-password" as const,
    action: "retire" as const,
    register: null,
    nextWorkspace: null,
  };
  const originals = [{ name: "state/first-setup.json", bytes: Buffer.from("retained original") }];
  const store = createFirstSetupResolutionStore({
    ...anchor,
    coordinator: createFirstSetupCoordinator(),
  });
  const folder = join(anchor.stateDir, "first-setup-resolutions", resolutionId);
  return { root, anchor, input, originals, store, folder };
}
async function damage(path: string, change: (value: Record<string, unknown>) => void) {
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  change(value);
  await writeFile(path, JSON.stringify(value));
  return readFile(path);
}

it.each([
  ["unsupported version", (value: Record<string, unknown>) => (value.version = 2)],
  ["empty originals", (value: Record<string, unknown>) => (value.originals = [])],
  ["unknown manifest field", (value: Record<string, unknown>) => (value.extra = true)],
])("refuses an archived manifest with %s without rewriting it", async (_name, change) => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  const path = join(f.folder, "manifest.json");
  const before = await damage(path, change);
  await expect(f.store.readOriginals(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(path)).toEqual(before);
});

it.each([
  ["missing name", { size: 0, digest: "a".repeat(64), chunks: [] }],
  ["empty name", { name: "", size: 0, digest: "a".repeat(64), chunks: [] }],
  ["missing original with a digest", { name: "a", size: null, digest: "a".repeat(64), chunks: [] }],
  ["missing original with chunks", { name: "a", size: null, digest: null, chunks: ["x"] }],
  ["negative size", { name: "a", size: -1, digest: "a".repeat(64), chunks: [] }],
  ["fractional size", { name: "a", size: 0.5, digest: "a".repeat(64), chunks: [] }],
  ["oversized original", { name: "a", size: 134217729, digest: "a".repeat(64), chunks: [] }],
  ["invalid digest", { name: "a", size: 0, digest: "invalid", chunks: [] }],
  ["missing chunk", { name: "a", size: 1, digest: "a".repeat(64), chunks: [] }],
  ["traversing chunk name", { name: "a", size: 1, digest: "a".repeat(64), chunks: ["../outside"] }],
])("refuses %s in archived original metadata", async (_name, entry) => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  const path = join(f.folder, "manifest.json");
  const before = await damage(path, (manifest) => (manifest.originals = [entry]));
  await expect(f.store.readOriginals(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(path)).toEqual(before);
});

it.each([
  ["extra field", { bytes: "", extra: true }],
  ["non-string bytes", { bytes: 4 }],
  ["oversized encoding", { bytes: "A".repeat(42672) }],
  ["noncanonical base64", { bytes: "cmV0YWluZWQgb3JpZ2luYWw" }],
  [
    "changed content of the same length",
    { bytes: Buffer.from("changed! original").toString("base64") },
  ],
])("refuses an original chunk with %s", async (_name, chunk) => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  const path = join(f.folder, "original-0-0.json");
  await writeFile(path, JSON.stringify(chunk));
  const before = await readFile(path);
  await expect(f.store.readOriginals(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(path)).toEqual(before);
});

it("refuses duplicate archived names even when each original's bytes and digest agree", async () => {
  const f = await fixture();
  await f.store.prepare(f.input, [...f.originals, { name: "second", bytes: null }]);
  await damage(join(f.folder, "manifest.json"), (manifest) => {
    const originals = manifest.originals as { name: string }[];
    originals[1]!.name = originals[0]!.name;
  });
  await expect(f.store.readOriginals(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it.each([0, 2, 128, 1.5, -1])("refuses original evidence from sequence %s", async (sequence) => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  await expect(f.store.readOriginals(f.input.resolutionId, sequence)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it.each([
  ["unknown field", (record: Record<string, unknown>) => (record.extra = true)],
  ["unsupported version", (record: Record<string, unknown>) => (record.version = 2)],
  ["invalid sequence", (record: Record<string, unknown>) => (record.sequence = 129)],
  ["wrong resolution", (record: Record<string, unknown>) => (record.resolutionId = randomUUID())],
  ["wrong sequence", (record: Record<string, unknown>) => (record.sequence = 2)],
  ["wrong phase", (record: Record<string, unknown>) => (record.phase = "applied")],
  [
    "wrong evidence digest",
    (record: Record<string, unknown>) => (record.evidenceDigest = "c".repeat(64)),
  ],
  [
    "wrong evidence references",
    (record: Record<string, unknown>) => (record.evidenceReferences = ["other"]),
  ],
  [
    "noncanonical timestamp",
    (record: Record<string, unknown>) => (record.recordedAt = "2026-10-19"),
  ],
])("refuses a retained prepared record with %s", async (_name, change) => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  const path = join(f.folder, "000001.json");
  const before = await damage(path, change);
  await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(path)).toEqual(before);
});

it("refuses an applied event that changes the prepared register answer", async () => {
  const f = await fixture();
  await f.store.apply(await f.store.prepare(f.input, f.originals));
  await damage(join(f.folder, "000002.json"), (record) => {
    record.register = { kind: "no-current-master", confirmed: true };
  });
  await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("does not accept an orphan manifest as an empty repair history", async () => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  await rm(join(f.folder, "000001.json"));
  await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("refuses a noncanonical record filename instead of renumbering the history", async () => {
  const f = await fixture();
  await f.store.prepare(f.input, f.originals);
  await writeFile(join(f.folder, "1.json"), await readFile(join(f.folder, "000001.json")));
  await rm(join(f.folder, "000001.json"));
  await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("refuses a repair directory containing 129 invalid event files", async () => {
  const f = await fixture();
  await mkdir(f.folder, { recursive: true });
  for (let sequence = 1; sequence <= 129; sequence++) {
    await writeFile(join(f.folder, `${String(sequence).padStart(6, "0")}.json`), "{}");
  }
  await expect(f.store.read(f.input.resolutionId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});

it("does not replace archived chunks left by a different interrupted preparation", async () => {
  const f = await fixture();
  await mkdir(f.folder, { recursive: true });
  const path = join(f.folder, "original-0-0.json");
  await writeFile(
    path,
    JSON.stringify({ bytes: Buffer.from("other original").toString("base64") }),
  );
  const before = await readFile(path);
  await expect(f.store.prepare(f.input, f.originals)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(await readFile(path)).toEqual(before);
  await expect(readFile(join(f.folder, "000001.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([
  { label: "empty list", originals: [] },
  {
    label: "duplicate names",
    originals: [
      { name: "same", bytes: null },
      { name: "same", bytes: null },
    ],
  },
  { label: "nonbinary bytes", originals: [{ name: "x", bytes: "private" }] },
])("refuses $label before publishing a record", async ({ originals }) => {
  const f = await fixture();
  await expect(f.store.prepare(f.input, originals as never)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  await expect(readFile(join(f.folder, "000001.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("binds a new workspace to the resolution and both canonical anchor directories", async () => {
  const f = await fixture();
  const workspaceId = randomUUID();
  const base = join(f.anchor.stateDir, "first-setup-workspaces", workspaceId);
  const binding: WorkspaceBinding = {
    workspaceId,
    resolutionId: f.input.resolutionId,
    selectionGeneration: 1,
    anchorVenueDir: f.anchor.venueDir,
    anchorStateDir: f.anchor.stateDir,
    venueDir: join(base, "venue"),
    stateDir: join(base, "state"),
  };
  expect(() => validateWorkspaceBinding(binding)).not.toThrow();
  for (const changed of [
    { ...binding, venueDir: join(f.root, "unrelated") },
    { ...binding, selectionGeneration: 0 },
    { ...binding, resolutionId: randomUUID() },
    { ...binding, anchorVenueDir: join(f.root, "other-venue") },
  ]) {
    await expect(
      f.store.prepare({ ...f.input, nextWorkspace: changed }, f.originals),
    ).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  }
  const prepared = await f.store.prepare({ ...f.input, nextWorkspace: binding }, f.originals);
  expect(prepared.nextWorkspace).toEqual(binding);
});

it("keeps a missing nested path canonical and refuses file or symlink directory components", async () => {
  const f = await fixture();
  const absent = join(f.root, "missing", "nested");
  expect(await canonicalFirstSetupDirectory(absent)).toBe(absent);
  await firstSetupDirectory(absent, true);
  expect(await canonicalFirstSetupDirectory(absent)).toBe(absent);
  await expect(firstSetupDirectory("relative/path", true)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  const file = join(f.root, "file");
  await writeFile(file, "retained");
  const link = join(f.root, "link");
  await symlink(absent, link);
  for (const path of [file, link]) {
    await expect(canonicalFirstSetupDirectory(path)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
    await expect(firstSetupDirectory(path, true)).rejects.toMatchObject({
      code: "setup.attempt_invalid",
    });
  }
  expect(await readFile(file, "utf8")).toBe("retained");
});
