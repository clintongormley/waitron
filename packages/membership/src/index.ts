// The entire public surface of @waitron/membership. Re-exports only — no logic here.
export type {
  NodeStanding,
  MembershipNode,
  MembershipDocumentBody,
  Endorsement,
  SignedMembershipDocument,
  NodeKeyPair,
  TrustSet,
  VerifyFailure,
  VerifyResult,
  AcceptResult,
} from "./types.js";

export { canonicalize } from "./canonicalize.js";
export type { CanonicalValue } from "./canonicalize.js";

export { generateNodeKeyPair, signBytes, verifyBytes } from "./crypto.js";

export { endorseKey, resolveSignerKey } from "./endorsement.js";

export { signDocumentBody, verifyMembershipDocument } from "./verify.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel (reachability rule, packages/shared/src/errors.ts).
import "./errors.js";
