// The entire public surface of @waitron/sync — native logical replication only. Re-exports, no logic.
//
// The application outbox (capture triggers, sync_log, the pull/apply loop, per-table enrolment) is
// gone (swap S5); what remains is the native-replication layer: publications, subscriptions, the
// name/LSN helpers, the drain/status readers, and the table classification vocabulary.

// The table-classification vocabulary, re-exported from the leaf `@waitron/sync-enrolment` so existing
// importers of `@waitron/sync` keep resolving these. The composition root assembles every module's
// classification and derives the two publication table-lists from it (`tablesForPublication`).
export { classify, tablesForPublication } from "@waitron/sync-enrolment";
export type { ClassifiedTable, TableClass } from "@waitron/sync-enrolment";

// Native logical replication (swap S2): build and create a node's two publications from the derived
// table lists. Utility DDL, created by the non-superuser table OWNER.
export {
  createPublications,
  createPublicationStatement,
  ensurePublications,
  publicationName,
  setPublicationTablesStatement,
} from "./publications.js";
export type { EnsurePublicationsResult, PublicationClass } from "./publications.js";

// Native logical replication (swap S4): the pure name/LSN helpers — a subscription is named after the
// SUBSCRIBER's node id (C1) and the publisher-side slot carries the same name; `lsnGte` is the pure
// fence-LSN compare the drain watermark uses (Ruling C2).
export { lsnGte, subscriptionName } from "./names.js";

// Native logical replication (swap S4): the publisher-side drain readers (raw facts + the pure
// `isDrained` fence-LSN watermark) and the subscriber-side status readers.
export { isDrained, listSlots, readSlotDrain } from "./drain.js";
export type { SlotDrain, SlotSummary } from "./drain.js";
export { listSubscriptions, readSubscriptionStatus } from "./status.js";
export type { SubscriptionStatus } from "./status.js";

// Native logical replication (swap S2): subscription verbs — create (origin=none, per-direction
// enable/copy_data, spec §2.2), enable/disable, narrow (SET PUBLICATION, the drain window §4.2),
// SKIP (§6), drop; pure statement builders beside each. The conninfo carries the waitron_repl
// password; a create failure throws only a SQLSTATE.
export {
  buildConninfo,
  createSubscription,
  createSubscriptionStatement,
  disableSubscription,
  disableSubscriptionStatement,
  dropReplicationSlot,
  dropSubscription,
  dropSubscriptionDetached,
  dropSubscriptionStatement,
  enableSubscription,
  enableSubscriptionStatement,
  refreshSubscription,
  refreshSubscriptionStatement,
  setSubscriptionPublications,
  setSubscriptionPublicationsStatement,
  skipSubscription,
  skipSubscriptionStatement,
} from "./subscriptions.js";
export type { ReplicationConnection } from "./subscriptions.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel, per the reachability rule in packages/shared/src/errors.ts.
// See errors.reachability.test.ts.
import "./errors.js";
