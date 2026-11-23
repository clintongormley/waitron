import { isDeepStrictEqual } from "node:util";
import {
  readOperationAuthority,
  withOperationAuthority,
  type ModuleOperationInput,
  type WaitronModule,
} from "@waitron/module";
import { AppError } from "@waitron/shared";

export function standbyContract(
  sourceId: string,
  targetNodeId: string,
  operatorId = "contract-administrator",
) {
  const state = { targetNodeId };
  function request(action: "reserve" | "establish") {
    return {
      binding: { module: "fiscal-verifactu", action, eventId: "test-join", sourceId, targetNodeId },
      input: state,
    };
  }
  return {
    state,
    request,
    authorised<T>(
      action: "reserve" | "establish",
      run: (operation: ModuleOperationInput) => Promise<T>,
    ) {
      const { binding, input } = request(action);
      return withOperationAuthority(binding, operatorId, (authority) =>
        run({ binding, input, authority }),
      );
    },
  };
}

export function withoutActivationMark(modules: readonly WaitronModule[]): WaitronModule[] {
  return modules.map((module) => {
    const standby = module.provisioning?.standby;
    if (standby === undefined) return module;
    const unmarked = { ...standby };
    delete unmarked.series;
    return { ...module, provisioning: { ...module.provisioning, standby: unmarked } };
  });
}

export function allocatedStandbyModules(
  modules: readonly WaitronModule[],
  fixture: ReturnType<typeof standbyContract>,
): WaitronModule[] {
  return modules.map((module) =>
    module.name === "fiscal-verifactu"
      ? ({
          ...module,
          provisioning: {
            ...module.provisioning,
            standby: {
              series: "on-activation",
              async reserve(_tx, _source, _target, operation) {
                if (!operation || !readOperationAuthority(operation.authority, operation.binding))
                  throw new AppError("sif.allocation_invalid", {
                    reason: "reauthentication_required",
                  });
                return { state: fixture.state };
              },
              async establish(_tx, _target, state) {
                if (!isDeepStrictEqual(state, fixture.state))
                  throw new AppError("sif.allocation_invalid", { reason: "reservation_mismatch" });
              },
            },
          },
          operations: { prepare: (operation, run) => run(operation) },
        } satisfies WaitronModule)
      : module,
  );
}
