import { AppError } from "@waitron/shared";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import type { WaitronModule } from "@waitron/module";
import { readRecoveryCopyPreview } from "./recovery-backup-preview.js";
import { createSelectedRecoveryPreparation } from "./recovery-preparation.js";
import type { RecoveryOperationInput } from "./recovery-module-operation.js";
import {
  readArtifactIdentity,
  type RestoreOperationRunner,
  type ValidatedArtifact,
} from "./restore.js";
import "./errors.js";

export interface RecoveryEntryContext {
  readonly selectedSourceId: string;
  readonly oldBoxGone: boolean;
  readonly soleRecovery: boolean;
}

export async function createRecoveryEntryRunner(options: {
  stateDir: string;
  venueDir: string;
  migrationsRoot: string | null;
  modules: readonly WaitronModule[];
  copy: ValidatedArtifact;
  operation: RecoveryOperationInput;
  secret: unknown;
  context: RecoveryEntryContext;
}): Promise<RestoreOperationRunner> {
  const { operation, copy, context } = options;
  const preview = await readRecoveryCopyPreview(copy, context.selectedSourceId, options);
  const selected = { ...preview, activationSourceId: copy.sourceId };
  const { node } = readArtifactIdentity(copy.secretEntries);
  const service = createSelectedRecoveryPreparation({
    stateDir: options.stateDir,
    venueDir: options.venueDir,
    modules: options.modules,
    secret: options.secret,
    coordinator: createFirstSetupCoordinator(),
    binding: operation.binding,
    node,
    selected,
    database() {
      throw new AppError("module.operation_invalid", { module: operation.binding.module });
    },
    // These declarations are independent of the allocation; local locks do not establish them.
    readIsolation: async () => ({
      oldMachineAbsent: false,
      oldMachineOffline: context.oldBoxGone,
      noParallelRecovery: context.soleRecovery,
    }),
  });
  return service.runner(operation.input, { refresh: true });
}
