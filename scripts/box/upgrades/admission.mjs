import { digest, exactRecord, safeInteger } from "./contracts.mjs";
import { isVerifiedAttemptRead, phaseElapsed } from "./journal.mjs";

const token = (value) =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const observationKeys = [
  "diskUuid",
  "layoutDigest",
  "nodeId",
  "term",
  "membershipDigest",
  "activeTreeId",
  "releaseDigest",
  "bootNonce",
  "schemaDigest",
  "clock",
  "containment",
  "allWritersStopped",
  "oldStateIntact",
  "captureVerified",
  "closure",
  "candidate",
  "checksFailed",
];

function validObservation(value) {
  if (!exactRecord(value, observationKeys)) return false;
  for (const key of ["diskUuid", "nodeId", "activeTreeId", "bootNonce"])
    if (!token(value[key])) return false;
  for (const key of ["layoutDigest", "membershipDigest", "releaseDigest", "schemaDigest"])
    if (!digest(value[key])) return false;
  for (const key of [
    "containment",
    "allWritersStopped",
    "oldStateIntact",
    "captureVerified",
    "checksFailed",
  ])
    if (typeof value[key] !== "boolean") return false;
  const clock = value.clock;
  return (
    safeInteger(value.term) &&
    ["absent", "uncertain"].includes(value.closure) &&
    ["never-started", "running", "stopped", "crashed"].includes(value.candidate) &&
    exactRecord(clock, ["bootId", "utcMs", "steadyMs", "reliableUtc", "suspendAware"]) &&
    token(clock.bootId) &&
    safeInteger(clock.utcMs) &&
    safeInteger(clock.steadyMs) &&
    typeof clock.reliableUtc === "boolean" &&
    typeof clock.suspendAware === "boolean"
  );
}

/** Decisions request further checks or journal transitions; none grants trading. */
export function decideStartup(read, observed) {
  const decision = (kind, reason, extra = {}) => ({
    kind,
    reason,
    requiresStartupChecks: true,
    ...extra,
  });
  const inspect = (reason) => decision("inspect", reason);
  if (!isVerifiedAttemptRead(read) || !validObservation(observed))
    return inspect("evidence-unverified");
  const binding = read.kind === "idle" ? read.layout : read.journal.binding;
  if (binding.diskUuid !== observed.diskUuid || binding.layoutDigest !== observed.layoutDigest)
    return inspect("layout-mismatch");
  if (read.kind === "idle") return decision("start-current", "verified-idle");
  const journal = read.journal;
  if (
    binding.nodeId !== observed.nodeId ||
    binding.term !== observed.term ||
    binding.membershipDigest !== observed.membershipDigest
  )
    return inspect("membership-changed");
  const oldTree =
    observed.activeTreeId === journal.oldTreeId &&
    observed.releaseDigest === binding.oldReleaseDigest;
  const candidateTree =
    observed.activeTreeId === journal.checkBinding?.activeTreeId &&
    observed.releaseDigest === binding.candidateReleaseDigest;
  if (["ROLLBACK_CLOSED", "LIVE", "RESTORED"].includes(journal.phase)) {
    const restored = journal.phase === "RESTORED";
    if (!(restored ? oldTree : candidateTree)) return inspect("tree-mismatch");
    return decision("start-current", restored ? "restored" : "rollback-closed", {
      generation: journal.releaseGeneration,
    });
  }
  if (journal.phase === "PREPARED" || journal.phase === "FREEZING") {
    if (!oldTree || !observed.oldStateIntact || observed.candidate !== "never-started")
      return inspect("old-state-uncertain");
    if (journal.phase === "PREPARED") return decision("keep-serving-old", "prepared");
    return observed.allWritersStopped
      ? decision("start-current", "intact-old")
      : inspect("writers-uncertain");
  }
  if (!observed.captureVerified || !observed.containment || observed.closure !== "absent")
    return inspect("rollback-uncertain");
  if (journal.phase === "ROLLBACK_INTENT")
    return observed.allWritersStopped
      ? decision("resume-restore", "recorded-rollback", { recordIntent: false })
      : inspect("writers-uncertain");
  const rollback = (reason) => decision("resume-restore", reason, { recordIntent: true });
  const elapsed = phaseElapsed(journal, observed.clock);
  if (elapsed === null) return rollback("clock-unavailable");
  if (
    elapsed >= journal.phaseDeadlineUtcMs - journal.phaseStartedUtcMs ||
    (observed.clock.reliableUtc && observed.clock.utcMs >= journal.phaseDeadlineUtcMs)
  )
    return rollback("budget-exhausted");
  if (journal.phase === "SNAPSHOT_READY") {
    if (!oldTree || !observed.allWritersStopped || observed.candidate !== "never-started")
      return inspect("snapshot-start-uncertain");
    return decision("validate", "launch-candidate");
  }
  if (observed.candidate === "crashed") return rollback("candidate-crashed");
  if (observed.checksFailed) return rollback("checks-failed");
  if (
    !candidateTree ||
    observed.candidate !== "running" ||
    observed.bootNonce !== journal.checkBinding.bootNonce ||
    observed.schemaDigest !== journal.checkBinding.schemaDigest ||
    observed.clock.bootId !== journal.startedBootId
  )
    return inspect("process-binding");
  return decision("validate", "rerun-checks");
}
