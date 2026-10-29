import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readAttempt, transitionAttempt } from "./journal.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const hash = (text) => createHash("sha256").update(text).digest("hex");
const binding = () => ({
  attemptId: "attempt-1",
  diskUuid: "disk-1",
  layoutDigest: "a".repeat(64),
  oldReleaseDigest: "b".repeat(64),
  candidateReleaseDigest: "c".repeat(64),
  nodeId: "node-1",
  term: 2,
  membershipDigest: "d".repeat(64),
  occurrenceId: "window-1",
  episodeId: "close-1",
  dailyAllowanceKey: "2026-10-29",
  windowRevision: 3,
  admissionGeneration: "generation-1",
  inventoryDigest: "e".repeat(64),
});
const clock = (utcMs = 1000, steadyMs = 100) => ({
  bootId: "boot-1",
  utcMs,
  steadyMs,
  reliableUtc: true,
  suspendAware: true,
});
const check = (activeTreeId = "candidate-tree") => ({
  bootNonce: "nonce-1",
  activeTreeId,
  schemaDigest: "f".repeat(64),
});
const event = (type, data = {}, time = clock()) => ({
  type,
  binding: binding(),
  clock: time,
  data,
});
const prepare = () =>
  event("prepare", {
    oldTreeId: "old-tree",
    inputsDigest: "1".repeat(64),
    floorDigest: "2".repeat(64),
    publicationDigest: "3".repeat(64),
  });

// This fixture exercises real file operations; B3 must independently qualify its host adapter.
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "a950-journal-")));
  roots.push(root);
  const identity = async () => {
    if ((await fs.realpath(root)) !== root) throw new Error("root-link");
    const stat = await fs.lstat(root);
    return {
      hostRoot: root,
      diskUuid: "disk-1",
      layoutDigest: "a".repeat(64),
      rootId: `${stat.dev}:${stat.ino}`,
    };
  };
  const io = {
    hostRoot: root,
    diskUuid: "disk-1",
    inspectRoot: identity,
    async withTurn(run) {
      await fs.mkdir(join(root, ".turn"));
      try {
        return await run();
      } finally {
        await fs.rmdir(join(root, ".turn"));
      }
    },
    async read(name) {
      let handle;
      try {
        handle = await fs.open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      try {
        return await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    },
    list: () => fs.readdir(root),
    create: (name, bytes) => fs.writeFile(join(root, name), bytes, { flag: "wx", mode: 0o600 }),
    async sync(name) {
      const handle = await fs.open(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    rename: (from, to) => fs.rename(join(root, from), join(root, to)),
    remove: (name) => fs.unlink(join(root, name)),
    async syncDirectory() {
      const handle = await fs.open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
  };
  const { diskUuid, layoutDigest, rootId } = await identity();
  const layout = { diskUuid, layoutDigest, rootId };
  await io.create("layout.json", JSON.stringify({ version: 1, ...layout, attemptId: null }) + "\n");
  return { root, io, read: () => readAttempt(root, "disk-1", io) };
}

async function advance(io, until = "validate") {
  let journal = await transitionAttempt(0, prepare(), io);
  for (const [type, data] of [
    ["freeze", {}],
    ["capture", { captureId: "snapshot-1" }],
    ["validate", { checkBinding: check() }],
    ["checks", { checkBinding: check(), checksDigest: "4".repeat(64) }],
    [
      "close",
      { checkBinding: check(), checksDigest: "4".repeat(64), releaseGeneration: "candidate-live" },
    ],
    ["release", { checkBinding: check(), releaseGeneration: "candidate-live" }],
  ]) {
    journal = await transitionAttempt(journal.sequence, event(type, data), io);
    if (type === until) break;
  }
  return journal;
}

describe("attempt journal", () => {
  it("requires an injected qualified host adapter instead of treating missing files as idle", async () => {
    expect(await readAttempt("/unqualified", "disk-1")).toEqual({
      kind: "inspection-required",
      reason: "layout-unqualified",
    });
  });
  it("never treats loss of every attempt record as a freshly initialised idle root", async () => {
    const { root, io, read } = await fixture();
    await advance(io, "close");
    for (const name of await fs.readdir(root))
      if (name !== "layout.json") await fs.unlink(join(root, name));
    expect(await read()).toMatchObject({ kind: "inspection-required" });
  });
  it("accepts only an explicitly initialised matching root as idle", async () => {
    const { root, io, read } = await fixture();
    expect(await read()).toMatchObject({ kind: "idle", layout: { diskUuid: "disk-1" } });
    expect(await readAttempt(root, "another-disk", io)).toMatchObject({
      kind: "inspection-required",
    });
    expect(await readAttempt(root + "-other", "disk-1", io)).toMatchObject({
      kind: "inspection-required",
    });
    await fs.unlink(join(root, "layout.json"));
    expect(await read()).toMatchObject({ kind: "inspection-required" });
  });
  it("round-trips complete immutable attempt evidence and rejects competing expected sequences", async () => {
    const { io, read } = await fixture();
    const journal = await transitionAttempt(0, prepare(), io);
    expect(journal).toMatchObject({
      version: 1,
      sequence: 1,
      phase: "PREPARED",
      binding: binding(),
      oldTreeId: "old-tree",
      captureId: null,
    });
    expect(await read()).toEqual({ kind: "verified", journal });
    const results = await Promise.allSettled([
      transitionAttempt(1, event("freeze"), io),
      transitionAttempt(1, event("freeze"), io),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await read()).journal.phase).toBe("FREEZING");
    await expect(transitionAttempt(1, event("freeze"), io)).rejects.toMatchObject({
      code: "upgrade.invalid_journal",
      reason: "sequence-conflict",
    });
  });
  it.each(["version", "diskUuid", "layoutDigest", "rootId", "unknown"])(
    "rejects invalid layout %s",
    async (field) => {
      const { root, io, read } = await fixture();
      const value = JSON.parse(await io.read("layout.json"));
      value[field] = "wrong";
      await fs.writeFile(join(root, "layout.json"), JSON.stringify(value) + "\n");
      expect(await read()).toMatchObject({ kind: "inspection-required" });
    },
  );
  it.each([
    null,
    {},
    [],
    { ...prepare(), extra: true },
    { ...prepare(), type: "invented" },
    { ...prepare(), binding: { ...binding(), term: -1 } },
    { ...prepare(), data: { ...prepare().data, oldTreeId: "../outside" } },
    { ...prepare(), clock: { ...clock(), suspendAware: false } },
  ])("refuses malformed event %# without publishing an attempt", async (input) => {
    const { io, read } = await fixture();
    await expect(transitionAttempt(0, input, io)).rejects.toMatchObject({
      code: "upgrade.invalid_journal",
    });
    expect((await read()).kind).toBe("idle");
  });
  it.each(["layout.json", "attempt.json", "0000000000000001.json"])(
    "does not follow a %s symlink",
    async (name) => {
      const { root, io, read } = await fixture();
      await transitionAttempt(0, prepare(), io);
      const saved = root + "-target";
      roots.push(saved);
      await fs.rename(join(root, name), saved);
      await fs.symlink(saved, join(root, name));
      expect(await read()).toMatchObject({ kind: "inspection-required" });
    },
  );
  it.each(["{", "", '{"version":2}\n'])("rejects truncated or unknown record %#", async (bytes) => {
    const { root, io, read } = await fixture();
    await transitionAttempt(0, prepare(), io);
    await fs.writeFile(join(root, "0000000000000001.json"), bytes);
    expect(await read()).toMatchObject({ kind: "inspection-required" });
  });
  it("never infers idle from a missing last record or accepts a gap, extra file or edited history", async () => {
    for (const fault of ["missing", "gap", "extra", "edit"]) {
      const { root, io, read } = await fixture();
      await advance(io);
      if (fault === "missing") await fs.unlink(join(root, "0000000000000004.json"));
      if (fault === "gap")
        await fs.rename(join(root, "0000000000000002.json"), join(root, "0000000000000009.json"));
      if (fault === "extra") await fs.writeFile(join(root, "unknown"), "unknown");
      if (fault === "edit") {
        const name = "0000000000000002.json";
        const record = JSON.parse(await io.read(name));
        record.journal.binding.nodeId = "another-node";
        record.digest = hash(JSON.stringify(record.journal));
        await fs.writeFile(join(root, name), JSON.stringify(record) + "\n");
      }
      expect(await read(), fault).toMatchObject({ kind: "inspection-required" });
    }
  });
  it.each(["create", "sync", "rename", "syncDirectory", "read"])(
    "holds admission after an interrupted %s publication",
    async (operation) => {
      const { io, read } = await fixture();
      await advance(io, "checks");
      let interrupted = false;
      const broken = {
        ...io,
        [operation]: async (...args) => {
          const target =
            operation === "syncDirectory" ||
            args.some((x) => x === ".pending" || x === "0000000000000006.json");
          if (target && !interrupted) {
            interrupted = true;
            throw new Error("interrupted");
          }
          return io[operation](...args);
        },
      };
      await expect(
        transitionAttempt(
          5,
          event("close", {
            checkBinding: check(),
            checksDigest: "4".repeat(64),
            releaseGeneration: "candidate-live",
          }),
          broken,
        ),
      ).rejects.toMatchObject({ code: "upgrade.invalid_journal" });
      expect(interrupted).toBe(true);
      const result = await read();
      // A durable closure can survive a lost answer; uncertainty can never become idle.
      expect(["inspection-required", "verified"]).toContain(result.kind);
      if (result.kind === "verified")
        expect(["VALIDATING", "ROLLBACK_CLOSED"]).toContain(result.journal.phase);
    },
  );
  it("resolves a lost completion answer from durable evidence and forbids rollback before release", async () => {
    const { io, read } = await fixture();
    await advance(io, "close");
    const restarted = await read();
    expect(restarted.journal.phase).toBe("ROLLBACK_CLOSED");
    await expect(
      transitionAttempt(6, event("rollback", { reason: "checks-failed" }), io),
    ).rejects.toMatchObject({ reason: "transition-refused" });
    expect((await read()).journal.phase).toBe("ROLLBACK_CLOSED");
  });
  it("serialises closure against rollback so the losing operation cannot reopen it", async () => {
    for (const winner of ["close", "rollback"]) {
      const { io, read } = await fixture();
      await advance(io, "checks");
      const close = event("close", {
        checkBinding: check(),
        checksDigest: "4".repeat(64),
        releaseGeneration: "candidate-live",
      });
      const rollback = event("rollback", { reason: "checks-failed" });
      await transitionAttempt(5, winner === "close" ? close : rollback, io);
      await expect(
        transitionAttempt(5, winner === "close" ? rollback : close, io),
      ).rejects.toMatchObject({ reason: "sequence-conflict" });
      expect((await read()).journal.phase).toBe(
        winner === "close" ? "ROLLBACK_CLOSED" : "ROLLBACK_INTENT",
      );
    }
  });
  it("records ordered restoration substeps, retires permission before release and retains terminal history after cleanup", async () => {
    const { io, read } = await fixture();
    let journal = await advance(io);
    journal = await transitionAttempt(
      journal.sequence,
      event("rollback", { reason: "checks-failed" }),
      io,
    );
    await expect(
      transitionAttempt(journal.sequence, event("restore-step", { step: "tree-replaced" }), io),
    ).rejects.toMatchObject({ reason: "transition-refused" });
    for (const step of ["candidate-stopped", "tree-replaced", "floor-applied", "old-checked"])
      journal = await transitionAttempt(journal.sequence, event("restore-step", { step }), io);
    journal = await transitionAttempt(
      journal.sequence,
      event("restored", { checkBinding: check("old-tree"), releaseGeneration: "old-live" }),
      io,
    );
    expect(journal.phase).toBe("RESTORED");
    for (const type of ["rollback", "restore-step", "validate"])
      await expect(
        transitionAttempt(
          journal.sequence,
          event(
            type,
            type === "rollback"
              ? { reason: "checks-failed" }
              : type === "restore-step"
                ? { step: "candidate-stopped" }
                : { checkBinding: check() },
          ),
          io,
        ),
      ).rejects.toMatchObject({ reason: "transition-refused" });
    journal = await transitionAttempt(
      journal.sequence,
      event("release", { checkBinding: check("old-tree"), releaseGeneration: "old-live" }),
      io,
    );
    journal = await transitionAttempt(journal.sequence, event("cleanup"), io);
    expect(journal).toMatchObject({
      phase: "RESTORED",
      outcome: "cleanup-complete",
      captureId: "snapshot-1",
    });
    expect((await read()).journal).toEqual(journal);
    await expect(transitionAttempt(journal.sequence, prepare(), io)).rejects.toMatchObject({
      reason: "transition-refused",
    });
  });

  it.each(["checks", "close", "release"])(
    "refuses %s from a later boot without reusing the old nonce",
    async (type) => {
      const { io } = await fixture();
      const journal = await advance(io, type === "release" ? "close" : "validate");
      const data =
        type === "release"
          ? { checkBinding: check(), releaseGeneration: "candidate-live" }
          : type === "checks"
            ? { checkBinding: check(), checksDigest: "4".repeat(64) }
            : {
                checkBinding: check(),
                checksDigest: "4".repeat(64),
                releaseGeneration: "candidate-live",
              };
      await expect(
        transitionAttempt(
          journal.sequence,
          event(type, data, { ...clock(2000, 5), bootId: "boot-2" }),
          io,
        ),
      ).rejects.toMatchObject({ reason: "transition-refused" });
    },
  );
  it("refuses a stale checked process at release", async () => {
    const { io } = await fixture();
    const journal = await advance(io, "close");
    await expect(
      transitionAttempt(
        journal.sequence,
        event("release", {
          checkBinding: { ...check(), bootNonce: "stale" },
          releaseGeneration: "candidate-live",
        }),
        io,
      ),
    ).rejects.toMatchObject({ reason: "transition-refused" });
  });
  it("does not reuse a backward steady reading after a persisted checkpoint", async () => {
    const { io } = await fixture();
    const journal = await advance(io);
    const checkpoint = await transitionAttempt(
      journal.sequence,
      event(
        "checks",
        { checkBinding: check(), checksDigest: "4".repeat(64) },
        clock(101000, 100100),
      ),
      io,
    );
    await expect(
      transitionAttempt(
        checkpoint.sequence,
        event(
          "close",
          {
            checkBinding: check(),
            checksDigest: "4".repeat(64),
            releaseGeneration: "candidate-live",
          },
          clock(101001, 1000),
        ),
        io,
      ),
    ).rejects.toMatchObject({ reason: "phase-budget" });
  });
  it("keeps the separate restoration and old-readiness budgets across their checkpoints", async () => {
    const { io } = await fixture();
    let journal = await advance(io);
    journal = await transitionAttempt(
      journal.sequence,
      event("rollback", { reason: "candidate-crashed" }),
      io,
    );
    for (const step of ["candidate-stopped", "tree-replaced", "floor-applied"])
      journal = await transitionAttempt(
        journal.sequence,
        event("restore-step", { step }, clock(300000, 299100)),
        io,
      );
    journal = await transitionAttempt(
      journal.sequence,
      event("restore-step", { step: "old-checked" }, clock(599999, 599099)),
      io,
    );
    journal = await transitionAttempt(
      journal.sequence,
      event(
        "restored",
        { checkBinding: check("old-tree"), releaseGeneration: "old-live" },
        clock(599999, 599099),
      ),
      io,
    );
    expect(journal.phase).toBe("RESTORED");
  });

  it("does not infer a durable closure after pointer rename but before its directory flush", async () => {
    const { io, read } = await fixture();
    await advance(io, "checks");
    let headRenamed = false;
    const broken = {
      ...io,
      async rename(from, to) {
        await io.rename(from, to);
        if (to === "head.json") headRenamed = true;
      },
      async syncDirectory() {
        if (headRenamed) throw new Error("flush refused");
        await io.syncDirectory();
      },
    };
    await expect(
      transitionAttempt(
        5,
        event("close", {
          checkBinding: check(),
          checksDigest: "4".repeat(64),
          releaseGeneration: "candidate-live",
        }),
        broken,
      ),
    ).rejects.toMatchObject({ reason: "publication-unverified" });
    expect(await read()).toMatchObject({ kind: "inspection-required" });
    await expect(
      transitionAttempt(6, event("rollback", { reason: "checks-failed" }), io),
    ).rejects.toMatchObject({ code: "upgrade.invalid_journal" });
  });

  it.each([
    { type: "validate", data: { checkBinding: null } },
    { type: "validate", data: { checkBinding: { ...check(), schemaDigest: "wrong" } } },
    { type: "rollback", data: { reason: "unknown-reason" } },
    { type: "prepare", binding: { ...binding(), nodeId: null } },
    { type: "prepare", binding: { ...binding(), layoutDigest: null } },
    { type: "prepare", binding: { ...binding(), extra: true } },
    { type: "prepare", binding: { ...binding(), candidateReleaseDigest: "b".repeat(64) } },
    { type: "prepare", clock: { ...clock(), utcMs: NaN } },
  ])("refuses malformed bindings before changing host evidence %#", async (change) => {
    const { io, read } = await fixture();
    await expect(transitionAttempt(0, { ...prepare(), ...change }, io)).rejects.toMatchObject({
      code: "upgrade.invalid_journal",
    });
    expect((await read()).kind).toBe("idle");
  });
  it("requires preparation, expected sequence and matching immutable attempt binding", async () => {
    const { io, read } = await fixture();
    await expect(transitionAttempt(0, event("freeze"), io)).rejects.toMatchObject({
      reason: "transition-refused",
    });
    await expect(transitionAttempt(-1, prepare(), io)).rejects.toMatchObject({
      reason: "sequence-conflict",
    });
    await expect(
      transitionAttempt(0, { ...prepare(), binding: { ...binding(), diskUuid: "disk-2" } }, io),
    ).rejects.toMatchObject({ reason: "binding-conflict" });
    await transitionAttempt(0, prepare(), io);
    await expect(
      transitionAttempt(
        1,
        { ...event("freeze"), binding: { ...binding(), episodeId: "another-close" } },
        io,
      ),
    ).rejects.toMatchObject({ reason: "binding-conflict" });
    const reordered = Object.fromEntries(Object.entries(binding()).reverse());
    await transitionAttempt(1, { ...event("freeze"), binding: reordered }, io);
    expect((await read()).journal.phase).toBe("FREEZING");
  });
  it("rejects an overflowing deadline and a steady clock preceding its phase", async () => {
    const first = await fixture();
    await transitionAttempt(
      0,
      { ...prepare(), clock: clock(Number.MAX_SAFE_INTEGER, 100) },
      first.io,
    );
    await expect(
      transitionAttempt(1, event("freeze", {}, clock(Number.MAX_SAFE_INTEGER, 100)), first.io),
    ).rejects.toMatchObject({ reason: "clock-unavailable" });
    const second = await fixture();
    await advance(second.io);
    await expect(
      transitionAttempt(
        4,
        event("checks", { checkBinding: check(), checksDigest: "4".repeat(64) }, clock(1001, 99)),
        second.io,
      ),
    ).rejects.toMatchObject({ reason: "phase-budget" });
  });
  it.each([
    "marker-shape",
    "marker-disk",
    "record-shape",
    "event-binding",
    "journal-body",
    "head-digest",
    "duplicate-keys",
  ])("rejects corrupt history with %s", async (fault) => {
    const { root, io, read } = await fixture();
    await transitionAttempt(0, prepare(), io);
    if (fault.startsWith("marker")) {
      const marker = JSON.parse(await io.read("attempt.json"));
      if (fault === "marker-shape") marker.extra = true;
      else marker.binding.diskUuid = "another-disk";
      await fs.writeFile(join(root, "attempt.json"), JSON.stringify(marker) + "\n");
    } else if (fault === "head-digest") {
      await fs.writeFile(
        join(root, "head.json"),
        JSON.stringify({ sequence: 1, digest: "0".repeat(64) }) + "\n",
      );
    } else {
      const name = "0000000000000001.json";
      const record = JSON.parse(await io.read(name));
      if (fault === "record-shape") record.extra = true;
      if (fault === "event-binding") record.event.binding.nodeId = "another-node";
      if (fault === "journal-body") record.journal.phase = "ROLLBACK_CLOSED";
      record.digest = hash(
        JSON.stringify({
          event: record.event,
          journal: record.journal,
          previousDigest: record.previousDigest,
        }),
      );
      let encoded = JSON.stringify(record) + "\n";
      if (fault === "duplicate-keys")
        encoded = encoded.replace('"phase":"PREPARED"', '"phase":"LIVE","phase":"PREPARED"');
      await fs.writeFile(join(root, name), encoded);
    }
    expect(await read()).toMatchObject({ kind: "inspection-required" });
  });
  it("rejects a corrupt publication read-back rather than returning the intended record", async () => {
    const { io, read } = await fixture();
    await transitionAttempt(0, prepare(), io);
    const broken = {
      ...io,
      async read(name) {
        const value = await io.read(name);
        return name === "0000000000000002.json" && value !== null ? value + "garbage" : value;
      },
    };
    await expect(transitionAttempt(1, event("freeze"), broken)).rejects.toMatchObject({
      reason: "publication-unverified",
    });
    expect((await read()).kind).toBe("inspection-required");
  });
  it("detects an internally inconsistent final read even when each separate publication read matched", async () => {
    const { root, io } = await fixture();
    await transitionAttempt(0, prepare(), io);
    const oldHead = await io.read("head.json");
    let lists = 0;
    const broken = {
      ...io,
      async list() {
        if (++lists === 2) {
          await fs.unlink(join(root, "0000000000000002.json"));
          await fs.writeFile(join(root, "head.json"), oldHead);
        }
        return io.list();
      },
    };
    await expect(transitionAttempt(1, event("freeze"), broken)).rejects.toMatchObject({
      reason: "publication-unverified",
    });
  });
  it("leaves an interrupted exclusive host turn for inspection, without removing another holder's lock", async () => {
    const { root, io, read } = await fixture();
    await fs.mkdir(join(root, ".turn"));
    expect((await read()).kind).toBe("inspection-required");
    await expect(transitionAttempt(0, prepare(), io)).rejects.toMatchObject({
      reason: "publication-unverified",
    });
    expect((await fs.stat(join(root, ".turn"))).isDirectory()).toBe(true);
  });
  it("refuses a replaced root, not just linked record files", async () => {
    const { root, read } = await fixture();
    const saved = root + "-saved";
    roots.push(saved);
    await fs.rename(root, saved);
    await fs.symlink(saved, root);
    expect((await read()).kind).toBe("inspection-required");
  });

  it.each(
    ["before", "after"].flatMap((when) =>
      [
        "create-intent",
        "sync-intent",
        "flush-intent",
        "create-record",
        "sync-record",
        "rename-record",
        "flush-record",
        "read-record",
        "create-head",
        "sync-head",
        "rename-head",
        "flush-head",
        "read-head",
        "verify-history",
        "remove-intent",
        "flush-removal",
      ].map((point) => [when, point]),
    ),
  )("%s %s cannot silently reopen rollback", async (when, point) => {
    const { io, read } = await fixture();
    await advance(io, "checks");
    let directories = 0;
    let lists = 0;
    let headRenamed = false;
    let injected = false;
    const broken = { ...io };
    for (const operation of [
      "create",
      "sync",
      "rename",
      "syncDirectory",
      "read",
      "list",
      "remove",
    ]) {
      broken[operation] = async (...args) => {
        let stage;
        if (["create", "sync", "rename"].includes(operation)) {
          const suffix =
            args[0] === ".publishing"
              ? "intent"
              : args[0] === ".pending"
                ? "record"
                : args[0] === ".head-pending"
                  ? "head"
                  : "";
          stage = `${operation}-${suffix}`;
        }
        if (operation === "syncDirectory")
          stage = ["flush-intent", "flush-record", "flush-head", "flush-removal"][directories++];
        if (operation === "read" && args[0] === "0000000000000006.json") stage = "read-record";
        if (operation === "read" && args[0] === "head.json" && headRenamed) stage = "read-head";
        if (operation === "list" && ++lists === 2) stage = "verify-history";
        if (operation === "remove") stage = "remove-intent";
        const target = stage === point && !injected;
        if (target) injected = true;
        if (target && when === "before") throw new Error("interrupted");
        const result = await io[operation](...args);
        if (operation === "rename" && args[1] === "head.json") headRenamed = true;
        if (target && when === "after") throw new Error("interrupted");
        return result;
      };
    }
    await expect(
      transitionAttempt(
        5,
        event("close", {
          checkBinding: check(),
          checksDigest: "4".repeat(64),
          releaseGeneration: "candidate-live",
        }),
        broken,
      ),
    ).rejects.toMatchObject({ code: "upgrade.invalid_journal" });
    expect(injected).toBe(true);
    const outcome = await read();
    if (point === "create-intent" && when === "before")
      expect(outcome.journal.phase).toBe("VALIDATING");
    else if (point === "flush-removal" || (point === "remove-intent" && when === "after"))
      expect(outcome.journal.phase).toBe("ROLLBACK_CLOSED");
    else expect(outcome.kind).toBe("inspection-required");
  });
  it("resolves a lost final answer without repeating the terminal write or allowing restoration", async () => {
    const { io, read } = await fixture();
    await advance(io, "checks");
    const lost = {
      ...io,
      async withTurn(run) {
        await io.withTurn(run);
        throw new Error("answer lost");
      },
    };
    await expect(
      transitionAttempt(
        5,
        event("close", {
          checkBinding: check(),
          checksDigest: "4".repeat(64),
          releaseGeneration: "candidate-live",
        }),
        lost,
      ),
    ).rejects.toMatchObject({ reason: "publication-unverified" });
    expect((await read()).journal.phase).toBe("ROLLBACK_CLOSED");
    await expect(
      transitionAttempt(6, event("rollback", { reason: "checks-failed" }), io),
    ).rejects.toMatchObject({ reason: "transition-refused" });
  });
  it.each(["candidate", "restored"])(
    "requires a new admission generation for the %s service",
    async (target) => {
      const { io } = await fixture();
      let journal = await advance(io, "checks");
      if (target === "restored") {
        journal = await transitionAttempt(
          journal.sequence,
          event("rollback", { reason: "candidate-crashed" }),
          io,
        );
        for (const step of ["candidate-stopped", "tree-replaced", "floor-applied", "old-checked"])
          journal = await transitionAttempt(journal.sequence, event("restore-step", { step }), io);
      }
      const data = {
        checkBinding: check(target === "restored" ? "old-tree" : "candidate-tree"),
        releaseGeneration: "generation-1",
        ...(target === "candidate" ? { checksDigest: "4".repeat(64) } : {}),
      };
      await expect(
        transitionAttempt(
          journal.sequence,
          event(target === "candidate" ? "close" : "restored", data),
          io,
        ),
      ).rejects.toMatchObject({ reason: "transition-refused" });
    },
  );
});
