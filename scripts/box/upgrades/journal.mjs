import { createHash } from "node:crypto";
import { digest, exactRecord, policyError, safeInteger } from "./contracts.mjs";

const bindingKeys = [
  "attemptId",
  "diskUuid",
  "layoutDigest",
  "oldReleaseDigest",
  "candidateReleaseDigest",
  "nodeId",
  "term",
  "membershipDigest",
  "occurrenceId",
  "episodeId",
  "dailyAllowanceKey",
  "windowRevision",
  "admissionGeneration",
  "inventoryDigest",
];
const checkKeys = ["bootNonce", "activeTreeId", "schemaDigest"];
const dataKeys = {
  prepare: ["oldTreeId", "inputsDigest", "floorDigest", "publicationDigest"],
  freeze: [],
  capture: ["captureId"],
  validate: ["checkBinding"],
  checks: ["checkBinding", "checksDigest"],
  close: ["checkBinding", "checksDigest", "releaseGeneration"],
  release: ["checkBinding", "releaseGeneration"],
  rollback: ["reason"],
  "restore-step": ["step"],
  restored: ["checkBinding", "releaseGeneration"],
  cleanup: [],
};
const restoreSteps = ["candidate-stopped", "tree-replaced", "floor-applied", "old-checked"];
const token = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = (value) => JSON.stringify(value) + "\n";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const failure = (reason) => policyError(reason, "upgrade.invalid_journal");
const inspect = (reason) => ({ kind: "inspection-required", reason });
const fileName = (sequence) => String(sequence).padStart(16, "0") + ".json";
const verifiedReads = new WeakSet();

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function isVerifiedAttemptRead(value) {
  return verifiedReads.has(value);
}

function parse(bytesIn) {
  const value = JSON.parse(bytesIn);
  if (bytes(value) !== bytesIn) throw failure("journal-invalid");
  return value;
}

function parseBinding(value) {
  if (
    !exactRecord(value, bindingKeys) ||
    bindingKeys.some((key) => {
      if (["term", "windowRevision"].includes(key)) return !safeInteger(value[key]);
      return !(key.endsWith("Digest") ? digest(value[key]) : token(value[key]));
    }) ||
    value.oldReleaseDigest === value.candidateReleaseDigest
  )
    throw failure("event-invalid");
  return Object.fromEntries(bindingKeys.map((key) => [key, value[key]]));
}

function parseCheck(value) {
  if (
    !exactRecord(value, checkKeys) ||
    !token(value.bootNonce) ||
    !token(value.activeTreeId) ||
    !digest(value.schemaDigest)
  )
    throw failure("event-invalid");
  return Object.fromEntries(checkKeys.map((key) => [key, value[key]]));
}

function parseEvent(value) {
  if (
    !exactRecord(value, ["type", "binding", "clock", "data"]) ||
    !Object.hasOwn(dataKeys, value.type) ||
    !exactRecord(value.data, dataKeys[value.type])
  )
    throw failure("event-invalid");
  const clock = value.clock;
  if (
    !exactRecord(clock, ["bootId", "utcMs", "steadyMs", "reliableUtc", "suspendAware"]) ||
    !token(clock.bootId) ||
    !safeInteger(clock.utcMs) ||
    !safeInteger(clock.steadyMs) ||
    typeof clock.reliableUtc !== "boolean" ||
    clock.suspendAware !== true
  )
    throw failure("clock-unavailable");
  const data = Object.fromEntries(dataKeys[value.type].map((key) => [key, value.data[key]]));
  for (const [key, item] of Object.entries(data)) {
    if (key === "checkBinding") data[key] = parseCheck(item);
    else if (!(key.endsWith("Digest") ? digest(item) : token(item))) throw failure("event-invalid");
  }
  if (
    value.type === "rollback" &&
    !["checks-failed", "candidate-crashed", "budget-exhausted", "administrator-return"].includes(
      data.reason,
    )
  )
    throw failure("event-invalid");
  return { type: value.type, binding: parseBinding(value.binding), clock: { ...clock }, data };
}

/** Suspend-aware steady readings are comparable only within their originating boot. */
export function phaseElapsed(journal, clock) {
  if (clock.suspendAware !== true) return null;
  if (clock.bootId === journal.startedBootId) {
    if (!safeInteger(clock.steadyMs) || clock.steadyMs < journal.bootMonotonicStartMs) return null;
    const elapsed = clock.steadyMs - journal.bootMonotonicStartMs;
    return elapsed < journal.elapsedMsAtCheckpoint ? null : elapsed;
  }
  if (
    clock.reliableUtc !== true ||
    !safeInteger(clock.utcMs) ||
    clock.utcMs < journal.phaseStartedUtcMs + journal.elapsedMsAtCheckpoint
  )
    return null;
  return clock.utcMs - journal.phaseStartedUtcMs;
}

function beginPhase(journal, phase, clock, budget) {
  if (!safeInteger(clock.utcMs + budget)) throw failure("clock-unavailable");
  return {
    ...journal,
    phase,
    phaseStartedUtcMs: clock.utcMs,
    phaseDeadlineUtcMs: clock.utcMs + budget,
    startedBootId: clock.bootId,
    bootMonotonicStartMs: clock.steadyMs,
    elapsedMsAtCheckpoint: 0,
  };
}

function derive(previous, event) {
  const { type, binding, clock, data } = event;
  if (previous === null) {
    if (type !== "prepare") throw failure("transition-refused");
    return beginPhase(
      {
        version: 1,
        binding,
        sequence: 1,
        oldTreeId: data.oldTreeId,
        inputsDigest: data.inputsDigest,
        floorDigest: data.floorDigest,
        publicationDigest: data.publicationDigest,
        captureId: null,
        checkBinding: null,
        checkedBootId: null,
        checksDigest: null,
        releaseGeneration: null,
        restoreSteps: [],
        outcome: "pending",
      },
      "PREPARED",
      clock,
      0,
    );
  }
  if (!same(binding, previous.binding) || previous.sequence === Number.MAX_SAFE_INTEGER)
    throw failure("binding-conflict");
  let next = { ...previous, sequence: previous.sequence + 1 };
  const phase = previous.phase;
  const elapsed = phaseElapsed(previous, clock);
  if (type === "freeze" && phase === "PREPARED")
    return beginPhase(next, "FREEZING", clock, 120_000);
  if (type === "rollback" && ["SNAPSHOT_READY", "VALIDATING"].includes(phase))
    return beginPhase({ ...next, outcome: data.reason }, "ROLLBACK_INTENT", clock, 300_000);
  if (
    type === "release" &&
    ["ROLLBACK_CLOSED", "RESTORED"].includes(phase) &&
    data.releaseGeneration === previous.releaseGeneration &&
    same(data.checkBinding, previous.checkBinding) &&
    clock.bootId === previous.checkedBootId &&
    previous.outcome !== "released" &&
    previous.outcome !== "cleanup-complete"
  )
    return {
      ...next,
      phase: phase === "ROLLBACK_CLOSED" ? "LIVE" : "RESTORED",
      outcome: "released",
    };
  if (type === "cleanup" && ["LIVE", "RESTORED"].includes(phase) && previous.outcome === "released")
    return { ...next, outcome: "cleanup-complete" };
  if (!["capture", "validate", "checks", "close", "restore-step", "restored"].includes(type))
    throw failure("transition-refused");
  if (
    elapsed === null ||
    elapsed >= previous.phaseDeadlineUtcMs - previous.phaseStartedUtcMs ||
    (clock.reliableUtc && clock.utcMs >= previous.phaseDeadlineUtcMs)
  )
    throw failure("phase-budget");
  next.elapsedMsAtCheckpoint = elapsed;
  if (type === "capture" && phase === "FREEZING")
    return { ...next, phase: "SNAPSHOT_READY", captureId: data.captureId };
  if (
    type === "validate" &&
    phase === "SNAPSHOT_READY" &&
    data.checkBinding.activeTreeId !== previous.oldTreeId
  )
    return beginPhase(
      { ...next, checkBinding: data.checkBinding, checkedBootId: clock.bootId },
      "VALIDATING",
      clock,
      300_000,
    );
  if (
    type === "checks" &&
    phase === "VALIDATING" &&
    clock.bootId === previous.checkedBootId &&
    same(data.checkBinding, previous.checkBinding)
  )
    return { ...next, checksDigest: data.checksDigest };
  if (
    type === "close" &&
    phase === "VALIDATING" &&
    clock.bootId === previous.checkedBootId &&
    same(data.checkBinding, previous.checkBinding) &&
    data.checksDigest === previous.checksDigest &&
    previous.checksDigest !== null &&
    data.releaseGeneration !== binding.admissionGeneration
  )
    return { ...next, phase: "ROLLBACK_CLOSED", releaseGeneration: data.releaseGeneration };
  if (
    type === "restore-step" &&
    phase === "ROLLBACK_INTENT" &&
    data.step === restoreSteps[previous.restoreSteps.length]
  ) {
    next = { ...next, restoreSteps: [...previous.restoreSteps, data.step] };
    return data.step === "floor-applied"
      ? beginPhase(next, "ROLLBACK_INTENT", clock, 300_000)
      : next;
  }
  if (
    type === "restored" &&
    phase === "ROLLBACK_INTENT" &&
    previous.restoreSteps.length === restoreSteps.length &&
    data.checkBinding.activeTreeId === previous.oldTreeId &&
    data.releaseGeneration !== binding.admissionGeneration
  )
    return {
      ...next,
      phase: "RESTORED",
      checkBinding: data.checkBinding,
      checkedBootId: clock.bootId,
      releaseGeneration: data.releaseGeneration,
    };
  throw failure("transition-refused");
}

async function readUnlocked(hostRoot, diskUuid, io, publishing = false) {
  const observed = await io.inspectRoot();
  if (
    hostRoot !== io.hostRoot ||
    diskUuid !== io.diskUuid ||
    !exactRecord(observed, ["hostRoot", "diskUuid", "layoutDigest", "rootId"]) ||
    observed.hostRoot !== hostRoot ||
    observed.diskUuid !== diskUuid ||
    !digest(observed.layoutDigest) ||
    typeof observed.rootId !== "string" ||
    observed.rootId.length === 0
  )
    throw failure("layout-mismatch");
  const layout = parse(await io.read("layout.json"));
  if (
    !exactRecord(layout, ["version", "diskUuid", "layoutDigest", "rootId", "attemptId"]) ||
    layout.version !== 1 ||
    layout.diskUuid !== diskUuid ||
    layout.layoutDigest !== observed.layoutDigest ||
    layout.rootId !== observed.rootId ||
    !(layout.attemptId === null || token(layout.attemptId))
  )
    throw failure("layout-mismatch");
  const names = await io.list();
  if (
    names.some(
      (name) =>
        !(publishing && name === ".publishing") &&
        !["layout.json", "attempt.json", "head.json", ".turn"].includes(name) &&
        !/^\d{16}\.json$/.test(name),
    )
  )
    throw failure("publication-uncertain");
  const markerBytes = await io.read("attempt.json");
  const headBytes = await io.read("head.json");
  const records = names.filter((name) => /^\d{16}\.json$/.test(name)).sort();
  if (markerBytes === null && headBytes === null && records.length === 0) {
    if (layout.attemptId !== null) throw failure("journal-invalid");
    return { kind: "idle", layout };
  }
  const marker = parse(markerBytes);
  if (!exactRecord(marker, ["binding"])) throw failure("journal-invalid");
  const binding = parseBinding(marker.binding);
  if (
    binding.diskUuid !== diskUuid ||
    binding.layoutDigest !== layout.layoutDigest ||
    binding.attemptId !== layout.attemptId
  )
    throw failure("layout-mismatch");
  const head = parse(headBytes);
  if (
    !exactRecord(head, ["sequence", "digest"]) ||
    !safeInteger(head.sequence) ||
    head.sequence === 0 ||
    head.sequence !== records.length ||
    !digest(head.digest)
  )
    throw failure("journal-invalid");
  let journal = null;
  let previousDigest = null;
  for (let index = 0; index < records.length; index++) {
    if (records[index] !== fileName(index + 1)) throw failure("journal-invalid");
    const record = parse(await io.read(records[index]));
    if (!exactRecord(record, ["event", "journal", "previousDigest", "digest"]))
      throw failure("journal-invalid");
    const value = {
      event: record.event,
      journal: record.journal,
      previousDigest: record.previousDigest,
    };
    if (record.previousDigest !== previousDigest || record.digest !== hash(value))
      throw failure("journal-invalid");
    const input = parseEvent(record.event);
    if (!same(input.binding, binding)) throw failure("binding-conflict");
    journal = derive(journal, input);
    if (!same(record.journal, journal)) throw failure("journal-invalid");
    previousDigest = record.digest;
  }
  if (head.digest !== previousDigest) throw failure("journal-invalid");
  return { kind: "verified", journal };
}

/**
 * JournalIo is a trusted fixed-root, no-follow IO boundary with an exclusive host
 * turn. No production adapter is supplied until B3's host/layout qualification.
 */
export async function readAttempt(hostRoot, diskUuid, io) {
  if (io === undefined) return inspect("layout-unqualified");
  try {
    const result = freeze(await io.withTurn(() => readUnlocked(hostRoot, diskUuid, io)));
    verifiedReads.add(result);
    return result;
  } catch {
    return inspect("journal-unavailable");
  }
}

async function publish(name, temporary, value, io) {
  const encoded = bytes(value);
  await io.create(temporary, encoded);
  await io.sync(temporary);
  await io.rename(temporary, name);
  await io.syncDirectory();
  if ((await io.read(name)) !== encoded) throw failure("publication-unverified");
}

export async function transitionAttempt(expectedSequence, value, io) {
  const event = parseEvent(value);
  if (!safeInteger(expectedSequence)) throw failure("sequence-conflict");
  try {
    return await io.withTurn(async () => {
      const read = await readUnlocked(io.hostRoot, io.diskUuid, io);
      const previous = read.kind === "idle" ? null : read.journal;
      if ((previous?.sequence ?? 0) !== expectedSequence) throw failure("sequence-conflict");
      if (
        event.binding.diskUuid !== io.diskUuid ||
        event.binding.layoutDigest !==
          (read.kind === "idle" ? read.layout.layoutDigest : previous.binding.layoutDigest)
      )
        throw failure("binding-conflict");
      const journal = derive(previous, event);
      await io.create(".publishing", bytes({ sequence: journal.sequence }));
      await io.sync(".publishing");
      await io.syncDirectory();
      if (previous === null) {
        await publish(
          "layout.json",
          ".layout-pending",
          { ...read.layout, attemptId: event.binding.attemptId },
          io,
        );
        await io.create("attempt.json", bytes({ binding: event.binding }));
        await io.sync("attempt.json");
        await io.syncDirectory();
      }
      const oldHead = previous === null ? null : parse(await io.read("head.json"));
      const content = { event, journal, previousDigest: oldHead === null ? null : oldHead.digest };
      const record = { ...content, digest: hash(content) };
      await publish(fileName(journal.sequence), ".pending", record, io);
      await publish(
        "head.json",
        ".head-pending",
        { sequence: journal.sequence, digest: record.digest },
        io,
      );
      const verified = await readUnlocked(io.hostRoot, io.diskUuid, io, true);
      if (verified.kind !== "verified" || !same(verified.journal, journal))
        throw failure("publication-unverified");
      await io.remove(".publishing");
      await io.syncDirectory();
      return journal;
    });
  } catch (error) {
    if (error?.code === "upgrade.invalid_journal") throw error;
    throw failure("publication-unverified");
  }
}
