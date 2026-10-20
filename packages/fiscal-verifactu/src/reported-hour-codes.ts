import { AppError } from "@waitron/shared";
import { isHourIdentity } from "./hour-identity.js";
import "./errors.js";

export function reportedHourCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256)
    throw new AppError("sif.allocation_invalid", { reason: "installation_codes_invalid" });
  const codes = value.map((code: unknown) =>
    typeof code === "string"
      ? code.trim().toUpperCase().replaceAll("O", "0").replace(/[IL]/g, "1")
      : code,
  );
  if (!codes.every(isHourIdentity))
    throw new AppError("sif.allocation_invalid", { reason: "installation_codes_invalid" });
  return [...new Set(codes)].sort();
}
