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
type RecoveryContext = Omit<HourRecoveryFacts, "clock" | "confirmation">;
type Selector = ReturnType<typeof createHourSelection>;
type Selection = Awaited<ReturnType<Selector["selected"]>>;
type Request = Parameters<Selector["select"]>[0];
function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
export function recoveryHourOperator(
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
  readContext?(binding: ModuleOperationInput["binding"]): Promise<RecoveryContext>;
  monotonicNow(): number;
}) {
  const checked = <T extends RecoveryContext>(current: T): T => {
    if (current.oldMachineAbsent !== false) return refuse("old_machine_absence_unconfirmed");
    if (current.oldMachineOffline !== true) return refuse("old_machine_active");
    if (current.noParallelRecovery !== true) return refuse("parallel_recovery");
    if (!["none", "committed"].includes(current.priorActivation)) return refuse("event_mismatch");
    return current;
  };
  const read = async (binding: OperationBinding) => checked({ ...(await options.read(binding)) });
  const engine = createHourSelection({ ...options, read });
  const within = async <T>(
    request: Pick<Request, "binding" | "authority">,
    run: (selector: Selector, facts: RecoveryContext, operator: RecoveryKeyOperator) => Promise<T>,
  ): Promise<T> => {
    const binding = Object.freeze({ ...request.binding });
    const authority = request.authority;
    recoveryHourOperator(binding, authority);
    return options.withState(binding, async (state) => {
      const context =
        options.readContext === undefined ? undefined : checked(await options.readContext(binding));
      const current = context?.priorActivation === "committed" ? context : await read(binding);
      const operator = recoveryHourOperator(binding, authority);
      const selector = createHourSelection({
        ...options,
        withState: async (_binding, body) => body(state),
        read: async () => ("clock" in current ? (current as HourRecoveryFacts) : read(binding)),
        readCommitted: async () => current,
      });
      return run(selector, current, operator);
    });
  };
  return {
    async select(supplied: Request) {
      const request = { ...supplied, binding: { ...supplied.binding } };
      recoveryHourOperator(request.binding, request.authority);
      const selected = await engine.select(request);
      const operator = recoveryHourOperator(request.binding, request.authority);
      return selected.status === "selected"
        ? { ...selected, input: inputFor(selected, operator) }
        : selected;
    },
    async preview(supplied: Omit<Request, "answer">) {
      const request = { ...supplied, binding: { ...supplied.binding } };
      recoveryHourOperator(request.binding, request.authority);
      const result = await engine.preview(request);
      recoveryHourOperator(request.binding, request.authority);
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
        const selected = await selector[
          facts.priorActivation === "committed" ? "committed" : "selected"
        ]({
          binding: held.binding,
          authority: held.authority,
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
