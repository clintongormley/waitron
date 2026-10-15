import { lstat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { AppError, isUuid } from "@waitron/shared";
import type { DeploymentEnvironment } from "@waitron/db";
import type { VenueRequest } from "./venue-plan.js";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
import "./errors.js";

export interface FirstSetupHold {
  readonly token: symbol;
}
export interface FirstSetupCoordinator {
  run<T>(body: (hold: FirstSetupHold) => Promise<T>): Promise<T>;
  held<T>(hold: FirstSetupHold, body: () => Promise<T>): Promise<T>;
}
export function createFirstSetupCoordinator(): FirstSetupCoordinator {
  let tail: Promise<unknown> = Promise.resolve();
  const active = new Set<FirstSetupHold>();
  return {
    run(body) {
      const next = tail.then(async () => {
        const hold = Object.freeze({ token: Symbol() });
        active.add(hold);
        try {
          return await body(hold);
        } finally {
          active.delete(hold);
        }
      });
      tail = next.catch(() => undefined);
      return next;
    },
    async held(hold, body) {
      if (!active.has(hold)) throw new AppError("setup.attempt_conflict", {});
      return body();
    },
  };
}
export interface FirstSetupFrozen {
  attemptId: string;
  nodeId: string;
  administratorId: string;
  sourceId: string;
  environment: DeploymentEnvironment;
  request: VenueRequest;
  modules: { module: string; version: string; eventId: string; request: unknown }[];
}
export type FirstSetupStatus =
  | "claimed"
  | "consumption-intent"
  | "activation-started"
  | "committed"
  | "publication"
  | "complete"
  | "abandoned"
  | "uncertain";
export type FirstSetupChange =
  | { kind: "input"; module: string; input: unknown }
  | { kind: "checked"; module: string }
  | { kind: "resume"; capabilityHash: string }
  | { kind: "committed"; result: unknown }
  | {
      kind:
        | "consumption-intent"
        | "activation-started"
        | "publication"
        | "complete"
        | "abandoned"
        | "uncertain";
    };
interface Attempt {
  frozen: FirstSetupFrozen;
  frozenDigest: string;
  revision: number;
  ownerGeneration: number;
  ownerVerifier: string;
  capabilityHash: string;
  claimNonceHash: string;
  status: FirstSetupStatus;
  consumptionIntent: boolean;
  inputs: Record<string, unknown>;
  result: unknown;
  history: { kind: string; revision: number; ownerGeneration: number }[];
}
export interface FirstSetupState extends Attempt {
  version: 1;
  venueDir: string;
  stateDir: string;
  previous: Attempt[];
}
export interface FirstSetupMarker {
  version: 1;
  attemptId: string;
  venueDir: string;
  stateDir: string;
  status: "claiming" | "active" | "complete" | "abandoned";
}
export interface FirstSetupStore {
  read(): Promise<FirstSetupState | null>;
  claim(
    frozen: FirstSetupFrozen,
    ownerVerifier: string,
    capabilityHash: string,
    claimNonceHash: string,
    hold?: FirstSetupHold,
  ): Promise<FirstSetupState>;
  update(
    attemptId: string,
    revision: number,
    change: FirstSetupChange,
    hold?: FirstSetupHold,
  ): Promise<FirstSetupState>;
}
export const FIRST_SETUP_HOST_FILES = [
  "first-setup.json",
  "first-setup-claim.json",
  "module-operation-public.json",
] as const;
const STATE_LIMIT = 1024 * 1024;
const MARKER_LIMIT = 16 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const VERIFIER = /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/;
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function conflict(): never {
  throw new AppError("setup.attempt_conflict", {});
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(
  value: unknown,
  allowed: readonly string[],
  required = allowed,
): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}
function publicValue(value: unknown, depth = 0): void {
  if (depth > 30) invalid();
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) publicValue(item, depth + 1);
    return;
  }
  if (!record(value)) invalid();
  for (const [key, item] of Object.entries(value)) {
    if (
      /password|passphrase|private|pkcs8|secret|credential|capability|nonceHash|^trust$|^current$|^pin$|^seed$|^__proto__$|^constructor$|^prototype$/i.test(
        key,
      )
    )
      invalid();
    publicValue(item, depth + 1);
  }
}
function validateFrozen(value: unknown): asserts value is FirstSetupFrozen {
  if (
    !keys(value, [
      "attemptId",
      "nodeId",
      "administratorId",
      "sourceId",
      "environment",
      "request",
      "modules",
    ]) ||
    ![value.attemptId, value.nodeId, value.administratorId].every(
      (id) => typeof id === "string" && isUuid(id),
    ) ||
    value.sourceId !== `first-setup:${String(value.attemptId)}` ||
    !["production", "preproduction"].includes(String(value.environment)) ||
    !Array.isArray(value.modules) ||
    value.modules.length > 100
  )
    invalid();
  const request = value.request;
  if (
    !keys(
      request,
      [
        "country",
        "taxId",
        "legalName",
        "taxpayerDomicile",
        "location",
        "seriesCode",
        "fullSeriesCode",
        "rectificativeSeriesCode",
        "admin",
      ],
      [
        "country",
        "taxId",
        "legalName",
        "location",
        "seriesCode",
        "rectificativeSeriesCode",
        "admin",
      ],
    ) ||
    !keys(
      request.admin,
      ["displayName", "email", "pinHash", "passwordHash", "firstNames", "lastNames", "locale"],
      ["displayName", "email", "pinHash", "passwordHash"],
    ) ||
    !VERIFIER.test(String(request.admin.pinHash)) ||
    !VERIFIER.test(String(request.admin.passwordHash))
  )
    invalid();
  const admin = { ...request.admin };
  delete admin.pinHash;
  delete admin.passwordHash;
  publicValue({ ...request, admin });
  if (
    !record(request.location) ||
    !Array.isArray(request.location.invoiceLocales) ||
    !request.location.invoiceLocales.length ||
    [
      request.country,
      request.taxId,
      request.legalName,
      request.seriesCode,
      request.rectificativeSeriesCode,
      admin.displayName,
      admin.email,
    ].some((text) => typeof text !== "string" || text.trim() === "")
  )
    invalid();
  const names = new Set<string>();
  const events = new Set<string>();
  for (const module of value.modules) {
    if (
      !keys(module, ["module", "version", "eventId", "request"]) ||
      typeof module.module !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(module.module) ||
      typeof module.version !== "string" ||
      !module.version ||
      module.version.length > 128 ||
      /\s/.test(module.version) ||
      typeof module.eventId !== "string" ||
      !isUuid(module.eventId) ||
      names.has(module.module) ||
      events.has(module.eventId)
    )
      invalid();
    names.add(module.module);
    events.add(module.eventId);
    publicValue(module.request);
  }
}
function frozenDigest(frozen: FirstSetupFrozen): string {
  const sorted = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sorted)
      : record(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])]),
          )
        : value;
  return createHash("sha256")
    .update(JSON.stringify(sorted(frozen)))
    .digest("hex");
}
const ATTEMPT_KEYS = [
  "frozen",
  "frozenDigest",
  "revision",
  "ownerGeneration",
  "ownerVerifier",
  "capabilityHash",
  "claimNonceHash",
  "status",
  "consumptionIntent",
  "inputs",
  "result",
  "history",
];
function validateAttempt(value: unknown): asserts value is Attempt {
  if (
    !keys(value, ATTEMPT_KEYS) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !Number.isSafeInteger(value.ownerGeneration) ||
    Number(value.ownerGeneration) < 1 ||
    !HASH.test(String(value.capabilityHash)) ||
    !HASH.test(String(value.claimNonceHash)) ||
    !VERIFIER.test(String(value.ownerVerifier)) ||
    ![
      "claimed",
      "consumption-intent",
      "activation-started",
      "committed",
      "publication",
      "complete",
      "abandoned",
      "uncertain",
    ].includes(String(value.status)) ||
    typeof value.consumptionIntent !== "boolean" ||
    !Array.isArray(value.history) ||
    value.history.length !== value.revision ||
    !record(value.inputs)
  )
    invalid();
  validateFrozen(value.frozen);
  if (value.frozenDigest !== frozenDigest(value.frozen)) invalid();
  if (value.ownerVerifier !== value.frozen.request.admin.passwordHash) invalid();
  for (const [index, event] of value.history.entries()) {
    if (
      !keys(event, ["kind", "revision", "ownerGeneration"]) ||
      event.revision !== index + 1 ||
      !Number.isSafeInteger(event.ownerGeneration) ||
      Number(event.ownerGeneration) < 1 ||
      Number(event.ownerGeneration) > Number(value.ownerGeneration) ||
      ![
        "claim",
        "input",
        "checked",
        "resume",
        "consumption-intent",
        "activation-started",
        "committed",
        "publication",
        "complete",
        "abandoned",
        "uncertain",
      ].includes(String(event.kind))
    )
      invalid();
  }
  if (
    value.history[0]?.kind !== "claim" ||
    value.consumptionIntent !== value.history.some((event) => event.kind === "consumption-intent")
  )
    invalid();
  publicValue(value.inputs);
  publicValue(value.result);
}
function parseState(value: unknown, venueDir: string, stateDir: string): FirstSetupState {
  if (
    !keys(value, ["version", "venueDir", "stateDir", "previous", ...ATTEMPT_KEYS]) ||
    value.version !== 1 ||
    value.venueDir !== venueDir ||
    value.stateDir !== stateDir ||
    !Array.isArray(value.previous)
  )
    invalid();
  validateAttempt(Object.fromEntries(ATTEMPT_KEYS.map((key) => [key, value[key]])));
  for (const old of value.previous) validateAttempt(old);
  return value as unknown as FirstSetupState;
}
function markerStatus(state: FirstSetupState): FirstSetupMarker["status"] {
  return state.status === "complete"
    ? "complete"
    : state.status === "abandoned"
      ? "abandoned"
      : "active";
}
async function canonicalDirectory(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    if ((await lstat(absolute)).isSymbolicLink()) invalid();
    return await realpath(absolute);
  } catch (error) {
    if (!(
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    ))
      throw error;
    return join(await canonicalDirectory(dirname(absolute)), basename(absolute));
  }
}
async function readPair(
  venueDir: string,
  expectedStateDir?: string,
): Promise<{ marker: FirstSetupMarker; state: FirstSetupState } | null> {
  let venueExists: boolean;
  try {
    const directory = await lstat(venueDir);
    if (directory.isSymbolicLink()) invalid();
    venueExists = directory.isDirectory();
  } catch (error) {
    if (!(
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    ))
      throw error;
    venueExists = false;
  }
  const value = venueExists
    ? await readDurableHostJson(join(venueDir, "first-setup-claim.json"), MARKER_LIMIT)
    : null;
  if (value === null) {
    if (
      expectedStateDir !== undefined &&
      (await readDurableHostJson(join(expectedStateDir, "first-setup.json"), STATE_LIMIT)) !== null
    )
      invalid();
    return null;
  }
  if (
    !keys(value, ["version", "attemptId", "venueDir", "stateDir", "status"]) ||
    value.version !== 1 ||
    value.venueDir !== venueDir ||
    typeof value.stateDir !== "string" ||
    resolve(value.stateDir) !== value.stateDir ||
    !["active", "complete", "abandoned"].includes(String(value.status)) ||
    typeof value.attemptId !== "string" ||
    !isUuid(value.attemptId)
  )
    invalid();
  if (expectedStateDir !== undefined && value.stateDir !== expectedStateDir) conflict();
  const state = parseState(
    await readDurableHostJson(join(value.stateDir, "first-setup.json"), STATE_LIMIT),
    venueDir,
    value.stateDir,
  );
  if (state.frozen.attemptId !== value.attemptId || markerStatus(state) !== value.status) invalid();
  return { marker: value as unknown as FirstSetupMarker, state };
}
export async function inspectFirstSetupMarker(
  venueDir: string,
  stateDir?: string,
): Promise<FirstSetupMarker | null> {
  return (
    (
      await readPair(
        await canonicalDirectory(venueDir),
        stateDir === undefined ? undefined : await canonicalDirectory(stateDir),
      )
    )?.marker ?? null
  );
}
export async function assertVenueFirstSetupAllowed(venueDir: string): Promise<void> {
  const pair = await readPair(await canonicalDirectory(venueDir));
  assertOtherSetupAllowed(pair?.state ?? null);
}
export function assertOtherSetupAllowed(state: FirstSetupState | null): void {
  if (
    state === null ||
    state.status === "complete" ||
    (state.status === "abandoned" && !state.consumptionIntent)
  )
    return;
  if (state.consumptionIntent) throw new AppError("setup.attempt_uncertain", {});
  conflict();
}
export function createFirstSetupStore(options: {
  venueDir: string;
  stateDir: string;
  coordinator: FirstSetupCoordinator;
}): FirstSetupStore {
  let venueDir = resolve(options.venueDir);
  let stateDir = resolve(options.stateDir);
  let statePath = join(stateDir, "first-setup.json");
  let markerPath = join(venueDir, "first-setup-claim.json");
  let roots: Promise<void> | undefined;
  const read = async () => {
    await (roots ??= (async () => {
      venueDir = await canonicalDirectory(options.venueDir);
      stateDir = await canonicalDirectory(options.stateDir);
      statePath = join(stateDir, "first-setup.json");
      markerPath = join(venueDir, "first-setup-claim.json");
    })());
    return (await readPair(venueDir, stateDir))?.state ?? null;
  };
  const inside = <T>(hold: FirstSetupHold | undefined, body: () => Promise<T>) =>
    hold === undefined ? options.coordinator.run(body) : options.coordinator.held(hold, body);
  const marker = (state: FirstSetupState, status = markerStatus(state)): FirstSetupMarker => ({
    version: 1,
    attemptId: state.frozen.attemptId,
    venueDir,
    stateDir,
    status,
  });
  const persist = async (state: FirstSetupState) => {
    parseState(state, venueDir, stateDir);
    await writeDurableHostJson(statePath, state, STATE_LIMIT);
    await writeDurableHostJson(markerPath, marker(state), MARKER_LIMIT);
    return structuredClone(state);
  };
  return {
    read,
    claim(frozen, ownerVerifier, capabilityHash, claimNonceHash, hold) {
      return inside(hold, async () => {
        validateFrozen(frozen);
        if (
          ownerVerifier !== frozen.request.admin.passwordHash ||
          !HASH.test(capabilityHash) ||
          !HASH.test(claimNonceHash)
        )
          invalid();
        const old = await read();
        assertOtherSetupAllowed(old);
        if (old?.status === "complete") conflict();
        const previous =
          old === null
            ? []
            : [
                ...old.previous,
                Object.fromEntries(
                  ATTEMPT_KEYS.map((key) => [key, old[key as keyof FirstSetupState]]),
                ) as unknown as Attempt,
              ];
        const allIds = new Set(
          previous.flatMap((attempt) => [
            attempt.frozen.attemptId,
            attempt.frozen.nodeId,
            attempt.frozen.administratorId,
            ...attempt.frozen.modules.map((module) => module.eventId),
          ]),
        );
        if (
          [
            frozen.attemptId,
            frozen.nodeId,
            frozen.administratorId,
            ...frozen.modules.map((module) => module.eventId),
          ].some((id) => allIds.has(id))
        )
          conflict();
        const state: FirstSetupState = {
          version: 1,
          venueDir,
          stateDir,
          frozen: structuredClone(frozen),
          frozenDigest: frozenDigest(frozen),
          revision: 1,
          ownerGeneration: 1,
          ownerVerifier,
          capabilityHash,
          claimNonceHash,
          status: "claimed",
          consumptionIntent: false,
          inputs: {},
          result: null,
          history: [{ kind: "claim", revision: 1, ownerGeneration: 1 }],
          previous,
        };
        if (Buffer.byteLength(JSON.stringify(state)) > STATE_LIMIT) invalid();
        // A surviving venue marker refuses competitors even if the state-root write never completes.
        await writeDurableHostJson(markerPath, marker(state, "claiming"), MARKER_LIMIT);
        return persist(state);
      });
    },
    update(attemptId, revision, change, hold) {
      return inside(hold, async () => {
        const state = await read();
        if (state === null || state.frozen.attemptId !== attemptId || state.revision !== revision)
          conflict();
        const allowed =
          change.kind === "input"
            ? ["kind", "module", "input"]
            : change.kind === "checked"
              ? ["kind", "module"]
              : change.kind === "resume"
                ? ["kind", "capabilityHash"]
                : change.kind === "committed"
                  ? ["kind", "result"]
                  : ["kind"];
        if (!keys(change, allowed)) invalid();
        if (state.status === "complete" || state.status === "abandoned") conflict();
        switch (change.kind) {
          case "resume":
            if (!HASH.test(change.capabilityHash)) invalid();
            state.ownerGeneration++;
            state.capabilityHash = change.capabilityHash;
            break;
          case "input":
          case "checked":
            if (state.status !== "claimed") conflict();
            if (!state.frozen.modules.some((module) => module.module === change.module)) invalid();
            if (change.kind === "input") {
              publicValue(change.input);
              state.inputs[change.module] = structuredClone(change.input);
            }
            break;
          case "consumption-intent":
            if (state.status !== "claimed") conflict();
            state.consumptionIntent = true;
            state.status = change.kind;
            break;
          case "activation-started":
            if (state.status !== "consumption-intent") conflict();
            state.status = change.kind;
            break;
          case "committed":
            if (state.status !== "activation-started") conflict();
            publicValue(change.result);
            state.result = structuredClone(change.result);
            state.status = change.kind;
            break;
          case "publication":
            if (state.status !== "committed") conflict();
            state.status = change.kind;
            break;
          case "complete":
            if (state.status !== "publication") throw new AppError("setup.attempt_uncertain", {});
            state.status = change.kind;
            break;
          case "abandoned":
          case "uncertain":
            state.status = change.kind;
            break;
          default:
            invalid();
        }
        state.revision++;
        state.history.push({
          kind: change.kind,
          revision: state.revision,
          ownerGeneration: state.ownerGeneration,
        });
        return persist(state);
      });
    },
  };
}
