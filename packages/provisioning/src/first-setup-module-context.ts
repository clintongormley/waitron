import { AppError } from "@waitron/shared";
import type { InitialSetupContext } from "@waitron/module";
import type { FirstSetupState } from "./first-setup-state.js";
import "./errors.js";
function refuse(): never {
  throw new AppError("sif.allocation_invalid", { reason: "outside_confirmation_missing" });
}
export function firstSetupModuleContext(
  state: Pick<FirstSetupState, "frozen">,
  name: string,
): InitialSetupContext {
  const frozen = state.frozen;
  const module = frozen.modules.find((entry) => entry.module === name);
  if (module === undefined) refuse();
  return {
    attemptId: frozen.attemptId,
    binding: {
      module: name,
      action: "setup",
      eventId: module.eventId,
      sourceId: frozen.sourceId,
      targetNodeId: frozen.nodeId,
    },
    administratorId: frozen.administratorId,
    country: frozen.request.country,
    taxId: frozen.request.taxId,
    environment: frozen.environment,
    recipientVenueId: frozen.sourceId,
    bases: [
      { code: frozen.request.seriesCode, purpose: "standard" },
      { code: frozen.request.fullSeriesCode ?? "FF", purpose: "full" },
      { code: frozen.request.rectificativeSeriesCode, purpose: "rectificative" },
    ],
    request: module.request,
  };
}
