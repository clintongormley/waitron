// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table. `convenio-config.ts` imports core `tenants`/`locations`
// to declare foreign keys; those must NEVER be re-exported, or they land in this package's snapshot
// as duplicate CREATE TABLEs that fail at apply time. `schema-ownership.test.ts` enforces this.
export { convenioConfig, overtimeModel } from "./convenio-config.js";
