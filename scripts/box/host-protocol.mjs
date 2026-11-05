import { exactRecord } from "./upgrades/contracts.mjs";

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

const PRINTABLE_ASCII = /^[ -~]*$/;
const NOT_PRINTABLE_ASCII = /[^ -~]/g;
const PERSON_ID = new RegExp(`^[A-Za-z0-9-]{1,${PERSON_ID_MAX}}$`);

/** @param {string} reason */
function refusal(reason) {
  return Object.freeze({ ok: false, reason });
}

/** @param {string} code */
function programmingError(code) {
  return Object.assign(new Error(code), { code });
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

/** @param {string} verb @param {Record<string, unknown>} fields */
function frozenFields(verb, fields) {
  /** @type {Record<string, unknown>} */
  const copy = {};
  for (const key of FIELD_KEYS[verb]) copy[key] = fields[key];
  return Object.freeze(copy);
}

/** @param {string} verb @param {Record<string, unknown>} fields @param {HostActor} actor */
function canonicalLine(verb, fields, actor) {
  /** @type {Record<string, unknown>} */
  const body = {};
  for (const key of FIELD_KEYS[verb]) body[key] = fields[key];
  body.actor = actor;
  const json = JSON.stringify(body).replace(
    NOT_PRINTABLE_ASCII,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `${verb} ${json}`;
}

/**
 * Reads one request line, without its newline.
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

  const fields = frozenFields(verb, record);
  if (canonicalLine(verb, fields, actor) !== line) return refusal("request_invalid");
  return Object.freeze({ ok: true, request: Object.freeze({ verb, fields, actor }) });
}

/**
 * Writes the one line `parseHostRequest` accepts for a request, without its newline.
 * @param {HostRequest} request
 * @returns {string}
 */
export function formatHostRequest(request) {
  if (!exactRecord(request, ["verb", "fields", "actor"]))
    throw programmingError("host_request.invalid");
  const { verb, fields, actor } = request;
  if (!hostVerb(verb) || !exactRecord(fields, FIELD_KEYS[verb])) {
    throw programmingError("host_request.invalid");
  }
  const checked = checkedActor(verb, actor);
  if (checked === null) throw programmingError("host_request.invalid");
  return canonicalLine(verb, fields, checked);
}
