import type { VenueAndNodeHandles } from "@waitron/node-db";
import {
  activateFirstSetup,
  checkedFirstSetupCommit,
  firstSetupProvisionRequest,
  publishCheckedFirstSetup,
  type FirstSetupPublicationDeps,
} from "./first-setup-activation.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { createFirstSetupRuntime } from "./first-setup-runtime.js";
import type { FirstSetupState } from "./first-setup-state.js";
import type { VenueResult } from "./venue-apply.js";
import type { FiscalReadinessResult } from "./fiscal-readiness.js";
import "./errors.js";

export interface FirstSetupCommandDeployment {
  publication(state: FirstSetupState): Promise<{
    digest: string;
    deps: Omit<FirstSetupPublicationDeps, "db" | "node">;
  }>;
  assertReady(state: FirstSetupState): Promise<void>;
  runReadiness?(state: FirstSetupState): Promise<FiscalReadinessResult>;
  provision(
    request: ReturnType<typeof firstSetupProvisionRequest>,
    beforeTransaction: () => Promise<void>,
  ): Promise<unknown>;
  recoverProvision(request: ReturnType<typeof firstSetupProvisionRequest>): Promise<VenueResult>;
}

export async function completeFirstSetupCommand(
  runtime: ReturnType<typeof createFirstSetupRuntime>,
  { venue: db, node }: VenueAndNodeHandles,
  owner: FirstSetupOwnerAttempt,
  deployment: FirstSetupCommandDeployment,
): Promise<VenueResult> {
  return runtime.resolution.withVenueExclusion(() =>
    runtime.coordinator.run(async (hold) => {
      const state = await runtime.owner.authorize(owner);
      runtime.assertSelection(state);
      const publication = await deployment.publication(state);
      const check = (current: FirstSetupState) =>
        checkedFirstSetupCommit(
          runtime,
          { db, recoverProvision: (request) => deployment.recoverProvision(request) },
          current,
        );
      const publish = (
        current: FirstSetupState,
        checked: NonNullable<Awaited<ReturnType<typeof check>>>,
      ) =>
        publishCheckedFirstSetup(
          runtime,
          { ...publication.deps, db, node },
          current,
          checked,
          owner,
          publication.digest,
          hold,
        );
      return activateFirstSetup(
        runtime,
        {
          provision: (beforeTransaction) =>
            deployment.provision(firstSetupProvisionRequest(state), beforeTransaction),
          check,
          assertReady: () => deployment.assertReady(state),
          publish,
        },
        owner,
        publication.digest,
        hold,
      );
    }),
  );
}
