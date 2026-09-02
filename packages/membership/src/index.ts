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

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel (reachability rule, packages/shared/src/errors.ts).
import "./errors.js";
