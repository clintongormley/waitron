import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  activateFirstSetup,
  checkedFirstSetupCommit,
  finishFirstSetup,
  firstSetupProvisionRequest,
  publishCheckedFirstSetup,
  type FirstSetupPublicationDeps,
} from "./first-setup-activation.js";
import type { FirstSetupOwnerAttempt } from "./first-setup-owner.js";
import type { createFirstSetupRuntime } from "./first-setup-runtime.js";
import type { FirstSetupState } from "./first-setup-state.js";
import type { VenueResult } from "./venue-apply.js";
import "./errors.js";

export interface FirstSetupCommandDeployment {
  publication(state: FirstSetupState): Promise<{
    digest: string;
    deps: Omit<FirstSetupPublicationDeps, "db">;
  }>;
  assertReady(state: FirstSetupState): Promise<void>;
  provision(
    request: ReturnType<typeof firstSetupProvisionRequest>,
    beforeTransaction: () => Promise<void>,
  ): Promise<unknown>;
  recoverProvision(request: ReturnType<typeof firstSetupProvisionRequest>): Promise<VenueResult>;
}

export async function completeFirstSetupCommand(
  runtime: ReturnType<typeof createFirstSetupRuntime>,
  db: Database,
  owner: FirstSetupOwnerAttempt,
  deployment: FirstSetupCommandDeployment,
): Promise<VenueResult> {
  return runtime.resolution.withVenueExclusion(() =>
    runtime.coordinator.run(async (hold) => {
      const state = await runtime.owner.authorize(owner);
      runtime.assertSelection(state);
      let publication: Awaited<ReturnType<FirstSetupCommandDeployment["publication"]>>;
      const check = (current: FirstSetupState) =>
        checkedFirstSetupCommit(
          runtime,
          { db, recoverProvision: (request) => deployment.recoverProvision(request) },
          current,
        );
      const publish = (
        current: FirstSetupState,
        checked: NonNullable<Awaited<ReturnType<typeof check>>>,
        beforeComplete?: () => Promise<unknown>,
      ) =>
        publishCheckedFirstSetup(
          runtime,
          { ...publication.deps, db },
          current,
          checked,
          owner,
          publication.digest,
          hold,
          beforeComplete,
        );
      if (["activation-started", "committed", "publication"].includes(state.status))
        return finishFirstSetup(
          runtime,
          { check, publish },
          owner,
          async (current) => {
            publication = await deployment.publication(current);
            return publication.digest;
          },
          hold,
        );
      publication = await deployment.publication(state);
      return activateFirstSetup(
        runtime,
        {
          provision: (beforeTransaction) =>
            deployment.provision(firstSetupProvisionRequest(state), beforeTransaction),
          check,
          assertReady: () => deployment.assertReady(state),
          // Committed retries require password recovery and the exact-Finish audit above.
          confirmCommitted: async () => {
            throw new AppError("setup.attempt_uncertain", {});
          },
          publish,
        },
        owner,
        publication.digest,
        hold,
      );
    }),
  );
}
