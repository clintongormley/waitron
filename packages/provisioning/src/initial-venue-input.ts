import { isUuid } from "@waitron/shared";
import type { InitialModuleInput, VenueApplyDeps } from "./venue-apply.js";

export interface InitialVenueInput {
  readonly nodeId: string;
  readonly administratorId: string;
  readonly inputs: readonly (InitialModuleInput & { readonly module: string })[];
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\p{Cc}/u.test(value)
  );
}

export function parseInitialVenueInput(value: unknown): InitialVenueInput | null {
  if (
    !exact(value, ["nodeId", "administratorId", "inputs"]) ||
    typeof value.nodeId !== "string" ||
    !isUuid(value.nodeId) ||
    typeof value.administratorId !== "string" ||
    !isUuid(value.administratorId) ||
    !Array.isArray(value.inputs) ||
    value.inputs.length === 0
  )
    return null;
  const inputs: (InitialModuleInput & { module: string })[] = [];
  for (const input of value.inputs) {
    if (
      !exact(input, ["module", "eventId", "sourceId", "input"]) ||
      !text(input.module) ||
      !/^[a-z][a-z0-9-]*$/.test(input.module) ||
      !text(input.eventId) ||
      !text(input.sourceId) ||
      inputs.some((other) => other.module === input.module)
    )
      return null;
    try {
      inputs.push({
        module: input.module,
        eventId: input.eventId,
        sourceId: input.sourceId,
        input: structuredClone(input.input),
      });
    } catch {
      return null;
    }
  }
  return {
    nodeId: value.nodeId.toLowerCase(),
    administratorId: value.administratorId.toLowerCase(),
    inputs,
  };
}

export function initialVenueApplyInput(
  input: InitialVenueInput,
): Pick<VenueApplyDeps, "moduleInputs" | "initialNodeId" | "initialAdministratorId"> {
  return {
    initialNodeId: input.nodeId,
    initialAdministratorId: input.administratorId,
    moduleInputs: new Map(input.inputs.map(({ module, ...operation }) => [module, operation])),
  };
}
