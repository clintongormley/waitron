import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LOCAL =
  "this box's own row, in node.db, which is never streamed; keyed by this box's node id";

export const NODE_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("node_mode", "local", LOCAL),
  classify("node_mirror_link", "local", LOCAL),
  classify("node_recovery_key", "local", LOCAL),
  classify("node_signing_key", "local", LOCAL),
  classify("node_primary_key", "local", LOCAL),
];
