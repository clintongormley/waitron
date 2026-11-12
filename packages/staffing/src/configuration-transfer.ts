import type { ModuleConfigurationTransfer } from "@waitron/module";

export const STAFFING_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [{ name: "staffing_days" }, { name: "staffing_blocks" }],
} as const satisfies ModuleConfigurationTransfer;
