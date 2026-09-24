// The WORKFORCE_ES migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where its limits are described.
//
// Two facts the factory cannot state for a set it has not seen. Both check constraints in
// `drizzle/0000_baseline.sql` are written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. And the one `unique()` this package
// declares, `convenio_config_location_uq`, is named, so the unnamed-constraint refusal reaches
// nothing either.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { WORKFORCE_ES_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "workforce-es",
  // Core alone: the one table here points at its `locations` and at nothing else.
  prerequisites: [CORE_MIGRATIONS],
  subject: WORKFORCE_ES_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
});
