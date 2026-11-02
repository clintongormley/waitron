export {
  HANDOVER_KINDS,
  envelopeDigest,
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
} from "./envelope.js";
export type {
  HandoverKind,
  HandoverPurpose,
  SignedHandoverEnvelope,
  VerifyEnvelopeResult,
} from "./envelope.js";

import "./errors.js";
