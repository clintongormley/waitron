import "./errors.js";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { hashSecret } from "@waitron/identity";
import { nodeRoles, setBreakGlassVerifierTx, withTransaction, type Database } from "@waitron/db";
import { generatePassword } from "./identifiers.js";
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
    const alphabet = "34679ACDEFHJKMNPQRTUVWXY";
    let name: string;
    do
      name = `${new Date().toISOString().slice(0, 10)} · ${Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
    while (name === prior?.name);
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
        // Installation follows the checked fiscal commit; publication retries must keep the delivered pair.
        await withTransaction(db, async (tx) => {
          const [stored] = await tx
            .select({ verifier: nodeRoles.breakGlassVerifier, name: nodeRoles.breakGlassKeyName })
            .from(nodeRoles)
            .where(eq(nodeRoles.nodeId, stage.nodeId));
          const verifier = stored?.verifier ?? null,
            name = stored?.name ?? null;
          if (verifier === null && name === null)
            await setBreakGlassVerifierTx(tx, stage.nodeId, stage.verifier, stage.name);
          else if (verifier !== stage.verifier || name !== stage.name) uncertain();
        });
      });
    },
  };
}
