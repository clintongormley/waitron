import { AppError } from "@waitron/shared";
import { policyRowFault } from "./convenio.js";
import "./errors.js";
export const WORKFORCE_ES_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [{ name: "convenio_config" }],
  validate(tables: Readonly<Record<string, readonly Record<string, unknown>[]>>): void {
    for (const row of tables.convenio_config ?? []) {
      const field = policyRowFault(row);
      if (field !== null)
        throw new AppError("setup.request_invalid", { field: `convenio_config.${field}` });
    }
  },
} as const;
