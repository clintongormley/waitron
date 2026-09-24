// Every check constraint in `drizzle/0000_baseline.sql` is named, and so is every `unique()` here,
// so the factory's blind spots for anonymous checks and unnamed constraints reach nothing in this
// set.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "payments",
  // The database the set's foreign keys resolve in (core's `sales`, `nodes`, `devices`,
  // `working_orders`), not a migration prerequisite.
  prerequisites: [CORE_MIGRATIONS],
  subject: PAYMENTS_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
});
