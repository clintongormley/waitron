import { dirname, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  realpath,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  truncate,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFirstSetupCoordinator, createFirstSetupStore } from "./index.js";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
import { request, PASSWORD } from "../test/first-setup-request.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture(
  phase: "claim" | "abandon" | "active" = "claim",
  frozenModules: readonly string[] = [],
  serviceOptions: Partial<Parameters<typeof createFirstSetupResolutionInspection>[0]> = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "first-resolution-")));
  dirs.push(root);
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const coordinator = createFirstSetupCoordinator();
  const store = createFirstSetupStore({ ...roots, coordinator });
  const ownerOptions = {
    ...roots,
    store,
    coordinator,
    bootId: "boot-1",
    freeze: async (
      venue: import("@waitron/provisioning").VenueRequest,
      environment: "production" | "preproduction",
      ids: Pick<
        import("@waitron/provisioning").FirstSetupFrozen,
        "attemptId" | "nodeId" | "administratorId"
      >,
    ) => ({
      ...ids,
      sourceId: `first-setup:${ids.attemptId}`,
      request: venue,
      environment,
      modules: frozenModules.map((module) => ({
        module,
        version: "1.0.0",
        eventId: randomUUID(),
        request: null,
      })),
    }),
  };
  const owner = createFirstSetupOwner(ownerOptions);
  const claim = await owner.claimFirstSetup({ environment: "production", request });
  if (phase === "abandon") await store.update(claim.state.attemptId, 1, { kind: "abandoned" });
  await mkdir(roots.venueDir, { recursive: true });
  await suite.db.archiveTo(join(roots.venueDir, "venue.db"));
  const service = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    ...roots,
    store,
    ...serviceOptions,
  });
  return {
    root,
    ...roots,
    store,
    coordinator,
    owner,
    claim,
    service,
  };
}
it.each(["claim", "abandon"] as const)(
  "describes an interrupted %s without repairing it or weakening strict admission",
  async (phase) => {
    const f = await fixture(phase);
    const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
    const db = await readFile(join(f.venueDir, "venue.db"));
    const entries = await readdir(f.venueDir);
    expect((await f.store.read())?.status).toBe(phase === "claim" ? "claimed" : "abandoned");
    const inspected = await f.service.inspectFirstSetupResolution();
    expect(inspected).toMatchObject({
      version: 2,
      pair: "valid",
      database: "no-venue-rows",
      revision: phase === "claim" ? 1 : 2,
      ownerGeneration: 1,
    });
    expect(inspected.inspectionId).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
    expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(db);
    expect(await readdir(f.venueDir)).toEqual(entries);
    expect((await f.store.read())?.status).toBe(phase === "claim" ? "claimed" : "abandoned");
    expect(JSON.stringify(inspected)).not.toContain(PASSWORD);
    expect(JSON.stringify(inspected)).not.toContain("scrypt$");
  },
);
it("reports exactly the inspection's own fields", async () => {
  const f = await fixture();
  const inspected = await f.service.inspectFirstSetupResolution();
  expect(Object.keys(inspected).sort()).toEqual(
    [
      "version",
      "inspectionId",
      "pair",
      "database",
      "revision",
      "ownerGeneration",
      "emptyDatabase",
      "artifacts",
    ].sort(),
  );
});
it.each(["missing", "corrupt", "partial", "symlink"] as const)(
  "keeps %s databases unavailable without creating or repairing them",
  async (kind) => {
    const f = await fixture();
    const path = join(f.venueDir, "venue.db");
    await rm(path);
    if (kind === "corrupt") {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "not a SQLite file");
    }
    if (kind === "partial") {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.alloc(0));
    }
    if (kind === "symlink") await symlink(join(f.root, "missing.db"), path);
    const before = await readdir(f.venueDir);
    const result = await f.service.inspectFirstSetupResolution();
    expect(result.database).toBe(kind === "symlink" ? "unreadable" : kind);
    expect(result.emptyDatabase).toBe(false);
    expect(await readdir(f.venueDir)).toEqual(before);
    if (kind === "missing") await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it.each([
  "flows/restore/record.json",
  "reset-request.json",
  "flows/setup/operation.json",
  "flows/setup/node-key.json",
  "flows/setup/public-evidence.json",
])("does not call %s evidence empty", async (name) => {
  const f = await fixture();
  await mkdir(join(f.stateDir, name, ".."), { recursive: true });
  await writeFile(join(f.stateDir, name), "{incomplete");
  const inspected = await f.service.inspectFirstSetupResolution();
  expect(inspected.artifacts).toContainEqual(expect.objectContaining({ name, status: "invalid" }));
});
it("binds exact delivery chunks and retained outside evidence into the inspection ID", async () => {
  const f = await fixture("active");
  const root = join(f.stateDir, "flows/setup/documents");
  await mkdir(root);
  const first = await f.service.inspectFirstSetupResolution();
  await writeFile(join(root, "orphan-0.json"), JSON.stringify({ data: "YQ==" }));
  const second = await f.service.inspectFirstSetupResolution();
  expect(second.inspectionId).not.toBe(first.inspectionId);
  expect(second.artifacts).toContainEqual(
    expect.objectContaining({ name: "flows/setup/documents/orphan-0.json", status: "present" }),
  );
  await writeFile(join(root, "orphan-0.json"), '{"data":"Yg=="}');
  expect((await f.service.inspectFirstSetupResolution()).inspectionId).not.toBe(
    second.inspectionId,
  );
});
it.each(["missing", "corrupt", "wrong-root"] as const)(
  "reports %s retained ownership as an unusable pair with no revision",
  async (why) => {
    const f = await fixture();
    const path = join(f.stateDir, "flows/setup/record.json");
    if (why === "missing") await rm(path);
    else if (why === "corrupt") {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "{broken");
    } else {
      const state = JSON.parse(await readFile(path, "utf8"));
      state.venueDir = join(f.root, "other");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(state));
    }
    const inspected = await f.service.inspectFirstSetupResolution();
    expect(inspected.pair).toBe(why === "missing" ? "missing" : "invalid");
    expect(inspected.revision).toBeNull();
    expect(inspected.ownerGeneration).toBeNull();
  },
);

it("binds an independently configured outside file and receipt directory without publishing its paths or granting trust", async () => {
  const f = await fixture("active");
  const outside = join(f.root, "outside.json");
  const receipts = join(f.root, "receipts");
  await mkdir(receipts);
  await writeFile(outside, '{"position":42}');
  await writeFile(join(receipts, "receipt.json"), '{"signed":"original"}');
  const service = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    publicEvidencePaths: [outside],
    publicEvidenceDirectories: [receipts],
  });
  const first = await service.inspectFirstSetupResolution();
  await writeFile(join(receipts, "receipt.json"), '{"signed":"changed"}');
  const second = await service.inspectFirstSetupResolution();
  expect(second.inspectionId).not.toBe(first.inspectionId);
  expect(JSON.stringify(second)).not.toContain(receipts);
  expect(JSON.stringify(second)).not.toContain("original");
  await rm(outside);
  const missing = await service.inspectFirstSetupResolution();
  expect(missing.artifacts).toContainEqual({ name: "outside-evidence-0", status: "missing" });
});
it("does not treat an absent independently configured register as proof of no register", async () => {
  const f = await fixture();
  const service = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    publicEvidencePaths: [join(f.root, "lost-register.json")],
  });
  const result = await service.inspectFirstSetupResolution();
  expect(result.artifacts).toContainEqual({ name: "outside-evidence-0", status: "missing" });
});
it("venue exclusion refuses a venue held by another process before its body runs", async () => {
  const f = await fixture("active");
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from "node:sqlite";
    const lock = new DatabaseSync(process.argv[1]);
    lock.exec("pragma busy_timeout=0; begin immediate");
    process.stdout.write("held");
    setInterval(() => lock, 1000);
  `,
      join(f.venueDir, "venue.lock"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const [chunk] = await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(([code]) => {
        throw new Error(`lock holder exited ${String(code)}`);
      }),
    ]);
    expect(String(chunk)).toBe("held");
    const body = vi.fn(async () => "ran");
    const outcome = await f.service.withVenueExclusion(body).catch((error: unknown) => error);
    expect(outcome).toMatchObject({ code: "provisioning.database_in_use" });
    expect(body).not.toHaveBeenCalled();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
});
it("records trading configuration beside a preactivation pair as evidence", async () => {
  const f = await fixture();
  await writeFile(join(f.stateDir, "trading.env"), "WAITRON_NODE_ID=synthetic\n");
  const inspected = await f.service.inspectFirstSetupResolution();
  expect(inspected.artifacts).toContainEqual(
    expect.objectContaining({ name: "trading.env", status: "present" }),
  );
});
it("retains outside receipt filename identity when the same bytes move to a different record", async () => {
  const f = await fixture("active");
  const receipts = join(f.root, "receipts");
  await mkdir(receipts);
  await writeFile(join(receipts, "first.json"), '{"signed":"same"}');
  const service = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    stateDir: f.stateDir,
    venueDir: f.venueDir,
    store: f.store,
    publicEvidenceDirectories: [receipts],
  });
  const first = await service.inspectFirstSetupResolution();
  await rm(join(receipts, "first.json"));
  await writeFile(join(receipts, "second.json"), '{"signed":"same"}');
  expect((await service.inspectFirstSetupResolution()).inspectionId).not.toBe(first.inspectionId);
});
it("retains an empty delivery directory as incomplete evidence", async () => {
  const f = await fixture();
  await mkdir(join(f.stateDir, "flows/setup/documents"));
  const result = await f.service.inspectFirstSetupResolution();
  expect(result.artifacts).toContainEqual({ name: "flows/setup/documents", status: "present" });
});
it("describes absent roots without creating a workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "first-resolution-empty-"));
  dirs.push(root);
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  const store = createFirstSetupStore({ ...roots, coordinator: createFirstSetupCoordinator() });
  expect(
    await createFirstSetupResolutionInspection({
      modules: ALL_MODULES,
      ...roots,
      store,
    }).inspectFirstSetupResolution(),
  ).toMatchObject({
    pair: "missing",
    database: "missing",
    revision: null,
    ownerGeneration: null,
  });
  expect(await readdir(root)).toEqual([]);
});
it("reports a database carrying a taxpayer as occupied and leaves the marker unchanged", async () => {
  const { seedTenant } = await import("@waitron/db/testing/seed.js");
  await seedTenant(suite.db);
  const f = await fixture();
  const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
  const result = await f.service.inspectFirstSetupResolution();
  expect(result.database).toBe("occupied");
  expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
});
it.each(["symlink", "directory", "oversize", "array"] as const)(
  "retains an unreadable or invalid %s artifact as evidence",
  async (kind) => {
    const f = await fixture();
    const path = join(f.stateDir, "flows/setup/node-key.json");
    if (kind === "symlink") await symlink(join(f.root, "lost.json"), path);
    if (kind === "directory") await mkdir(path);
    if (kind === "oversize") {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "x".repeat(1024 * 1024 + 1));
    }
    if (kind === "array") {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "[]");
    }
    const inspected = await f.service.inspectFirstSetupResolution();
    expect(inspected.artifacts).toContainEqual(
      expect.objectContaining({
        name: "flows/setup/node-key.json",
        status: kind === "array" ? "invalid" : "unreadable",
      }),
    );
  },
);
it("does not follow a symlinked delivery directory", async () => {
  const f = await fixture();
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "hidden.json"), "{}");
  await symlink(outside, join(f.stateDir, "flows/setup/documents"));
  const result = await f.service.inspectFirstSetupResolution();
  expect(result.artifacts).toContainEqual({ name: "flows/setup/documents", status: "unreadable" });
  expect(JSON.stringify(result)).not.toContain("hidden.json");
});
it.each(["missing", "symlink", "invalid-file"] as const)(
  "retains %s independently configured receipt evidence",
  async (kind) => {
    const f = await fixture();
    const directory = join(f.root, "receipts");
    if (kind === "symlink") await symlink(f.stateDir, directory);
    if (kind === "invalid-file") {
      await mkdir(directory);
      await writeFile(join(directory, "invalid.json"), "{incomplete");
    }
    const service = createFirstSetupResolutionInspection({
      modules: ALL_MODULES,
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      store: f.store,
      publicEvidenceDirectories: [directory],
    });
    const result = await service.inspectFirstSetupResolution();
    expect(result.artifacts).toContainEqual(
      expect.objectContaining({
        name:
          kind === "invalid-file"
            ? expect.stringMatching(/^outside-receipts-0\//)
            : "outside-receipts-0",
        status: kind === "missing" ? "missing" : kind === "symlink" ? "unreadable" : "invalid",
      }),
    );
  },
);
it("keeps an unreadable database result unknown instead of calling it empty", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = await fixture();
  const connection = new DatabaseSync(join(f.venueDir, "venue.db"));
  try {
    connection.exec("begin exclusive");
    const result = await f.service.inspectFirstSetupResolution();
    expect(result.database).toBe("unknown");
    expect(result.emptyDatabase).toBe(false);
  } finally {
    connection.exec("rollback");
    connection.close();
  }
});
it.each(["delivery", "outside"] as const)(
  "bounds the number of %s evidence entries without dropping the overflow into emptiness",
  async (kind) => {
    const f = await fixture();
    const directory =
      kind === "delivery" ? join(f.stateDir, "flows/setup/documents") : join(f.root, "receipts");
    await mkdir(directory);
    await Promise.all(
      Array.from({ length: 1025 }, (_, i) => writeFile(join(directory, `${i}.json`), "{}")),
    );
    const service = createFirstSetupResolutionInspection({
      modules: ALL_MODULES,
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      store: f.store,
      ...(kind === "outside" ? { publicEvidenceDirectories: [directory] } : {}),
    });
    const result = await service.inspectFirstSetupResolution();
    expect(result.artifacts).toContainEqual({
      name: kind === "delivery" ? "flows/setup/documents" : "outside-receipts-0",
      status: "unreadable",
    });
  },
);

it("captures exact configured evidence once and retains missing sources explicitly", async () => {
  const f = await fixture("active");
  const evidence = join(f.root, "public.json");
  const receipts = join(f.root, "receipts");
  const delivery = join(f.stateDir, "flows/setup/documents");
  await writeFile(evidence, '{"public":42}');
  await mkdir(receipts);
  await writeFile(join(receipts, "one.json"), '{"receipt":1}');
  await mkdir(delivery);
  await writeFile(join(delivery, "one.json"), '{"delivery":1}');
  const missing = join(f.root, "missing.json");
  const service = createFirstSetupResolutionInspection({
    modules: ALL_MODULES,
    ...f,
    publicEvidencePaths: [evidence, evidence, missing],
    publicEvidenceDirectories: [receipts, receipts, join(f.root, "missing-receipts")],
  });
  const captured = await service.captureFirstSetupOriginals();
  expect(captured.originals.filter((entry) => entry.name === `outside-file:${evidence}`)).toEqual([
    { name: `outside-file:${evidence}`, bytes: Buffer.from('{"public":42}') },
  ]);
  expect(captured.originals).toContainEqual({ name: `outside-file:${missing}`, bytes: null });
  expect(captured.originals).toContainEqual({
    name: `directory:outside:${receipts}`,
    bytes: Buffer.from('["one.json"]'),
  });
  expect(captured.originals).toContainEqual({
    name: `outside-file:${join(receipts, "one.json")}`,
    bytes: Buffer.from('{"receipt":1}'),
  });
  expect(captured.originals).toContainEqual({
    name: "state/flows/setup/documents/one.json",
    bytes: Buffer.from('{"delivery":1}'),
  });
  expect(captured.inspection.inspectionId).toBe(
    (await service.inspectFirstSetupResolution()).inspectionId,
  );
});

it("sees an attempt's modules whose tables live in the core set as an empty core-only database", async () => {
  const hosted = ALL_MODULES.filter((module) => module.tablesIn === "core").map((m) => m.name);
  expect(hosted).toEqual(expect.arrayContaining(["catalogue", "identity"]));
  const f = await fixture("active", hosted, { modules: ALL_MODULES });
  expect(await f.service.inspectFirstSetupResolution()).toMatchObject({
    database: "no-venue-rows",
    emptyDatabase: true,
  });
  const withBookings = await fixture("active", [...hosted, "bookings"], { modules: ALL_MODULES });
  expect(await withBookings.service.inspectFirstSetupResolution()).toMatchObject({
    database: "no-venue-rows",
    emptyDatabase: false,
  });
});

it("rechecks a real empty database against the caller's required migration sets", async () => {
  const f = await fixture("active");
  await expect(f.service.recheckEmptyDatabase(f, ["core"])).resolves.toBe(true);
  await expect(f.service.recheckEmptyDatabase(f, ["bookings"])).resolves.toBe(false);
  await expect(
    createFirstSetupResolutionInspection({
      modules: ALL_MODULES,
      ...f,
      expectedMigrationSets: ["bookings"],
    }).recheckEmptyDatabase(f, []),
  ).resolves.toBe(false);
});

it.each(["file", "symlink"] as const)(
  "never reads a %s state root as an ownership directory",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "setup-unreadable-root-"));
    dirs.push(root);
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue");
    await mkdir(venueDir);
    if (kind === "file") await writeFile(stateDir, "retained state");
    else {
      await mkdir(join(root, "other"));
      await symlink(join(root, "other"), stateDir);
    }
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
    const inspected = await service.inspectFirstSetupResolution();
    expect(inspected.artifacts).toContainEqual({
      name: "flows/setup/record.json",
      status: "unreadable",
    });
    expect(inspected.revision).toBeNull();
    expect(inspected.ownerGeneration).toBeNull();
  },
);

it.each(["directory", "oversize", "removed"])(
  "does not archive a state artifact replaced by %s after inspection",
  async (fault) => {
    const f = await fixture("active");
    const path = join(f.stateDir, "flows/setup/public-evidence.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{"retained":true}');
    const inspect = f.service.inspectFirstSetupResolution.bind(f.service);
    let changed = false;
    f.service.inspectFirstSetupResolution = async () => {
      const result = await inspect();
      if (!changed) {
        changed = true;
        if (fault === "oversize") await truncate(path, 128 * 1024 * 1024 + 1);
        else {
          await rm(path);
          if (fault === "directory") await mkdir(path);
        }
      }
      return result;
    };
    const state = await readFile(join(f.stateDir, "flows/setup/record.json"));
    await expect(f.service.captureFirstSetupOriginals()).rejects.toMatchObject({
      code: fault === "removed" ? "setup.attempt_conflict" : "setup.not_ready",
    });
    expect(changed).toBe(true);
    expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(state);
  },
);

it.each(["file", "overflow"])(
  "does not archive a delivery directory replaced by %s after inspection",
  async (fault) => {
    const f = await fixture("active");
    const directory = join(f.stateDir, "flows/setup/documents");
    const inspect = f.service.inspectFirstSetupResolution.bind(f.service);
    let changed = false;
    f.service.inspectFirstSetupResolution = async () => {
      const result = await inspect();
      if (!changed) {
        changed = true;
        if (fault === "file") {
          await mkdir(dirname(directory), { recursive: true });
          await writeFile(directory, "not a directory");
        } else {
          await mkdir(directory);
          await Promise.all(
            Array.from({ length: 1025 }, (_, i) => writeFile(join(directory, `${i}.json`), "{}")),
          );
        }
      }
      return result;
    };
    const state = await readFile(join(f.stateDir, "flows/setup/record.json"));
    await expect(f.service.captureFirstSetupOriginals()).rejects.toMatchObject({
      code: "setup.not_ready",
    });
    expect(changed).toBe(true);
    expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(state);
  },
);

it.each([
  ["a state artifact made a folder", "unexpected"],
  ["a state artifact over the size limit", "too-large"],
  ["a delivery folder made a file", "unexpected"],
  ["a delivery folder over the file count", "too-large"],
] as const)("names the cause when %s after inspection", async (fault, cause) => {
  const f = await fixture("active");
  const artifact = join(f.stateDir, "flows/setup/public-evidence.json");
  const delivery = join(f.stateDir, "flows/setup/documents");
  await mkdir(dirname(artifact), { recursive: true });
  await writeFile(artifact, '{"retained":true}');
  const inspect = f.service.inspectFirstSetupResolution.bind(f.service);
  let changed = false;
  f.service.inspectFirstSetupResolution = async () => {
    const result = await inspect();
    if (!changed) {
      changed = true;
      if (fault === "a state artifact made a folder") {
        await rm(artifact);
        await mkdir(artifact);
      } else if (fault === "a state artifact over the size limit")
        await truncate(artifact, 128 * 1024 * 1024 + 1);
      else if (fault === "a delivery folder made a file") {
        await mkdir(dirname(delivery), { recursive: true });
        await writeFile(delivery, "not a folder");
      } else {
        await mkdir(delivery);
        await Promise.all(
          Array.from({ length: 1025 }, (_, i) => writeFile(join(delivery, `${i}.json`), "{}")),
        );
      }
    }
    return result;
  };
  await expect(f.service.captureFirstSetupOriginals()).rejects.toMatchObject({
    code: "setup.not_ready",
    params: { cause },
  });
  expect(changed).toBe(true);
});

it("leaves a damaged ownership record and its marker as they are when inspected", async () => {
  const f = await fixture("active");
  const path = join(f.stateDir, "flows/setup/record.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{damaged setup state");
  const before = await readFile(path);
  const marker = await readFile(join(f.stateDir, "flows/setup/record.json"));
  await f.service.inspectFirstSetupResolution();
  expect(await readFile(path)).toEqual(before);
  expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(marker);
});

it("classifies a valid database above 128 MiB without treating the snapshot budget as unreadability", async () => {
  const f = await fixture("active");
  await truncate(join(f.venueDir, "venue.db"), 128 * 1024 * 1024 + 4096);
  const inspected = await f.service.inspectFirstSetupResolution();
  expect(inspected.database).toBe("no-venue-rows");
  expect(inspected.emptyDatabase).toBe(true);
  expect(inspected.artifacts).toContainEqual({ name: "venue.db", status: "unreadable" });
  await expect(f.service.captureFirstSetupOriginals()).rejects.toMatchObject({
    code: "setup.not_ready",
  });
});

it.each(["directory", "fifo"] as const)("rejects a %s before SQLite admission", async (kind) => {
  const f = await fixture("active");
  const path = join(f.venueDir, "venue.db");
  await rm(path);
  if (kind === "directory") await mkdir(path);
  else execFileSync("mkfifo", [path], { timeout: 5000 });
  expect(await f.service.inspectFirstSetupDatabase()).toEqual({
    database: "unreadable",
    emptyDatabase: false,
  });
});

it("inspects a pair whose database is over the snapshot budget and changes neither record", async () => {
  const f = await fixture("claim");
  await truncate(join(f.venueDir, "venue.db"), 128 * 1024 * 1024 + 4096);
  const before = await readFile(join(f.stateDir, "flows/setup/record.json"));
  const marker = await readFile(join(f.stateDir, "flows/setup/record.json"));
  const entries = (await readdir(f.stateDir)).sort();
  const inspected = await f.service.inspectFirstSetupResolution();
  expect(inspected).toMatchObject({
    pair: "valid",
    database: "no-venue-rows",
    emptyDatabase: true,
  });
  expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(before);
  expect(await readFile(join(f.stateDir, "flows/setup/record.json"))).toEqual(marker);
  expect((await readdir(f.stateDir)).sort()).toEqual(entries);
});
