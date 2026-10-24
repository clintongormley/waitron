import type { FirstFiscalHost } from "../src/setup-first-fiscal-api.js";
import type { FirstSetupOwnerAttempt } from "../src/first-setup-owner.js";
import { firstFiscalPublicDigest } from "../src/first-fiscal-delivery.js";

export async function keepHourRecoveryDocument(
  host: FirstFiscalHost,
  owner: FirstSetupOwnerAttempt,
  password: string,
  module = "fiscal-verifactu",
) {
  const state = await host.owner.authorize(owner);
  const staged = await host.keys.stageInitialNodeKey(
    owner,
    await host.owner.reconfirm(owner, password, "block-use"),
  );
  const statement = {
    kind: "waitron-recovery-document",
    version: 1,
    scope: {
      taxpayerNif: state.frozen.request.taxId,
      softwareId: "W1",
      environment: state.frozen.environment,
    },
    taxpayerName: state.frozen.request.legalName,
    venueName: state.frozen.request.location.name,
    createdAt: new Date().toISOString(),
    nodeKey: { nodeId: staged.key.nodeId, name: staged.key.name },
  };
  const ref = {
    module,
    stageId: staged.stage.stageId,
    inputDigest: firstFiscalPublicDigest(state.inputs[module]),
    bindingDigest: firstFiscalPublicDigest(statement),
    documentDigest: firstFiscalPublicDigest({ syntheticPdf: true, statement }),
  };
  await host.recoveryDelivery.registerRecoveryDocumentDelivery(owner, { ...ref, statement });
  await host.recoveryDelivery.confirmRecoveryDocumentKept(
    owner,
    { ...ref, kept: true },
    await host.owner.reconfirm(owner, password, "activation"),
  );
  return { ...staged, statement, ref };
}
