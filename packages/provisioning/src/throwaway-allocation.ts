import { randomUUID } from "node:crypto";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { InitialModuleInput } from "./venue-apply.js";
import type { VenueAction } from "./venue-plan.js";
import "./errors.js";

export interface ThrowawayApplyInput {
  readonly initialNodeId: string;
  readonly initialAdministratorId: string;
  readonly moduleInputs: ReadonlyMap<string, InitialModuleInput>;
  readonly modules: readonly WaitronModule[];
}

/** The apply inputs for a venue whose one enabled module offering a throwaway allocation makes its
 * own; `undefined` when no enabled module offers one, a refusal when more than one does. The module list returned is a copy in which
 * only that module's `operations` differs. */
export function throwawayApplyInput(
  plan: readonly VenueAction[],
  modules: readonly WaitronModule[],
  environments: readonly ("production" | "preproduction")[],
): ThrowawayApplyInput | undefined {
  const offering = modules.filter((module) => module.provisioning?.throwawayAllocation);
  if (offering.length === 0) return undefined;
  if (offering.length > 1)
    throw new AppError("module.throwaway_allocation_ambiguous", {
      candidates: offering.map((module) => module.name),
    });
  const [seat] = offering as [WaitronModule];
  const taxpayer = plan.find((action) => action.kind === "ensure-tenant");
  if (taxpayer === undefined) throw new AppError("setup.request_invalid", { field: "taxId" });
  const bases = plan.flatMap((action) =>
    action.kind === "create-series" ? [{ code: action.code, purpose: action.purpose }] : [],
  );
  const initialNodeId = randomUUID();
  const initialAdministratorId = randomUUID();
  const { eventId, sourceId, input, operations } = seat.provisioning!.throwawayAllocation!.prepare({
    environments,
    taxpayerNif: taxpayer.taxId,
    bases,
    nodeId: initialNodeId,
    administratorId: initialAdministratorId,
  });
  return {
    initialNodeId,
    initialAdministratorId,
    moduleInputs: new Map([[seat.name, { eventId, sourceId, input }]]),
    modules: modules.map((module) => (module === seat ? { ...module, operations } : module)),
  };
}
