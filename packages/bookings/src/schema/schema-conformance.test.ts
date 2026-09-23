// The BOOKINGS migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the bookings set in particular.
//
// Two facts the factory cannot state for a set it has not seen. Both check constraints in
// `drizzle/0000_baseline.sql` are written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. And no declaration in this package carries
// a `unique()` at all, named or otherwise, so the unnamed-constraint refusal reaches nothing
// either.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { BOOKINGS_MIGRATIONS } from "../migrations.js";
// The set's one schema file, which is also what `drizzle.config.ts` generates from; the package
// has no `src/schema/index.ts` barrel.
import * as declarations from "./bookings.js";

describeSchemaConformance({
  subjectName: "bookings",
  // Core, because `bookings` carries foreign keys into its `locations`, `dining_tables` and
  // `working_orders`, and `drizzle/0000_baseline.sql` names no other set's table and creates no
  // trigger, so this is the database those keys resolve in. Not because the migration needs it:
  // with an empty list the set still builds and every case still passes (measured 2026-09-23). Most
  // of the package's other database suites apply the whole manifest (`src/testing/migrations.ts`).
  prerequisites: [CORE_MIGRATIONS],
  subject: BOOKINGS_MIGRATIONS,
  declarations,
  // True: `bookings.status` carries the `enumText`/`enumCheck` pair, through `enumType`.
  declaresClosedVocabularies: true,
});
