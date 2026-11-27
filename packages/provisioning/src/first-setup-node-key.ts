import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AppError, isCalendarDate } from "@waitron/shared";
import { masterKeyName } from "@waitron/credentials";
import {
  insertMasterKey,
  insertRecoveryPack,
  markRecoveryPackReceived,
  readCurrentMasterKey,
  readRecoveryPack,
  withTransaction,
  type Database,
} from "@waitron/db";
import { makeNewMasterKey, type MadeMasterKey } from "./new-master-key.js";
import { readSetupFlowRecord, updateSetupFlowSection } from "./setup-flow-record.js";
import type {
  FirstSetupCoordinator,
  FirstSetupHold,
  FirstSetupState,
  FirstSetupStore,
} from "./first-setup-state.js";
import type { createFirstSetupOwner, FirstSetupOwnerAttempt } from "./first-setup-owner.js";

export interface StagedNodeKey {
  readonly version: 1;
  readonly stageId: string;
  readonly attemptId: string;
  readonly nodeId: string;
  readonly frozenDigest: string;
  readonly masterKeyName: string;
  /** Lower-case hex; the master key itself is never staged. */
  readonly masterKeyCheckValue: string;
  /** The sealing public key, SPKI DER, as base64. */
  readonly masterKeyPublicKey: string;
}
interface Options {
  stateDir: string;
  store: FirstSetupStore;
  coordinator: FirstSetupCoordinator;
  owner: ReturnType<typeof createFirstSetupOwner>;
}
function invalid(): never {
  throw new AppError("setup.attempt_invalid", {});
}
function uncertain(): never {
  throw new AppError("setup.attempt_uncertain", {});
}
export function firstSetupFrozenDigest(state: FirstSetupState): string {
  return createHash("sha256").update(JSON.stringify(state.frozen)).digest("hex");
}
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
function masterKeyFactsValid(name: unknown, checkValue: unknown, publicKey: unknown): boolean {
  if (
    typeof name !== "string" ||
    typeof checkValue !== "string" ||
    !/^[0-9a-f]{64}$/.test(checkValue) ||
    typeof publicKey !== "string"
  )
    return false;
  const bytes = Buffer.from(publicKey, "base64");
  if (
    bytes.toString("base64") !== publicKey ||
    bytes.length !== 44 ||
    !bytes.subarray(0, 12).equals(X25519_SPKI_PREFIX)
  )
    return false;
  const day = name.slice(0, 10);
  return isCalendarDate(day) && name === masterKeyName(bytes, day);
}
export function readFirstSetupStagedKey(value: unknown, state: FirstSetupState): StagedNodeKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const v = value as Record<string, unknown>;
  const fields = [
    "version",
    "stageId",
    "attemptId",
    "nodeId",
    "frozenDigest",
    "masterKeyName",
    "masterKeyCheckValue",
    "masterKeyPublicKey",
  ];
  if (
    Reflect.ownKeys(v).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(v, k)) ||
    v.version !== 1 ||
    typeof v.stageId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.stageId) ||
    v.attemptId !== state.frozen.attemptId ||
    v.nodeId !== state.frozen.nodeId ||
    v.frozenDigest !== firstSetupFrozenDigest(state) ||
    !masterKeyFactsValid(v.masterKeyName, v.masterKeyCheckValue, v.masterKeyPublicKey)
  )
    invalid();
  return Object.freeze({ ...v }) as unknown as StagedNodeKey;
}
export function createFirstSetupNodeKeys(options: Options) {
  let transient: { stage: StagedNodeKey; made: MadeMasterKey; ownerGeneration: number } | undefined;
  const inside = <T>(
    hold: FirstSetupHold | undefined,
    run: (held: FirstSetupHold) => Promise<T>,
  ) =>
    hold === undefined
      ? options.coordinator.run(run)
      : options.coordinator.held(hold, () => run(hold));
  const read = async (state: FirstSetupState) => {
    const data = (await readSetupFlowRecord(options.stateDir))?.nodeKey;
    if (data !== undefined && Buffer.byteLength(JSON.stringify(data)) > 4096) invalid();
    return data === undefined ? null : readFirstSetupStagedKey(data, state);
  };
  const generate = async (state: FirstSetupState) => {
    const masterKey = makeNewMasterKey(new Date().toISOString().slice(0, 10));
    const stage: StagedNodeKey = {
      version: 1,
      stageId: randomUUID(),
      attemptId: state.frozen.attemptId,
      nodeId: state.frozen.nodeId,
      frozenDigest: firstSetupFrozenDigest(state),
      masterKeyName: masterKey.made.masterKeyName,
      masterKeyCheckValue: masterKey.checkValue,
      masterKeyPublicKey: masterKey.publicKey.toString("base64"),
    };
    await updateSetupFlowSection(options.stateDir, "nodeKey", () => stage);
    transient = { stage, made: masterKey.made, ownerGeneration: state.ownerGeneration };
    return structuredClone({ stage, ...transient.made });
  };
  return {
    stageInitialNodeKey(
      owner: FirstSetupOwnerAttempt,
      reconfirmation: string,
      hold?: FirstSetupHold,
    ) {
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner);
        await options.owner.consumeReconfirmation(owner, reconfirmation, "block-use", held);
        if (!["claimed", "consumption-intent"].includes(state.status))
          throw new AppError("setup.attempt_conflict", {});
        const prior = await read(state);
        if (prior !== null) {
          if (transient === undefined) throw new AppError("setup.node_key_lost", {});
          if (
            transient.ownerGeneration !== state.ownerGeneration ||
            !isDeepStrictEqual(prior, transient.stage)
          )
            throw new AppError("setup.attempt_conflict", {});
          return structuredClone({ stage: transient.stage, ...transient.made });
        }
        return generate(state);
      });
    },
    reissueInitialNodeKey(
      owner: FirstSetupOwnerAttempt,
      reconfirmation: string,
      hold?: FirstSetupHold,
    ) {
      return inside(hold, async (held) => {
        const state = await options.owner.authorize(owner);
        await options.owner.consumeReconfirmation(owner, reconfirmation, "node-key-reissue", held);
        if (!["claimed", "consumption-intent"].includes(state.status))
          throw new AppError("setup.attempt_conflict", {});
        if ((await read(state)) === null) invalid();
        return generate(state);
      });
    },
    readStage(owner: FirstSetupOwnerAttempt, hold?: FirstSetupHold) {
      return inside(hold, async () => {
        const state = await options.owner.authorize(owner);
        return (await read(state)) ?? invalid();
      });
    },
    installStagedNodeKey(
      db: Database,
      state: FirstSetupState,
      stage: StagedNodeKey,
      hold?: FirstSetupHold,
    ) {
      return inside(hold, async () => {
        const result = state.result as { venue?: { nodeId?: unknown } } | null;
        if (
          !["committed", "publication"].includes(state.status) ||
          result?.venue?.nodeId !== state.frozen.nodeId
        )
          uncertain();
        if (
          stage.frozenDigest !== firstSetupFrozenDigest(state) ||
          !isDeepStrictEqual(state, await options.store.read()) ||
          !isDeepStrictEqual(stage, await read(state))
        )
          uncertain();
        // Pack 1 and the master key are written in one venue.db transaction, so a publication
        // retry that finds pack 1 finds this stage's master key with it and writes nothing.
        await withTransaction(db, async (tx) => {
          if ((await readRecoveryPack(tx, stage.nodeId, 1)) !== null) {
            if ((await readCurrentMasterKey(tx))?.name !== stage.masterKeyName) uncertain();
            return;
          }
          const at = new Date();
          const masterKeyNumber = await insertMasterKey(tx, {
            name: stage.masterKeyName,
            checkValue: stage.masterKeyCheckValue,
            publicKey: Buffer.from(stage.masterKeyPublicKey, "base64"),
            madeAt: at,
            madeBy: null,
          });
          await insertRecoveryPack(tx, {
            nodeId: stage.nodeId,
            number: 1,
            madeAt: at,
            madeBy: null,
            parts: [
              { part: "bucket", state: "not-set-up" },
              { part: "archives", state: "not-set-up" },
              {
                part: "master-key",
                state: "included",
                masterKeyNumber,
                masterKeyName: stage.masterKeyName,
              },
            ],
          });
          // The first-hour step's Continue confirmed this pack reached the person.
          await markRecoveryPackReceived(tx, stage.nodeId, 1, at);
        });
      });
    },
  };
}
