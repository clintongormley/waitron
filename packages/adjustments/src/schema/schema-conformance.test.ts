import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { ADJUSTMENTS_MIGRATIONS } from "../migrations.js";
import * as declarations from "./index.js";

describeSchemaConformance({
  subjectName: "adjustments",
  prerequisites: [CORE_MIGRATIONS],
  subject: ADJUSTMENTS_MIGRATIONS,
  declarations,
  // `apply_role` and `approver_role` carry the `enumText`/`enumCheck` pair, through identity's
  // `personRole`.
  declaresClosedVocabularies: true,
});
