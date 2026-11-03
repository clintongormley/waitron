import { AppError } from "@waitron/shared";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type OperationAuthority,
  type OperationBinding,
  type OperationOperator,
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
import type { ConflictAllocationInput } from "./conflict-recovery-contract.js";
import "./errors.js";

export interface HourRecoveryFacts extends HourSelectionFacts {
  readonly oldMachineOffline: boolean;
  readonly oldMachineAbsent: boolean;
  readonly oldMachineRelinquished: boolean;
  readonly noParallelRecovery: boolean;
  readonly priorActivation: "none" | "committed";
}
type RecoveryContext = Omit<HourRecoveryFacts, "clock">;
type Selector = ReturnType<typeof createHourSelection>;
type Selection = Awaited<ReturnType<Selector["selected"]>>;
type Request = Parameters<Selector["select"]>[0];
function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function hourOperator(
  binding: OperationBinding,
  authority: OperationAuthority,
  promotion: boolean,
): OperationOperator {
  const operator = readOperationAuthority(authority, binding)?.operatorId;
  if (
    binding.module !== "fiscal-verifactu" ||
    !(promotion ? ["promote"] : ["restore", "conflict-switch"]).includes(binding.action)
  )
    return refuse("event_mismatch");
  if (promotion && typeof operator === "string") return operator;
  if (
    typeof operator !== "object" ||
    operator.kind !== "recovery-key" ||
    operator.nodeId !== binding.targetNodeId ||
    operator.eventId !== binding.eventId
  )
    return refuse("reauthentication_required");
  return operator;
}
export function recoveryHourOperator(
  binding: OperationBinding,
  authority: OperationAuthority,
): OperationOperator {
  return hourOperator(binding, authority, false);
}
export function promotionHourOperator(
  binding: OperationBinding,
  authority: OperationAuthority,
): OperationOperator {
  return hourOperator(binding, authority, true);
}

function inputFor(selected: Selection, operatorId: OperationOperator, relinquished: boolean) {
  const common = {
    eventId: selected.binding.eventId,
    sourceId: selected.binding.sourceId,
    targetNodeId: selected.binding.targetNodeId,
    operatorId,
  };
  const closing = {
    noParallelRecovery: true,
    confirmedAt: selected.issuedAt,
    incidentEvidence: `hour/${selected.binding.eventId}`,
  };
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
    approval: relinquished
      ? {
          version: 2,
          ...common,
          oldMachineOffline: false,
          oldMachineAbsent: false,
          oldMachineRelinquished: true,
          ...closing,
        }
      : { version: 1, ...common, oldMachineOffline: true, oldMachineAbsent: false, ...closing },
  } satisfies ConflictAllocationInput;
}
interface PreparationOptions {
  withState: HourSelectionStore;
  read(binding: ModuleOperationInput["binding"], comparisonId?: string): Promise<HourRecoveryFacts>;
  readContext?(binding: ModuleOperationInput["binding"]): Promise<RecoveryContext>;
  monotonicNow(): number;
}
export function createHourRecoveryPreparation(options: PreparationOptions) {
  return createPreparation(options, false);
}
export function createHourPromotionPreparation(options: PreparationOptions) {
  return createPreparation(options, true);
}
function createPreparation(options: PreparationOptions, promotion: boolean) {
  const operatorFor = (binding: OperationBinding, authority: OperationAuthority) =>
    hourOperator(binding, authority, promotion);
  const checked = <T extends RecoveryContext>(current: T): T => {
    if (current.oldMachineAbsent !== false) return refuse("old_machine_absence_unconfirmed");
    if (current.oldMachineRelinquished !== false && !promotion) return refuse("old_machine_active");
    if (
      current.oldMachineOffline !== true &&
      !(promotion && current.oldMachineRelinquished === true)
    )
      return refuse("old_machine_active");
    if (current.noParallelRecovery !== true) return refuse("parallel_recovery");
    if (!["none", "committed"].includes(current.priorActivation)) return refuse("event_mismatch");
    return current;
  };
  const read = async (binding: OperationBinding, comparisonId?: string) =>
    checked({ ...(await options.read(binding, comparisonId)) });
  const unused = new Map<string, unknown>();
  const eventKey = (binding: OperationBinding) =>
    JSON.stringify([
      binding.module,
      binding.action,
      binding.eventId,
      binding.sourceId,
      binding.targetNodeId,
    ]);
  const engine = createHourSelection({
    ...options,
    read,
    onNewIntent(selected) {
      if (selected.binding.action === "conflict-switch")
        unused.set(eventKey(selected.binding), inputFor(selected, selected.operatorId, false));
    },
  });
  const within = async <T>(
    request: Pick<Request, "binding" | "authority">,
    run: (selector: Selector, facts: RecoveryContext, operator: OperationOperator) => Promise<T>,
  ): Promise<T> => {
    const binding = Object.freeze({ ...request.binding });
    const authority = request.authority;
    operatorFor(binding, authority);
    return options.withState(binding, async (state) => {
      const context =
        options.readContext === undefined ? undefined : checked(await options.readContext(binding));
      const current = context?.priorActivation === "committed" ? context : await read(binding);
      const operator = operatorFor(binding, authority);
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
      operatorFor(request.binding, request.authority);
      const selected = await engine.select(request);
      const operator = operatorFor(request.binding, request.authority);
      if (selected.status !== "selected") return selected;
      // The real host refuses a facts read outside a preparation scope.
      const relinquished =
        promotion &&
        (
          await options.withState(request.binding, async () =>
            options.readContext === undefined
              ? read(request.binding)
              : checked(await options.readContext(request.binding)),
          )
        ).oldMachineRelinquished;
      return { ...selected, input: inputFor(selected, operator, relinquished) };
    },
    async preview(supplied: Omit<Request, "comparisonId">) {
      const request = { ...supplied, binding: { ...supplied.binding } };
      operatorFor(request.binding, request.authority);
      const result = await engine.preview(request);
      operatorFor(request.binding, request.authority);
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
        if (
          !isDeepStrictEqual(inputFor(selected, operator, facts.oldMachineRelinquished), held.input)
        )
          return refuse("event_mismatch");
        if (held.binding.action === "conflict-switch" && facts.priorActivation !== "committed") {
          const key = eventKey(held.binding);
          if (!isDeepStrictEqual(unused.get(key), held.input))
            return refuse("uncertain_prior_activation");
          unused.delete(key);
        }
        return withHourAdmission(
          held,
          {
            requiredBases: selected.bases,
            priorActivation: facts.priorActivation,
            oldMachineRelinquished: facts.oldMachineRelinquished,
          },
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
