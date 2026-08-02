// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table. persons.ts imports `tenants` to declare a foreign key;
// it must NEVER be re-exported, or it lands in this package's snapshot as a duplicate CREATE TABLE
// that fails at apply time. `schema-ownership.test.ts` enforces this.
export { persons, personStatus, workforceRole } from "./persons.js";
