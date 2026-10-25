import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import * as provision from "./index.js";
import type { BackupRepairRecord } from "./first-setup-backup-workspace.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const recoveryId = "f063ea32-8c34-4b43-8ffc-5a319ec8c895";
async function fixture(shared = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "backup-workspace-")));
  directories.push(root);
  const anchor = {
    venueDir: join(root, "venue"),
    stateDir: join(root, shared ? "venue" : "state"),
  };
  for (const path of new Set(Object.values(anchor))) await mkdir(path);
  await writeFile(join(anchor.stateDir, "first-setup.json"), "opaque malformed original");
  await writeFile(join(anchor.venueDir, "venue.db"), "unchanged database bytes");
  const base = join(anchor.stateDir, "first-setup-resolutions", "backup-recovery", recoveryId);
  const target = {
    recoveryId,
    anchor,
    source: anchor,
    target: { venueDir: join(base, "target", "venue"), stateDir: join(base, "target", "state") },
    generation: 1,
  };
  const store = provision.createFirstSetupBackupWorkspace(anchor);
  const input = async (): Promise<
    Omit<BackupRepairRecord, "version" | "sequence" | "previousRecordDigest" | "recordedAt">
  > => ({
    target,
    observation: {
      inspectionId: "a".repeat(64),
      revision: null,
      ownerGeneration: null,
      originalsDigest: await store.inspect(recoveryId),
    },
    sourceId: "b".repeat(64),
    activationSourceId: "c".repeat(64),
    binding: {
      module: "synthetic",
      action: "restore",
      eventId: "4cc6a357-e31c-4c2e-9b40-023c9963bec8",
      sourceId: "c".repeat(64),
      targetNodeId: "47d5be37-2011-4afc-bdc8-46b5cb238deb",
    },
    input: null,
    retainedEvidenceDigest: "d".repeat(64),
    phase: "prepared",
  });
  return { root, anchor, base, target, store, input };
}

it("leaves an ordinary first-setup target alone when no V2 namespace exists", async () => {
  const f = await fixture();
  expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({ kind: "absent" });
  await provision.assertFirstSetupBackupBootTarget(f.anchor);
});
it("rechecks the same originals across real venue exclusions while binding ordinary database sidecars", async () => {
  const f = await fixture();
  const first = await lockVenueDatabase(f.anchor.venueDir);
  let input: Awaited<ReturnType<typeof f.input>>;
  let lockJournal: Buffer;
  try {
    input = await f.input();
    lockJournal = await readFile(join(f.anchor.venueDir, "venue.lock-journal"));
  } finally {
    first.release();
  }
  const second = await lockVenueDatabase(f.anchor.venueDir);
  try {
    expect(await readFile(join(f.anchor.venueDir, "venue.lock-journal"))).not.toEqual(lockJournal);
    expect(await f.store.inspect(recoveryId)).toBe(input.observation.originalsDigest);
    await f.store.append(input);
    expect(await f.store.read()).toHaveLength(1);
    await writeFile(join(f.anchor.venueDir, "venue.db-wal"), "new retained business rows");
    await expect(f.store.append({ ...input, input: { accepted: true } })).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  } finally {
    second.release();
  }
});
it.each([false, true])(
  "admits only the exact selected target (shared roots: %s)",
  async (shared) => {
    const f = await fixture(shared),
      input = await f.input();
    const prepared = await f.store.append(input);
    expect(prepared).toMatchObject({
      version: 2,
      sequence: 1,
      previousRecordDigest: null,
      phase: "prepared",
    });
    for (const phase of ["prepared", "placement-started", "restored"] as const) {
      if (phase !== "prepared")
        await f.store.append({ ...input, input: { accepted: true }, phase });
      expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
        kind: "repair",
        target: f.target,
      });
      for (const roots of [f.anchor, f.target.target])
        await expect(provision.assertFirstSetupBackupBootTarget(roots)).rejects.toMatchObject({
          code: "setup.attempt_uncertain",
        });
    }
    const restored = (await f.store.read()).at(-1)!;
    await expect(f.store.select(restored)).resolves.toEqual(f.target);
    expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
      kind: "selected",
      target: f.target,
    });
    await provision.assertFirstSetupBackupBootTarget(f.target.target);
    await expect(provision.assertFirstSetupBackupBootTarget(f.anchor)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(await readFile(join(f.anchor.venueDir, "venue.db"), "utf8")).toBe(
      "unchanged database bytes",
    );
    expect(await readFile(join(f.anchor.stateDir, "first-setup.json"), "utf8")).toBe(
      "opaque malformed original",
    );
    await expect(f.store.select(restored)).resolves.toEqual(f.target);
    expect((await f.store.read()).map((record) => record.phase)).toEqual([
      "prepared",
      "placement-started",
      "restored",
      "selected",
    ]);
  },
);
it("never selects a merely prepared target or an orphan directory", async () => {
  const f = await fixture();
  await mkdir(f.target.target.venueDir, { recursive: true });
  await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(provision.assertFirstSetupBackupBootTarget(f.target.target)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it("binds old siblings and rejects a changed original while allowing its own journal writes", async () => {
  const f = await fixture();
  const old = join(f.anchor.stateDir, "first-setup-resolutions", "older");
  await mkdir(old, { recursive: true });
  await writeFile(join(old, "000001.json"), "older independent record");
  const input = await f.input();
  await f.store.append(input);
  await f.store.append({ ...input, input: { checked: true } });
  expect(await f.store.inspect(recoveryId)).toBe(input.observation.originalsDigest);
  await writeFile(join(old, "000001.json"), "changed independent record");
  await expect(
    f.store.append({ ...input, phase: "placement-started", input: { checked: true } }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it("refuses phase skipping and freezes placement input", async () => {
  const f = await fixture(),
    input = await f.input();
  const prepared = await f.store.append(input);
  await expect(f.store.select(prepared)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(
    f.store.append({ ...input, phase: "restored", input: { checked: true } }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await f.store.append({ ...input, phase: "placement-started", input: { checked: true } });
  await expect(
    f.store.append({ ...input, phase: "restored", input: { checked: false } }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});

it("retains immutable private control evidence while leaving the database in place", async () => {
  const f = await fixture(),
    input = await f.input();
  await f.store.append(input);
  const evidence = join(f.base, "evidence");
  const names = await import("node:fs/promises").then((fs) => fs.readdir(evidence));
  const contents = await Promise.all(names.map((name) => readFile(join(evidence, name), "utf8")));
  expect(contents).toContain("opaque malformed original");
  expect(contents).not.toContain("unchanged database bytes");
});
it("rejects a client-supplied selected phase even after a restored record", async () => {
  const f = await fixture(),
    input = { ...(await f.input()), input: { checked: true } };
  for (const phase of ["prepared", "placement-started", "restored"] as const)
    await f.store.append({ ...input, phase });
  await expect(f.store.append({ ...input, phase: "selected" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});
it.each(["venue.db-wal", "venue.db-shm", "new-original.json"])(
  "rejects a newly appearing %s after observation",
  async (name) => {
    const f = await fixture(),
      input = await f.input();
    await f.store.append(input);
    await writeFile(join(f.anchor.venueDir, name), "unobserved bytes");
    await expect(f.store.append({ ...input, input: { checked: true } })).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  },
);
it("does not treat lock heartbeat updates as changes to retained business evidence", async () => {
  const f = await fixture();
  await writeFile(join(f.anchor.venueDir, "venue.holder.json"), "heartbeat one");
  const input = await f.input();
  await f.store.append(input);
  await writeFile(join(f.anchor.venueDir, "venue.holder.json"), "heartbeat two");
  await expect(f.store.append({ ...input, input: { checked: true } })).resolves.toMatchObject({
    phase: "prepared",
    sequence: 2,
  });
});
it("refuses symlink originals without changing their target", async () => {
  const f = await fixture(),
    outside = join(f.root, "outside");
  await writeFile(outside, "do not touch");
  const fs = await import("node:fs/promises");
  await fs.symlink(outside, join(f.anchor.stateDir, "symlink.json"));
  await expect(f.store.inspect(recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await readFile(outside, "utf8")).toBe("do not touch");
});
it("refuses populated orphan targets before writing discovery", async () => {
  const f = await fixture(),
    input = await f.input();
  await mkdir(f.target.target.venueDir, { recursive: true });
  await writeFile(join(f.target.target.venueDir, "venue.db"), "unowned target");
  await expect(f.store.append(input)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await readFile(join(f.target.target.venueDir, "venue.db"), "utf8")).toBe("unowned target");
});
it("refuses malformed persisted records instead of falling back to ordinary boot", async () => {
  const f = await fixture(),
    input = await f.input();
  await f.store.append(input);
  await writeFile(join(f.base, "000001.json"), '{"version":1}');
  await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(provision.assertFirstSetupBackupBootTarget(f.target.target)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it.each([
  "target",
  "observation",
  "binding",
  "sourceId",
  "activationSourceId",
  "retainedEvidenceDigest",
] as const)("freezes %s before placement", async (key) => {
  const f = await fixture(),
    input = await f.input();
  await f.store.append(input);
  const replacement = await f.input();
  if (key === "target")
    replacement.target = {
      ...input.target,
      recoveryId: "d6dcdd66-4eba-49f2-9cb8-cf8c65a8a9ae",
      target: {
        venueDir: input.target.target.venueDir.replace(
          recoveryId,
          "d6dcdd66-4eba-49f2-9cb8-cf8c65a8a9ae",
        ),
        stateDir: input.target.target.stateDir.replace(
          recoveryId,
          "d6dcdd66-4eba-49f2-9cb8-cf8c65a8a9ae",
        ),
      },
    };
  else if (key === "observation")
    replacement.observation = { ...input.observation, inspectionId: "e".repeat(64) };
  else if (key === "binding")
    replacement.binding = { ...input.binding, eventId: "d6dcdd66-4eba-49f2-9cb8-cf8c65a8a9ae" };
  else if (key === "activationSourceId") {
    replacement.activationSourceId = "e".repeat(64);
    replacement.binding = { ...input.binding, sourceId: replacement.activationSourceId };
  } else replacement[key] = "e".repeat(64);
  await expect(f.store.append(replacement)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
});

it.each(["state", "venue", "target-state", "target-venue"])(
  "requires both %s witnesses and reconciles only an exact retry",
  async (location) => {
    const f = await fixture(),
      input = { ...(await f.input()), input: { checked: true } };
    for (const phase of ["prepared", "placement-started", "restored"] as const)
      await f.store.append({ ...input, phase });
    const restored = (await f.store.read()).at(-1)!;
    await f.store.select(restored);
    const root =
      location === "state"
        ? f.anchor.stateDir
        : location === "venue"
          ? f.anchor.venueDir
          : location === "target-state"
            ? f.target.target.stateDir
            : f.target.target.venueDir;
    const name = location.startsWith("target") ? "backlink.json" : "current.json";
    const fs = await import("node:fs/promises");
    await fs.unlink(join(root, "first-setup-resolutions", "backup-recovery", name));
    expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
      kind: "repair",
      target: f.target,
    });
    await expect(provision.assertFirstSetupBackupBootTarget(f.target.target)).rejects.toMatchObject(
      { code: "setup.attempt_uncertain" },
    );
    await f.store.select(restored);
    expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
      kind: "selected",
      target: f.target,
    });
  },
);
it.each([
  ["extra record field", (input: Record<string, unknown>) => ({ ...input, authority: "invented" })],
  [
    "bad digest",
    (input: Record<string, unknown>) => ({ ...input, retainedEvidenceDigest: "invalid" }),
  ],
  ["nonfinite input", (input: Record<string, unknown>) => ({ ...input, input: { number: NaN } })],
  ["undefined input", (input: Record<string, unknown>) => ({ ...input, input: undefined })],
  ["date input", (input: Record<string, unknown>) => ({ ...input, input: new Date() })],
  [
    "oversized input",
    (input: Record<string, unknown>) => ({ ...input, input: "x".repeat(131072) }),
  ],
  ["sparse input", (input: Record<string, unknown>) => ({ ...input, input: new Array(2) })],
  [
    "symbol property",
    (input: Record<string, unknown>) => ({ ...input, input: { [Symbol("secret")]: "not json" } }),
  ],
] as const)("refuses %s before durable output", async (_, change) => {
  const f = await fixture(),
    input = await f.input();
  await expect(f.store.append(change(input) as typeof input)).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
  expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({ kind: "absent" });
});
it("returns detached records so an observed result cannot mutate the next append", async () => {
  const f = await fixture(),
    input = await f.input();
  const writing = f.store.append(input);
  Object.assign(input.binding, { eventId: "63a50838-d58f-4f5c-826b-cd369b5acb63" });
  const record = await writing;
  expect(record.binding.eventId).toBe("4cc6a357-e31c-4c2e-9b40-023c9963bec8");
});

it("keeps JSON primitives, nested arrays and objects without coercion", async () => {
  const f = await fixture(),
    input = await f.input();
  const payload = { values: [0, 42, true, false, null, "public", { nested: [] }] };
  expect((await f.store.append({ ...input, input: payload })).input).toEqual(payload);
});
it("reads an absent journal as no records", async () => {
  expect(await (await fixture()).store.read()).toEqual([]);
});
it("rejects a stale first observation before installing discovery", async () => {
  const f = await fixture(),
    input = await f.input();
  await writeFile(join(f.anchor.stateDir, "first-setup.json"), "changed owner evidence");
  await expect(f.store.append(input)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({ kind: "absent" });
});
it("rejects placement without a prepared record", async () => {
  const f = await fixture(),
    input = await f.input();
  await expect(
    f.store.append({ ...input, input: { checked: true }, phase: "placement-started" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});
it.each([
  ["bad generation", "target", { generation: 2 }],
  ["bad recovery id", "target", { recoveryId: "not-a-uuid" }],
  [
    "client-selected directory",
    "target",
    { target: { venueDir: "/tmp/arbitrary", stateDir: "/tmp/arbitrary-state" } },
  ],
  ["relative roots", "target", { anchor: { venueDir: "relative", stateDir: "relative-state" } }],
  ["partial observation", "observation", { revision: 1 }],
  ["zero generation", "observation", { ownerGeneration: 0 }],
  ["bad inspection", "observation", { inspectionId: "no digest" }],
  ["bad source binding", "binding", { sourceId: "e".repeat(64) }],
  ["bad event", "binding", { eventId: "not-a-uuid" }],
  ["bad target node", "binding", { targetNodeId: "not-a-uuid" }],
  ["empty module", "binding", { module: "" }],
  ["extra authority", "binding", { authority: "not permitted" }],
] as const)("rejects %s in a new action", async (_, key, fields) => {
  const f = await fixture(),
    input = await f.input();
  const bad = { ...input, [key]: { ...input[key], ...fields } };
  await expect(f.store.append(bad)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});
it.each([
  ["wrong version", { version: 1 }],
  ["out of range sequence", { sequence: 129 }],
  ["broken chain", { previousRecordDigest: "e".repeat(64) }],
  ["wrong sequence", { sequence: 2 }],
  ["invalid date", { recordedAt: "yesterday" }],
  ["noncanonical date", { recordedAt: "2026-10-24" }],
  ["extra authority", { authority: "invented" }],
] as const)("keeps persisted %s in repair", async (_, fields) => {
  const f = await fixture(),
    input = await f.input(),
    record = await f.store.append(input);
  await writeFile(join(f.base, "000001.json"), JSON.stringify({ ...record, ...fields }));
  await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it.each([
  "manifest-version",
  "manifest-digest",
  "evidence-content",
  "chain-gap",
  "witness-digest",
  "witness-version",
  "witness-mismatch",
])("does not admit %s as a complete retained chain", async (fault) => {
  const f = await fixture(),
    input = await f.input();
  await f.store.append(input);
  const fs = await import("node:fs/promises");
  if (fault.startsWith("manifest")) {
    const path = join(f.base, "originals.json"),
      value = JSON.parse(await readFile(path, "utf8")) as { version: number; entries: unknown[] };
    if (fault === "manifest-version") value.version = 7;
    else value.entries = [];
    await writeFile(path, JSON.stringify(value));
  } else if (fault === "evidence-content") {
    const path = join(f.base, "evidence"),
      names = await fs.readdir(path);
    await writeFile(join(path, names[0]!), "changed archive");
  } else if (fault === "chain-gap")
    await fs.rename(join(f.base, "000001.json"), join(f.base, "000002.json"));
  else {
    const path = join(
      f.anchor.stateDir,
      "first-setup-resolutions",
      "backup-recovery",
      "current.json",
    );
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (fault === "witness-version") value.version = 1;
    else if (fault === "witness-digest") value.initialRecordDigest = "e".repeat(64);
    else value.initialRecordDigest = "not-a-hash";
    await writeFile(path, JSON.stringify(value));
  }
  await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
  await expect(f.store.append(input)).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
});
it("rejects paths with a symlink ancestor", async () => {
  const f = await fixture(),
    fs = await import("node:fs/promises");
  await fs.symlink(f.anchor.stateDir, join(f.root, "alias"));
  const alias = provision.createFirstSetupBackupWorkspace({
    ...f.anchor,
    stateDir: join(f.root, "alias", "child"),
  });
  await expect(alias.inspect(recoveryId)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
});

it("checks the persisted first record against its immutable discovery digest", async () => {
  const f = await fixture(),
    input = await f.input(),
    record = await f.store.append(input);
  await writeFile(
    join(f.base, "000001.json"),
    JSON.stringify({ ...record, recordedAt: "2026-10-23T00:00:00.000Z" }),
  );
  await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});
it.each(["relative-root", "invalid-operation-id", "missing-original-roots"])(
  "handles %s without accepting unknown originals",
  async (fault) => {
    const f = await fixture();
    if (fault === "relative-root")
      await expect(
        provision
          .createFirstSetupBackupWorkspace({ ...f.anchor, stateDir: "relative" })
          .inspect(recoveryId),
      ).rejects.toMatchObject({ code: "setup.attempt_invalid" });
    else if (fault === "invalid-operation-id")
      await expect(f.store.inspect("not-a-uuid")).rejects.toMatchObject({
        code: "setup.attempt_invalid",
      });
    else {
      const fs = await import("node:fs/promises");
      await fs.rm(f.anchor.stateDir, { recursive: true });
      await expect(f.store.inspect(recoveryId)).resolves.toMatch(/^[a-f0-9]{64}$/);
      expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
        kind: "absent",
      });
    }
  },
);
it("rejects an action whose source differs from the selected V1 roots", async () => {
  const f = await fixture(),
    input = await f.input();
  input.target.source = {
    venueDir: join(f.root, "foreign-venue"),
    stateDir: join(f.root, "foreign-state"),
  };
  await expect(f.store.append(input)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
});
it.each(["cycle", "too-deep", "getter", "null-placement"])(
  "rejects nonpublic %s input before writing",
  async (fault) => {
    const f = await fixture(),
      input = await f.input();
    if (fault === "cycle") {
      const value: { self?: unknown } = {};
      value.self = value;
      input.input = value;
    }
    if (fault === "too-deep") {
      let value: unknown = null;
      for (let i = 0; i < 66; i++) value = { value };
      input.input = value;
    }
    if (fault === "getter")
      input.input = {
        get value() {
          return "not a data property";
        },
      };
    if (fault === "null-placement") input.phase = "placement-started";
    await expect(f.store.append(input)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  },
);
it("rejects a rewritten source even when a fabricated chain has internally matching digests", async () => {
  const f = await fixture(),
    input = await f.input();
  await f.store.append(input);
  const fs = await import("node:fs/promises"),
    { createHash } = await import("node:crypto");
  const source = {
    venueDir: join(f.root, "foreign-venue"),
    stateDir: join(f.root, "foreign-state"),
  };
  for (const path of Object.values(source)) await mkdir(path);
  const record = { ...(await f.store.read())[0]!, target: { ...f.target, source } };
  const witness = {
    version: 2,
    target: record.target,
    initialRecordDigest: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
    initialRecord: record,
  };
  await writeFile(join(f.base, "000001.json"), JSON.stringify(record));
  for (const path of Object.values(f.anchor))
    await fs.writeFile(
      join(path, "first-setup-resolutions", "backup-recovery", "current.json"),
      JSON.stringify(witness),
    );
  await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
    code: "setup.attempt_uncertain",
  });
});

it("retains a bucket generation id separately from the prefixed stream-byte activation id", async () => {
  const f = await fixture(),
    input = await f.input();
  const activationSourceId = "stream-sha256:" + "c".repeat(64);
  const supplied = {
    ...input,
    sourceId: "node-generation-2026-10-24",
    activationSourceId,
    binding: { ...input.binding, sourceId: activationSourceId },
  };
  const record = await f.store.append(supplied);
  expect(record.sourceId).toBe("node-generation-2026-10-24");
  expect(record.activationSourceId).toBe("stream-sha256:" + "c".repeat(64));
  expect((await f.store.read())[0]!.binding.sourceId).toBe("stream-sha256:" + "c".repeat(64));
});

it("refuses orphan state roots paired with an ordinary venue", async () => {
  const f = await fixture();
  await mkdir(f.target.target.stateDir, { recursive: true });
  await expect(
    provision.assertFirstSetupBackupBootTarget({
      venueDir: f.anchor.venueDir,
      stateDir: f.target.target.stateDir,
    }),
  ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
});

const placementInput = { checked: true };
async function journalAt(phase: "prepared" | "placement-started" | "restored") {
  const f = await fixture(),
    input = await f.input();
  await f.store.append(input);
  for (const next of ["placement-started", "restored"] as const) {
    if (phase === "prepared") break;
    await f.store.append({ ...input, input: placementInput, phase: next });
    if (next === phase) break;
  }
  return { f, input };
}
it.each(["prepared", "placement-started", "restored"] as const)(
  "abandons a %s recovery, which then reads as no recovery",
  async (phase) => {
    const { f } = await journalAt(phase);
    const last = (await f.store.read()).at(-1)!;
    const abandoned = await f.store.abandon(recoveryId);
    expect(abandoned).toMatchObject({
      phase: "abandoned",
      sequence: last.sequence + 1,
      input: last.input,
    });
    expect((await f.store.read()).at(-1)).toEqual(abandoned);
    expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({ kind: "absent" });
    await provision.assertFirstSetupBackupBootTarget(f.anchor);
  },
);
it("refuses to abandon a selected recovery", async () => {
  const { f } = await journalAt("restored");
  await f.store.select((await f.store.read()).at(-1)!);
  await expect(f.store.abandon(recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.store.read()).at(-1)!.phase).toBe("selected");
  expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
    kind: "selected",
    target: f.target,
  });
});
it("refuses to abandon a recovery it does not hold, or when there is none", async () => {
  const f = await fixture();
  await expect(f.store.abandon(recoveryId)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await f.store.append(await f.input());
  await expect(f.store.abandon("d6dcdd66-4eba-49f2-9cb8-cf8c65a8a9ae")).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.store.read()).at(-1)!.phase).toBe("prepared");
});
it("lets nothing follow an abandoned record", async () => {
  const { f, input } = await journalAt("restored");
  const restored = (await f.store.read()).at(-1)!;
  await f.store.abandon(recoveryId);
  for (const phase of ["prepared", "placement-started", "restored"] as const)
    await expect(f.store.append({ ...input, input: placementInput, phase })).rejects.toMatchObject({
      code: "setup.attempt_conflict",
    });
  await expect(f.store.select(restored)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect((await f.store.read()).map((record) => record.phase)).toEqual([
    "prepared",
    "placement-started",
    "restored",
    "abandoned",
  ]);
});
it("refuses an abandoned record whose input differs from the record before it", async () => {
  const { f, input } = await journalAt("placement-started");
  await expect(
    f.store.append({ ...input, input: { checked: false }, phase: "abandoned" }),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect((await f.store.read()).at(-1)!.phase).toBe("placement-started");
});
it.each([true, false])(
  "keeps an abandoned journal readable once the attempt is deleted (abandoned: %s)",
  async (abandon) => {
    const { f } = await journalAt("restored");
    if (abandon) await f.store.abandon(recoveryId);
    await rm(join(f.anchor.stateDir, "first-setup.json"));
    if (abandon) {
      expect((await f.store.read()).at(-1)!.phase).toBe("abandoned");
      expect(await provision.resolveFirstSetupBackupWorkspace(f.anchor)).toEqual({
        kind: "absent",
      });
    } else
      await expect(provision.resolveFirstSetupBackupWorkspace(f.anchor)).rejects.toMatchObject({
        code: "setup.attempt_uncertain",
      });
  },
);
it("returns the same record when abandoned twice, writing nothing the second time", async () => {
  const { f } = await journalAt("placement-started");
  const first = await f.store.abandon(recoveryId);
  const path = join(f.base, `${String(first.sequence).padStart(6, "0")}.json`);
  const bytes = await readFile(path);
  await rm(join(f.anchor.stateDir, "first-setup.json"));
  await expect(f.store.abandon(recoveryId)).resolves.toEqual(first);
  expect(await readFile(path)).toEqual(bytes);
  expect(await f.store.read()).toHaveLength(first.sequence);
});
