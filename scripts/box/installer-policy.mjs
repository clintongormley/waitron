import { classifyDisk } from "./disk-state.mjs";
import { CONTROL_CHARACTERS, usableVenueName } from "./name-tag.mjs";
import { exactRecord, safeInteger } from "./upgrades/contracts.mjs";

/** Spec §5.1 guard 3, §5.2 and §5.3 item 4. The spec's calls, not separately the owner's. */
export const INSTALLER_TIMINGS_MS = Object.freeze({
  waitronStart: 15_000,
  reinstallIdle: 120_000,
  eraseWait: 60_000,
  retry: 60_000,
});

/**
 * @typedef {{ name: string, live: boolean }} VenueTag  decoded from the frozen internal disk's name tag (spec §7.6)
 * @typedef {'observing'|'refused'|'waitron-found'|'reinstall-screen'|'awaiting-erase-word'|'loading'|'network'
 *   |'clock'|'clock-retry'|'downloading'|'download-retry'|'erase-countdown'|'erase-stopped'|'writing'
 *   |'remove-usb'|'booting'|'powering-off'} InstallerPhase
 * @typedef {object} InstallerState  frozen; only states this module made are accepted
 * @property {InstallerPhase} phase
 * @property {number} atMs  the last event's time
 * @property {number} clockFloorMs
 * @property {string} eraseWord  the word that confirms an erase when no venue name can be typed; its value comes from the Linux pull request's translation file
 * @property {boolean} ramReady
 * @property {boolean} usbPresent
 * @property {null|{diskId:string, kind:'waitron'|'recognised-other'|'unknown', recognised:'blank'|'windows'|'bitlocker'|null,
 *   layoutVersion:number|null, hardware:'no-tpm'|'secure-boot-off'|null, attachmentUnclear:boolean, venueTag:VenueTag|null}} target
 * @property {null|'unattended'|'typed'} confirmed
 * @property {boolean} clockSet
 * @property {number} requestId  the last find-network, set-clock or download issued; 0 before the first
 * @property {number|null} deadlineMs
 * @property {null|{reason:string, hardware:'no-tpm'|'secure-boot-off'|null, releaseVersion:string|null}} refusal
 * @property {{key:string, params:object}} message  the last message, repeated by final phases
 * @typedef {'wait'|'find-network'|'set-clock'|'download'|'confirm-erase'|'write-owned-target'|'boot-installed'|'power-off'|'refuse'} InstallerAction
 * @typedef {object} InstallerDecision  frozen
 * @property {InstallerAction} action
 * @property {string|null} diskId  the frozen target's id for write-owned-target and boot-installed; null otherwise
 * @property {number|null} requestId  a new identifier for find-network, set-clock and download; null otherwise.
 *   Their results (online, clock-set, release-checked) must carry it back; a result carrying another stops the run with sequence-invalid.
 * @property {{key:string, params:object}} message  frozen
 * @property {number|null} deadlineMs  on atMs's clock
 * @property {InstallerState} state
 */

const FINAL_PHASES = ["refused", "booting", "powering-off"];
const ADAPTER_PHASES = Object.freeze({
  observed: "observing",
  online: "network",
  "clock-set": "clock",
  "release-checked": "downloading",
  "write-finished": "writing",
});
const REQUESTS = ["find-network", "set-clock", "download"];
const BARE_KINDS = ["ram-ready", "usb-removed", "usb-inserted", "key", "tick"];
const RELEASE_OUTCOMES = [
  "verified",
  "unavailable",
  "truncated",
  "signature",
  "checksum",
  "too-large",
  "installer-too-old",
];
const MAX_TYPED_UNITS = 512;
const PRINTABLE_ASCII = /^[\x20-\x7E]{1,32}$/;

/** @type {WeakSet<object>} */
const GENUINE = new WeakSet();

/** @param {string} code @param {string} reason */
function refusal(code, reason) {
  return Object.assign(new Error(code), { code, reason });
}
const eventInvalid = (reason = "event-invalid") => refusal("installer.event_invalid", reason);

/** @param {unknown} value @param {number} maxCodePoints */
function usableText(value, maxCodePoints) {
  if (typeof value !== "string" || !value.isWellFormed() || CONTROL_CHARACTERS.test(value))
    return false;
  const length = [...value].length;
  return length >= 1 && length <= maxCodePoints;
}

/** @param {unknown} state */
function genuine(state) {
  if (state === null || typeof state !== "object" || !GENUINE.has(state))
    throw refusal("installer.state_invalid", "state-invalid");
}

/** @param {string} key @param {object} [params] */
function message(key, params = {}) {
  return Object.freeze({ key, params: Object.freeze({ ...params }) });
}

/** @param {object} fields @returns {InstallerState} */
function makeState(fields) {
  const state = Object.freeze({ ...fields });
  GENUINE.add(state);
  return state;
}

/** @param {unknown} options @returns {InstallerState} */
export function createInstallerState(options) {
  if (
    !exactRecord(options, ["atMs", "clockFloorMs", "eraseWord"]) ||
    !safeInteger(options.atMs) ||
    !safeInteger(options.clockFloorMs) ||
    !usableText(options.eraseWord, 32)
  )
    throw refusal("installer.options_invalid", "options-invalid");
  return makeState({
    phase: "observing",
    atMs: options.atMs,
    clockFloorMs: options.clockFloorMs,
    eraseWord: options.eraseWord,
    ramReady: false,
    usbPresent: true,
    target: null,
    confirmed: null,
    clockSet: false,
    requestId: 0,
    deadlineMs: null,
    refusal: null,
    message: message("installer.starting"),
  });
}

/** @param {any} event */
function checkEvent(event) {
  const { kind } = event ?? {};
  const keys = (/** @type {string[]} */ ...rest) => exactRecord(event, ["kind", "atMs", ...rest]);
  const answer = (/** @type {string[]} */ ...rest) =>
    keys("requestId", ...rest) && safeInteger(event.requestId);
  let ok;
  if (BARE_KINDS.includes(kind)) ok = keys();
  else if (kind === "online") ok = answer();
  else if (kind === "observed")
    ok =
      keys("observation", "venueTag") &&
      (event.venueTag === null ||
        (exactRecord(event.venueTag, ["name", "live"]) &&
          typeof event.venueTag.name === "string" &&
          typeof event.venueTag.live === "boolean"));
  else if (kind === "submit") ok = keys("text") && typeof event.text === "string";
  else if (kind === "choice")
    ok = keys("choice") && ["install-now", "power-off"].includes(event.choice);
  else if (kind === "clock-set")
    ok =
      answer("ok", "utcMs") &&
      typeof event.ok === "boolean" &&
      (event.ok ? safeInteger(event.utcMs) : event.utcMs === null);
  else if (kind === "release-checked")
    ok =
      answer("outcome", "releaseVersion") &&
      RELEASE_OUTCOMES.includes(event.outcome) &&
      (event.outcome === "installer-too-old"
        ? typeof event.releaseVersion === "string" && PRINTABLE_ASCII.test(event.releaseVersion)
        : event.releaseVersion === null);
  else if (kind === "write-finished") ok = keys("ok") && typeof event.ok === "boolean";
  else ok = false;
  if (!ok || !safeInteger(event.atMs)) throw eventInvalid();
}

/**
 * @param {InstallerState} state @param {string} action @param {object} [changes]
 * @returns {InstallerDecision}
 */
function decide(state, action, changes = {}) {
  const asks = REQUESTS.includes(action);
  const next = makeState({ ...state, ...changes, ...(asks && { requestId: state.requestId + 1 }) });
  return Object.freeze({
    action,
    diskId: null,
    requestId: asks ? next.requestId : null,
    message: next.message,
    deadlineMs: next.deadlineMs,
    state: next,
  });
}

/**
 * @param {InstallerState} state @param {string} reason @param {string|null} hardware
 * @param {string|null} [releaseVersion]
 */
function refuse(state, reason, hardware, releaseVersion = null) {
  const details = { reason, hardware, releaseVersion };
  return decide(state, "refuse", {
    phase: "refused",
    deadlineMs: null,
    refusal: Object.freeze(details),
    message: message("installer.refused", details),
  });
}

/** @param {{name: string, live: boolean}|null} tag @returns {VenueTag|null} */
function usableTag(tag) {
  if (tag === null) return null;
  const name = usableVenueName(tag.name);
  return name === null ? null : Object.freeze({ name, live: tag.live });
}

/** @param {InstallerState} state @param {any} event */
function observe(state, event) {
  const venueTag = usableTag(event.venueTag);
  let classification;
  try {
    classification = classifyDisk(event.observation);
  } catch {
    return refuse(state, "observation-invalid", null);
  }
  const { kind, diskId, hardware, layoutVersion, recognised } = classification;
  if (kind === "none") return refuse(state, "disk-none", hardware);
  if (kind === "multiple") return refuse(state, "disk-multiple", hardware);
  const disk = event.observation.disks.find((/** @type {any} */ d) => d.diskId === diskId);
  const attachmentUnclear = disk.attachment === "unknown";
  const target = Object.freeze({
    diskId,
    kind,
    recognised,
    layoutVersion,
    hardware,
    attachmentUnclear,
    venueTag: kind === "waitron" ? venueTag : null,
  });
  if (kind === "waitron") {
    const changes = {
      phase: "waitron-found",
      target,
      deadlineMs: event.atMs + INSTALLER_TIMINGS_MS.waitronStart,
      message: message("installer.waitron_found", {
        seconds: INSTALLER_TIMINGS_MS.waitronStart / 1000,
        venueName: venueTag?.name ?? null,
        live: venueTag?.live ?? null,
        hardware,
      }),
    };
    return decide(state, "wait", changes);
  }
  if (hardware !== null) return refuse(state, hardware, hardware);
  if (kind === "unknown" || attachmentUnclear)
    return decide(state, "confirm-erase", {
      phase: "awaiting-erase-word",
      target,
      message: message("installer.unknown_disk", { attachmentUnclear, mismatch: false }),
    });
  return enterLoading(state, { target, confirmed: "unattended" });
}

/** Spec §5 step 3: the stick may come out only once the installer is wholly in memory. @param {InstallerState} state @param {object} changes */
function enterLoading(state, changes) {
  if (state.ramReady)
    return decide(state, "find-network", {
      ...changes,
      phase: "network",
      deadlineMs: null,
      message: message("installer.safe_to_remove"),
    });
  return decide(state, "wait", {
    ...changes,
    phase: "loading",
    deadlineMs: null,
    message: message("installer.loading"),
  });
}

/** One frozen target: the only disk id an action names. @param {InstallerDecision} decision */
function naming(decision) {
  const { diskId } = /** @type {NonNullable<InstallerState["target"]>} */ (decision.state.target);
  return Object.freeze({ ...decision, diskId });
}

/** @param {InstallerState} state @param {object} [changes] */
function bootInstalled(state, changes = {}) {
  return naming(
    decide(state, "boot-installed", {
      ...changes,
      phase: "booting",
      deadlineMs: null,
      message: message("installer.starting_installed"),
    }),
  );
}

/** Reached only from a verified release (spec §5 step 5). @param {InstallerState} state */
function writeTarget(state) {
  return naming(
    decide(state, "write-owned-target", {
      phase: "writing",
      deadlineMs: null,
      message: message("installer.writing"),
    }),
  );
}

/** @param {InstallerState} state @param {number} atMs @param {boolean} mismatch */
function reinstallScreen(state, atMs, mismatch) {
  const venueTag = /** @type {NonNullable<InstallerState["target"]>} */ (state.target).venueTag;
  return decide(state, "confirm-erase", {
    phase: "reinstall-screen",
    deadlineMs: atMs + INSTALLER_TIMINGS_MS.reinstallIdle,
    message: message("installer.reinstall", {
      prompt: venueTag === null ? "erase-word" : "venue-name",
      venueName: venueTag?.name ?? null,
      live: venueTag?.live ?? null,
      mismatch,
    }),
  });
}

/** @param {string} text @returns {string|null} the NFC text, or null when it is too long */
function typedFits(text) {
  const normalised = text.normalize("NFC");
  return normalised.length <= MAX_TYPED_UNITS ? normalised : null;
}

/** The text is compared and dropped. @param {InstallerState} state @param {string} text */
function typedMatches(state, text) {
  const normalised = typedFits(text);
  if (normalised === null) return false;
  const venueTag = /** @type {NonNullable<InstallerState["target"]>} */ (state.target).venueTag;
  return venueTag === null ? text === state.eraseWord : normalised === venueTag.name;
}

/** @param {InstallerState} state */
function typedConfirmation(state) {
  const { hardware } = /** @type {NonNullable<InstallerState["target"]>} */ (state.target);
  if (hardware !== null) return refuse(state, hardware, hardware);
  return enterLoading(state, { confirmed: "typed" });
}

/** @param {InstallerState} state @param {number} atMs @param {'clock-retry'|'download-retry'} phase */
function retryLater(state, atMs, phase) {
  return decide(state, "wait", {
    phase,
    deadlineMs: atMs + INSTALLER_TIMINGS_MS.retry,
    message: message(
      phase === "clock-retry" ? "installer.clock_retry" : "installer.download_retry",
      {
        seconds: INSTALLER_TIMINGS_MS.retry / 1000,
      },
    ),
  });
}

/** @param {InstallerState} state @param {any} event */
function findNetworkAgain(state, event) {
  if (event.kind !== "tick" || event.atMs < /** @type {number} */ (state.deadlineMs))
    return undefined;
  return decide(state, "find-network", {
    phase: "network",
    deadlineMs: null,
    message: message("installer.finding_network"),
  });
}

/** @param {InstallerState} state */
function download(state) {
  return decide(state, "download", {
    phase: "downloading",
    clockSet: true,
    message: message("installer.downloading"),
  });
}

const RELEASE_REFUSALS = Object.freeze({
  signature: "release-signature",
  checksum: "release-checksum",
  "too-large": "release-too-large",
  "installer-too-old": "installer-too-old",
});

/** @type {Record<string, (state: InstallerState, event: any) => InstallerDecision|undefined>} */
const PHASE_RULES = {
  "waitron-found": (state, event) => {
    if (event.kind === "key" || event.kind === "submit")
      return reinstallScreen(state, event.atMs, false);
    if (event.kind === "tick" && event.atMs >= /** @type {number} */ (state.deadlineMs))
      return bootInstalled(state);
    return undefined;
  },
  "reinstall-screen": (state, event) => {
    if (event.kind === "key")
      return decide(state, "wait", {
        deadlineMs: event.atMs + INSTALLER_TIMINGS_MS.reinstallIdle,
      });
    if (event.kind === "submit")
      return typedMatches(state, event.text)
        ? typedConfirmation(state)
        : reinstallScreen(state, event.atMs, true);
    if (event.kind === "tick" && event.atMs >= /** @type {number} */ (state.deadlineMs))
      return bootInstalled(state);
    return undefined;
  },
  "awaiting-erase-word": (state, event) => {
    if (event.kind !== "submit") return undefined;
    if (typedFits(event.text) !== null && event.text === state.eraseWord)
      return typedConfirmation(state);
    const { attachmentUnclear } = /** @type {NonNullable<InstallerState["target"]>} */ (
      state.target
    );
    return decide(state, "confirm-erase", {
      message: message("installer.unknown_disk", { attachmentUnclear, mismatch: true }),
    });
  },
  network: (state, event) => {
    if (event.kind !== "online") return undefined;
    if (state.clockSet) return download(state);
    return decide(state, "set-clock", {
      phase: "clock",
      message: message("installer.setting_clock"),
    });
  },
  clock: (state, event) => {
    if (event.kind !== "clock-set") return undefined;
    if (event.ok && event.utcMs >= state.clockFloorMs) return download(state);
    return retryLater(state, event.atMs, "clock-retry");
  },
  "clock-retry": findNetworkAgain,
  "download-retry": findNetworkAgain,
  downloading: (state, event) => {
    if (event.kind !== "release-checked") return undefined;
    const { outcome, releaseVersion } = event;
    if (outcome === "unavailable" || outcome === "truncated")
      return retryLater(state, event.atMs, "download-retry");
    const reason = RELEASE_REFUSALS[/** @type {keyof typeof RELEASE_REFUSALS} */ (outcome)];
    if (reason !== undefined) return refuse(state, reason, null, releaseVersion);
    if (state.confirmed === "typed") return writeTarget(state);
    const { recognised } = /** @type {NonNullable<InstallerState["target"]>} */ (state.target);
    const deadlineMs = event.atMs + INSTALLER_TIMINGS_MS.eraseWait;
    return decide(state, "wait", {
      phase: "erase-countdown",
      deadlineMs,
      message: message("installer.erase_countdown", {
        seconds: INSTALLER_TIMINGS_MS.eraseWait / 1000,
        recognised,
      }),
    });
  },
  "erase-countdown": (state, event) => {
    if (event.kind === "key" || event.kind === "submit")
      return decide(state, "confirm-erase", {
        phase: "erase-stopped",
        deadlineMs: null,
        message: message("installer.erase_stopped"),
      });
    if (event.kind === "tick" && event.atMs >= /** @type {number} */ (state.deadlineMs))
      return writeTarget(state);
    return undefined;
  },
  "erase-stopped": (state, event) => {
    if (event.kind !== "choice") return undefined;
    if (event.choice === "install-now") return writeTarget(state);
    return decide(state, "power-off", {
      phase: "powering-off",
      message: message("installer.powering_off"),
    });
  },
  writing: (state, event) => {
    if (event.kind !== "write-finished") return undefined;
    if (!event.ok) return refuse(state, "write-failed", null);
    if (!state.usbPresent) return bootInstalled(state);
    return decide(state, "wait", { phase: "remove-usb", message: message("installer.remove_usb") });
  },
};

/** Pure. @param {unknown} state @param {unknown} event @returns {InstallerDecision} */
export function nextInstallerStep(state, event) {
  genuine(state);
  const current = /** @type {InstallerState} */ (state);
  checkEvent(event);
  const e = /** @type {any} */ (event);
  if (e.atMs < current.atMs) throw eventInvalid("time-backwards");
  const timed = makeState({ ...current, atMs: e.atMs });

  if (FINAL_PHASES.includes(timed.phase))
    return Object.freeze({
      action: "wait",
      diskId: null,
      requestId: null,
      message: timed.message,
      deadlineMs: null,
      state: timed,
    });
  const adapterPhase = ADAPTER_PHASES[/** @type {keyof typeof ADAPTER_PHASES} */ (e.kind)];
  if (adapterPhase !== undefined && adapterPhase !== timed.phase)
    return refuse(timed, "sequence-invalid", null);
  if (Object.hasOwn(e, "requestId") && e.requestId !== timed.requestId)
    return refuse(timed, "sequence-invalid", null);
  if (e.kind === "observed") return observe(timed, e);
  if (e.kind === "ram-ready") {
    const ready = makeState({ ...timed, ramReady: true });
    return ready.phase === "loading" ? enterLoading(ready, {}) : decide(ready, "wait");
  }
  if (e.kind === "usb-removed") {
    if (!timed.ramReady) return refuse(timed, "usb-removed-early", null);
    if (timed.phase === "remove-usb") return bootInstalled(timed, { usbPresent: false });
    return decide(timed, "wait", { usbPresent: false });
  }
  if (e.kind === "usb-inserted") return decide(timed, "wait", { usbPresent: true });
  const rules = PHASE_RULES[/** @type {keyof typeof PHASE_RULES} */ (timed.phase)];
  return rules?.(timed, e) ?? decide(timed, "wait");
}

/**
 * @typedef {object} InstallerStatus  frozen; what the public status page may show (spec §5.6)
 * @property {InstallerPhase} stage
 * @property {boolean} safeToRemove  ramReady and a confirmed path, until a final phase
 * @property {string|null} stopReason
 * @property {'no-tpm'|'secure-boot-off'|null} hardware  from the refusal or the target
 * @property {string|null} releaseVersion  for installer-too-old only
 */

/** Pure. The page is open to anyone on the network: no disk id, venue name or typed text. @param {unknown} state @returns {InstallerStatus} */
export function installerStatus(state) {
  genuine(state);
  const {
    phase,
    ramReady,
    confirmed,
    refusal: stop,
    target,
  } = /** @type {InstallerState} */ (state);
  return Object.freeze({
    stage: phase,
    safeToRemove: ramReady && confirmed !== null && !FINAL_PHASES.includes(phase),
    stopReason: stop?.reason ?? null,
    hardware: stop?.hardware ?? target?.hardware ?? null,
    releaseVersion: stop?.releaseVersion ?? null,
  });
}
