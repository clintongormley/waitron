import { isDeepStrictEqual as equal } from "node:util";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { initialSetupFor, type WaitronModule } from "@waitron/module";
import {
  readDurableHostJson,
  writeDurableHostJson,
  type FirstSetupState,
  type FirstSetupHold,
  type FirstSetupStore,
  type FirstSetupCoordinator,
} from "@waitron/provisioning";
import type { createFirstSetupOwner, FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import { firstSetupModuleContext } from "./first-fiscal-evidence.js";
import { firstFiscalPublicDigest } from "./first-fiscal-delivery.js";
import {
  firstSetupFrozenDigest,
  readFirstSetupStagedKey,
  type createFirstSetupNodeKeys,
  type StagedNodeKey,
} from "./first-setup-node-key.js";
import "./errors.js";

export interface RecoveryDeliveryReference {
  module: string;
  stageId: string;
  inputDigest: string;
  bindingDigest: string;
  documentDigest: string;
}
export interface RecoveryDeliveryInput extends RecoveryDeliveryReference {
  statement: unknown;
}
export interface RecoveryKeptInput extends RecoveryDeliveryReference {
  kept: true;
}
interface Manifest extends RecoveryDeliveryInput {
  version: 1;
  kind: "recovery-key-delivery";
  attemptId: string;
  revision: number;
  ownerGeneration: number;
  frozenDigest: string;
  stage: StagedNodeKey;
}
interface Options {
  stateDir: string;
  store: FirstSetupStore;
  coordinator: FirstSetupCoordinator;
  owner: ReturnType<typeof createFirstSetupOwner>;
  keys: ReturnType<typeof createFirstSetupNodeKeys>;
  modules: readonly WaitronModule[];
}
const limit = 16384;
function refuse(): never {
  throw new AppError("setup.not_ready", {});
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function reference(
  value: unknown,
  extra: string[],
): asserts value is RecoveryDeliveryInput & RecoveryKeptInput {
  if (
    !exact(value, [
      "module",
      "stageId",
      "inputDigest",
      "bindingDigest",
      "documentDigest",
      ...extra,
    ]) ||
    typeof value.module !== "string" ||
    !/^[a-z][a-z0-9-]{0,127}$/.test(value.module) ||
    typeof value.stageId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.stageId) ||
    [value.inputDigest, value.bindingDigest, value.documentDigest].some(
      (digest) => typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest),
    )
  )
    refuse();
}
function seat(state: FirstSetupState, module: string, modules: readonly WaitronModule[]) {
  const frozen = state.frozen.modules.find((entry) => entry.module === module),
    installed = modules.find((entry) => entry.name === module),
    contribution = initialSetupFor(modules, module);
  if (
    frozen === undefined ||
    frozen.version !== installed?.version ||
    contribution?.recoveryDocument === undefined
  )
    refuse();
  return contribution;
}
function readManifest(
  value: unknown,
  state: FirstSetupState,
  module: string,
  modules: readonly WaitronModule[],
): Manifest | null {
  if (value === null) return null;
  if (
    !exact(value, [
      "version",
      "kind",
      "module",
      "stageId",
      "inputDigest",
      "bindingDigest",
      "documentDigest",
      "statement",
      "attemptId",
      "revision",
      "ownerGeneration",
      "frozenDigest",
      "stage",
    ]) ||
    value.version !== 1 ||
    value.kind !== "recovery-key-delivery" ||
    value.module !== module ||
    value.attemptId !== state.frozen.attemptId ||
    value.frozenDigest !== firstSetupFrozenDigest(state) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    Number(value.revision) > state.revision ||
    !Number.isSafeInteger(value.ownerGeneration) ||
    Number(value.ownerGeneration) < 1 ||
    Number(value.ownerGeneration) > state.ownerGeneration
  )
    refuse();
  const input = Object.fromEntries(
    ["module", "stageId", "inputDigest", "bindingDigest", "documentDigest", "statement"].map(
      (key) => [key, value[key]],
    ),
  );
  reference(input, ["statement"]);
  const manifest = value as unknown as Manifest;
  readFirstSetupStagedKey(manifest.stage, state);
  if (
    manifest.stage.stageId !== manifest.stageId ||
    manifest.stage.nodeId !== state.frozen.nodeId ||
    manifest.inputDigest !== firstFiscalPublicDigest(state.inputs[module]) ||
    manifest.bindingDigest !== firstFiscalPublicDigest(manifest.statement)
  )
    refuse();
  const contribution = seat(state, module, modules),
    context = firstSetupModuleContext(state, module);
  if (
    !equal(
      contribution.recoveryDocument!(context, contribution.inspect(context, state.inputs[module]), {
        ...manifest,
        stage: { nodeId: manifest.stage.nodeId, name: manifest.stage.name },
        identity: {
          taxpayerName: state.frozen.request.legalName,
          venueName: state.frozen.request.location.name,
        },
      }),
      manifest.statement,
    )
  )
    refuse();
  return manifest;
}
export function readFirstSetupRecoveryDeliverySnapshot(
  module: string,
  state: FirstSetupState,
  originals: readonly { name: string; bytes: Uint8Array | null }[],
  modules: readonly WaitronModule[],
) {
  const bytes = originals.find(
    (entry) => entry.name === `state/first-fiscal-documents/${module}.recovery.json`,
  )?.bytes;
  if (bytes == null) return null;
  if (bytes.length > limit) refuse();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return refuse();
  }
  return readManifest(value, state, module, modules);
}
export function createFirstSetupRecoveryDelivery(options: Options) {
  const grants = new Map<string, { manifest: Manifest; expires: number }>();
  const path = (module: string) =>
    join(options.stateDir, "first-fiscal-documents", `${module}.recovery.json`);
  const inside = <T>(
    hold: FirstSetupHold | undefined,
    run: (held: FirstSetupHold) => Promise<T>,
  ) =>
    hold === undefined
      ? options.coordinator.run(run)
      : options.coordinator.held(hold, () => run(hold));
  const read = async (state: FirstSetupState, module: string) =>
    readManifest(await readDurableHostJson(path(module), limit), state, module, options.modules);
  const sameReference = (manifest: Manifest, value: RecoveryDeliveryReference) =>
    ["module", "stageId", "inputDigest", "bindingDigest", "documentDigest"].every(
      (key) => manifest[key as keyof Manifest] === value[key as keyof RecoveryDeliveryReference],
    );
  return {
    invalidate(attemptId: string) {
      for (const [module, grant] of grants)
        if (grant.manifest.attemptId === attemptId) grants.delete(module);
    },
    registerRecoveryDocumentDelivery(
      owner: FirstSetupOwnerAttempt,
      supplied: RecoveryDeliveryInput,
      hold?: FirstSetupHold,
    ) {
      this.invalidate(owner.attemptId);
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner);
        reference(supplied, ["statement"]);
        if (
          state.status !== "consumption-intent" ||
          !state.consumptionIntent ||
          !Object.hasOwn(state.inputs, supplied.module)
        )
          refuse();
        const stage = await options.keys.readStage(owner, held),
          contribution = seat(state, supplied.module, options.modules),
          context = firstSetupModuleContext(state, supplied.module);
        if (
          stage.stageId !== supplied.stageId ||
          supplied.inputDigest !== firstFiscalPublicDigest(state.inputs[supplied.module]) ||
          supplied.bindingDigest !== firstFiscalPublicDigest(supplied.statement)
        )
          refuse();
        const statement = contribution.recoveryDocument!(
          context,
          contribution.inspect(context, state.inputs[supplied.module]),
          {
            ...supplied,
            stage: { nodeId: stage.nodeId, name: stage.name },
            identity: {
              taxpayerName: state.frozen.request.legalName,
              venueName: state.frozen.request.location.name,
            },
          },
        );
        if (!equal(statement, supplied.statement)) refuse();
        const manifest: Manifest = {
          ...structuredClone(supplied),
          statement: structuredClone(statement),
          version: 1,
          kind: "recovery-key-delivery",
          attemptId: state.frozen.attemptId,
          revision: state.revision,
          ownerGeneration: state.ownerGeneration,
          frozenDigest: firstSetupFrozenDigest(state),
          stage,
        };
        const prior = await read(state, supplied.module);
        if (
          prior !== null &&
          !equal(
            { ...prior, revision: manifest.revision, ownerGeneration: manifest.ownerGeneration },
            manifest,
          )
        )
          refuse();
        await writeDurableHostJson(path(supplied.module), manifest, limit);
      });
    },
    confirmRecoveryDocumentKept(
      owner: FirstSetupOwnerAttempt,
      supplied: RecoveryKeptInput,
      reconfirmation: string,
      hold?: FirstSetupHold,
    ) {
      this.invalidate(owner.attemptId);
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner);
        await options.owner.consumeReconfirmation(owner, reconfirmation, "activation", held);
        reference(supplied, ["kept"]);
        const manifest = await read(state, supplied.module);
        if (
          supplied.kept !== true ||
          state.status !== "consumption-intent" ||
          manifest === null ||
          manifest.revision !== state.revision ||
          manifest.ownerGeneration !== state.ownerGeneration ||
          !sameReference(manifest, supplied) ||
          !equal(manifest.stage, await options.keys.readStage(owner, held))
        )
          refuse();
        grants.set(supplied.module, { manifest, expires: performance.now() + 300000 });
      });
    },
    consume(owner: FirstSetupOwnerAttempt, module: string, hold?: FirstSetupHold) {
      const grant = grants.get(module);
      grants.delete(module);
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner),
          manifest = await read(state, module);
        if (
          grant === undefined ||
          performance.now() >= grant.expires ||
          manifest === null ||
          !equal(grant.manifest, manifest) ||
          manifest.revision !== state.revision ||
          manifest.ownerGeneration !== state.ownerGeneration ||
          !equal(manifest.stage, await options.keys.readStage(owner, held))
        )
          refuse();
      });
    },
    install(
      db: import("@waitron/db").Database,
      state: FirstSetupState,
      owner: FirstSetupOwnerAttempt,
      module: string,
      hold: FirstSetupHold,
    ) {
      return inside(hold, async (held) => {
        await options.owner.authorize(owner);
        const manifest = await read(state, module);
        if (manifest === null) refuse();
        await options.keys.installStagedNodeKey(db, state, manifest.stage, held);
      });
    },
  };
}
