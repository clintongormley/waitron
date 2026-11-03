import { exactRecord, safeInteger } from "./upgrades/contracts.mjs";

/** Spec §5.3 item 2 (line 300) and item 4 (line 322); joinWithin reuses the one minute (D16). The spec's calls, not separately the owner's. */
export const NETWORK_TIMINGS_MS = Object.freeze({
  hotspotAfter: 60_000,
  retryEvery: 60_000,
  joinWithin: 60_000,
});

/**
 * @typedef {'probing'|'hotspot'|'joining'|'joined'|'online'} NetworkPhase
 * @typedef {object} NetworkState  frozen; only states this module made are accepted
 * @property {NetworkPhase} phase
 * @property {number} atMs
 * @property {number|null} deadlineMs  probing: when the hotspot opens; hotspot: the next probe; joining/joined: when the join counts as failed
 * @property {'join-failed'|'no-internet'|null} failure  why the last join failed (the page says the password was wrong, or the network has no internet); null until one fails, and again after continue
 * @typedef {'wait'|'probe'|'open-hotspot'|'join'|'continue'} NetworkAction
 *   open-hotspot: open «Waitron-Instalar» (fixed name, open, 10.42.0.1, forwarding nothing; the adapter's duty)
 *   join: close the hotspot, then join ssidHex with the password the adapter took from the form
 *   continue: internet found; close the hotspot if open; the installer goes on
 * @typedef {{ action: NetworkAction, ssidHex: string|null, deadlineMs: number|null, state: NetworkState }} NetworkDecision  frozen
 */

// The same rule as the Wi-Fi record's: lowercase hex of 1-32 bytes.
const SSID_HEX = /^(?:[0-9a-f]{2}){1,32}$/;

/** @type {WeakSet<object>} */
const GENUINE = new WeakSet();

/** @param {string} code @param {string} reason */
function refusal(code, reason) {
  return Object.assign(new Error(code), { code, reason });
}
const eventInvalid = (reason = "event-invalid") =>
  refusal("installer_network.event_invalid", reason);

/** @param {unknown} state */
function genuine(state) {
  if (state === null || typeof state !== "object" || !GENUINE.has(state))
    throw refusal("installer_network.state_invalid", "state-invalid");
}

/** @param {object} fields @returns {NetworkState} */
function makeState(fields) {
  const state = /** @type {NetworkState} */ (Object.freeze({ ...fields }));
  GENUINE.add(state);
  return state;
}

/** Throws installer_network.options_invalid unless options is exactly {atMs}. @param {unknown} options @returns {NetworkState} */
export function createNetworkState(options) {
  if (!exactRecord(options, ["atMs"]) || !safeInteger(options.atMs))
    throw refusal("installer_network.options_invalid", "options-invalid");
  return makeState({
    phase: "probing",
    atMs: options.atMs,
    deadlineMs: options.atMs + NETWORK_TIMINGS_MS.hotspotAfter,
    failure: null,
  });
}

/** @param {any} event */
function checkEvent(event) {
  const { kind } = event ?? {};
  const keys = (/** @type {string[]} */ ...rest) => exactRecord(event, ["kind", "atMs", ...rest]);
  let ok;
  if (kind === "tick") ok = keys();
  else if (kind === "link") ok = keys("internet") && typeof event.internet === "boolean";
  else if (kind === "join-requested")
    ok = keys("ssidHex") && typeof event.ssidHex === "string" && SSID_HEX.test(event.ssidHex);
  else if (kind === "join-result") ok = keys("ok") && typeof event.ok === "boolean";
  else ok = false;
  if (!ok || !safeInteger(event.atMs)) throw eventInvalid();
}

/**
 * @param {NetworkState} state @param {NetworkAction} action @param {object} [changes]
 * @param {string|null} [ssidHex] @returns {NetworkDecision}
 */
function decide(state, action, changes = {}, ssidHex = null) {
  const next = makeState({ ...state, ...changes });
  return Object.freeze({ action, ssidHex, deadlineMs: next.deadlineMs, state: next });
}

/** @param {NetworkState} state @param {'join-failed'|'no-internet'|null} failure */
function openHotspot(state, failure) {
  return decide(state, "open-hotspot", {
    phase: "hotspot",
    deadlineMs: state.atMs + NETWORK_TIMINGS_MS.retryEvery,
    failure,
  });
}

/** Pure. Throws installer_network.state_invalid / installer_network.event_invalid (event-invalid, time-backwards). @param {unknown} state @param {unknown} event @returns {NetworkDecision} */
export function nextNetworkStep(state, event) {
  genuine(state);
  const current = /** @type {NetworkState} */ (state);
  checkEvent(event);
  const e = /** @type {any} */ (event);
  if (e.atMs < current.atMs) throw eventInvalid("time-backwards");
  const timed = makeState({ ...current, atMs: e.atMs });
  const { phase } = timed;

  if (phase === "online") return decide(timed, "wait");
  if (e.kind === "link" && e.internet)
    return decide(timed, "continue", { phase: "online", deadlineMs: null, failure: null });
  const due = e.kind === "tick" && e.atMs >= /** @type {number} */ (timed.deadlineMs);

  if (phase === "probing" && due) return openHotspot(timed, null);
  if (phase === "hotspot" && due)
    return decide(timed, "probe", { deadlineMs: e.atMs + NETWORK_TIMINGS_MS.retryEvery });
  if (phase === "hotspot" && e.kind === "join-requested")
    return decide(
      timed,
      "join",
      { phase: "joining", deadlineMs: e.atMs + NETWORK_TIMINGS_MS.joinWithin },
      e.ssidHex,
    );
  if (phase === "joining" && e.kind === "join-result")
    return e.ok ? decide(timed, "probe", { phase: "joined" }) : openHotspot(timed, "join-failed");
  if (phase === "joining" && due) return openHotspot(timed, "join-failed");
  if (phase === "joined" && due) return openHotspot(timed, "no-internet");
  return decide(timed, "wait");
}

/** Pure. @param {unknown} state @returns {{stage: NetworkPhase, failure: 'join-failed'|'no-internet'|null}} frozen */
export function networkStatus(state) {
  genuine(state);
  const { phase, failure } = /** @type {NetworkState} */ (state);
  return Object.freeze({ stage: phase, failure });
}
