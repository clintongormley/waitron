export {
  insertHandoverActivationTx,
  readActivationRows,
  readHandoverActivation,
} from "./activations.js";
export type { HandoverActivation, HandoverActivationRow } from "./activations.js";
export { HANDOVER_BACKUP_VERIFICATION } from "./backup-verification.js";
export { HANDOVER_CLASSIFICATION } from "./classification.js";
export {
  HANDOVER_KINDS,
  envelopeDigest,
  isSha256Hex,
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
} from "./envelope.js";
export { bindingFingerprint, isOperationId, parseBinding, refuseRequest } from "./binding.js";
export type { HandoverBinding, HandoverScenario } from "./binding.js";
export { assembleIndicator, signIndicator } from "./indicator.js";
export { parseIndicator } from "./indicator-parse.js";
export type {
  FinalStateFacts,
  FinalStateIndicator,
  ModuleEntry,
  SchemaEntry,
} from "./indicator.js";
export { NODE_LOCAL_MANIFEST } from "./manifest.js";
export { HANDOVER_MIGRATIONS } from "./migrations.js";
export { handoverActivations, handoverScenario } from "./schema/index.js";
export type { NodeLocalItem, NodeLocalManifestRow, RetainedRevision } from "./manifest.js";
export {
  ACTIVATED_OR_LATER,
  BEFORE_ACTIVATION,
  HANDOVER_STATES,
  READY_TO_PROMOTE,
  initialState,
  isOpen,
  nextState,
} from "./states.js";
export type { HandoverRole, HandoverState } from "./states.js";
export type {
  HandoverKind,
  HandoverPurpose,
  SignedHandoverEnvelope,
  VerifyEnvelopeResult,
} from "./envelope.js";

import "./errors.js";
