import "./errors.js";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { hashSecret } from "@waitron/identity";
import {
  insertRecoveryPack,
  markRecoveryPackReceived,
  readRecoveryPack,
  withNodeTransaction,
  withTransaction,
} from "@waitron/db";
import {
  readRecoveryKeyName,
  readRecoveryKeyVerifier,
  setRecoveryKeyTx,
  type VenueAndNodeHandles,
} from "@waitron/node-db";
import { generatePassword } from "./identifiers.js";
import { newBreakGlassKeyName } from "./server-key-name.js";
import { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
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
  readonly name: string;
  readonly verifier: string;
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
export function readFirstSetupStagedKey(value: unknown, state: FirstSetupState): StagedNodeKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const v = value as Record<string, unknown>;
  const fields = ["version", "stageId", "attemptId", "nodeId", "frozenDigest", "name", "verifier"];
  if (
    Reflect.ownKeys(v).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(v, k)) ||
    v.version !== 1 ||
    typeof v.stageId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.stageId) ||
    v.attemptId !== state.frozen.attemptId ||
    v.nodeId !== state.frozen.nodeId ||
    v.frozenDigest !== firstSetupFrozenDigest(state) ||
    typeof v.name !== "string" ||
    !/^\d{4}-\d\d-\d\d · [34679ACDEFHJKMNPQRTUVWXY]{4}$/.test(v.name) ||
    typeof v.verifier !== "string" ||
    !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(v.verifier)
  )
    invalid();
  return Object.freeze({ ...v }) as unknown as StagedNodeKey;
}
export function createFirstSetupNodeKeys(options: Options) {
  const path = join(options.stateDir, "first-setup-node-key.json");
  let transient:
    | {
        stage: StagedNodeKey;
        key: { nodeId: string; name: string; secret: string };
        ownerGeneration: number;
      }
    | undefined;
  const inside = <T>(
    hold: FirstSetupHold | undefined,
    run: (held: FirstSetupHold) => Promise<T>,
  ) =>
    hold === undefined
      ? options.coordinator.run(run)
      : options.coordinator.held(hold, () => run(hold));
  const read = async (state: FirstSetupState) => {
    const data = await readDurableHostJson(path, 4096);
    return data === null ? null : readFirstSetupStagedKey(data, state);
  };
  const generate = async (state: FirstSetupState, prior?: StagedNodeKey) => {
    const secret = generatePassword();
    const name = newBreakGlassKeyName(
      new Date().toISOString().slice(0, 10),
      new Set(prior === undefined ? [] : [prior.name]),
    );
    const stage: StagedNodeKey = {
      version: 1,
      stageId: randomUUID(),
      attemptId: state.frozen.attemptId,
      nodeId: state.frozen.nodeId,
      frozenDigest: firstSetupFrozenDigest(state),
      name,
      verifier: hashSecret(secret),
    };
    await writeDurableHostJson(path, stage, 4096);
    transient = {
      stage,
      key: { nodeId: stage.nodeId, name, secret },
      ownerGeneration: state.ownerGeneration,
    };
    return structuredClone({ stage, key: transient.key });
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
          if (
            transient === undefined ||
            transient.ownerGeneration !== state.ownerGeneration ||
            !isDeepStrictEqual(prior, transient.stage)
          )
            throw new AppError("setup.attempt_conflict", {});
          return structuredClone({ stage: transient.stage, key: transient.key });
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
        const prior = (await read(state)) ?? invalid();
        return generate(state, prior);
      });
    },
    readStage(owner: FirstSetupOwnerAttempt, hold?: FirstSetupHold) {
      return inside(hold, async () => {
        const state = await options.owner.authorize(owner);
        return (await read(state)) ?? invalid();
      });
    },
    installStagedNodeKey(
      db: VenueAndNodeHandles,
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
        // Installation follows the checked fiscal commit; publication retries must keep the delivered pair.
        // Pack 1 is saved in venue.db first and the key in node.db after it, so an interruption
        // between them leaves pack 1 with no key, which the next run finishes.
        await withNodeTransaction(db.node, async (nodeTx) => {
          const verifier = await readRecoveryKeyVerifier(nodeTx, stage.nodeId);
          const name = await readRecoveryKeyName(nodeTx, stage.nodeId);
          const keyStaged = verifier === stage.verifier && name === stage.name;
          if (verifier !== null && !keyStaged) uncertain();
          await withTransaction(db.venue, async (tx) => {
            const pack = await readRecoveryPack(tx, stage.nodeId, 1);
            if (pack !== null) {
              const named = pack.parts.find((part) => part.part === "server-key")?.keyName;
              if (named !== stage.name) uncertain();
              return;
            }
            if (keyStaged) uncertain();
            const at = new Date();
            await insertRecoveryPack(tx, {
              nodeId: stage.nodeId,
              number: 1,
              madeAt: at,
              madeBy: null,
              parts: [
                { part: "bucket", state: "not-set-up" },
                { part: "archives", state: "not-set-up" },
                { part: "server-key", state: "included", keyName: stage.name, carriedKey: true },
              ],
            });
            // The first-hour step's "I kept it" confirmed this pack reached the person.
            await markRecoveryPackReceived(tx, stage.nodeId, 1, at);
          });
          if (!keyStaged) await setRecoveryKeyTx(nodeTx, stage.nodeId, stage.verifier, stage.name);
        });
      });
    },
  };
}
