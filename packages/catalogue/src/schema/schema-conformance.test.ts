// The CATALOGUE migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the catalogue set in
// particular.
//
// Two facts the factory cannot state for a set it has not seen. Every check constraint in
// `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. And every `unique()` in this package's
// declarations is given a name, so the unnamed-constraint refusal reaches nothing either.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { CATALOGUE_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "catalogue",
  // Core first: these tables carry foreign keys into its `categories` and `products`. It is the
  // list this package's own database suites apply, `src/migrations.test.ts` among them.
  prerequisites: [CORE_MIGRATIONS],
  subject: CATALOGUE_MIGRATIONS,
  declarations: barrel,
  // False: no column here declares a closed vocabulary — `units.hardware_unit` is a plain
  // `label()` beside a hand-written check, and `src/schema/units.ts` says why.
  declaresClosedVocabularies: false,
});
