import { AppError } from "@waitron/shared";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import type { OperationBinding, ModuleOperationHost } from "@waitron/module";
import { createModulePreparationState } from "./module-preparation-state.js";
import type { FirstSetupHold } from "./first-setup-state.js";
import "./errors.js";

type Options = Parameters<typeof createModulePreparationState>[0] & {
  readRecoveryFacts(
    binding: OperationBinding,
    check: () => void,
  ): ReturnType<NonNullable<ModuleOperationHost["readRecoveryFacts"]>>;
  currentHold?(): FirstSetupHold | undefined;
};
export function createRecoveryPreparationHost(options: Options): {
  readRecoveryFacts: NonNullable<ModuleOperationHost["readRecoveryFacts"]>;
  withPreparationState: NonNullable<ModuleOperationHost["withPreparationState"]>;
} {
  const preparation = createModulePreparationState(options);
  const scopes = new AsyncLocalStorage<{ binding: OperationBinding; active: boolean }>();
  return {
    async readRecoveryFacts(binding) {
      const scope = scopes.getStore();
      const held = { ...binding };
      const check = () => {
        if (scope?.active !== true || !isDeepStrictEqual(scope.binding, held))
          throw new AppError("setup.attempt_conflict", {});
      };
      check();
      const facts = await options.readRecoveryFacts(held, check);
      check();
      return structuredClone(facts);
    },
    withPreparationState(binding, run) {
      const scope = { binding: { ...binding }, active: true };
      return preparation.withState(
        scope.binding,
        (state) =>
          scopes.run(scope, async () => {
            try {
              return await run(state);
            } finally {
              scope.active = false;
            }
          }),
        options.currentHold?.(),
      );
    },
  };
}
