import type { WaitronModule } from "@waitron/module";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { handoverPromotionContext } from "../handover-preparation.js";
import { createNodeOperationPreparation } from "../node-operation-preparation.js";
import type { PromotionOperationRunner } from "../promote.js";
import type { RecoveryOperationInput } from "../recovery-module-operation.js";
import { TOTP_KEY_RING } from "./authenticator.js";

/** Use the live boot handles when the test calls boot's promotion runner directly. */
export function signedInPromotion(options: {
  stateDir: string;
  venueDir: string;
  modules: readonly WaitronModule[];
  operation: RecoveryOperationInput;
  credentials: { personId: string; password: string };
}): PromotionOperationRunner {
  return (context, consume) => {
    const service = createNodeOperationPreparation({
      stateDir: options.stateDir,
      venueDir: options.venueDir,
      modules: options.modules,
      db: context.db,
      nodeDb: context.nodeDb,
      node: context.node,
      credentialKeyRing: TOTP_KEY_RING,
      coordinator: createFirstSetupCoordinator(),
      environment: {},
    });
    return service.withPromotion(
      options.operation,
      options.credentials,
      handoverPromotionContext({ scenario: "emergency" }),
      (_modules, runner) => runner(context, consume),
    );
  };
}
