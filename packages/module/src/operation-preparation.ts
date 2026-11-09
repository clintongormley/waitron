import type { OperationBinding, OperationAuthority } from "./operation-authority.js";
import type { Context } from "hono";
import type { InitialSetupContext } from "./initial-setup.js";
import type { WaitronModule } from "./module.js";
import type { Database, Transaction } from "@waitron/db";
import type { ProvisionedNode } from "./provisioning.js";
import { AppError } from "@waitron/shared";
import {
  moduleOperationFor,
  snapshotModuleOperations,
  type ModuleOperationInput,
  type ModuleOperations,
} from "./operation-input.js";

export interface ModuleRecoveryFacts {
  readonly country: string;
  readonly taxId: string;
  readonly environment: "production" | "preproduction";
  readonly bases: readonly { readonly code: string; readonly purpose: string }[];
  readonly contextKey: string;
  readonly history: readonly unknown[];
  readonly oldMachineOffline: boolean;
  readonly oldMachineAbsent: boolean;
  /** The old machine handed its work to this one, rather than being taken offline. */
  readonly oldMachineRelinquished: boolean;
  readonly noParallelRecovery: boolean;
  readonly priorActivation: "none" | "committed";
}

export interface ModuleOperationHost {
  readRecoveryFacts?(binding: OperationBinding): Promise<ModuleRecoveryFacts>;
  readSetupFacts?(binding: OperationBinding): Promise<{
    readonly context: InitialSetupContext;
    readonly contextKey: string;
    readonly continuationKey?: string;
    readonly localHistory: unknown;
  }>;
  withPreparationState?<T>(
    binding: OperationBinding,
    run: (state: {
      readonly value: unknown;
      readonly history: readonly unknown[];
      /** A `"wait"` write is checked against the owner's grant without spending it. */
      replace(value: unknown, purpose?: "wait" | "intent"): Promise<void>;
    }) => Promise<T>,
  ): Promise<T>;
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** Set only by a test; production leaves it unset and modules read the real clocks. */
  readonly testClock?: { wall(): number; monotonic(): number };
  readPublicEvidence(
    binding: OperationBinding,
  ): Promise<{ trust: unknown; current: unknown } | undefined>;
}

export function configureModuleOperations(
  modules: readonly WaitronModule[],
  host: ModuleOperationHost,
): readonly WaitronModule[] {
  return modules.map((module) => {
    const operations = module.operations?.configure?.(host) ?? module.operations;
    const initialSetup = module.provisioning?.initialSetup;
    const configuredSetup = initialSetup?.configure?.(host) ?? initialSetup;
    if (module.operations?.configure === undefined && initialSetup?.configure === undefined)
      return module;
    return {
      ...module,
      operations,
      ...(configuredSetup === initialSetup
        ? {}
        : {
            provisioning: { ...module.provisioning, initialSetup: configuredSetup },
          }),
    };
  });
}

/** Whether the request came from a browser running on the box itself. */
export interface OperationClient {
  readonly onBox: boolean;
}

/** How a box whose module keeps a dormant setup writes it for itself from its own venue copy. */
export interface ModuleDormantSetup {
  /** What the module's `provisioning.standby.reserve` takes; opaque to the host. */
  readonly reserveInput: unknown;
  /** What this box's preparation history already retains for `binding`'s target. */
  retained(
    history: readonly unknown[],
    binding: OperationBinding,
  ): "none" | "this_source" | "another_source";
}

export interface ModuleOperationPreparation {
  readonly liveRecoveryActions?: readonly string[];
  readonly dormantSetup?: ModuleDormantSetup;
  configure?(host: ModuleOperationHost): ModuleOperationPreparation;
  readRecoveryHistory?(db: Database): Promise<readonly unknown[]>;
  readRecoveryState?(
    db: Database,
    node: ProvisionedNode,
    binding: OperationBinding,
    preparationHistory?: readonly unknown[],
  ): Promise<
    Pick<
      ModuleRecoveryFacts,
      "country" | "taxId" | "environment" | "bases" | "history" | "priorActivation"
    >
  >;
  recovery?(
    operation: Pick<ModuleOperationInput, "binding" | "authority">,
    proposal: unknown,
    client: OperationClient,
  ): Promise<unknown>;
  /** Rebuild transient admission checks without selecting another identity. */
  resumeRecovery?(operation: Pick<ModuleOperationInput, "binding" | "authority">): Promise<void>;
  prepare<T>(
    operation: ModuleOperationInput,
    run: (prepared: ModuleOperationInput) => Promise<T>,
  ): Promise<T>;
}

export interface LiveModuleOperationScope {
  readonly binding: OperationBinding;
  readonly node: ProvisionedNode;
  readonly authority: OperationAuthority;
  readonly operations: ModuleOperationPreparation;
  commit<R>(body: (tx: Transaction) => Promise<R>): Promise<R>;
}

export interface LiveModuleOperationBridge {
  readonly node: ProvisionedNode;
  requireHttps(c: Context): void;
  client(c: Context): OperationClient;
  withAdmission<T>(run: () => Promise<T>): Promise<T>;
  run<T>(
    binding: OperationBinding,
    key: unknown,
    isolation: { oldMachineOffline: boolean; noParallelRecovery: boolean },
    body: (scope: LiveModuleOperationScope) => Promise<T>,
  ): Promise<T>;
}

export async function withPreparedModuleOperations<T>(
  modules: readonly WaitronModule[],
  operations: ModuleOperations,
  targetNodeId: string,
  action: string,
  run: (prepared: ModuleOperations) => Promise<T>,
): Promise<T> {
  const supplied = snapshotModuleOperations(operations);
  const selected = [...modules];
  const visit = async (index: number, ready: ModuleOperations): Promise<T> => {
    const module = selected[index];
    if (module === undefined) return run(ready);
    if (module.operations === undefined) return visit(index + 1, ready);
    const operation = moduleOperationFor(ready, module.name, targetNodeId, action);
    if (operation === undefined) return visit(index + 1, ready);
    let active = true;
    try {
      return await module.operations.prepare(operation, async (prepared) => {
        const next = new Map(ready);
        next.set(module.name, prepared);
        if (!active || prepared.authority !== operation.authority)
          throw new AppError("module.operation_invalid", { module: module.name });
        moduleOperationFor(next, module.name, targetNodeId, action);
        return visit(index + 1, snapshotModuleOperations(next));
      });
    } finally {
      active = false;
    }
  };
  return visit(0, supplied);
}
