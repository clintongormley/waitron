import { classifyDisk } from "./disk-state.mjs";
import { exactRecord, safeInteger } from "./upgrades/contracts.mjs";

/** Spec §5.1 guard 3 (line 247), §5.1 (lines 264-266), §5.2 (lines 276-279), §5.3 item 4 (line 322). The spec's calls, not separately the owner's. */
export const INSTALLER_TIMINGS_MS = Object.freeze({
  waitronStart: 15_000,
  reinstallIdle: 120_000,
  eraseWait: 60_000,
  retry: 60_000,
});

/**
 * @typedef {{ name: string, live: boolean }} VenueTag  decoded from the frozen internal disk's name tag; display only (spec §7.6)
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
 * @property {number|null} deadlineMs
 * @property {null|{reason:string, hardware:'no-tpm'|'secure-boot-off'|null, releaseVersion:string|null}} refusal
 * @property {{key:string, params:object}} message  the last message, repeated by final phases (D14)
 * @typedef {'wait'|'find-network'|'set-clock'|'download'|'confirm-erase'|'write-owned-target'|'boot-installed'|'power-off'|'refuse'} InstallerAction
 * @typedef {object} InstallerDecision  frozen
 * @property {InstallerAction} action
 * @property {string|null} diskId  the frozen target's id for write-owned-target and boot-installed; null otherwise
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
const PERSON_INPUTS = ["key", "submit", "choice"];
const BARE_KINDS = ["ram-ready", "usb-removed", "usb-inserted", "key", "online", "tick"];
const RELEASE_OUTCOMES = [
  "verified",
  "unavailable",
  "truncated",
  "signature",
  "checksum",
  "too-large",
  "installer-too-old",
];
const PRINTABLE_ASCII = /^[\x20-\x7E]{1,32}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

/** @type {WeakSet<object>} */
const GENUINE = new WeakSet();

/** @param {string} code @param {string} reason */
function refusal(code, reason) {
  return Object.assign(new Error(code), { code, reason });
}
const eventInvalid = (reason = "event-invalid") => refusal("installer.event_invalid", reason);

/** @param {unknown} value @param {number} maxCodePoints */
function usableText(value, maxCodePoints) {
  if (typeof value !== "string" || !value.isWellFormed() || CONTROL.test(value)) return false;
  const length = [...value].length;
  return length >= 1 && length <= maxCodePoints;
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
    deadlineMs: null,
    refusal: null,
    message: message("installer.starting"),
  });
}

/** @param {any} event */
function checkEvent(event) {
  const { kind } = event ?? {};
  const keys = (/** @type {string[]} */ ...rest) => exactRecord(event, ["kind", "atMs", ...rest]);
  let ok;
  if (BARE_KINDS.includes(kind)) ok = keys();
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
      keys("ok", "utcMs") &&
      typeof event.ok === "boolean" &&
      (event.ok ? safeInteger(event.utcMs) : event.utcMs === null);
  else if (kind === "release-checked")
    ok =
      keys("outcome", "releaseVersion") &&
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
  const next = makeState({ ...state, ...changes });
  return Object.freeze({
    action,
    diskId: null,
    message: next.message,
    deadlineMs: next.deadlineMs,
    state: next,
  });
}

/** @param {InstallerState} state @param {string} reason @param {string|null} hardware */
function refuse(state, reason, hardware) {
  const details = { reason, hardware, releaseVersion: null };
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
  const name = tag.name.normalize("NFC");
  return usableText(name, 256) ? Object.freeze({ name, live: tag.live }) : null;
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
  return decide(state, "wait", {
    phase: "loading",
    target,
    confirmed: "unattended",
    message: message("installer.loading"),
  });
}

/** Pure. @param {unknown} state @param {unknown} event @returns {InstallerDecision} */
export function nextInstallerStep(state, event) {
  if (state === null || typeof state !== "object" || !GENUINE.has(state))
    throw refusal("installer.state_invalid", "state-invalid");
  const current = /** @type {InstallerState} */ (state);
  checkEvent(event);
  const e = /** @type {any} */ (event);
  if (e.atMs < current.atMs) throw eventInvalid("time-backwards");
  const timed = makeState({ ...current, atMs: e.atMs });

  if (FINAL_PHASES.includes(timed.phase))
    return Object.freeze({
      action: "wait",
      diskId: null,
      message: timed.message,
      deadlineMs: null,
      state: timed,
    });
  const adapterPhase = ADAPTER_PHASES[/** @type {keyof typeof ADAPTER_PHASES} */ (e.kind)];
  if (adapterPhase !== undefined && adapterPhase !== timed.phase)
    return refuse(timed, "sequence-invalid", null);
  if (PERSON_INPUTS.includes(e.kind)) return decide(timed, "wait");
  if (e.kind === "observed") return observe(timed, e);
  if (e.kind === "ram-ready") return decide(timed, "wait", { ramReady: true });
  if (e.kind === "usb-removed") return decide(timed, "wait", { usbPresent: false });
  if (e.kind === "usb-inserted") return decide(timed, "wait", { usbPresent: true });
  return decide(timed, "wait");
}
