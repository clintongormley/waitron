import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { ADJUSTMENTS_MIGRATIONS } from "../migrations.js";
import * as declarations from "./index.js";

describeSchemaConformance({
  subjectName: "adjustments",
  // No prerequisites: `drizzle/0000_baseline.sql` names no other set's table.
  subject: ADJUSTMENTS_MIGRATIONS,
  declarations,
  // `apply_role` and `approver_role` carry the `enumText`/`enumCheck` pair, through identity's
  // `personRole`.
  declaresClosedVocabularies: true,
});
