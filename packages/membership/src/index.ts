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

// resolveSignerKey is deliberately NOT exported: it is quadratic in an uncapped endorsement list,
// which only verify.ts's MAX_ENDORSEMENTS bounds.
export { endorseKey } from "./endorsement.js";

export { isMembershipDocument, signDocumentBody, verifyMembershipDocument } from "./verify.js";

export { buildNextMembershipDocument } from "./build.js";

export { nextStandings, evictNode, withMember } from "./standings.js";

export { standingOf, isFencedStanding, servingPrimaryNodeId, routableServers } from "./fence.js";
export type { RoutableServer } from "./fence.js";

export { acceptMembershipDocument } from "./accept.js";

import "./errors.js";
