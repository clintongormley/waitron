import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import type { InitialVenueInput } from "@waitron/provisioning";
import type { PublicFirstSetupState } from "../src/first-setup-owner.js";

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
        request: { input: { approval: { eventId: string; sourceId: string } } };
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
  return { initialOperations, headers: headers(), state: owner!.state };
}
