// The Drizzle snapshot is built from THIS file's exports, so it names each one and never re-exports
// a core table: one here would land in this set's snapshot as a duplicate CREATE TABLE.
export { handoverActivations, handoverScenario } from "./activations.js";
