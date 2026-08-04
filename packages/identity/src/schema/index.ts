// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table. persons imports `tenants` from @waitron/db for a
// foreign key; `tenants` must NEVER be re-exported here or it lands in this package's snapshot as a
// duplicate CREATE TABLE. schema-ownership.test.ts enforces this.
export { persons, personStatus, personRole } from "./persons.js";
