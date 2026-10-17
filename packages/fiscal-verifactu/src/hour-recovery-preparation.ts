import { AppError } from "@waitron/shared";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type OperationAuthority,
  type OperationBinding,
  type RecoveryKeyOperator,
} from "@waitron/module";
import { isDeepStrictEqual } from "node:util";
import {
  createHourSelection,
  type HourSelectionFacts,
  type HourSelectionStore,
} from "./hour-selection.js";
import { withHourAdmission } from "./allocation-envelope.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import "./errors.js";

export interface HourRecoveryFacts extends HourSelectionFacts {
  readonly oldMachineOffline: boolean;
  readonly oldMachineAbsent: boolean;
  readonly noParallelRecovery: boolean;
  readonly priorActivation: "none" | "committed";
}
type Selector = ReturnType<typeof createHourSelection>;
type Selection = Awaited<ReturnType<Selector["selected"]>>;
type Request = Parameters<Selector["select"]>[0];
function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function authenticated(
  binding: OperationBinding,
  authority: OperationAuthority,
): RecoveryKeyOperator {
  const operator = readOperationAuthority(authority, binding)?.operatorId;
  if (
    typeof operator !== "object" ||
    operator.kind !== "recovery-key" ||
    operator.nodeId !== binding.targetNodeId ||
    operator.eventId !== binding.eventId
  )
    return refuse("reauthentication_required");
  if (binding.module !== "fiscal-verifactu" || !["restore", "re-register"].includes(binding.action))
    return refuse("event_mismatch");
  return operator;
}
function inputFor(selected: Selection, operatorId: RecoveryKeyOperator) {
  return {
    allocation: {
      version: 1,
      allocationId: `hour/${selected.binding.eventId}`,
      taxpayerNif: selected.scope.taxpayerNif,
      softwareId: WAITRON_ID_SISTEMA,
      environment: selected.scope.environment,
      installationIdentity: selected.identity,
      series: selected.bases.map(({ code, purpose }) => ({
        code: `${code}-${selected.identity}`,
        purpose,
      })),
      source: "hour",
      reservationEvidence: null,
      issuedAt: selected.issuedAt,
    },
    approval: {
      version: 1,
      eventId: selected.binding.eventId,
      sourceId: selected.binding.sourceId,
      targetNodeId: selected.binding.targetNodeId,
      operatorId,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: selected.issuedAt,
      incidentEvidence: `hour/${selected.binding.eventId}`,
    },
  };
}
export function createHourRecoveryPreparation(options: {
  withState: HourSelectionStore;
  read(binding: ModuleOperationInput["binding"]): Promise<HourRecoveryFacts>;
  monotonicNow(): number;
}) {
  const read = async (binding: OperationBinding) => {
    const current = { ...(await options.read(binding)) };
    if (current.oldMachineAbsent !== false) return refuse("old_machine_absence_unconfirmed");
    if (current.oldMachineOffline !== true) return refuse("old_machine_active");
    if (current.noParallelRecovery !== true) return refuse("parallel_recovery");
    if (!["none", "committed"].includes(current.priorActivation)) return refuse("event_mismatch");
    return current;
  };
  const engine = createHourSelection({ ...options, read });
  const within = async <T>(
    request: Pick<Request, "binding" | "authority">,
    run: (
      selector: Selector,
      facts: HourRecoveryFacts,
      operator: RecoveryKeyOperator,
    ) => Promise<T>,
  ): Promise<T> => {
    const binding = Object.freeze({ ...request.binding });
    const authority = request.authority;
    authenticated(binding, authority);
    return options.withState(binding, async (state) => {
      const current = await read(binding);
      const operator = authenticated(binding, authority);
      const selector = createHourSelection({
        ...options,
        withState: async (_binding, body) => body(state),
        read: async () => current,
      });
      return run(selector, current, operator);
    });
  };
  return {
    async select(supplied: Request) {
      const request = { ...supplied, binding: { ...supplied.binding } };
      authenticated(request.binding, request.authority);
      const selected = await engine.select(request);
      const operator = authenticated(request.binding, request.authority);
      return selected.status === "selected"
        ? { ...selected, input: inputFor(selected, operator) }
        : selected;
    },
    async preview(supplied: Omit<Request, "answer">) {
      const request = { ...supplied, binding: { ...supplied.binding } };
      authenticated(request.binding, request.authority);
      const result = await engine.preview(request);
      authenticated(request.binding, request.authority);
      return result;
    },
    async prepare<T>(
      operation: ModuleOperationInput,
      run: (prepared: ModuleOperationInput) => Promise<T>,
    ): Promise<T> {
      const held = {
        ...operation,
        binding: Object.freeze({ ...operation.binding }),
        input: undefined as unknown,
      };
      try {
        held.input = structuredClone(operation.input);
      } catch {
        return refuse("malformed_allocation");
      }
      return within(held, async (selector, facts, operator) => {
        const selected = await selector.selected({
          binding: held.binding,
          authority: held.authority,
          confirmation: facts.confirmation,
        });
        if (!isDeepStrictEqual(inputFor(selected, operator), held.input))
          return refuse("event_mismatch");
        return withHourAdmission(
          held,
          { requiredBases: selected.bases, priorActivation: facts.priorActivation },
          (evidence) =>
            createAllocationPreparation(async (scope) => ({ ...scope, evidence })).prepare(
              held,
              run,
            ),
        );
      });
    },
  };
}
