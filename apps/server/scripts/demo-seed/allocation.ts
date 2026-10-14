import { generateKeyPairSync, randomUUID } from "node:crypto";
import { stampDeployment } from "@waitron/db";
import { getCountryPack } from "@waitron/country-packs";
import { createAllocationPreparation, WAITRON_ID_SISTEMA } from "@waitron/fiscal-verifactu";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "@waitron/fiscal-verifactu/src/paper-evidence.js";
import { applyVenue, type VenueAction, type VenueApplyDeps } from "@waitron/provisioning";
import { AppError } from "@waitron/shared";
import { demoSeedEnvironment } from "./seed-sales.js";

export async function applyDeveloperDemoVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
  environment: NodeJS.ProcessEnv = process.env,
) {
  demoSeedEnvironment(environment);
  const taxpayer = actions.find((action) => action.kind === "ensure-tenant");
  const demo = getCountryPack("ES")!.demo!;
  if (
    taxpayer?.country !== "ES" ||
    taxpayer.taxId !== demo.taxId ||
    taxpayer.legalName !== demo.legalName
  )
    throw new AppError("deployment.demo_data_refused", { environment: "preproduction" });
  const initialNodeId = randomUUID();
  const initialAdministratorId = randomUUID();
  const eventId = randomUUID();
  const sourceId = "developer-demo";
  const incidentEvidence = "developer-demo-simulation";
  const bases = actions
    .filter((action) => action.kind === "create-series")
    .map(({ code, purpose }) => ({ code, purpose }));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const trust = enrolPaperCustodian(
    "developer-demo",
    publicPem,
    paperCustodianFingerprint(publicPem),
  )!;
  const allocation = {
    version: 1 as const,
    allocationId: randomUUID(),
    taxpayerNif: taxpayer.taxId,
    softwareId: WAITRON_ID_SISTEMA,
    environment: "preproduction" as const,
    installationIdentity: "S000001",
    series: bases.map(({ code, purpose }) => ({ code: `${code}-S000001`, purpose })),
    source: "initial-paper" as const,
    issuedAt: new Date().toISOString(),
  };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "developer-demo",
      generationId: randomUUID(),
      blockId: randomUUID(),
      packVersion: 1,
      recipientVenueId: "developer-demo",
      allocations: [allocation],
    },
    privatePem,
  );
  const approval = {
    version: 1 as const,
    eventId,
    sourceId,
    targetNodeId: initialNodeId,
    operatorId: initialAdministratorId,
    oldMachineAbsent: true,
    oldMachineOffline: false,
    noParallelRecovery: true,
    confirmedAt: allocation.issuedAt,
    incidentEvidence,
  };
  const consumption = signPaperConsumptionForBlock(
    block,
    allocation.allocationId,
    {
      eventId,
      operatorId: initialAdministratorId,
      sourceId,
      targetNodeId: initialNodeId,
      incidentEvidence,
      consumedAt: approval.confirmedAt,
    },
    privatePem,
  );
  const preparation = createAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: {
      allocationId: allocation.allocationId,
      priorActivation: "none",
      incidentEvidence,
      requiredBases: bases,
      authority: {
        kind: "paper",
        trust,
        recipientVenueId: block.payload.recipientVenueId,
        generationId: block.payload.generationId,
        blockId: block.payload.blockId,
        currentRegisterConfirmed: true,
        consumptionConfirmed: true,
        currentEntryState: "consumed-for-event",
      },
    },
  }));
  await stampDeployment(deps.db, "preproduction");
  return applyVenue(actions, {
    ...deps,
    initialNodeId,
    initialAdministratorId,
    moduleInputs: new Map([
      [
        "fiscal-verifactu",
        {
          eventId,
          sourceId,
          input: {
            allocation: { ...allocation, reservationEvidence: { block, consumption } },
            approval,
          },
        },
      ],
    ]),
    modules: deps.modules.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: preparation } : module,
    ),
  });
}
