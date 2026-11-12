import "./errors.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual as equal } from "node:util";
import {
  lockVenueDatabase,
  type Database,
  type NodeDatabase,
  type Transaction,
  withTransaction,
} from "@waitron/db";
import { readNodeMode, readRecoveryKeyName, readRecoveryKeyVerifier } from "@waitron/node-db";
import type { TotpKeyRing } from "@waitron/identity";
import {
  configureModuleOperations,
  moduleOperationFor,
  readOperationAuthority,
  withOperationAuthority,
  withPreparedModuleOperations,
  type ModuleClockSetAnswer,
  type ModuleClockSetRequest,
  type ModuleOperationHost,
  type ModuleOperations,
  type OperationAuthority,
  type OperationBinding,
  type OperationClient,
  type ProvisionedNode,
  type WaitronModule,
  type LiveModuleOperationScope,
} from "@waitron/module";
import {
  createModuleOperationHost,
  createRecoveryPreparationHost,
  readModulePreparationHistory,
  type FirstSetupCoordinator,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { requiredNameOf } from "./box-health-api.js";
import type { clockCorrection } from "./clock-correction.js";
import {
  withAuthenticatedOperation,
  withRecoveryKeyAuthority,
} from "./operation-authentication.js";
import type { RecoveryOperationInput } from "./recovery-module-operation.js";
import type { PromotionOperationRunner } from "./promote.js";

interface Context {
  readonly oldNodeNeutralised?: unknown;
  readonly noParallelRecovery?: unknown;
  readonly oldMachineRelinquished?: unknown;
}
type Commit = <T>(body: (tx: Transaction) => Promise<T>) => Promise<T>;
export function createNodeOperationPreparation(options: {
  stateDir: string;
  venueDir: string;
  db: Database;
  /** This box's node.db, which holds the recovery-key check. */
  nodeDb: NodeDatabase;
  node: ProvisionedNode;
  modules: readonly WaitronModule[];
  credentialKeyRing?: TotpKeyRing;
  coordinator: FirstSetupCoordinator;
  environment: Readonly<Record<string, string | undefined>>;
  testClock?: ModuleOperationHost["testClock"];
  isLiveWritable?: () => boolean;
  /** Boot's setter, measuring on the same steady clock as `testClock` or `performance.now()`. */
  clockCorrection?: Pick<ReturnType<typeof clockCorrection>, "set" | "steps">;
}) {
  const node = Object.freeze({ ...options.node });
  const scopes = new AsyncLocalStorage<{
    binding: OperationBinding;
    authority: OperationAuthority;
    verifier: string | null | undefined;
    isolation?: Readonly<{ oldMachineOffline: boolean; noParallelRecovery: boolean }>;
    // Kept apart from `isolation`: isolation makes `authorize` require a live primary, which a
    // mirror being promoted never is.
    promotion?: Readonly<{ oldMachineRelinquished: boolean }>;
  }>();
  const invalid = (binding: OperationBinding): never => {
    throw new AppError("module.operation_invalid", { module: binding.module });
  };
  const assertLive = async () => {
    const role = await readNodeMode(options.nodeDb, node.nodeId);
    if (
      options.isLiveWritable?.() === false ||
      role.mode !== "primary" ||
      role.singletonRole !== "primary"
    )
      throw new AppError("node.read_only", {});
  };
  const authorize = async (binding: OperationBinding) => {
    const scope = scopes.getStore();
    if (
      scope === undefined ||
      !equal(scope.binding, binding) ||
      readOperationAuthority(scope.authority, binding) === undefined
    )
      return invalid(binding);
    if (
      scope.verifier !== undefined &&
      (await readRecoveryKeyVerifier(options.nodeDb, node.nodeId)) !== scope.verifier
    )
      throw new AppError("promotion.break_glass_invalid", {});
    if (scope.isolation !== undefined) await assertLive();
  };
  const scoped = createRecoveryPreparationHost({
    ...options,
    authorize,
    withVenueExclusion: async (run) => {
      const lock = await lockVenueDatabase(options.venueDir);
      try {
        return await run();
      } finally {
        lock.release();
      }
    },
    readRecoveryFacts: async (binding, check) => {
      const reader = options.modules.find((module) => module.name === binding.module)?.operations
        ?.readRecoveryState;
      if (reader === undefined) return invalid(binding);
      const history = await readModulePreparationHistory(options, binding.module);
      await authorize(binding);
      const current = await reader(options.db, node, binding, history);
      await authorize(binding);
      check();
      const keyName = await readRecoveryKeyName(options.nodeDb, node.nodeId);
      await authorize(binding);
      const { isolation, promotion } = scopes.getStore() ?? {};
      const relinquished = promotion?.oldMachineRelinquished ?? false;
      return {
        ...current,
        history: current.history,
        oldMachineOffline: isolation?.oldMachineOffline ?? !relinquished,
        oldMachineRelinquished: relinquished,
        oldMachineAbsent: false,
        noParallelRecovery: isolation?.noParallelRecovery ?? true,
        contextKey: JSON.stringify([
          binding,
          current.country,
          current.taxId,
          current.environment,
          current.bases,
          keyName,
        ]),
      };
    },
  });
  const correction = options.clockCorrection;
  const setBoxClock =
    correction === undefined
      ? undefined
      : async (
          binding: OperationBinding,
          request: ModuleClockSetRequest,
        ): Promise<ModuleClockSetAnswer> => {
          // Before any await: a step made meanwhile makes the device's offset stale.
          const stepsSeen = correction.steps();
          await authorize(binding);
          const { operatorId } = readOperationAuthority(scopes.getStore()!.authority, binding)!;
          if (typeof operatorId !== "string") return { status: "refused", reason: "not_admitted" };
          const answer = await correction.set({
            reason: "start",
            source: "admin",
            offsetMs: request.offsetMs,
            measuredAt: { ...request.measuredAt },
            stepsSeen,
            witnesses: [],
            agreesWithinMs: 30_000,
            admin: {
              personId: operatorId,
              personName: await requiredNameOf(options.db, operatorId),
              reading: { ...request.reading },
            },
            requester: { source: "admin", person: operatorId },
          });
          return answer.set ? { status: "set" } : { status: "refused", reason: answer.reason };
        };
  const modules = configureModuleOperations(
    options.modules,
    createModuleOperationHost(options.environment, {
      ...scoped,
      testClock: options.testClock,
      ...(setBoxClock === undefined ? {} : { setBoxClock }),
    }),
  );
  const invoke = async <T>(
    supplied: OperationBinding,
    credentials: unknown,
    context: Context,
    run: (authority: OperationAuthority, commit: Commit) => Promise<T>,
    afterSignIn?: () => Promise<void>,
  ): Promise<T> => {
    const binding = Object.freeze({ ...supplied });
    const heldContext = Object.freeze({ ...context });
    const heldCredentials = structuredClone(credentials);
    if (!modules.some((module) => module.name === binding.module)) return invalid(binding);
    if (!["reserve", "establish", "promote"].includes(binding.action)) return invalid(binding);
    if (binding.targetNodeId !== node.nodeId) return invalid(binding);
    if (binding.action === "promote") {
      if (heldContext.oldNodeNeutralised !== true)
        throw new AppError("promotion.fence_not_attested", {});
      if (heldContext.noParallelRecovery !== true) return invalid(binding);
      if (
        heldContext.oldMachineRelinquished !== undefined &&
        typeof heldContext.oldMachineRelinquished !== "boolean"
      )
        return invalid(binding);
    }
    const promotion =
      binding.action === "promote"
        ? Object.freeze({ oldMachineRelinquished: heldContext.oldMachineRelinquished === true })
        : undefined;
    const key =
      typeof heldCredentials === "object" &&
      heldCredentials !== null &&
      "breakGlass" in heldCredentials;
    const verifier = key ? await readRecoveryKeyVerifier(options.nodeDb, node.nodeId) : undefined;
    const authenticated = async (authority: OperationAuthority, commit: Commit) => {
      return scopes.run({ binding, authority, verifier, promotion }, () => run(authority, commit));
    };
    if (
      typeof heldCredentials === "object" &&
      heldCredentials !== null &&
      "breakGlass" in heldCredentials
    )
      return withRecoveryKeyAuthority(
        { db: options.db, node: options.nodeDb, nodeId: node.nodeId },
        binding,
        heldCredentials.breakGlass,
        async (authority, commit) => {
          await afterSignIn?.();
          return authenticated(authority, commit);
        },
      );
    if (options.credentialKeyRing === undefined) return invalid(binding);
    return withAuthenticatedOperation(
      { db: options.db, credentialKeyRing: options.credentialKeyRing },
      {
        binding,
        permission: "node.manage",
      },
      heldCredentials,
      (authority) => authenticated(authority, (body) => withTransaction(options.db, body)),
      afterSignIn,
    );
  };
  /**
   * The module's dormant setup, from this box's own copy, under the person `promote` signed in,
   * the first time only. On the one module with this seat neither step writes a venue row (the
   * table list in `handover-dormant-setup.test.ts`), and the file write comes last, so nothing a
   * stopped attempt leaves needs repair: a retry finds the setup or starts again from the copy.
   */
  const writeDormantSetup = async (
    promote: OperationBinding,
    authority: OperationAuthority,
  ): Promise<void> => {
    const contribution = modules.find((module) => module.name === promote.module);
    const setup = contribution?.operations?.dormantSetup;
    const standby = contribution?.provisioning?.standby;
    if (setup === undefined || standby === undefined) return;
    if ((await readNodeMode(options.nodeDb, node.nodeId)).mode !== "mirror") return;
    const retained = setup.retained(
      await readModulePreparationHistory(options, promote.module),
      promote,
    );
    if (retained === "another_source") return invalid(promote);
    if (retained === "this_source") return;
    const { operatorId } = readOperationAuthority(authority, promote)!;
    const step = <T>(
      action: "reserve" | "establish",
      input: unknown,
      body: (tx: Transaction, operation: ReturnType<typeof moduleOperationFor>) => Promise<T>,
    ): Promise<T> => {
      const binding = Object.freeze({ ...promote, action });
      return withOperationAuthority(binding, operatorId, (stepAuthority) =>
        scopes.run({ binding, authority: stepAuthority, verifier: undefined }, () =>
          withPreparedModuleOperations(
            modules,
            new Map([[promote.module, { binding, authority: stepAuthority, input }]]),
            node.nodeId,
            action,
            (ready) =>
              withTransaction(options.db, (tx) =>
                body(tx, moduleOperationFor(ready, promote.module, node.nodeId, action)),
              ),
          ),
        ),
      );
    };
    const source = { ...node, nodeId: promote.sourceId as ProvisionedNode["nodeId"] };
    const { state } = await step("reserve", setup.reserveInput, (tx, operation) =>
      standby.reserve(tx, source, node, operation),
    );
    await step("establish", state, (tx, operation) =>
      standby.establish(tx, node, state, operation),
    );
  };
  const prepareStep = async (
    binding: OperationBinding,
    authority: OperationAuthority,
    proposal: unknown,
    client: OperationClient,
  ) => {
    const contribution = modules.find((module) => module.name === binding.module)?.operations;
    if (contribution?.recovery === undefined) return invalid(binding);
    return contribution.recovery({ binding: { ...binding }, authority }, proposal, client);
  };
  const prepareWith =
    (before?: (binding: OperationBinding, authority: OperationAuthority) => Promise<void>) =>
    async (
      suppliedBinding: OperationBinding,
      credentials: unknown,
      context: Context,
      proposal: unknown,
      client: OperationClient,
      afterSignIn?: () => Promise<void>,
    ): Promise<unknown> => {
      const binding = Object.freeze({ ...suppliedBinding });
      if (binding.action !== "promote") return invalid(binding);
      const held = structuredClone(proposal);
      return invoke(
        binding,
        credentials,
        context,
        async (authority) => {
          await before?.(binding, authority);
          return prepareStep(binding, authority, held, client);
        },
        afterSignIn,
      );
    };
  return {
    // Read from the configured modules: a module's `recovery` can exist only once configured.
    hasRecoveryOperation: modules.some((module) => module.operations?.recovery !== undefined),
    async withLiveRecovery<T>(
      supplied: OperationBinding,
      key: unknown,
      isolation: { oldMachineOffline: boolean; noParallelRecovery: boolean },
      run: (scope: LiveModuleOperationScope) => Promise<T>,
    ): Promise<T> {
      const binding = Object.freeze({ ...supplied });
      const answers = Object.freeze({ ...isolation });
      const contribution = modules.find((module) => module.name === binding.module)?.operations;
      const actions = [...(contribution?.liveRecoveryActions ?? [])];
      if (
        contribution === undefined ||
        !actions.includes(binding.action) ||
        binding.targetNodeId !== node.nodeId
      )
        return invalid(binding);
      await assertLive();
      const verifier = await readRecoveryKeyVerifier(options.nodeDb, node.nodeId);
      return withRecoveryKeyAuthority(
        { db: options.db, node: options.nodeDb, nodeId: node.nodeId },
        binding,
        key,
        (authority, commit) =>
          scopes.run({ binding, authority, verifier, isolation: answers }, async () => {
            await authorize(binding);
            return run({
              binding,
              node,
              authority,
              operations: contribution,
              commit: (body) =>
                commit(async (tx) => {
                  await assertLive();
                  return body(tx);
                }),
            });
          }),
        actions,
      );
    },
    prepare: prepareWith(),
    /** `prepare`, after making sure the setup a promotion reads exists, on the one sign-in. */
    prepareWithDormantSetup: prepareWith(writeDormantSetup),
    async withOperation<T>(
      operation: RecoveryOperationInput,
      credentials: unknown,
      context: Context,
      run: (
        modules: readonly WaitronModule[],
        operations: ModuleOperations,
        commit: Commit,
      ) => Promise<T>,
    ): Promise<T> {
      const binding = Object.freeze({ ...operation.binding });
      const input = structuredClone(operation.input);
      return invoke(binding, credentials, context, (authority, commit) =>
        run(modules, new Map([[binding.module, { binding, authority, input }]]), commit),
      );
    },
    async withPromotion<T>(
      operation: RecoveryOperationInput,
      credentials: unknown,
      context: Context,
      run: (modules: readonly WaitronModule[], runner: PromotionOperationRunner) => Promise<T>,
      afterSignIn?: () => Promise<void>,
    ): Promise<T> {
      const binding = Object.freeze({ ...operation.binding });
      const input = structuredClone(operation.input);
      if (binding.action !== "promote") return invalid(binding);
      return invoke(
        binding,
        credentials,
        context,
        (authority, commit) =>
          run(modules, async (current, consume) => {
            if (current.db !== options.db || !equal(current.node, node)) return invalid(binding);
            return withPreparedModuleOperations(
              modules,
              new Map([[binding.module, { binding, authority, input }]]),
              node.nodeId,
              "promote",
              (ready) => commit((tx) => consume(tx, ready)),
            );
          }),
        afterSignIn,
      );
    },
  };
}
