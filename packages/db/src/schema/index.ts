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
export * from "./order-prep.js";
export * from "./catalogue.js";
export * from "./working-order-counters.js";
export * from "./sales.js";
export * from "./sale-voids.js";
export * from "./incidents.js";
// deployment.js is deliberately NOT re-exported here — see its own file for why.
