import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

const LOCAL =
  "this box's own row, in node.db, which is never streamed; keyed by this box's node id";

const HANDOVER = "this box's own handover record, in node.db, keyed by this box's node id";

export const NODE_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("node_mode", "local", LOCAL),
  classify("node_mirror_link", "local", LOCAL),
  classify("node_recovery_key", "local", LOCAL),
  classify("node_signing_key", "local", LOCAL),
  classify("node_primary_key", "local", LOCAL),
  classify("node_pair_link", "local", LOCAL),
  classify("node_handover_operations", "local", HANDOVER),
  classify("node_handover_events", "local", HANDOVER),
  classify("node_handover_restriction", "local", HANDOVER),
];
