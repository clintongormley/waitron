import { isIP } from "node:net";
import { usableVenueName } from "./name-tag.mjs";
import { exactRecord } from "./upgrades/contracts.mjs";
import { WIFI_COPY_FAILURES, WIFI_COPY_STATES } from "./wifi-boot-copy.mjs";
import { WIFI_NO_COPY_REASONS, formatWifiRecord, isSsidHex } from "./wifi-record.mjs";

/**
 * @typedef {{ source: "person", person: string } | { source: "server" }} HostActor  frozen
 * @typedef {{ verb: string, fields: Record<string, unknown>, actor: HostActor }} HostRequest  frozen
 */

export const HOST_VERBS = Object.freeze([
  "network.read",
  "network.scan",
  "network.join",
  "network.forget",
  "screen.read",
  "screen.set",
  "tag.write",
]);
/** Answered by the shell handler; this module refuses them as unknown. */
export const SHELL_VERBS = Object.freeze(["clock.status", "clock.set"]);
export const HOST_LINE_MAX = 4096;
/** Bytes, with the newline: the client reads no more. */
export const HOST_REPLY_MAX = 4096;
export const NETWORK_SCAN_MAX = 32;
export const PERSON_ID_MAX = 64;

/** The permission the server must have checked before sending a person's request. */
export const VERB_PERMISSION = Object.freeze({
  "network.read": "system.manage",
  "network.scan": "system.manage",
  "network.join": "system.manage",
  "network.forget": "system.manage",
  "screen.read": "system.manage",
  "screen.set": "system.manage",
});

/** @type {Readonly<Record<string, readonly string[]>>} */
const FIELD_KEYS = Object.freeze({
  "network.read": [],
  "network.scan": [],
  "network.join": ["ssidHex", "keyMgmt", "psk", "hidden"],
  "network.forget": ["ssidHex"],
  "screen.read": [],
  "screen.set": ["start"],
  "tag.write": ["tag"],
});

/** @type {Readonly<Record<string, readonly string[]>>} */
const ACTOR_SOURCES = Object.freeze({
  "network.read": ["person", "server"],
  "network.scan": ["person"],
  "network.join": ["person"],
  "network.forget": ["person"],
  "screen.read": ["person", "server"],
  "screen.set": ["person"],
  "tag.write": ["server"],
});

export const START_SCREENS = Object.freeze(["dashboard", "till"]);

const PRINTABLE_ASCII = /^[ -~]*$/;
const NOT_PRINTABLE_ASCII = /[^ -~]/g;
const PERSON_ID = new RegExp(`^[A-Za-z0-9-]{1,${PERSON_ID_MAX}}$`);

/** @param {string} reason */
function refusal(reason) {
  return Object.freeze({ ok: false, reason });
}

/** @param {string} code @param {string} reason */
function programmingError(code, reason) {
  return Object.assign(new Error(code), { code, reason });
}

/** @param {unknown} verb */
function hostVerb(verb) {
  return typeof verb === "string" && HOST_VERBS.includes(verb);
}

/** @param {string} verb @param {unknown} actor @returns {HostActor | null} */
function checkedActor(verb, actor) {
  if (actor === null || typeof actor !== "object" || Array.isArray(actor)) return null;
  const { source } = /** @type {Record<string, unknown>} */ (actor);
  if (typeof source !== "string" || !ACTOR_SOURCES[verb].includes(source)) return null;
  if (source === "server") {
    return exactRecord(actor, ["source"]) ? Object.freeze({ source: "server" }) : null;
  }
  const id = /** @type {Record<string, unknown>} */ (actor).person;
  if (!exactRecord(actor, ["source", "person"]) || typeof id !== "string" || !PERSON_ID.test(id))
    return null;
  return Object.freeze({ source: "person", person: id });
}

/** @param {Readonly<Record<string, unknown>>} fields */
function joinFits({ ssidHex, keyMgmt, psk, hidden }) {
  /** @type {Uint8Array} */
  let bytes;
  try {
    bytes = formatWifiRecord(/** @type {any} */ ({ ssidHex, keyMgmt, psk, hidden }));
  } catch {
    return false;
  }
  bytes.fill(0);
  return true;
}

/** @param {unknown} tag @returns {Readonly<{ name: string, live: boolean }> | null | undefined} */
function checkedTag(tag) {
  if (tag === null) return null;
  if (!exactRecord(tag, ["name", "live"])) return undefined;
  const { name, live } = /** @type {Record<string, unknown>} */ (tag);
  if (typeof live !== "boolean" || typeof name !== "string" || usableVenueName(name) !== name)
    return undefined;
  return Object.freeze({ name, live });
}

/**
 * Each field is read once into the copy, and the copy is what gets checked and written.
 * @param {string} verb @param {Record<string, unknown>} fields
 * @returns {Readonly<Record<string, unknown>> | null}
 */
function checkedFields(verb, fields) {
  /** @type {Record<string, unknown>} */
  const copy = {};
  for (const key of FIELD_KEYS[verb]) copy[key] = fields[key];
  switch (verb) {
    case "network.join":
      if (!joinFits(copy)) return null;
      break;
    case "network.forget":
      if (!isSsidHex(copy.ssidHex)) return null;
      break;
    case "screen.set":
      if (!START_SCREENS.includes(/** @type {string} */ (copy.start))) return null;
      break;
    case "tag.write": {
      const tag = checkedTag(copy.tag);
      if (tag === undefined) return null;
      copy.tag = tag;
      break;
    }
  }
  return Object.freeze(copy);
}

/** @param {unknown} value */
function asciiJson(value) {
  return JSON.stringify(value).replace(
    NOT_PRINTABLE_ASCII,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** @param {string} verb @param {Readonly<Record<string, unknown>>} fields @param {HostActor} actor */
function canonicalLine(verb, fields, actor) {
  return `${verb} ${asciiJson({ ...fields, actor })}`;
}

/**
 * Pure. Reads one request line, without its newline. Never throws.
 * @param {unknown} line
 * @returns {Readonly<{ ok: true, request: HostRequest } | { ok: false, reason: string }>}
 */
export function parseHostRequest(line) {
  if (typeof line !== "string" || line.length > HOST_LINE_MAX || !PRINTABLE_ASCII.test(line)) {
    return refusal("request_invalid");
  }
  const space = line.indexOf(" ");
  const verb = space === -1 ? line : line.slice(0, space);
  if (verb === "") return refusal("request_invalid");
  if (!hostVerb(verb)) return refusal("unknown_request");
  if (space === -1) return refusal("request_invalid");

  /** @type {unknown} */
  let body;
  try {
    body = JSON.parse(line.slice(space + 1));
  } catch {
    return refusal("request_invalid");
  }
  if (!exactRecord(body, [...FIELD_KEYS[verb], "actor"])) return refusal("request_invalid");
  const record = /** @type {Record<string, unknown>} */ (body);

  const actor = checkedActor(verb, record.actor);
  if (actor === null) return refusal("actor_invalid");

  const fields = checkedFields(verb, record);
  if (fields === null) return refusal("fields_invalid");
  if (canonicalLine(verb, fields, actor) !== line) return refusal("request_invalid");
  return Object.freeze({ ok: true, request: Object.freeze({ verb, fields, actor }) });
}

/**
 * Pure. Writes the one line `parseHostRequest` accepts for a request, without its newline.
 * Throws code host_request.invalid, reason request-invalid, unless request is exactly {verb,
 * fields, actor} with a host verb, that verb's field keys and values, and an actor it allows; a
 * getter or proxy trap that throws passes its own error on. Keys are judged as exactRecord judges
 * them: own enumerable string keys only, so a Symbol key is ignored.
 * @param {HostRequest} request
 * @returns {string}
 */
export function formatHostRequest(request) {
  if (!exactRecord(request, ["verb", "fields", "actor"]))
    throw programmingError("host_request.invalid", "request-invalid");
  const { verb, fields, actor } = request;
  if (!hostVerb(verb) || !exactRecord(fields, FIELD_KEYS[verb])) {
    throw programmingError("host_request.invalid", "request-invalid");
  }
  const checked = checkedActor(verb, actor);
  if (checked === null) throw programmingError("host_request.invalid", "request-invalid");
  const checkedValues = checkedFields(verb, fields);
  if (checkedValues === null) throw programmingError("host_request.invalid", "request-invalid");
  return canonicalLine(verb, checkedValues, checked);
}

export const PARSER_REFUSALS = Object.freeze([
  "request_invalid",
  "unknown_request",
  "actor_invalid",
  "fields_invalid",
]);

/** @type {Readonly<Record<string, readonly string[]>>} */
export const REPLY_REFUSALS = Object.freeze({
  "network.read": Object.freeze([]),
  "network.scan": Object.freeze(["busy", "no_wifi"]),
  "network.join": Object.freeze(["busy", "no_wifi"]),
  "network.forget": Object.freeze(["busy", "not_saved"]),
  "screen.read": Object.freeze([]),
  "screen.set": Object.freeze([]),
  "tag.write": Object.freeze(["busy", "no_free_token", "header_unreadable", "no_space"]),
});

export const CHANGE_KINDS = Object.freeze(["join", "forget"]);
export const CHANGE_STATES = Object.freeze(["running", "applied", "refused"]);
/** @type {Readonly<Record<string, readonly string[]>>} */
export const CHANGE_REFUSALS = Object.freeze({
  join: Object.freeze(["password-rejected", "network-not-found", "timed-out", "failed"]),
  forget: Object.freeze(["failed"]),
});
export const SCAN_SECURITY = Object.freeze(["wpa-psk", "sae", "other"]);
export const TAG_OUTCOMES = Object.freeze(["written", "removed", "unchanged"]);

/** @param {unknown} value */
const ssidOrNull = (value) => value === null || isSsidHex(value);

/** @param {unknown} wired */
function checkedWired(wired) {
  if (!exactRecord(wired, ["connected", "address"])) return null;
  const { connected, address } = /** @type {Record<string, unknown>} */ (wired);
  if (typeof connected !== "boolean") return null;
  // A zone would name the box's interface.
  const addressOk =
    address === null ||
    (connected && typeof address === "string" && !address.includes("%") && isIP(address) !== 0);
  return addressOk ? { connected, address } : null;
}

/** @param {unknown} wifi */
function checkedWifi(wifi) {
  if (!exactRecord(wifi, ["connectedSsidHex", "savedSsidHex"])) return null;
  const { connectedSsidHex, savedSsidHex } = /** @type {Record<string, unknown>} */ (wifi);
  return ssidOrNull(connectedSsidHex) && ssidOrNull(savedSsidHex)
    ? { connectedSsidHex, savedSsidHex }
    : null;
}

/** @param {unknown} change @returns {object | null | undefined} undefined when refused */
function checkedChange(change) {
  if (change === null) return null;
  if (!exactRecord(change, ["kind", "ssidHex", "state", "reason"])) return undefined;
  const { kind, ssidHex, state, reason } = /** @type {Record<string, any>} */ (change);
  if (!CHANGE_KINDS.includes(kind) || !isSsidHex(ssidHex) || !CHANGE_STATES.includes(state)) {
    return undefined;
  }
  const reasonOk = state === "refused" ? CHANGE_REFUSALS[kind].includes(reason) : reason === null;
  return reasonOk ? { kind, ssidHex, state, reason } : undefined;
}

/** @param {unknown} bootCopy */
function checkedBootCopy(bootCopy) {
  if (!exactRecord(bootCopy, ["state", "reason", "failure"])) return null;
  const { state, reason, failure } = /** @type {Record<string, any>} */ (bootCopy);
  if (!WIFI_COPY_STATES.includes(state)) return null;
  if (reason !== null && !WIFI_NO_COPY_REASONS.includes(reason)) return null;
  const failureOk = state === "failed" ? WIFI_COPY_FAILURES.includes(failure) : failure === null;
  return failureOk ? { state, reason, failure } : null;
}

/** @param {unknown} network */
function checkedNetwork(network) {
  if (!exactRecord(network, ["ssidHex", "signal", "security"])) return null;
  const { ssidHex, signal, security } = /** @type {Record<string, any>} */ (network);
  if (!isSsidHex(ssidHex) || !SCAN_SECURITY.includes(security)) return null;
  if (!Number.isInteger(signal) || signal < 0 || signal > 100) return null;
  return { ssidHex, signal, security };
}

/** @param {unknown} networks */
function checkedNetworks(networks) {
  if (!Array.isArray(networks)) return null;
  const { length } = networks;
  if (length > NETWORK_SCAN_MAX) return null;
  const checked = [];
  for (let index = 0; index < length; index += 1) checked.push(checkedNetwork(networks[index]));
  if (checked.includes(null)) return null;
  const ssids = new Set(
    /** @type {{ ssidHex: string }[]} */ (checked).map((network) => network.ssidHex),
  );
  return ssids.size === checked.length ? checked : null;
}

/**
 * Each verb's successful reply, rebuilt in its one key order from the checked values, or null.
 * Each value is read once, so a getter cannot change what is written after it was checked.
 * @type {Readonly<Record<string, (reply: Record<string, unknown>) => Record<string, unknown> | null>>}
 */
const REPLY_RULES = Object.freeze({
  "network.read": (reply) => {
    if (!exactRecord(reply, ["ok", "wired", "wifi", "change", "bootCopy"])) return null;
    const wired = checkedWired(reply.wired);
    const wifi = checkedWifi(reply.wifi);
    const change = checkedChange(reply.change);
    const bootCopy = checkedBootCopy(reply.bootCopy);
    if (wired === null || wifi === null || change === undefined || bootCopy === null) return null;
    return { ok: true, wired, wifi, change, bootCopy };
  },
  "network.scan": (reply) => {
    if (!exactRecord(reply, ["ok", "networks"])) return null;
    const networks = checkedNetworks(reply.networks);
    return networks === null ? null : { ok: true, networks };
  },
  "network.join": (reply) => (exactRecord(reply, ["ok"]) ? { ok: true } : null),
  "network.forget": (reply) => (exactRecord(reply, ["ok"]) ? { ok: true } : null),
  "screen.read": startReply,
  "screen.set": startReply,
  "tag.write": (reply) => {
    if (!exactRecord(reply, ["ok", "tag"])) return null;
    const { tag } = reply;
    return TAG_OUTCOMES.includes(/** @type {string} */ (tag)) ? { ok: true, tag } : null;
  },
});

/** @param {Record<string, unknown>} reply */
function startReply(reply) {
  if (!exactRecord(reply, ["ok", "start"])) return null;
  const { start } = reply;
  return START_SCREENS.includes(/** @type {string} */ (start)) ? { ok: true, start } : null;
}

/** @param {unknown} verb @param {unknown} reply @returns {Record<string, unknown>} */
function canonicalReply(verb, reply) {
  if (!hostVerb(verb) || reply === null || typeof reply !== "object") {
    throw programmingError("host_reply.invalid", "reply-invalid");
  }
  const record = /** @type {Record<string, unknown>} */ (reply);
  const name = /** @type {string} */ (verb);
  /** @type {Record<string, unknown> | null} */
  let canonical = null;
  const { ok } = record;
  if (ok === true) {
    canonical = REPLY_RULES[name](record);
  } else if (ok === false && exactRecord(record, ["ok", "reason"])) {
    const { reason } = record;
    const allowed = [...PARSER_REFUSALS, "host_failed", ...REPLY_REFUSALS[name]];
    if (allowed.includes(/** @type {string} */ (reason))) canonical = { ok: false, reason };
  }
  if (canonical === null) throw programmingError("host_reply.invalid", "reply-invalid");
  return canonical;
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Pure. Writes a reply's one line, newline included. Throws code host_reply.invalid, reason
 * reply-invalid, unless verb is a host verb and reply is exactly one of the replies or refusals it
 * may answer; a getter or proxy trap that throws passes its own error on. Keys are judged as
 * exactRecord judges them: own enumerable string keys only, so a Symbol key is ignored.
 * @param {string} verb @param {Record<string, unknown>} reply
 * @returns {string}
 */
export function formatHostReply(verb, reply) {
  return `${asciiJson(canonicalReply(verb, reply))}\n`;
}

const REPLY_TEXT = /^[ -~]*\n$/;
const MALFORMED = Object.freeze({ kind: "malformed" });

/**
 * Pure. Reads a reply's text, newline included. Never throws.
 * @param {string} verb @param {unknown} text
 * @returns {Readonly<{ kind: "ok", value: Readonly<Record<string, unknown>> }
 *   | { kind: "refused", reason: string } | { kind: "malformed" }>}
 */
export function parseHostReply(verb, text) {
  if (typeof text !== "string" || text.length > HOST_REPLY_MAX || !REPLY_TEXT.test(text)) {
    return MALFORMED;
  }
  /** @type {Record<string, unknown>} */
  let canonical;
  try {
    canonical = canonicalReply(verb, JSON.parse(text));
  } catch {
    return MALFORMED;
  }
  if (`${asciiJson(canonical)}\n` !== text) return MALFORMED;
  const { ok, ...value } = canonical;
  if (ok === false)
    return Object.freeze({ kind: "refused", reason: /** @type {string} */ (value.reason) });
  return Object.freeze({ kind: "ok", value: deepFreeze(value) });
}

/** @type {Readonly<Record<string, string>>} */
const VERB_ADAPTER = Object.freeze({
  "network.read": "networkRead",
  "network.scan": "networkScan",
  "network.join": "networkJoin",
  "network.forget": "networkForget",
  "screen.read": "screenRead",
  "screen.set": "screenSet",
  "tag.write": "tagWrite",
});
const ADAPTER_NAMES = [...Object.values(VERB_ADAPTER), "log"];
const HOST_FAILED_LINE = '{"ok":false,"reason":"host_failed"}\n';

/**
 * Each adapter is called as a plain function, never with `this`.
 * @typedef {Record<string, (...args: any[]) => unknown>} HostAdapters  exactly networkRead,
 *   networkScan, networkJoin, networkForget, screenRead, screenSet, tagWrite and log
 */

/**
 * Answers one request line, without its newline, through the adapters. Never rejects; any fault
 * answers host_failed and keeps nothing from it.
 * @param {unknown} line @param {HostAdapters} adapters
 * @returns {Promise<string>} one reply line, newline included
 */
export async function handleHostRequest(line, adapters) {
  try {
    const keys = Reflect.ownKeys(/** @type {object} */ (adapters));
    if (keys.length !== ADAPTER_NAMES.length || !ADAPTER_NAMES.every((name) => keys.includes(name)))
      return HOST_FAILED_LINE;
    // Read once and called without `this`, so what runs is what was checked.
    /** @type {Record<string, unknown>} */
    const table = Object.fromEntries(ADAPTER_NAMES.map((name) => [name, adapters[name]]));
    if (!ADAPTER_NAMES.every((name) => typeof table[name] === "function")) return HOST_FAILED_LINE;
    const { log, ...requestAdapters } = /** @type {HostAdapters} */ (table);
    const parsed = parseHostRequest(line);
    if (!parsed.ok) return `${asciiJson(parsed)}\n`;
    const { verb, fields, actor } = parsed.request;
    const permission = actor.source === "person" ? VERB_PERMISSION[verb] : null;
    // Awaited first, so no change happens that the log did not record.
    await log(Object.freeze({ verb, actor, permission }));
    const run = requestAdapters[VERB_ADAPTER[verb]];
    const answer = await (FIELD_KEYS[verb].length === 0 ? run() : run(fields));
    const copy = JSON.parse(JSON.stringify(answer));
    if (copy?.ok === false && !REPLY_REFUSALS[verb].includes(copy.reason)) return HOST_FAILED_LINE;
    return formatHostReply(verb, copy);
  } catch {
    return HOST_FAILED_LINE;
  }
}
