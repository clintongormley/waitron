import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  type FirstSetupFrozen,
} from "@waitron/provisioning";
import type { InitialSetupContext } from "@waitron/module";
import { ALL_MODULES } from "@waitron/composition";
import { FISCAL_INITIAL_SETUP } from "@waitron/fiscal-verifactu/src/initial-setup.js";
import { validateInitialPaperCandidates } from "@waitron/fiscal-verifactu/src/initial-paper-candidates.js";
import {
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { createFirstSetupOwner } from "../src/first-setup-owner.js";

export const PASSWORD = "SYNTHETIC-owner-password";
export const MODULE = "fiscal-verifactu";
export const request = {
  taxpayerDomicile: "Mayor 1, Madrid",
  country: "ES",
  taxId: "50000000R",
  legalName: "Olivo SL",
  location: {
    name: "Olivo",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Restaurante",
    addressLine1: "Mayor 1",
    addressLine2: null,
    postalCode: "28001",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  },
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: { displayName: "Elena", email: "elena@example.test", password: PASSWORD, pin: "4826" },
};
export async function firstFiscalFixture() {
  const root = await mkdtemp(join(tmpdir(), "first-fiscal-"));
  try {
    const stateDir = join(root, "state");
    const venueDir = join(root, "venue");
    const coordinator = createFirstSetupCoordinator();
    const store = createFirstSetupStore({ stateDir, venueDir, coordinator });
    let context!: InitialSetupContext;
    const ownerOptions = {
      store,
      stateDir,
      coordinator,
      bootId: "boot-1",
      freeze: async (
        venue: FirstSetupFrozen["request"],
        environment: FirstSetupFrozen["environment"],
        ids: Pick<FirstSetupFrozen, "attemptId" | "nodeId" | "administratorId">,
      ) => {
        const sourceId = `first-setup:${ids.attemptId}`;
        context = {
          attemptId: ids.attemptId,
          administratorId: ids.administratorId,
          country: venue.country,
          taxId: venue.taxId,
          environment,
          recipientVenueId: sourceId,
          bases: [
            { code: "A", purpose: "standard" },
            { code: "FF", purpose: "full" },
            { code: "R", purpose: "rectificative" },
          ],
          binding: {
            module: MODULE,
            action: "setup",
            eventId: randomUUID(),
            sourceId,
            targetNodeId: ids.nodeId,
          },
        };
        const selected = validateInitialPaperCandidates(context, [1, 2]);
        context = { ...context, request: FISCAL_INITIAL_SETUP.request(context, selected) };
        return {
          ...ids,
          sourceId,
          environment,
          request: venue,
          modules: [
            {
              module: MODULE,
              version: "0.0.0",
              eventId: context.binding.eventId,
              request: context.request,
            },
          ],
        };
      },
    };
    const owner = createFirstSetupOwner(ownerOptions);
    const nonce = randomBytes(32).toString("base64url");
    const claim = await owner.claimFirstSetup({ environment: "production", request }, nonce);
    const pair = generateKeyPairSync("ed25519");
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const fingerprint = paperCustodianFingerprint(publicKey)!;
    const key = { custodianId: "Elena", publicKey, fingerprint };
    const candidates = (
      context.request as {
        candidates: readonly import("@waitron/fiscal-verifactu/src/paper-protocol.js").PaperAllocation[];
      }
    ).candidates;
    const block = signPaperBlock(
      {
        version: 1,
        custodianId: "Elena",
        generationId: "g1",
        blockId: "b1",
        packVersion: 1,
        recipientVenueId: context.recipientVenueId,
        allocations: candidates,
      },
      privateKey,
    );
    const approval = {
      version: 1 as const,
      eventId: context.binding.eventId,
      operatorId: context.administratorId,
      sourceId: context.binding.sourceId,
      targetNodeId: context.binding.targetNodeId,
      oldMachineAbsent: true,
      oldMachineOffline: false,
      noParallelRecovery: true,
      confirmedAt: "2026-10-15T08:00:00.000Z",
      incidentEvidence: "master/event1",
    };
    const consumption = signPaperConsumptionForBlock(
      block,
      candidates[0]!.allocationId,
      {
        eventId: approval.eventId,
        operatorId: approval.operatorId,
        sourceId: approval.sourceId,
        targetNodeId: approval.targetNodeId,
        incidentEvidence: approval.incidentEvidence,
        consumedAt: approval.confirmedAt,
      },
      privateKey,
    );
    const input = {
      allocation: { ...candidates[0]!, reservationEvidence: { block, consumption } },
      approval,
    };
    const current = {
      version: 1,
      allocationId: candidates[0]!.allocationId,
      binding: context.binding,
      operatorId: context.administratorId,
      priorActivation: "none",
      incidentEvidence: approval.incidentEvidence,
      requiredBases: context.bases,
      recipientVenueId: context.recipientVenueId,
      generationId: "g1",
      blockId: "b1",
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    };
    let state = await store.update(context.attemptId, 1, { kind: "input", module: MODULE, input });
    state = await store.update(context.attemptId, state.revision, { kind: "consumption-intent" });
    return {
      root,
      stateDir,
      venueDir,
      store,
      coordinator,
      owner,
      ownerOptions,
      nonce,
      context,
      input,
      current,
      key,
      ownerAttempt: { ...claim.state, revision: state.revision, capability: claim.capability },
      modules: ALL_MODULES,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
