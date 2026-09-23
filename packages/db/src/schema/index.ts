// The schema barrel. Later tasks add series, orders and sales files and
// re-export them here. It exists from Task 2 rather than from the first
// schema task because `Database` is parameterised on it — so every table
// added later widens the type of every existing query for free, with no
// signature in any consumer to update.
export * from "./tenants.js";
export * from "./nodes.js";
export * from "./series.js";
export * from "./orders.js";
export * from "./order-amendments.js";
export * from "./dining-tables.js";
export * from "./floor-zones.js";
export * from "./kitchen-stations.js";
export * from "./kitchen-courses.js";
export * from "./ticket-items.js";
export * from "./devices.js";
export * from "./join-requests.js";
export * from "./print-agents.js";
export * from "./printers.js";
export * from "./print-jobs.js";
export * from "./station-printers.js";
export * from "./drawer-opens.js";
export * from "./catalogue.js";
export * from "./location-catalogues.js";
export * from "./recipes.js";
export * from "./purchase-invoices.js";
export * from "./canvases.js";
export * from "./device-profiles.js";
export * from "./tenant-themes.js";
export * from "./tenant-receipts.js";
export * from "./table-service-statuses.js";
export * from "./working-order-counters.js";
export * from "./sales.js";
export * from "./sale-voids.js";
export * from "./daily-closes.js";
export * from "./incidents.js";
export * from "./change-log.js";
// `deployment`, `mirror_config` and `node_membership` were deliberately NOT re-exported here until
// the SQLite flip. They were created by a hand-written `--custom` migration instead, because
// drizzle-kit had never diffed them into a snapshot and a plain generate would have emitted a
// second CREATE TABLE against databases that already had them. The flip regenerated every set as
// one baseline, which reconciled the snapshot chain — the one thing those files named as the
// precondition for bringing them in — so they are ordinary schema now. Receipt: with them missing
// from this barrel, `scripts/classification-complete.test.ts` reported all three as classified by
// core with no migration creating them.
export * from "./deployment.js";
export * from "./node-roles.js";
export * from "./mirror-config.js";
export * from "./node-membership.js";
