import { AppError, type RecordExportDocument, type RecordExportInput } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { WaitronModule } from "./module.js";
import "./errors.js";

export interface ModuleTimeRecordExport {
  prepare(tx: Transaction, input: RecordExportInput): Promise<() => Promise<RecordExportDocument>>;
}
export function selectTimeRecordExport(
  modules: readonly WaitronModule[],
): ModuleTimeRecordExport | undefined {
  const providers = modules.flatMap((m) =>
    m.timeRecordExport === undefined ? [] : [m.timeRecordExport],
  );
  if (providers.length > 1)
    throw new AppError("module.config_invalid", {
      reason: "multiple time-record export providers",
    });
  return providers[0];
}
