// Every check constraint in `drizzle/0000_baseline.sql` is named, and no declaration here carries a
// `unique()`, so the factory's blind spots for anonymous checks and unnamed constraints reach
// nothing in this set.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "workforce",
  // The database the set's foreign keys resolve in (core's `locations`, `tills`, `nodes`;
  // identity's `persons`), not a migration prerequisite.
  prerequisites: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  subject: WORKFORCE_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
});
