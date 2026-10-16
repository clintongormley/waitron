import { isDeepStrictEqual } from "node:util";
import {
  readOperationAuthority,
  type ModuleOperationInput,
  type ModuleOperationPreparation,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { withHourAdmission } from "./allocation-envelope.js";
import { createAllocationPreparation } from "./allocation-preparation.js";
import { createHourSelection, type HourSelectionFacts } from "./hour-selection.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import "./errors.js";

type SelectionOptions = Parameters<typeof createHourSelection>[0];
type Selected = Awaited<ReturnType<ReturnType<typeof createHourSelection>["selected"]>>;
type SelectionRequest = Parameters<ReturnType<typeof createHourSelection>["select"]>[0];

function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}
function initialOperator(operation: Pick<ModuleOperationInput, "binding" | "authority">) {
  const operator = readOperationAuthority(operation.authority, operation.binding);
  if (
    operator === undefined ||
    typeof operator.operatorId !== "string" ||
    operator.operatorId.trim().length === 0
  )
    return refuse("reauthentication_required");
  if (operation.binding.action !== "setup") return refuse("event_mismatch");
  return operator.operatorId;
}
function inputFor(
  selected: Selected,
  operation: Pick<ModuleOperationInput, "binding" | "authority">,
) {
  const operatorId = initialOperator(operation);
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
      oldMachineAbsent: true,
      oldMachineOffline: false,
      noParallelRecovery: true,
      confirmedAt: selected.issuedAt,
      incidentEvidence: `hour/${selected.binding.eventId}`,
    },
  };
}

export function createHourPreparation(
  options: Omit<SelectionOptions, "read"> & {
    read: (
      binding: ModuleOperationInput["binding"],
    ) => Promise<HourSelectionFacts & { confirmation?: object }>;
  },
) {
  const engine = createHourSelection(options);
  const operations: ModuleOperationPreparation = {
    prepare(operation, run) {
      const held = { ...operation, binding: { ...operation.binding }, input: undefined as unknown };
      initialOperator(held);
      try {
        held.input = structuredClone(operation.input);
      } catch {
        return refuse("malformed_allocation");
      }
      return options.withState(held.binding, async (state) => {
        const facts = await options.read(held.binding);
        const selector = createHourSelection({
          ...options,
          withState: async (_binding, body) => body(state),
          read: async () => facts,
        });
        const selected = await selector.selected({
          binding: held.binding,
          authority: held.authority,
          confirmation: facts.confirmation,
        });
        if (!isDeepStrictEqual(inputFor(selected, held), held.input))
          return refuse("event_mismatch");
        return withHourAdmission(
          held,
          { requiredBases: selected.bases, priorActivation: "none" },
          (evidence) =>
            createAllocationPreparation(async (scope) => ({ ...scope, evidence })).prepare(
              held,
              run,
            ),
        );
      });
    },
  };
  return {
    ...operations,
    async select(request: SelectionRequest) {
      initialOperator(request);
      const selected = await engine.select(request);
      return selected.status === "selected"
        ? { ...selected, input: inputFor(selected, request) }
        : selected;
    },
  };
}
