// The Drizzle snapshot is built from THIS file's exports. Every name is written out explicitly —
// never `export *`, and never a core table. The schema files import core tables (`tenants`,
// `locations`, `tills`) to declare foreign keys; those must NEVER be re-exported, or they land in
// this package's snapshot as duplicate CREATE TABLEs that fail at apply time.
// `schema-ownership.test.ts` enforces this. persons (+ personStatus, personRole) is an EXTERNAL FK
// target now, owned by @waitron/identity — the schema files import it for foreign keys the way they
// import `tenants`/`locations`/`tills`, and it must NOT be re-exported here.
export { employments } from "./employments.js";
export { timeEntries, workforceCorrectionStatus, workforceEntryKind } from "./time-entries.js";
export { workforceChains } from "./workforce-chains.js";
export { rosterVersions, rosterVersionStatus } from "./roster-versions.js";
export { shifts } from "./shifts.js";
export { absences, absenceKind, absenceStatus } from "./absences.js";
export { availability } from "./availability.js";
export { shiftTemplates } from "./shift-templates.js";
export { shiftSwaps, shiftSwapStatus } from "./shift-swaps.js";
