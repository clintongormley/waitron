import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enabledModules, type ModuleConfig, type WaitronModule } from "@waitron/module";
import { ALL_MODULES } from "@waitron/composition";
import {
  createFirstSetupCoordinator,
  createFirstSetupStore,
  venueFiscalSelection,
  type FirstSetupFrozen,
} from "@waitron/provisioning";
import { FISCAL_INITIAL_SETUP } from "@waitron/fiscal-verifactu/src/initial-setup.js";
import { declaredHistoryBytes } from "@waitron/fiscal-verifactu/src/paper-register-history.js";
import type { DeclaredPaperConfirmation } from "@waitron/fiscal-verifactu/src/declared-paper-evidence.js";
import type { PaperAllocation } from "@waitron/fiscal-verifactu/src/paper-protocol.js";
import type {
  DeclaredRegisterHistory,
  DeclaredReservation,
} from "@waitron/fiscal-verifactu/src/paper-register-protocol.js";
import { createFirstSetupOwner } from "../src/first-setup-owner.js";
import { firstSetupModuleContext } from "../src/first-fiscal-evidence.js";
import { request, PASSWORD, MODULE } from "./first-fiscal.js";
export const publicDigest = (value: unknown) =>
  createHash("sha256").update(declaredHistoryBytes(value)).digest("hex");
export async function declaredFirstFiscalFixture(options?: {
  modules?: readonly WaitronModule[];
  serials?: readonly number[];
  workspace?: { root: string; stateDir: string; venueDir: string };
  moduleConfig?: ModuleConfig;
  extendHistory?(
    history: DeclaredRegisterHistory,
    context: import("@waitron/module").InitialSetupContext,
  ): DeclaredRegisterHistory;
}) {
  const root = options?.workspace?.root ?? (await mkdtemp(join(tmpdir(), "declared-delivery-")));
  try {
    const stateDir = options?.workspace?.stateDir ?? join(root, "state"),
      venueDir = options?.workspace?.venueDir ?? join(root, "venue"),
      coordinator = createFirstSetupCoordinator();
    const store = createFirstSetupStore({ stateDir, venueDir, coordinator });
    const modules =
      options?.modules ??
      ALL_MODULES.filter((m) => ["core", MODULE, "fiscal-none"].includes(m.name));
    const selectedModules = enabledModules(
      modules,
      venueFiscalSelection(modules, "ES-common", options?.moduleConfig).config,
    );
    const ownerOptions = {
      stateDir,
      store,
      coordinator,
      bootId: "boot-1",
      freeze: async (
        venue: FirstSetupFrozen["request"],
        environment: FirstSetupFrozen["environment"],
        ids: Pick<FirstSetupFrozen, "attemptId" | "nodeId" | "administratorId">,
      ) => ({
        ...ids,
        sourceId: `first-setup:${ids.attemptId}`,
        environment,
        request: venue,
        modules: selectedModules.map((m) => ({
          module: m.name,
          version: m.version,
          eventId: randomUUID(),
          request: null,
        })),
      }),
    };
    const owner = createFirstSetupOwner(ownerOptions),
      nonce = randomBytes(32).toString("base64url");
    const claim = await owner.claimFirstSetup({ environment: "production", request }, nonce);
    let state = (await store.read())!;
    let context = firstSetupModuleContext(state, MODULE);
    const selected = FISCAL_INITIAL_SETUP.candidates(context, { serials: options?.serials ?? [1] });
    state = await store.update(state.frozen.attemptId, state.revision, {
      kind: "candidates",
      module: MODULE,
      request: FISCAL_INITIAL_SETUP.request(context, selected),
    });
    state = await store.update(state.frozen.attemptId, state.revision, {
      kind: "consumption-intent",
    });
    context = firstSetupModuleContext(state, MODULE);
    const allocation = (context.request as { candidates: PaperAllocation[] }).candidates[0]!;
    const time = "2026-10-16T00:00:00.000Z";
    const reservation: DeclaredReservation = {
      kind: "reserve",
      allocation,
      recipientVenueId: context.recipientVenueId,
      binding: context.binding,
      reservedAt: time,
    };
    const consumption = {
      kind: "consume" as const,
      allocationId: allocation.allocationId,
      reservationDigest: publicDigest(reservation),
      eventId: context.binding.eventId,
      operatorId: context.administratorId,
      sourceId: context.binding.sourceId,
      targetNodeId: context.binding.targetNodeId,
      incidentEvidence: "public/delivery",
      consumedAt: time,
    };
    const scope = {
      taxpayerNif: context.taxId,
      softwareId: "W1",
      environment: context.environment,
    };
    let history: DeclaredRegisterHistory = {
      format: "waitron-paper-register",
      version: 2,
      integrity: "owner-declared",
      scope,
      registerId: "delivery-register",
      mode: "complete",
      originals: [],
      revisions: [
        {
          version: 2,
          registerId: "delivery-register",
          scope,
          revision: "1",
          previousDigest: "0".repeat(64),
          createdAt: time,
          sHighWater: options?.serials?.[0] ?? 1,
          pHighWater: 0,
          events: [reservation, consumption],
        },
      ],
    };
    history = options?.extendHistory?.(history, context) ?? history;
    const input = {
      allocation: {
        ...allocation,
        reservationEvidence: {
          kind: "paper-declared-evidence",
          version: 2,
          historyDigest: publicDigest(history),
          reservation,
          consumption,
          reservationDigest: publicDigest(reservation),
          consumptionDigest: publicDigest(consumption),
        },
      },
      approval: {
        version: 1 as const,
        eventId: context.binding.eventId,
        operatorId: context.administratorId,
        sourceId: context.binding.sourceId,
        targetNodeId: context.binding.targetNodeId,
        oldMachineAbsent: true,
        oldMachineOffline: false,
        noParallelRecovery: true,
        confirmedAt: time,
        incidentEvidence: consumption.incidentEvidence,
      },
    };
    state = await store.update(state.frozen.attemptId, state.revision, {
      kind: "import",
      module: MODULE,
      input,
    });
    const statement: DeclaredPaperConfirmation = {
      kind: "paper-declared-confirmation",
      version: 2,
      binding: context.binding,
      operatorId: context.administratorId,
      input,
      history,
      known: {
        scope,
        sHighWater: 0,
        pHighWater: 0,
        sBurnFloor: 0,
        pBurnFloor: 0,
        currentHead: null,
        retainedHeads: [],
        originals: [],
        retiredBindings: [],
      },
      current: {
        currentRegisterConfirmed: true,
        noParallelPaperAllocation: true,
        confirmedAt: time,
      },
      recipientVenueId: context.recipientVenueId,
      requiredBases: context.bases,
      priorActivation: "none",
      phase: "activate",
      delivery: {
        kept: true,
        documentDigest: "a".repeat(64),
        historyDigest: publicDigest(history),
      },
    };
    return {
      root,
      stateDir,
      venueDir,
      coordinator,
      store,
      owner,
      ownerOptions,
      nonce,
      context,
      input,
      statement,
      modules,
      ...(options?.moduleConfig === undefined ? {} : { moduleConfig: options.moduleConfig }),
      bootId: "boot-1",
      ownerAttempt: {
        attemptId: state.frozen.attemptId,
        revision: state.revision,
        ownerGeneration: state.ownerGeneration,
        capability: claim.capability,
      },
      password: PASSWORD,
      module: MODULE,
      dispose: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
