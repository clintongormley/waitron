import * as filesystem from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { createFirstSetupCoordinator, createFirstSetupStore } from "@waitron/provisioning";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
vi.mock("node:fs/promises", { spy: true });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => filesystem.rm(root, { recursive: true, force: true })),
  );
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
    kind === "local" ? join(stateDir, "first-fiscal-documents") : join(root, "receipts");
  await filesystem.mkdir(directory);
  const path = join(directory, "one.json");
  await filesystem.writeFile(path, '{"position":42}');
  const store = createFirstSetupStore({
    stateDir,
    venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  const service = createFirstSetupResolutionInspection({
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
