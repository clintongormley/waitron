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
export * from "./print-agents.js";
export * from "./printers.js";
export * from "./print-jobs.js";
export * from "./catalogue.js";
export * from "./recipes.js";
export * from "./purchase-invoices.js";
export * from "./layouts.js";
export * from "./table-service-statuses.js";
export * from "./working-order-counters.js";
export * from "./sales.js";
export * from "./sale-voids.js";
export * from "./daily-closes.js";
export * from "./incidents.js";
// deployment.js is deliberately NOT re-exported here — see its own file for why.
