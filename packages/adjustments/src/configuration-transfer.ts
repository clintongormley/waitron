import type { ModuleConfigurationTransfer } from "@waitron/module";

export const ADJUSTMENTS_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [{ name: "adjustment_reasons" }],
} as const satisfies ModuleConfigurationTransfer;
