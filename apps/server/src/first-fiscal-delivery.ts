import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual as equal } from "node:util";
import { AppError } from "@waitron/shared";
import { initialSetupFor, type OperationBinding, type WaitronModule } from "@waitron/module";
import {
  readDurableHostJson,
  writeDurableHostJson,
  type FirstSetupCoordinator,
  type FirstSetupHold,
  type FirstSetupState,
  type FirstSetupStore,
} from "@waitron/provisioning";
import type { createFirstSetupOwner, FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import {
  firstSetupFrozenDigest,
  type createFirstSetupNodeKeys,
  type StagedNodeKey,
} from "./first-setup-node-key.js";
interface Options {
  stateDir: string;
  store: FirstSetupStore;
  coordinator: FirstSetupCoordinator;
  bootId: string;
  owner: ReturnType<typeof createFirstSetupOwner>;
  keys: ReturnType<typeof createFirstSetupNodeKeys>;
  modules: readonly WaitronModule[];
}
export interface FirstFiscalDeliveryInput {
  module: string;
  stageId: string;
  inputDigest: string;
  historyDigest: string;
  documentDigest: string;
  statement: unknown;
}
export type FirstFiscalKeptInput = Omit<FirstFiscalDeliveryInput, "statement"> & { kept: true };
interface Manifest {
  version: 1;
  id: string;
  module: string;
  attemptId: string;
  revision: number;
  ownerGeneration: number;
  frozenDigest: string;
  stage: StagedNodeKey;
  inputDigest: string;
  historyDigest: string;
  documentDigest: string;
  publicDigest: string;
  length: number;
  chunks: number;
}
function refuse(): never {
  throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
}
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function exact(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Reflect.ownKeys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k))
  );
}
const hex = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const name = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z][a-z0-9-]*$/.test(v) && v.length <= 128;
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) invalid();
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(",")}]`;
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], depth + 1)}`,
    )
    .join(",")}}`;
}
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const firstFiscalPublicDigest = (value: unknown) => hash(canonical(value));
const CHUNK = 32768,
  MAX = 8 * 1024 * 1024;
function input(value: unknown, kept: boolean): FirstFiscalDeliveryInput | FirstFiscalKeptInput {
  if (
    !exact(value, [
      "module",
      "stageId",
      "inputDigest",
      "historyDigest",
      "documentDigest",
      kept ? "kept" : "statement",
    ]) ||
    !name(value.module) ||
    typeof value.stageId !== "string" ||
    ![value.inputDigest, value.historyDigest, value.documentDigest].every(hex) ||
    (kept && value.kept !== true)
  )
    refuse();
  return value as unknown as FirstFiscalDeliveryInput | FirstFiscalKeptInput;
}
export function createFirstFiscalDelivery(options: Options) {
  const root = join(options.stateDir, "first-fiscal-documents");
  const grants = new Map<string, { manifest: Manifest; expires: number; bootId: string }>();
  const invalidate = (attemptId: string) => {
    for (const [key, g] of grants) if (g.manifest.attemptId === attemptId) grants.delete(key);
  };
  const inside = <T>(
    hold: FirstSetupHold | undefined,
    run: (held: FirstSetupHold) => Promise<T>,
  ) =>
    hold === undefined
      ? options.coordinator.run(run)
      : options.coordinator.held(hold, () => run(hold));
  const seat = (state: FirstSetupState, module: string) => {
    const frozen = state.frozen.modules.find((m) => m.module === module),
      installed = options.modules.find((m) => m.name === module);
    const contribution = initialSetupFor(options.modules, module);
    if (
      frozen === undefined ||
      installed?.version !== frozen.version ||
      contribution?.documentConfirmation === undefined
    )
      refuse();
    return contribution;
  };
  const readManifest = async (module: string): Promise<Manifest | null> => {
    if (!name(module)) refuse();
    const v = await readDurableHostJson(join(root, `${module}.json`), 8192);
    if (v === null) return null;
    if (
      !exact(v, [
        "version",
        "id",
        "module",
        "attemptId",
        "revision",
        "ownerGeneration",
        "frozenDigest",
        "stage",
        "inputDigest",
        "historyDigest",
        "documentDigest",
        "publicDigest",
        "length",
        "chunks",
      ]) ||
      v.version !== 1 ||
      v.module !== module ||
      typeof v.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(v.id) ||
      typeof v.attemptId !== "string" ||
      ![v.revision, v.ownerGeneration, v.length, v.chunks].every(
        (x) => typeof x === "number" && Number.isSafeInteger(x) && x > 0,
      ) ||
      ![v.frozenDigest, v.inputDigest, v.historyDigest, v.documentDigest, v.publicDigest].every(
        hex,
      ) ||
      Number(v.length) > MAX ||
      v.chunks !== Math.ceil(Number(v.length) / CHUNK)
    )
      invalid();
    return v as unknown as Manifest;
  };
  const readPublic = async (m: Manifest) => {
    const parts: Buffer[] = [];
    for (let i = 0; i < m.chunks; i++) {
      const chunk = await readDurableHostJson(join(root, `${m.id}-${i}.json`), 48000);
      if (!exact(chunk, ["data"]) || typeof chunk.data !== "string" || chunk.data.length > 44000)
        invalid();
      const bytes = Buffer.from(chunk.data, "base64");
      if (
        bytes.toString("base64") !== chunk.data ||
        bytes.length !== (i === m.chunks - 1 ? m.length - i * CHUNK : CHUNK)
      )
        invalid();
      parts.push(bytes);
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== m.length || hash(bytes) !== m.publicDigest) invalid();
    try {
      return JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      return invalid();
    }
  };
  const matches = (
    m: Manifest,
    state: FirstSetupState,
    value: Omit<FirstFiscalDeliveryInput, "statement">,
  ) =>
    m.attemptId === state.frozen.attemptId &&
    m.revision === state.revision &&
    m.ownerGeneration === state.ownerGeneration &&
    m.frozenDigest === firstSetupFrozenDigest(state) &&
    m.module === value.module &&
    m.stage.stageId === value.stageId &&
    m.inputDigest === value.inputDigest &&
    m.historyDigest === value.historyDigest &&
    m.documentDigest === value.documentDigest &&
    firstFiscalPublicDigest(state.inputs[value.module]) === value.inputDigest;
  const checked = async (state: FirstSetupState, m: Manifest) => {
    const current = await readPublic(m),
      contribution = seat(state, m.module),
      context = firstSetupModuleContext(state, m.module);
    return contribution.documentConfirmation!(
      context,
      contribution.inspect(context, state.inputs[m.module]),
      {
        statement: current,
        historyDigest: m.historyDigest,
        documentDigest: m.documentDigest,
        prior: null,
      },
    );
  };
  return {
    invalidate,
    async has(binding: OperationBinding) {
      const state = await options.store.read();
      if (state === null || binding.action !== "setup") return false;
      const manifest = await readManifest(binding.module);
      return manifest?.attemptId === state.frozen.attemptId;
    },
    registerFirstFiscalDelivery(
      owner: FirstSetupOwnerAttempt,
      supplied: FirstFiscalDeliveryInput,
      hold?: FirstSetupHold,
    ) {
      invalidate(owner.attemptId);
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner),
          value = input(supplied, false) as FirstFiscalDeliveryInput;
        if (
          !state.consumptionIntent ||
          !["consumption-intent", "committed", "publication"].includes(state.status)
        )
          refuse();
        const stage = await options.keys.readStage(owner, held);
        if (
          stage.stageId !== value.stageId ||
          !Object.hasOwn(state.inputs, value.module) ||
          firstFiscalPublicDigest(state.inputs[value.module]) !== value.inputDigest
        )
          refuse();
        const prior = await readManifest(value.module),
          contribution = seat(state, value.module),
          context = firstSetupModuleContext(state, value.module);
        const current = contribution.documentConfirmation!(
          context,
          contribution.inspect(context, state.inputs[value.module]),
          {
            statement: structuredClone(value.statement),
            historyDigest: value.historyDigest,
            documentDigest: value.documentDigest,
            prior: prior === null ? null : await readPublic(prior),
          },
        );
        const bytes = Buffer.from(canonical(current));
        if (bytes.length === 0 || bytes.length > MAX) invalid();
        if (prior !== null) {
          if (
            prior.attemptId !== state.frozen.attemptId ||
            prior.frozenDigest !== firstSetupFrozenDigest(state) ||
            !equal(prior.stage, stage) ||
            prior.inputDigest !== value.inputDigest ||
            prior.historyDigest !== value.historyDigest ||
            prior.documentDigest !== value.documentDigest
          )
            refuse();
          if (matches(prior, state, value) && prior.publicDigest === hash(bytes)) return;
        }
        const id = randomUUID();
        for (let i = 0; i < Math.ceil(bytes.length / CHUNK); i++)
          await writeDurableHostJson(
            join(root, `${id}-${i}.json`),
            { data: bytes.subarray(i * CHUNK, (i + 1) * CHUNK).toString("base64") },
            48000,
          );
        const manifest: Manifest = {
          version: 1,
          id,
          module: value.module,
          attemptId: owner.attemptId,
          revision: state.revision,
          ownerGeneration: state.ownerGeneration,
          frozenDigest: firstSetupFrozenDigest(state),
          stage,
          inputDigest: value.inputDigest,
          historyDigest: value.historyDigest,
          documentDigest: value.documentDigest,
          publicDigest: hash(bytes),
          length: bytes.length,
          chunks: Math.ceil(bytes.length / CHUNK),
        };
        // Only the final manifest makes a fully validated set of public chunks readable.
        await writeDurableHostJson(join(root, `${value.module}.json`), manifest, 8192);
      });
    },
    confirmFirstFiscalDocumentKept(
      owner: FirstSetupOwnerAttempt,
      supplied: FirstFiscalKeptInput,
      reconfirmation: string,
      hold?: FirstSetupHold,
    ) {
      invalidate(owner.attemptId);
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner);
        await options.owner.consumeReconfirmation(owner, reconfirmation, "activation", held);
        const value = input(supplied, true) as FirstFiscalKeptInput,
          manifest = await readManifest(value.module);
        if (
          !state.consumptionIntent ||
          !["consumption-intent", "committed", "publication"].includes(state.status) ||
          manifest === null ||
          !matches(manifest, state, value) ||
          !equal(manifest.stage, await options.keys.readStage(owner, held))
        )
          refuse();
        await checked(state, manifest);
        grants.set(value.module, {
          manifest,
          expires: performance.now() + 300000,
          bootId: options.bootId,
        });
      });
    },
    async read(
      binding: OperationBinding,
    ): Promise<{ trust: unknown; current: unknown } | undefined> {
      const grant = grants.get(binding.module);
      grants.delete(binding.module);
      const state = await options.store.read();
      if (state === null || binding.action !== "setup") return undefined;
      const manifest = await readManifest(binding.module);
      if (manifest === null && grant === undefined) return refuse();
      if (
        grant === undefined ||
        manifest === null ||
        grant.bootId !== options.bootId ||
        performance.now() >= grant.expires ||
        !equal(manifest, grant.manifest) ||
        !matches(manifest, state, {
          module: binding.module,
          stageId: manifest.stage.stageId,
          inputDigest: manifest.inputDigest,
          historyDigest: manifest.historyDigest,
          documentDigest: manifest.documentDigest,
        }) ||
        !["consumption-intent", "committed", "publication"].includes(state.status) ||
        !equal(binding, firstSetupModuleContext(state, binding.module).binding)
      )
        refuse();
      const stage = await readDurableHostJson(
        join(options.stateDir, "first-setup-node-key.json"),
        4096,
      );
      if (!equal(stage, manifest.stage)) refuse();
      const current = await checked(state, manifest);
      if (!equal(state, await options.store.read()) || performance.now() >= grant.expires) refuse();
      return { trust: null, current: structuredClone(current) };
    },
  };
}
