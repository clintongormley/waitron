import {
  digest,
  exactRecord,
  parseHoldAnswer,
  parseVerifiedRelease,
  safeInteger,
} from "./contracts.mjs";
import { setTimeout as nextTurn } from "node:timers/promises";

// A timed-out adapter may still own an external operation. Keep the process's
// discovery slot until it settles, including after returning a deferred result.
let active;

/** @param {object} slot */
function releaseSlot(slot) {
  if (slot.finished && slot.pending === 0) active = undefined;
}

/** @param {Function} operation @param {number} budget @param {object} deps @param {AbortSignal} signal @param {object} slot */
async function bounded(operation, budget, deps, signal, slot) {
  const operationStop = new globalThis.AbortController();
  const timerStop = new globalThis.AbortController();
  const cancel = () => operationStop.abort();
  signal.addEventListener("abort", cancel, { once: true });
  let settled = false;
  const finish = () => {
    settled = true;
    slot.pending--;
    releaseSlot(slot);
  };
  slot.pending++;
  const work = Promise.resolve()
    .then(() => {
      operationStop.signal.throwIfAborted();
      return operation(operationStop.signal);
    })
    .then(
      (value) => {
        finish();
        return value;
      },
      (error) => {
        finish();
        throw error;
      },
    );
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(new Error("discovery-aborted"));
    operationStop.signal.addEventListener("abort", onAbort, { once: true });
  });
  const timeout = Promise.resolve()
    .then(() => deps.sleep(budget, timerStop.signal))
    .then(() => {
      operationStop.abort();
      throw new Error("discovery-deadline");
    });
  if (signal.aborted) cancel();
  try {
    return { ok: true, value: await Promise.race([work, aborted, timeout]) };
  } catch {
    // An async adapter can still be unwinding its abort through promise layers.
    // Yield one timer turn before retaining the slot for unsettled work.
    await nextTurn();
    return { ok: false, settled };
  } finally {
    signal.removeEventListener("abort", cancel);
    operationStop.signal.removeEventListener("abort", onAbort);
    timerStop.abort();
    operationStop.abort();
  }
}

/**
 * No production verifier, hold service, host operation or polling caller is
 * installed here. Those bindings require P-B3/P-HOLD and release qualification.
 * @param {{nowMs:number,installedDigest:string}} input
 * @param {DiscoveryDeps} deps
 * @param {AbortSignal} signal
 */
export async function discoverRelease(input, deps, signal) {
  const validInput =
    exactRecord(input, ["nowMs", "installedDigest"]) &&
    safeInteger(input.nowMs) &&
    digest(input.installedDigest);
  const defer = (reason) => ({
    kind: "deferred",
    reason,
    nextCheckMs:
      validInput && safeInteger(input.nowMs + 86_400_000) ? input.nowMs + 86_400_000 : null,
  });
  if (!validInput || typeof deps.platform !== "string" || !safeInteger(deps.hostProtocol))
    return defer("discovery-input");
  if (signal.aborted) return defer("cancelled");
  if (active) return defer("discovery-busy");
  const slot = { pending: 0, finished: false };
  active = slot;
  let lastClock = input.nowMs;
  const clock = () => {
    const value = deps.now();
    if (!safeInteger(value) || value < lastClock) throw new Error("clock-uncertain");
    lastClock = value;
    return value;
  };
  const retry = async (operation, budget) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) return { ok: false };
      const result = await bounded(operation, budget, deps, signal, slot);
      if (result.ok || !result.settled) return result;
    }
    return { ok: false };
  };
  try {
    clock();
    const fetched = await retry((abort) => deps.fetchManifest(abort), 30_000);
    if (signal.aborted) return defer("cancelled");
    if (!fetched.ok) return defer("manifest-unavailable");
    if (
      !(fetched.value instanceof Uint8Array) ||
      fetched.value.length === 0 ||
      fetched.value.length > 65_536
    )
      return defer("manifest-invalid");
    let verified;
    try {
      verified = deps.verifyManifest(new Uint8Array(fetched.value));
    } catch {
      return defer("manifest-invalid");
    }
    let release;
    try {
      release = parseVerifiedRelease(
        verified,
        input.installedDigest,
        deps.platform,
        deps.hostProtocol,
      );
    } catch {
      return defer("release-incompatible");
    }
    if (!deps.hold) return defer("hold-unknown");
    const checked = await retry((abort) => deps.hold.check(release.releaseDigest, abort), 30_000);
    if (signal.aborted) return defer("cancelled");
    if (!checked.ok) return defer("hold-unknown");
    let hold;
    try {
      hold = parseHoldAnswer(checked.value, release.releaseDigest, clock());
    } catch {
      return defer("hold-unknown");
    }
    if (hold.kind === "held") return defer("release-held");
    for (const imageDigest of release.imageDigests) {
      const pulled = await retry((abort) => deps.pullImage(imageDigest, abort), 600_000);
      if (signal.aborted) return defer("cancelled");
      if (!pulled.ok) return defer("image-unavailable");
      if (pulled.value !== imageDigest) return defer("image-digest");
    }
    try {
      parseHoldAnswer(hold, release.releaseDigest, clock());
    } catch {
      return defer("hold-unknown");
    }
    return { kind: "ready", release, hold };
  } catch {
    return defer("clock-uncertain");
  } finally {
    slot.finished = true;
    releaseSlot(slot);
  }
}

/**
 * @typedef {object} DiscoveryDeps
 * @property {string} platform Trusted host inventory, not a caller-selected target.
 * @property {number} hostProtocol
 * @property {(signal:AbortSignal)=>Promise<Uint8Array>} fetchManifest
 * @property {(bytes:Uint8Array)=>object} verifyManifest Trusted strict signature/key verifier.
 * @property {{check:(digest:string,signal:AbortSignal)=>Promise<object>}|undefined} hold Qualified P-HOLD adapter only.
 * @property {(digest:string,signal:AbortSignal)=>Promise<string>} pullImage
 * @property {()=>number} now
 * @property {(ms:number,signal:AbortSignal)=>Promise<void>} sleep Must cancel its timer on abort.
 */
