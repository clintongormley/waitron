import * as filesystem from "node:fs/promises";
import { createHash } from "node:crypto";
import { ALL_MODULES } from "@waitron/composition";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, createFirstSetupStore } from "./index.js";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
vi.mock("node:fs/promises", { spy: true });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => filesystem.rm(root, { recursive: true, force: true })),
  );
});

async function databaseFixture() {
  const root = await filesystem.realpath(
    await filesystem.mkdtemp(join(tmpdir(), "setup-snapshot-")),
  );
  roots.push(root);
  const stateDir = join(root, "state");
  const venueDir = join(root, "venue");
  await filesystem.mkdir(stateDir);
  await filesystem.mkdir(venueDir);
  const store = createFirstSetupStore({
    stateDir,
    venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  const service = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    stateDir,
    venueDir,
    store,
  });
  return { venueDir, service };
}

it("fingerprints both database files without whole-file reads or retaining their bytes", async () => {
  const { venueDir, service } = await databaseFixture();
  const files = [
    ["venue.db", Buffer.alloc(128 * 1024 + 1, "d")],
    ["venue.db-wal", Buffer.alloc(128 * 1024 + 1, "w")],
  ] as const;
  for (const [name, bytes] of files) await filesystem.writeFile(join(venueDir, name), bytes);
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    const file = await actual.open(...args);
    if (files.some(([name]) => args[0] === join(venueDir, name)))
      vi.spyOn(file, "readFile").mockRejectedValue(new Error("whole-file read"));
    return file;
  });
  const { inspection, originals } = await service.captureFirstSetupOriginals();
  for (const [name, bytes] of files) {
    expect(inspection.artifacts).toContainEqual({
      name,
      status: "present",
      digest: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(originals.map((original) => original.name)).not.toContain(`venue/${name}`);
  }
});

it.each(["venue.db", "venue.db-wal"])(
  "rejects a same-size change to %s between inspections",
  async (name) => {
    const { venueDir, service } = await databaseFixture();
    const path = join(venueDir, name);
    await filesystem.writeFile(path, "before");
    const inspect = service.inspectFirstSetupResolution;
    service.inspectFirstSetupResolution = async () => {
      const result = await inspect();
      await filesystem.writeFile(path, "after!");
      return result;
    };
    await expect(service.captureFirstSetupOriginals()).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  },
);

it("refuses a database that grows past the limit after its size check", async () => {
  const { venueDir, service } = await databaseFixture();
  const path = join(venueDir, "venue.db");
  await filesystem.writeFile(path, "database");
  const limit = 128 * 1024 * 1024;
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  let opens = 0;
  let stream: ReturnType<filesystem.FileHandle["createReadStream"]> | undefined;
  vi.mocked(filesystem.open).mockImplementation(async (...args) => {
    const file = await actual.open(...args);
    if (args[0] === path && ++opens === 4) {
      const stat = file.stat.bind(file);
      vi.spyOn(file, "stat").mockImplementationOnce(async () => {
        const info = await stat();
        await actual.truncate(path, limit + 2);
        return info;
      });
      vi.spyOn(file, "readFile").mockRejectedValue(new Error("whole-file read"));
      const createReadStream = file.createReadStream.bind(file);
      vi.spyOn(file, "createReadStream").mockImplementation((options) => {
        stream = createReadStream(options);
        return stream;
      });
    }
    return file;
  });
  await expect(service.captureFirstSetupOriginals()).rejects.toMatchObject({
    code: "setup.not_ready",
    params: { cause: "too-large" },
  });
  expect(stream?.bytesRead).toBe(limit + 1);
});

it.each(["local", "outside-file", "receipt"])(
  "snapshot rejects a transient %s change even when both inspections see the original bytes",
  async (kind) => {
    const root = await filesystem.realpath(
      await filesystem.mkdtemp(join(tmpdir(), "setup-snapshot-")),
    );
    roots.push(root);
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue"),
      receipts = join(root, "receipts");
    for (const dir of [stateDir, venueDir, receipts]) await filesystem.mkdir(dir);
    const path =
      kind === "local"
        ? join(stateDir, "trading.env")
        : kind === "receipt"
          ? join(receipts, "one.json")
          : join(root, "current.json");
    const original = '{"value":42}',
      intermediate = '{"value":43}';
    await filesystem.writeFile(path, original);
    const store = createFirstSetupStore({
      stateDir,
      venueDir,
      coordinator: createFirstSetupCoordinator(),
    });
    const service = createFirstSetupResolutionInspection({
      modules: ALL_MODULES,
      stateDir,
      venueDir,
      store,
      ...(kind === "outside-file" ? { publicEvidencePaths: [path] } : {}),
      ...(kind === "receipt" ? { publicEvidenceDirectories: [receipts] } : {}),
    });
    const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
    let reads = 0;
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      const file = await actual.open(...args);
      if (String(args[0]) === path) {
        const read = file.readFile.bind(file);
        vi.spyOn(file, "readFile").mockImplementation(async (options) => {
          const transient = ++reads === 2;
          if (transient) await actual.writeFile(path, intermediate);
          try {
            return await read(options);
          } finally {
            if (transient) await actual.writeFile(path, original);
          }
        });
      }
      return file;
    });
    await expect(service.captureFirstSetupOriginals()).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(await filesystem.readFile(path, "utf8")).toBe(original);
  },
);

it.each([
  ["local", "omit"],
  ["outside", "omit"],
  ["local", "disappear"],
  ["outside", "disappear"],
])("snapshot rejects a transient %s directory %s", async (kind, change) => {
  const root = await filesystem.realpath(
    await filesystem.mkdtemp(join(tmpdir(), "setup-directory-snapshot-")),
  );
  roots.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await filesystem.mkdir(stateDir);
  await filesystem.mkdir(venueDir);
  const directory =
    kind === "local" ? join(stateDir, "flows/setup/documents") : join(root, "receipts");
  await filesystem.mkdir(directory, { recursive: true });
  const path = join(directory, "one.json");
  await filesystem.writeFile(path, '{"position":42}');
  const store = createFirstSetupStore({
    stateDir,
    venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  const service = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    stateDir,
    venueDir,
    store,
    ...(kind === "outside" ? { publicEvidenceDirectories: [directory] } : {}),
  });
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  let listings = 0;
  vi.mocked(filesystem.readdir).mockImplementation(async (...args) => {
    const transient = String(args[0]) === directory && ++listings === 2;
    if (transient) {
      await actual.unlink(path);
      if (change === "disappear") await actual.rmdir(directory);
    }
    try {
      return await actual.readdir(...args);
    } finally {
      if (transient) {
        if (change === "disappear") await actual.mkdir(directory);
        await actual.writeFile(path, '{"position":42}');
      }
    }
  });
  await expect(service.captureFirstSetupOriginals()).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(listings).toBeGreaterThanOrEqual(2);
  expect(await filesystem.readFile(path, "utf8")).toBe('{"position":42}');
});

it.each(["local", "outside"])(
  "snapshot rejects transient disappearance of a previously observed %s file",
  async (kind) => {
    const root = await filesystem.realpath(
      await filesystem.mkdtemp(join(tmpdir(), "setup-missing-snapshot-")),
    );
    roots.push(root);
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue");
    await filesystem.mkdir(stateDir);
    await filesystem.mkdir(venueDir);
    const path = kind === "local" ? join(stateDir, "trading.env") : join(root, "current.json");
    await filesystem.writeFile(path, '{"position":42}');
    const store = createFirstSetupStore({
      stateDir,
      venueDir,
      coordinator: createFirstSetupCoordinator(),
    });
    const service = createFirstSetupResolutionInspection({
      modules: ALL_MODULES,
      stateDir,
      venueDir,
      store,
      ...(kind === "outside" ? { publicEvidencePaths: [path] } : {}),
    });
    const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
    let opens = 0;
    vi.mocked(filesystem.open).mockImplementation(async (...args) => {
      const transient = String(args[0]) === path && ++opens === 2;
      if (transient) await actual.unlink(path);
      try {
        return await actual.open(...args);
      } finally {
        if (transient) await actual.writeFile(path, '{"position":42}');
      }
    });
    await expect(service.captureFirstSetupOriginals()).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
    expect(opens).toBeGreaterThanOrEqual(2);
    expect(await filesystem.readFile(path, "utf8")).toBe('{"position":42}');
  },
);
