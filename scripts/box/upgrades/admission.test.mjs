import { describe, expect, it } from "vitest";
import { readAttempt, transitionAttempt } from "./journal.mjs";
import { decideStartup } from "./admission.mjs";

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
const observation = () => ({
  diskUuid: "disk-1",
  layoutDigest: "a".repeat(64),
  nodeId: "node-1",
  term: 2,
  membershipDigest: "d".repeat(64),
  activeTreeId: "candidate-tree",
  releaseDigest: "c".repeat(64),
  bootNonce: "nonce-1",
  schemaDigest: "f".repeat(64),
  clock: clock(2000, 1100),
  containment: true,
  allWritersStopped: true,
  oldStateIntact: true,
  captureVerified: true,
  closure: "absent",
  candidate: "running",
  checksFailed: false,
});

async function state(phase, changes = {}) {
  const root = "/qualified/host";
  const layout = {
    version: 1,
    diskUuid: "disk-1",
    layoutDigest: "a".repeat(64),
    rootId: "mount:inode",
  };
  const files = new Map([["layout.json", JSON.stringify(layout) + "\n"]]);
  const io = {
    hostRoot: root,
    diskUuid: "disk-1",
    inspectRoot: async () => ({
      hostRoot: root,
      diskUuid: layout.diskUuid,
      layoutDigest: layout.layoutDigest,
      rootId: layout.rootId,
    }),
    withTurn: (run) => run(),
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    async create(name, bytes) {
      if (files.has(name)) throw new Error("exists");
      files.set(name, bytes);
    },
    sync: async () => {},
    syncDirectory: async () => {},
    remove: async (name) => {
      files.delete(name);
    },
    async rename(from, to) {
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
  let journal;
  for (const [type, data] of [
    [
      "prepare",
      {
        oldTreeId: "old-tree",
        inputsDigest: "1".repeat(64),
        floorDigest: "2".repeat(64),
        publicationDigest: "3".repeat(64),
      },
    ],
    ["freeze", {}],
    ["capture", { captureId: "snapshot-1" }],
    ["validate", { checkBinding: check() }],
    ["checks", { checkBinding: check(), checksDigest: "4".repeat(64) }],
    ...(phase === "ROLLBACK_INTENT" || phase === "RESTORED"
      ? [
          ["rollback", { reason: "checks-failed" }],
          ...["candidate-stopped", "tree-replaced", "floor-applied", "old-checked"].map((step) => [
            "restore-step",
            { step },
          ]),
          ["restored", { checkBinding: check("old-tree"), releaseGeneration: "old-live" }],
        ]
      : [
          [
            "close",
            {
              checkBinding: check(),
              checksDigest: "4".repeat(64),
              releaseGeneration: "candidate-live",
            },
          ],
          ["release", { checkBinding: check(), releaseGeneration: "candidate-live" }],
        ]),
  ]) {
    if (phase === "IDLE") break;
    journal = await transitionAttempt(
      journal?.sequence ?? 0,
      { type, binding: binding(), clock: clock(), data },
      io,
    );
    if (journal.phase === phase && type !== "checks") break;
  }
  return {
    read: await readAttempt(root, "disk-1", io),
    observed: { ...observation(), ...changes },
  };
}
const old = { activeTreeId: "old-tree", releaseDigest: "b".repeat(64), candidate: "never-started" };

describe("startup decisions from verified attempt evidence", () => {
  it.each([
    ["IDLE", old, "start-current", "verified-idle"],
    ["PREPARED", old, "keep-serving-old", "prepared"],
    ["FREEZING", old, "start-current", "intact-old"],
    ["SNAPSHOT_READY", { ...old, candidate: "never-started" }, "validate", "launch-candidate"],
    ["VALIDATING", {}, "validate", "rerun-checks"],
    ["ROLLBACK_CLOSED", {}, "start-current", "rollback-closed"],
    ["LIVE", {}, "start-current", "rollback-closed"],
    ["ROLLBACK_INTENT", { candidate: "stopped" }, "resume-restore", "recorded-rollback"],
    ["RESTORED", { ...old, candidate: "stopped" }, "start-current", "restored"],
  ])(
    "design6 %s preserves its required recovery outcome",
    async (phase, observed, kind, reason) => {
      const result = await state(phase, observed);
      expect(decideStartup(result.read, result.observed)).toMatchObject({
        kind,
        reason,
        requiresStartupChecks: true,
      });
      expect(decideStartup(result.read, result.observed)).not.toHaveProperty("permit");
    },
  );
  it.each([
    null,
    {},
    { kind: "verified", journal: {} },
    { kind: "idle", layout: {} },
    { kind: "inspection-required", reason: "journal-unavailable" },
  ])("never admits unknown, forged or unavailable evidence %#", (read) => {
    expect(decideStartup(read, observation()).kind).toBe("inspect");
  });
  it("cannot mutate a verified read into a forged terminal phase", async () => {
    const { read } = await state("VALIDATING");
    expect(() => {
      read.journal.phase = "ROLLBACK_CLOSED";
    }).toThrow(TypeError);
    expect(decideStartup(JSON.parse(JSON.stringify(read)), observation()).kind).toBe("inspect");
  });
  it.each([
    { diskUuid: "disk-2" },
    { layoutDigest: "0".repeat(64) },
    { nodeId: "node-2" },
    { term: 3 },
    { term: 1 },
    { membershipDigest: "0".repeat(64) },
    { unknown: true },
    { bootNonce: "../wrong" },
    { releaseDigest: "wrong" },
    { containment: "true" },
    { clock: null },
  ])("holds changed disk, mount, authority or malformed observation %#", async (change) => {
    const { read, observed } = await state("VALIDATING", change);
    expect(decideStartup(read, observed).kind).toBe("inspect");
  });
  it.each(["PREPARED", "FREEZING"])(
    "%s never replaces an old app that may still serve",
    async (phase) => {
      for (const change of [
        { candidate: "running" },
        { oldStateIntact: false },
        { activeTreeId: "other-tree" },
        { releaseDigest: "0".repeat(64) },
      ]) {
        const { read, observed } = await state(phase, { ...old, ...change });
        expect(decideStartup(read, observed).kind).toBe("inspect");
      }
    },
  );
  it.each(["FREEZING", "SNAPSHOT_READY", "ROLLBACK_INTENT"])(
    "%s keeps uncertain writers stopped",
    async (phase) => {
      const { read, observed } = await state(phase, { ...old, allWritersStopped: false });
      expect(decideStartup(read, observed).kind).toBe("inspect");
    },
  );
  it.each(["SNAPSHOT_READY", "VALIDATING", "ROLLBACK_INTENT"])(
    "%s requires complete retained capture and containment",
    async (phase) => {
      for (const change of [
        { captureVerified: false },
        { containment: false },
        { closure: "uncertain" },
      ]) {
        const { read, observed } = await state(phase, change);
        expect(decideStartup(read, observed).kind).toBe("inspect");
      }
    },
  );
  it.each([
    [{ candidate: "crashed" }, "candidate-crashed"],
    [{ checksFailed: true }, "checks-failed"],
    [{ clock: clock(301000, 300100) }, "budget-exhausted"],
    [{ clock: { ...clock(2000, 100), bootId: "boot-2", reliableUtc: false } }, "clock-unavailable"],
  ])("chooses only recorded rollback after failed validation %#", async (changes, reason) => {
    const { read, observed } = await state("VALIDATING", changes);
    expect(decideStartup(read, observed)).toMatchObject({
      kind: "resume-restore",
      reason,
      recordIntent: true,
      requiresStartupChecks: true,
    });
    expect(read.journal.phase).toBe("VALIDATING");
  });
  it.each(["ROLLBACK_CLOSED", "LIVE", "RESTORED"])(
    "%s preserves current work after lost release or clock failure",
    async (phase) => {
      const { read, observed } = await state(phase, {
        ...(phase === "RESTORED" ? old : {}),
        bootNonce: "new-nonce",
        clock: { ...clock(), bootId: "boot-2", reliableUtc: false },
        closure: "uncertain",
        captureVerified: false,
      });
      expect(decideStartup(read, observed).kind).toBe("start-current");
      expect(decideStartup(read, { ...observed, activeTreeId: "different-tree" }).kind).toBe(
        "inspect",
      );
    },
  );
  it.each([
    { bootNonce: "stale-nonce" },
    { schemaDigest: "0".repeat(64) },
    { activeTreeId: "stale-tree" },
    { candidate: "stopped" },
  ])("does not reuse another process or tree's checks %#", async (changes) => {
    const { read, observed } = await state("VALIDATING", changes);
    expect(decideStartup(read, observed).kind).toBe("inspect");
  });
  it.each([
    [clock(500, 1100), "validate"],
    [clock(301000, 1100), "resume-restore"],
    [clock(2000, 300100), "resume-restore"],
    [{ ...clock(2000, 999999999), bootId: "boot-2" }, "inspect"],
    [{ ...clock(500, 100), bootId: "boot-2" }, "resume-restore"],
    [{ ...clock(2000, 1100), suspendAware: false }, "resume-restore"],
  ])("does not extend validation across suspend, reboot or clock jumps %#", async (time, kind) => {
    const { read, observed } = await state("VALIDATING", { clock: time });
    expect(decideStartup(read, observed).kind).toBe(kind);
  });
});
