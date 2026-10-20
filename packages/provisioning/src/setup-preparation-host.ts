import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import type { ModuleOperationHost, OperationBinding } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { FirstSetupHold } from "./first-setup-state.js";
import { createModulePreparationState } from "./module-preparation-state.js";
import "./errors.js";

type PreparationState = Parameters<
  Parameters<ReturnType<typeof createModulePreparationState>["withState"]>[1]
>[0];

type Options = Parameters<typeof createModulePreparationState>[0] & {
  readSetupFacts(
    binding: OperationBinding,
    assertActive: () => void,
  ): ReturnType<NonNullable<ModuleOperationHost["readSetupFacts"]>>;
  currentHold?(): FirstSetupHold | undefined;
};

export function createSetupPreparationHost(options: Options) {
  const preparation = createModulePreparationState(options);
  const scopes = new AsyncLocalStorage<{ binding: OperationBinding; active: boolean }>();
  return {
    async readSetupFacts(binding: OperationBinding) {
      const scope = scopes.getStore();
      const held = { ...binding };
      const check = () => {
        if (scope?.active !== true || !isDeepStrictEqual(scope.binding, held))
          throw new AppError("setup.attempt_conflict", {});
      };
      check();
      const facts = await options.readSetupFacts(held, check);
      check();
      return facts;
    },
    withPreparationState<T>(
      binding: OperationBinding,
      run: (state: PreparationState) => Promise<T>,
    ): Promise<T> {
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
