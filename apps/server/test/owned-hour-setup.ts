import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import type { InitialVenueInput, VenueRequest } from "@waitron/provisioning";
import type { PublicFirstSetupState } from "../src/first-setup-owner.js";
import { firstFiscalPublicDigest } from "../src/first-fiscal-delivery.js";

export async function ownedHourSetup(
  transport: typeof fetch,
  base: string,
  venue: unknown,
  password: string,
  claim: { configurationImport: true; newTaxpayer: boolean } | undefined = undefined,
) {
  let owner: { state: PublicFirstSetupState; capability: string } | undefined;
  const headers = () => ({
    "Content-Type": "application/json",
    ...(owner === undefined
      ? {}
      : {
          "X-Waitron-Setup-Owner": owner.capability,
          "X-Waitron-Setup-Attempt": owner.state.attemptId,
          "X-Waitron-Setup-Revision": String(owner.state.revision),
          "X-Waitron-Setup-Generation": String(owner.state.ownerGeneration),
        }),
  });
  const send = async (path: string, body?: unknown) => {
    const response = await transport(`${base}/setup-api/first-setup/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = (await response.json()) as {
      state?: PublicFirstSetupState;
      capability?: string;
      reconfirmation: string;
      preparation: { id: string };
      modules: {
        module: string;
        request: {
          input: {
            approval: { eventId: string; sourceId: string };
            allocation: { installationIdentity: string };
          };
        };
      }[];
    };
    expect(response.status, JSON.stringify(value)).toBe(200);
    if (value.state)
      owner = { state: value.state, capability: value.capability ?? owner!.capability };
    return value;
  };
  await send("claim", {
    venue,
    clientClaimNonce: randomBytes(32).toString("base64url"),
    ...claim,
  });
  const module = "fiscal-verifactu";
  const challenge = await send("preparation", { module, proposal: { action: "clock-challenge" } });
  await send("preparation", {
    module,
    proposal: {
      action: "compare-clocks",
      browser: { challengeId: challenge.preparation.id, instantMs: Date.now() },
    },
  });
  const grant = await send("reconfirm", { password, purpose: "block-use" });
  await send("candidates", {
    module,
    proposal: { answer: "no" },
    reconfirmation: grant.reconfirmation,
  });
  const prepared = (await send("request")).modules.find((entry) => entry.module === module)!.request
    .input;
  const initialOperations: InitialVenueInput = {
    nodeId: owner!.state.nodeId,
    administratorId: owner!.state.administratorId,
    inputs: [
      {
        module,
        eventId: prepared.approval.eventId,
        sourceId: prepared.approval.sourceId,
        input: prepared,
      },
    ],
  };
  await send("input", { module, input: prepared });
  const staged = (await send("node-key", {
    reconfirmation: (await send("reconfirm", { password, purpose: "block-use" })).reconfirmation,
  })) as unknown as {
    stage: { stageId: string; nodeId: string; name: string };
    key: { nodeId: string; name: string; secret: string };
  };
  const request = venue as VenueRequest;
  const statement = {
    kind: "waitron-recovery-document",
    installationCodes: [prepared.allocation.installationIdentity],
    version: 1,
    scope: { taxpayerNif: request.taxId, softwareId: "W1", environment: owner!.state.environment },
    taxpayerName: request.legalName,
    venueName: request.location.name,
    createdAt: new Date().toISOString(),
    nodeKey: { nodeId: staged.stage.nodeId, name: staged.stage.name },
  };
  const ref = {
    module,
    stageId: staged.stage.stageId,
    inputDigest: firstFiscalPublicDigest(prepared),
    bindingDigest: firstFiscalPublicDigest(statement),
    documentDigest: firstFiscalPublicDigest({ syntheticPdf: true, statement }),
  };
  await send("recovery-document", { ...ref, statement });
  await send("recovery-document-kept", {
    ...ref,
    kept: true,
    reconfirmation: (await send("reconfirm", { password, purpose: "activation" })).reconfirmation,
  });
  return {
    initialOperations,
    headers: headers(),
    state: owner!.state,
    recovery: { ...staged, statement, ref },
  };
}
