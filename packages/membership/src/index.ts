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

// resolveSignerKey is deliberately NOT re-exported: it is O(n²) over its endorsement list and, unlike
// the document path (capped at MAX_ENDORSEMENTS in verify.ts's isDocument), takes an uncapped list.
// Nothing outside this package needs it — verify.ts imports it directly from ./endorsement.js — so
// keeping it off the Slice-1 public surface avoids handing callers an uncapped entry point.
export { endorseKey } from "./endorsement.js";

export { signDocumentBody, verifyMembershipDocument } from "./verify.js";

export { buildNextMembershipDocument } from "./build.js";

export { acceptMembershipDocument } from "./accept.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel (reachability rule, packages/shared/src/errors.ts).
import "./errors.js";
