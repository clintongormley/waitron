// The CATALOGUE migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the catalogue set in
// particular.
//
// Every check constraint in `drizzle/*.sql` is written with a `CONSTRAINT <name>`
// clause, so `checksInDdl`'s blindness to an anonymous check reaches nothing here.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { CATALOGUE_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "catalogue",
  // Core, because these tables carry foreign keys into its `catalogues`, `categories` and
  // `products`, so this is the database those keys resolve in.
  prerequisites: [CORE_MIGRATIONS],
  subject: CATALOGUE_MIGRATIONS,
  declarations: barrel,
  // True: `sections.role` carries the `enumText`/`enumCheck` pair, through `enumType`.
  // `units.hardware_unit` is a plain `label()` beside a hand-written check, and
  // `src/schema/units.ts` says why.
  declaresClosedVocabularies: true,
});
