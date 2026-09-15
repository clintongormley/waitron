// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table: a re-exported core table lands in this package's
// snapshot as a duplicate CREATE TABLE that fails at apply time. `schema-ownership.test.ts`
// enforces this.
export { tenantCredentials } from "./tenant-credentials.js";
