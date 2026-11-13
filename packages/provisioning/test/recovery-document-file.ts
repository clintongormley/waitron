import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecoveryDeliveryInput } from "../src/first-setup-recovery-delivery.js";

export async function readRecoveryDocumentFile(
  stateDir: string,
  module: string,
): Promise<RecoveryDeliveryInput> {
  const saved = JSON.parse(
    await readFile(join(stateDir, "flows/setup/documents", `${module}.recovery.json`), "utf8"),
  ) as RecoveryDeliveryInput;
  return {
    module: saved.module,
    stageId: saved.stageId,
    inputDigest: saved.inputDigest,
    bindingDigest: saved.bindingDigest,
    documentDigest: saved.documentDigest,
    statement: saved.statement,
  };
}
