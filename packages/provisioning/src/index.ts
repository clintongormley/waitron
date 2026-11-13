export { runCli } from "./cli.js";
export type { CliDeps } from "./cli.js";
export { generatePassword, quoteIdent } from "./identifiers.js";
export { newBreakGlassKeyName } from "./server-key-name.js";
export { generateKeyRing, runKeyring } from "./keyring-command.js";
export type { GeneratedKeyRing } from "./keyring-command.js";
export type { ProvisioningIo } from "./io.js";
export { planVenue, describeVenueAction, VENUE_FIELDS } from "./venue-plan.js";
export type { AdoptResult, VenueRequest, VenueAction } from "./venue-plan.js";
export { applyVenue } from "./venue-apply.js";
export { throwawayApplyInput } from "./throwaway-allocation.js";
export type { ThrowawayApplyInput } from "./throwaway-allocation.js";
export { parseInitialVenueInput, initialVenueApplyInput } from "./initial-venue-input.js";
export type { InitialVenueInput } from "./initial-venue-input.js";
export { renameTaxpayer } from "./taxpayer-name.js";
export {
  privacyContactChecked,
  readPrivacyContact,
  savePrivacyContact,
  type PrivacyContact,
} from "./privacy-contact.js";
export type { InitialModuleInput, VenueApplyDeps, VenueResult } from "./venue-apply.js";
export { FISCAL_TERRITORIES, resolveFiscalModules } from "./fiscal-modules.js";
export {
  readModulePreparationHistory,
  mergeModulePreparationRevisions,
  modulePreparationMergeFits,
  readModulePreparationRevisions,
} from "./module-preparation-state.js";
export { createRecoveryPreparationHost } from "./recovery-preparation-host.js";
export type { FiscalModules } from "./fiscal-modules.js";
export { venueFiscalSelection } from "./venue-fiscal.js";
export type { VenueFiscalSelection } from "./venue-fiscal.js";
export {
  assertNoForeignTenant,
  assertNoOperationalVenue,
  assertOperationalVenue,
  hasOperationalVenue,
  readTenantIdentities,
} from "./tenant-guard.js";
export type { TenantIdentity } from "./tenant-guard.js";
// `findAheadSets` stays internal. `unknownHashes` is for a journal read from a file no store opens.
export { assertNotAhead, unknownHashes } from "./schema-ahead.js";
export type { AheadSet } from "./schema-ahead.js";
import "./errors.js";
export {
  FIRST_SETUP_HOST_FILES,
  isFirstSetupHostPath,
  createFirstSetupCoordinator,
  createFirstSetupStore,
  parseState as parseFirstSetupState,
  assertOtherSetupAllowed,
  assertOtherFirstSetupAllowed,
  assertVenueFirstSetupAllowed,
  inspectFirstSetupMarker,
} from "./first-setup-state.js";
export { readDurableHostJson, writeDurableHostJson } from "./durable-host-json.js";
export type {
  FirstSetupCoordinator,
  FirstSetupHold,
  FirstSetupStore,
  FirstSetupState,
  FirstSetupFrozen,
  FirstSetupChange,
  FirstSetupMarker,
} from "./first-setup-state.js";
export {
  canonicalFirstSetupDirectory,
  canonicalFirstSetupRoots,
} from "./first-setup-directories.js";
export type { RegisterAnswer, FirstSetupOriginal } from "./first-setup-directories.js";
export { createSetupPreparationHost } from "./setup-preparation-host.js";
export { publicFirstSetupState, createFirstSetupOwner } from "./first-setup-owner.js";
export type {
  FirstSetupClaimPayload,
  FirstSetupOwnerAttempt,
  ReconfirmationPurpose,
  PublicFirstSetupState,
} from "./first-setup-owner.js";
export { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";
export type {
  FirstSetupRoots,
  FirstSetupArtifact,
  FirstSetupInspection,
} from "./first-setup-resolution-inspection.js";
export { firstSetupDatabaseIsEmpty } from "./first-setup-empty-database.js";
export {
  executeTarget,
  openImmutable,
  openImmutableWhenWalEmpty,
  openWalInPlace,
} from "./read-only-database.js";
export type { ImmutableOpen } from "./read-only-database.js";
export { createSetupOperationStore } from "./setup-operation.js";
export type {
  SetupOperationKind,
  SetupOperationPhase,
  SetupOperationState,
  ActiveSetupOperation,
  SetupOperationStore,
} from "./setup-operation.js";
export { passwordThrottleBucket, createPasswordThrottle } from "./password-throttle.js";
export type { PasswordThrottle, PasswordThrottleProbe } from "./password-throttle.js";
export { inTurn, keysInTurn } from "./attempt-turns.js";
export {
  failedAtFolderSync,
  mkdirDurable,
  stagedPath,
  stageFileDurable,
  syncFolderHolding,
  syncNewFolders,
  writeFileDurable,
} from "./fs-atomic.js";

export { createModuleOperationHost, createFirstSetupRuntime } from "./first-setup-runtime.js";
export type { PreparationAuthority } from "./first-setup-preparation.js";
export { prepareFirstSetupCommand } from "./first-setup-command.js";
export { completeFirstSetupCommand } from "./first-setup-command-activation.js";
export { createFirstSetupCommandDeployment } from "./first-setup-command-deployment.js";
export { firstSetupModuleContext } from "./first-setup-module-context.js";

export {
  createFirstSetupNodeKeys,
  firstSetupFrozenDigest,
  readFirstSetupStagedKey,
  type StagedNodeKey,
} from "./first-setup-node-key.js";
export { firstFiscalPublicDigest, firstFiscalPublicJson } from "./first-setup-public-digest.js";
export {
  createFirstSetupRecoveryDelivery,
  readFirstSetupRecoveryDeliverySnapshot,
  type RecoveryDeliveryReference,
  type RecoveryDeliveryInput,
  type RecoveryKeptInput,
} from "./first-setup-recovery-delivery.js";

export {
  activateFirstSetup,
  publishCheckedFirstSetup,
  checkedFirstSetupCommit,
  firstSetupProvisionRequest,
} from "./first-setup-activation.js";
export type {
  CheckedFirstSetupCommit,
  FirstSetupActivationHost,
  FirstSetupActivationDeps,
  FirstSetupPublicationDeps,
} from "./first-setup-activation.js";

export { recoverProvisionedVenue } from "./recover-provisioned-venue.js";

export { firstSetupPublicationDigest } from "./first-setup-publication-digest.js";

export { parseEmailSettings } from "./email-settings.js";

export { createFiscalReadinessStore, fiscalReadinessBinding } from "./fiscal-readiness.js";
export { fiscalReadinessInput } from "./fiscal-readiness-input.js";
export type {
  FiscalReadinessInput,
  FiscalTestStatus,
  FiscalTestResult,
  FiscalReadinessResult,
} from "./fiscal-readiness.js";

export { submitFiscalReadiness, fiscalReadinessDatabaseKey } from "./fiscal-readiness-runner.js";

export * from "./configuration-import.js";
export * from "./configuration-transfer.js";
export * from "./artifact-cipher.js";
export * from "./backup-archive.js";
export * from "./scrypt-kdf.js";
export * from "./kitchen-timing.js";
export {
  isCanonicalInstant,
  startAgainSummary,
  type StartAgainSummary,
} from "./first-setup-start-again-summary.js";
export {
  START_AGAIN_MARKER_FILE,
  START_AGAIN_MARKER_LIMIT,
  assertNoStartAgainDeletion,
  assertStartAgainAllowedOnDisk,
  clearStartAgainMarker,
  deleteMarkedAttempt,
  finishStartAgainDeletion,
  markerSize,
  readStartAgainMarker,
  startAgainMarkerFor,
  writeStartAgainMarker,
  type StartAgainMarker,
} from "./first-setup-start-again-deletion.js";
export { START_AGAIN_SET_ASIDE_DIR } from "./first-setup-start-again-names.js";
export {
  BACKUP_ROOM_NOTE_FILE,
  BACKUP_ROOM_START_DELETED_FILE,
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
} from "@waitron/store";
export { isBackupRoomFileName } from "./backup-room-note-file.js";
export { deleteBackupRoomNote } from "./backup-room-note-file.js";
export {
  START_AGAIN_CHOICES_DIR,
  assertStartAgainNotKept,
  startAgainChoiceStem,
  readStartAgainChoices,
  writeStartAgainChoice,
  type StartAgainChoiceRecord,
} from "./first-setup-start-again-choice.js";
export { chooseStartAgainLeftovers, rootRelativePath } from "./first-setup-start-again-choose.js";
export { errnoOf } from "./errno.js";
export {
  START_AGAIN_FORGIVE_MS,
  START_AGAIN_FREE_GUESSES,
  START_AGAIN_GUESSES_FILE,
  START_AGAIN_MAX_WAIT_MS,
  beginStartAgainGuess,
  startAgainWaitMs,
} from "./first-setup-start-again-guesses.js";
export {
  START_AGAIN_ENTRY_LIMIT,
  classifyStartAgainRefusal,
  surveyStartAgainLeftovers,
  type StartAgainEntry,
  type StartAgainSurvey,
  type StartAgainUnit,
} from "./first-setup-start-again-leftovers.js";
export {
  moveStartAgainUnits,
  prepareSetAside,
  recordedStartAgainMove,
  resumeStartAgainSetAside,
  setAsideDestinations,
  setAsideFolderPaths,
  type SetAsideIo,
} from "./first-setup-start-again-set-aside.js";
export {
  beginEnvironmentMove,
  resumeEnvironmentMove,
  finishEnvironmentMove,
} from "./environment-recovery-move.js";

export { readRestoreFlowPhase, type RestoreFlowPhase } from "./restore-flow-phase.js";

export {
  STARTER_PROFILE_NAMES,
  STARTER_JOB_ROLE_NAMES,
  DEMO_JOB_ROLE_NAMES,
} from "./starter-content.js";

export {
  readSetupFlowRecord,
  updateSetupFlowSection,
  type SetupFlowRecord,
  type SetupFlowSection,
} from "./setup-flow-record.js";
