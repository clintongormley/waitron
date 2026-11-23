import "./errors.js";
import { AppError } from "@waitron/shared";
import { seriesPurposes } from "./setup/strings.js";

export function assertHourSeriesConfiguration(bases: readonly { purpose: string }[]): void {
  if (
    bases.length !== seriesPurposes.length ||
    !seriesPurposes.every(
      (purpose) => bases.filter((base) => base.purpose === purpose).length === 1,
    )
  )
    throw new AppError("sif.allocation_invalid", { reason: "series_configuration_unsupported" });
}
