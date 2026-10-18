import "./errors.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual as equal } from "node:util";
import {
  lockVenueDatabase,
  readBreakGlassVerifier,
  readBreakGlassKeyName,
  type Database,
  type Transaction,
  withTransaction,
} from "@waitron/db";
import type { TotpKeyRing } from "@waitron/identity";
import {
  configureModuleOperations,
  readOperationAuthority,
  withPreparedModuleOperations,
  type ModuleOperations,
  type OperationAuthority,
  type OperationBinding,
  type ProvisionedNode,
  type WaitronModule,
} from "@waitron/module";
import {
  createModuleOperationHost,
  createRecoveryPreparationHost,
  readModulePreparationHistory,
  type FirstSetupCoordinator,
} from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import {
  withAuthenticatedOperation,
  withRecoveryKeyAuthority,
} from "./operation-authentication.js";
import type { RecoveryOperationInput } from "./recovery-module-operation.js";
import type { PromotionOperationRunner } from "./promote.js";

interface Context {
  readonly oldNodeNeutralised?: unknown;
  readonly noParallelRecovery?: unknown;
}
type Commit = <T>(body: (tx: Transaction) => Promise<T>) => Promise<T>;
export function createNodeOperationPreparation(options: {
  stateDir: string;
  venueDir: string;
  db: Database;
  node: ProvisionedNode;
  modules: readonly WaitronModule[];
  credentialKeyRing: TotpKeyRing;
  coordinator: FirstSetupCoordinator;
  environment: Readonly<Record<string, string | undefined>>;
}) {
  const node = Object.freeze({ ...options.node });
  const scopes = new AsyncLocalStorage<{
    binding: OperationBinding;
    authority: OperationAuthority;
    verifier: string | null | undefined;
  }>();
  const invalid = (binding: OperationBinding): never => {
    throw new AppError("module.operation_invalid", { module: binding.module });
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
      (await readBreakGlassVerifier(options.db, node.nodeId)) !== scope.verifier
    )
      throw new AppError("promotion.break_glass_invalid", {});
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
      const current = await reader(options.db, node, binding, history);
      check();
      return {
        ...current,
        oldMachineOffline: true,
        oldMachineAbsent: false,
        noParallelRecovery: true,
        contextKey: JSON.stringify([
          binding,
          current.country,
          current.taxId,
          current.environment,
          current.bases,
          await readBreakGlassKeyName(options.db, node.nodeId),
        ]),
      };
    },
  });
  const modules = configureModuleOperations(
    options.modules,
    createModuleOperationHost(options.environment, scoped),
  );
  const invoke = async <T>(
    supplied: OperationBinding,
    credentials: unknown,
    context: Context,
    run: (authority: OperationAuthority, commit: Commit) => Promise<T>,
  ): Promise<T> => {
    const binding = Object.freeze({ ...supplied });
    const heldContext = Object.freeze({ ...context });
    const heldCredentials = structuredClone(credentials);
    if (!modules.some((module) => module.name === binding.module)) return invalid(binding);
    if (!["reserve", "establish", "promote", "re-register"].includes(binding.action))
      return invalid(binding);
    if (binding.targetNodeId !== node.nodeId) return invalid(binding);
    if (binding.action === "promote" || binding.action === "re-register") {
      if (heldContext.oldNodeNeutralised !== true)
        throw new AppError("promotion.fence_not_attested", {});
      if (heldContext.noParallelRecovery !== true) return invalid(binding);
    }
    const key =
      typeof heldCredentials === "object" &&
      heldCredentials !== null &&
      "breakGlass" in heldCredentials;
    const verifier = key ? await readBreakGlassVerifier(options.db, node.nodeId) : undefined;
    const authenticated = async (authority: OperationAuthority, commit: Commit) => {
      return scopes.run({ binding, authority, verifier }, () => run(authority, commit));
    };
    if (
      typeof heldCredentials === "object" &&
      heldCredentials !== null &&
      "breakGlass" in heldCredentials
    )
      return withRecoveryKeyAuthority(
        { db: options.db, nodeId: node.nodeId },
        binding,
        heldCredentials.breakGlass,
        authenticated,
      );
    return withAuthenticatedOperation(
      { db: options.db, credentialKeyRing: options.credentialKeyRing },
      {
        binding,
        permission: ["reserve", "establish"].includes(binding.action)
          ? "mirror.create"
          : "node.promote",
      },
      heldCredentials,
      (authority) => authenticated(authority, (body) => withTransaction(options.db, body)),
    );
  };
  return {
    async prepare(
      suppliedBinding: OperationBinding,
      credentials: unknown,
      context: Context,
      proposal: unknown,
    ): Promise<unknown> {
      const binding = Object.freeze({ ...suppliedBinding });
      if (!["promote", "re-register"].includes(binding.action)) return invalid(binding);
      const held = structuredClone(proposal);
      return invoke(binding, credentials, context, async (authority) => {
        const contribution = modules.find((module) => module.name === binding.module)?.operations;
        if (contribution?.recovery === undefined) return invalid(binding);
        return contribution.recovery({ binding: { ...binding }, authority }, held);
      });
    },
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
    ): Promise<T> {
      const binding = Object.freeze({ ...operation.binding });
      const input = structuredClone(operation.input);
      if (binding.action !== "promote") return invalid(binding);
      return invoke(binding, credentials, context, (authority, commit) =>
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
      );
    },
  };
}
