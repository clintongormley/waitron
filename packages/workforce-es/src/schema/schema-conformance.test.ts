// The WORKFORCE_ES migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where its limits are described.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { WORKFORCE_ES_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "workforce-es",
  prerequisites: [CORE_MIGRATIONS],
  subject: WORKFORCE_ES_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
});
