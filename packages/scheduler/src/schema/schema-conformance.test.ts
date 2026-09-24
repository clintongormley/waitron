// Every check in `drizzle/0000_baseline.sql` has a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here, and no declaration here carries a
// `unique()`, so neither does the unnamed-constraint refusal.
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { SCHEDULER_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "scheduler",
  // No prerequisites: `drizzle/0000_baseline.sql` names no other set's table.
  subject: SCHEDULER_MIGRATIONS,
  declarations: barrel,
  // False: `state` is a plain `label()` beside its own hand-written check,
  // `scheduled_runs_state_ck`, not the `enumText`/`enumCheck` pair.
  declaresClosedVocabularies: false,
});
