import "./errors.js";
import { AppError } from "@waitron/shared";

export function assertHourSeriesConfiguration(bases: readonly { purpose: string }[]): void {
  if (
    bases.length !== 3 ||
    !["standard", "full", "rectificative"].every(
      (purpose) => bases.filter((base) => base.purpose === purpose).length === 1,
    )
  )
    throw new AppError("sif.allocation_invalid", { reason: "series_configuration_unsupported" });
}
