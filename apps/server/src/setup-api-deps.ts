import type { KeyRing } from "@waitron/credentials";
import type { DeploymentEnvironment, Database, NodeDatabase } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import type {
  VenueResult,
  SetupOperationStore,
  FirstSetupCoordinator,
  ConfigurationPreview,
  FiscalReadinessResult,
} from "@waitron/provisioning";
import type { Context } from "hono";
import type { AdoptHooks } from "./adopt.js";
import type { JoinedBox, BoxJoinAttempt } from "./box-join-attempt.js";
import type { createCloudRecoveryClient } from "./cloud-recovery.js";
import type { ProvisionRequest } from "./provision.js";
import type { RecoveryBackupPreview } from "./recovery-backup-preview.js";
import type { RecoveryEntryContext } from "./recovery-entry.js";
import type { RecoveryOperationInput } from "./recovery-module-operation.js";
import type { ArchiveRequest } from "./restore-request.js";
import type { ReceiveArchive } from "./setup-archive-upload.js";
import type { SetupCloudSignIn } from "./setup-cloud-sign-in.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type {
  PrepareRecovery,
  StageRecovery,
  DiscardStagedRecovery,
} from "./setup-recovery-preparation-api.js";
import type { sendSmtpTestMessage } from "./smtp-test-message.js";
import type { TradingConfig } from "./trading-config.js";

/** What the owner sends to rebuild this box from their bucket. */
export interface BucketRestoreInput {
  /** The recovery kit's text, as downloaded or pasted. */
  kit: string;
  environment: DeploymentEnvironment;
  /** The owner says the old server is switched off for good. */
  oldBoxGone: boolean;
  /** The tax id of the restored copy the owner confirmed; null until they have seen one. */
  venueConfirmed: string | null;
  recoveryOperation?: RecoveryOperationInput;
  nodeRecoverySecret?: string;
  recoveryContext?: RecoveryEntryContext;
}
/**
 * Everything setup mode needs for an unprovisioned box. Its routes are UNAUTHENTICATED, like
 * `/health`, because no venue is bound yet.
 */
export interface SetupDeps {
  installationOrigin?: "usb";
  cloudSignIn?: SetupCloudSignIn;
  environment: DeploymentEnvironment;
  sendEmailTest?: typeof sendSmtpTestMessage;
  /** Keeps a developer Live walkthrough on preproduction transports after restart. */
  devMode?: boolean;
  /** Plaintext admin secrets never reach it — the provision route hashes them at the boundary. */
  provision?: (
    req: ProvisionRequest,
    beforeTransaction?: () => Promise<void>,
  ) => Promise<VenueResult>;
  /** Reconstructs the one venue committed by this persisted request after a process interruption. */
  recoverProvision?: (req: ProvisionRequest) => Promise<VenueResult>;
  /** Adds the installed sample restaurant after a Demo venue is minted. Prepare and Live never call
   * it. */
  seedDemo?: (result: VenueResult, req: ProvisionRequest) => Promise<void>;
  /** Adopts the main box's bundle that the join attempt holds once approved. */
  adoptJoined?: (joined: JoinedBox, hooks: AdoptHooks) => Promise<void>;
  joinAttempt?: BoxJoinAttempt;
  /** This box's configured origin; provision and Finish joining answer `labelContactUrl` of it,
   * which setup prints on the box's label. */
  advertisedOrigin?: string;
  /** Used to seal the fiscal regime's provisioning secret through its `provisioningSecret.seal`
   * seat. */
  db?: Database;
  node?: NodeDatabase;
  ring?: KeyRing;
  establishIdentity?: (nodeId: string) => Promise<void>;
  /** Mints the venue's term-0 membership document after `establishIdentity` seals the identity key.
   */
  seedMembership?: (nodeId: string) => Promise<void>;
  /** The box's state folder: preparation, demo and a development box's Live setup write backup key
   * 1 of the master key they make into its `backup.env`, and answer `setup.not_ready` without it. */
  stateDir?: string;
  /** Persists `trading.env` so the next boot enters trading mode. */
  persistTrading?: (cfg: TradingConfig) => Promise<void>;
  requestRestart?: () => void;
  /** Notes the clock steps this process made whose note could not be written; throws while one
   * still cannot be. A finish that restarts into the full start calls it first, since the step
   * lives only in this process until it is noted. */
  writeClockSteps?: () => Promise<void>;
  initialiseErrorReports?: (environment: DeploymentEnvironment) => Promise<void>;
  /** The built setup-wizard SPA directory, or `undefined` to serve the inline
   * `SETUP_PLACEHOLDER_HTML` shell instead. */
  setupAppDir?: string;
  /** Persistent first-boot serialization and progress, shared by provision, adoption and recovery. */
  operations?: SetupOperationStore;
  firstFiscal?: FirstFiscalHost;
  firstSetup?: { coordinator: FirstSetupCoordinator; assertOtherAllowed(): Promise<void> };
  receiveArchive?: ReceiveArchive;
  stageRestore?: (request: ArchiveRequest, options: { oldBoxGone: boolean }) => Promise<void>;
  /** `WAITRON_RECOVERY_OPERATION_FILE` as the start reads it; a restore without recovery details
   * is refused when it is unset. */
  recoveryOperationPath?: string;
  prepareRecovery?: PrepareRecovery;
  stageRecovery?: StageRecovery;
  discardStagedRecovery?: DiscardStagedRecovery;
  clearStagedRecovery?: () => Promise<void>;
  /** Whether a request came from a browser on the box itself; tests replace it. */
  requestFromBox?: (c: Context) => boolean;
  previewRestore?: (request: ArchiveRequest) => Promise<RecoveryBackupPreview>;
  previewBucketRestore?: (
    input: Omit<BucketRestoreInput, "venueConfirmed">,
    signal?: AbortSignal,
  ) => Promise<RecoveryBackupPreview>;
  previewCloudRestore?: (pointId: string) => Promise<RecoveryBackupPreview>;
  /** Checks the owner's bucket and stages a rebuild from it for the entrypoint to write after
   * restart. Rejects with the refusal, having staged nothing. */
  stageBucketRestore?: (input: BucketRestoreInput, signal?: AbortSignal) => Promise<void>;
  /** Stages the reset of the adopt `operationId` for the entrypoint to carry out after restart. */
  stageReset?: (operationId: string) => Promise<void>;
  /** Fresh replacement's private Cloud snapshot recovery client. */
  cloudRecovery?: Omit<
    ReturnType<typeof createCloudRecoveryClient>,
    "replacementIdentity" | "replacementApproval" | "preview"
  >;
  /** Validates and stages a configuration export before live provisioning. */
  stageConfiguration?: (
    artifactPath: string,
    passphrase: string,
    signal: AbortSignal,
  ) => Promise<ConfigurationPreview>;
  /** Removes any staged archive after the selected venue and its configuration are durable. */
  clearConfiguration?: () => Promise<void>;
  /** Runs one explicit preproduction submission for the intended live fiscal inputs. */
  runFiscalTest?: (input: {
    request: ProvisionRequest;
    contribution: FiscalContribution;
    secret: unknown;
  }) => Promise<FiscalReadinessResult>;
  /** Refuses first production activation unless matching accepted server evidence exists. */
  assertFiscalReady?: (input: {
    request: ProvisionRequest;
    contribution: FiscalContribution;
    secret: unknown;
  }) => Promise<void>;
}
