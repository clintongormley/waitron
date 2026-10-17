import { AppError } from "@waitron/shared";
import { isDeepStrictEqual } from "node:util";
import { withTransaction, type Database } from "@waitron/db";
import { initialSetupFor } from "@waitron/module";
import type { createFirstSetupRuntime } from "./first-setup-runtime.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { FirstSetupState, FirstSetupHold } from "./first-setup-state.js";
import type { VenueResult } from "./venue-apply.js";
import { firstSetupModuleContext } from "./first-setup-module-context.js";
import { prepareFirstSetupFinishAudit } from "./first-setup-finish-audit.js";
import "./errors.js";

export type FirstSetupActivationHost = Pick<
  ReturnType<typeof createFirstSetupRuntime>,
  "modules" | "owner" | "store" | "assertSelection" | "assertFreshAssignment" | "recoveryDelivery"
>;
export interface CheckedFirstSetupCommit {
  venue: VenueResult;
  modules: Record<string, unknown>;
}
export interface FirstSetupActivationDeps {
  provision(beforeTransaction: () => Promise<void>): Promise<unknown>;
  check(state: FirstSetupState): Promise<CheckedFirstSetupCommit | null>;
  assertReady(): Promise<void>;
  confirmCommitted(state: FirstSetupState): Promise<void>;
  publish(state: FirstSetupState, checked: CheckedFirstSetupCommit): Promise<VenueResult>;
}
function conflict(): never {
  throw new AppError("setup.attempt_uncertain", {});
}
export function firstSetupProvisionRequest(state: FirstSetupState) {
  const offering = state.frozen.modules.filter((module) => module.request !== null);
  return {
    environment: state.frozen.environment,
    ...(state.frozen.configurationImport === undefined
      ? {}
      : {
          configurationImport: true,
          configurationDigest: state.frozen.configurationImport.digest,
          newTaxpayer: state.frozen.configurationImport.newTaxpayer,
        }),
    venue: structuredClone(state.frozen.request),
    initialOperations: {
      nodeId: state.frozen.nodeId,
      administratorId: state.frozen.administratorId,
      inputs: offering.map((module) => ({
        module: module.module,
        eventId: module.eventId,
        sourceId: state.frozen.sourceId,
        input: state.inputs[module.module],
      })),
    },
  };
}
export async function checkedFirstSetupCommit(
  host: Pick<FirstSetupActivationHost, "modules">,
  deps: {
    db?: Database;
    recoverProvision?: (
      request: ReturnType<typeof firstSetupProvisionRequest>,
    ) => Promise<VenueResult>;
  },
  state: FirstSetupState,
): Promise<CheckedFirstSetupCommit | null> {
  if (deps.db === undefined || deps.recoverProvision === undefined)
    throw new AppError("setup.not_ready", {});
  const offering = state.frozen.modules.filter(
    (module) => initialSetupFor(host.modules, module.module) !== undefined,
  );
  if (offering.length === 0) conflict();
  const results = await withTransaction(deps.db, async (tx) => {
    const checked: Record<string, unknown> = {};
    for (const module of offering) {
      const seat = initialSetupFor(host.modules, module.module)!;
      const result = await seat.committed(
        tx,
        firstSetupModuleContext(state, module.module),
        state.inputs[module.module],
      );
      if (result === null) return null;
      checked[module.module] = result;
    }
    return checked;
  });
  if (results === null) return null;
  const result = {
    venue: await deps.recoverProvision(firstSetupProvisionRequest(state)),
    modules: results,
  };
  if (state.result !== null && !isDeepStrictEqual(state.result, result)) conflict();
  return result;
}
// The caller holds venue exclusion and the setup coordinator through publication.
export async function activateFirstSetup(
  host: FirstSetupActivationHost,
  deps: FirstSetupActivationDeps,
  owner: FirstSetupOwnerAttempt,
  digest: string,
  hold: FirstSetupHold,
): Promise<VenueResult> {
  let state = await host.owner.authorize(owner);
  if (["uncertain", "abandoned", "claimed"].includes(state.status)) conflict();
  for (const module of state.frozen.modules)
    if (initialSetupFor(host.modules, module.module) !== undefined)
      await host.assertFreshAssignment(state, module.module);
  host.assertSelection(state);
  if (
    state.inputs.$publication !== undefined &&
    !isDeepStrictEqual(state.inputs.$publication, { digest })
  )
    throw new AppError("setup.attempt_conflict", {});
  const advance = async (change: Parameters<typeof host.store.update>[2]) => {
    state = await host.store.update(state.frozen.attemptId, state.revision, change, hold);
  };
  let checked: CheckedFirstSetupCommit | null;
  if (state.status === "consumption-intent") {
    for (const module of state.frozen.modules)
      if (initialSetupFor(host.modules, module.module)?.recoveryDocument !== undefined)
        await host.recoveryDelivery.consume(owner, module.module, hold);
    await deps.assertReady();
    try {
      await deps.provision(async () => {
        if (state.inputs.$publication === undefined)
          await advance({ kind: "publication-binding", digest });
        await advance({ kind: "activation-started" });
      });
    } catch (error) {
      if ((state as FirstSetupState).status === "activation-started") {
        try {
          checked = await deps.check(state);
          if (checked !== null) await advance({ kind: "committed", result: checked });
          else await advance({ kind: "uncertain" });
        } catch {
          await advance({ kind: "uncertain" });
        }
      }
      throw error;
    }
    if ((state as FirstSetupState).status !== "activation-started") conflict();
    checked = await deps.check(state);
    if (checked === null) {
      await advance({ kind: "uncertain" });
      conflict();
    }
    await advance({ kind: "committed", result: checked });
  } else {
    try {
      checked = await deps.check(state);
    } catch {
      await advance({ kind: "uncertain" });
      conflict();
    }
    if (checked === null) {
      await advance({ kind: "uncertain" });
      conflict();
    }
    await deps.confirmCommitted(state);
    if (state.status === "activation-started")
      await advance({ kind: "committed", result: checked });
  }
  return deps.publish(state, checked);
}

export interface FirstSetupPublicationDeps {
  db: Database;
  publishSelection(state: FirstSetupState): Promise<void>;
  publishIdentity(result: VenueResult, state: FirstSetupState): Promise<void>;
  sealSettings(): Promise<void>;
  persistTrading(result: VenueResult, state: FirstSetupState): Promise<void>;
  clearConfiguration?(): Promise<void>;
  installLegacyKey?(
    state: FirstSetupState,
    owner: FirstSetupOwnerAttempt,
    module: string,
    hold: FirstSetupHold,
  ): Promise<void>;
}
export async function publishCheckedFirstSetup(
  host: FirstSetupActivationHost,
  deps: FirstSetupPublicationDeps,
  state: FirstSetupState,
  checked: CheckedFirstSetupCommit,
  owner: FirstSetupOwnerAttempt,
  digest: string,
  hold: FirstSetupHold,
  beforeComplete?: () => Promise<unknown>,
): Promise<VenueResult> {
  if (
    !["committed", "publication"].includes(state.status) ||
    !isDeepStrictEqual(state.result, checked)
  )
    conflict();
  if (!isDeepStrictEqual(state.inputs.$publication, { digest })) conflict();
  const advance = async (change: Parameters<typeof host.store.update>[2]) => {
    state = await host.store.update(state.frozen.attemptId, state.revision, change, hold);
  };
  for (const module of state.frozen.modules) {
    if (initialSetupFor(host.modules, module.module)?.recoveryDocument !== undefined) {
      await host.recoveryDelivery.install(
        deps.db,
        state,
        { ...owner, revision: state.revision },
        module.module,
        hold,
      );
    } else await deps.installLegacyKey?.(state, owner, module.module, hold);
  }
  await deps.publishSelection(state);
  const result = checked.venue;
  await deps.publishIdentity(result, state);
  await deps.sealSettings();
  await deps.persistTrading(result, state);
  await deps.clearConfiguration?.();
  if (state.status === "committed") await advance({ kind: "publication" });
  // Password recovery remains available until the publication audit is durable.
  await beforeComplete?.();
  await advance({ kind: "complete" });
  return result;
}

export interface FirstSetupFinishDeps {
  check(state: FirstSetupState): Promise<CheckedFirstSetupCommit | null>;
  publish(
    state: FirstSetupState,
    checked: CheckedFirstSetupCommit,
    beforeComplete: () => Promise<unknown>,
  ): Promise<VenueResult>;
}
export async function finishFirstSetup(
  host: FirstSetupActivationHost & Pick<ReturnType<typeof createFirstSetupRuntime>, "resolution">,
  deps: FirstSetupFinishDeps,
  owner: FirstSetupOwnerAttempt,
  publicationDigest: string | ((state: FirstSetupState) => string),
  hold: FirstSetupHold,
): Promise<VenueResult> {
  let state = await host.owner.authorize(owner);
  const ownership = [...state.history]
    .reverse()
    .find((event) => ["claim", "resume", "recover"].includes(event.kind));
  if (ownership?.kind !== "recover" || ownership.ownerGeneration !== state.ownerGeneration)
    throw new AppError("setup.owner_required", {});
  if (!["activation-started", "committed", "publication"].includes(state.status)) conflict();
  host.assertSelection(state);
  const digest =
    typeof publicationDigest === "string" ? publicationDigest : publicationDigest(state);
  if (!isDeepStrictEqual(state.inputs.$publication, { digest })) conflict();
  const checked = await deps.check(state);
  if (checked === null) conflict();
  const applyAudit = await prepareFirstSetupFinishAudit(host, state, checked);
  if (state.status === "activation-started")
    state = await host.store.update(
      state.frozen.attemptId,
      state.revision,
      { kind: "committed", result: checked },
      hold,
    );
  return deps.publish(state, checked, applyAudit);
}
