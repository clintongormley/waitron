import type { ModuleConfigurationTransfer } from "@waitron/module";
import { AppError } from "@waitron/shared";

/** An imported venue keeps a switched-on Void reason that asks for a note, as the operations
 * keep one (A758 D27). The export writes booleans as 0 and 1. */
function validateAdjustmentsConfiguration(
  tables: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): void {
  const kept = (tables.adjustment_reasons ?? []).some(
    (row) => row.kind === "void" && row.active === 1 && row.note_required === 1,
  );
  if (!kept) throw new AppError("setup.request_invalid", { field: "adjustment_reasons" });
}

export const ADJUSTMENTS_CONFIGURATION_TRANSFER = {
  kind: "tables",
  tables: [{ name: "adjustment_reasons" }, { name: "adjustment_settings" }],
  validate: validateAdjustmentsConfiguration,
} as const satisfies ModuleConfigurationTransfer;
