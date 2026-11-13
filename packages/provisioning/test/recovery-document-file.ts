import { readSetupFlowRecord } from "../src/setup-flow-record.js";
import type { RecoveryDeliveryInput } from "../src/first-setup-recovery-delivery.js";

export async function readRecoveryDocumentFile(
  stateDir: string,
  module: string,
): Promise<RecoveryDeliveryInput> {
  const saved = (await readSetupFlowRecord(stateDir))!.recoveryManifests![
    module
  ] as RecoveryDeliveryInput;
  return {
    module: saved.module,
    stageId: saved.stageId,
    inputDigest: saved.inputDigest,
    bindingDigest: saved.bindingDigest,
    documentDigest: saved.documentDigest,
    statement: saved.statement,
  };
}
