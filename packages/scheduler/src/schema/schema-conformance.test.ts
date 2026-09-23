// The SCHEDULER migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the scheduler set in
// particular.
//
// Two facts the factory cannot state for a set it has not seen. Every check constraint in
// `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. And no declaration in this package carries
// a `unique()` at all, named or otherwise, so the unnamed-constraint refusal reaches nothing
// either.
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { SCHEDULER_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "scheduler",
  // No prerequisites: `drizzle/0000_baseline.sql` names no other set's table — no foreign key, no
  // trigger — so nothing it builds depends on core. Four of the package's other database suites
  // do need core: their setup calls `seedTenant`, which writes core's `tenants`.
  subject: SCHEDULER_MIGRATIONS,
  declarations: barrel,
  // False: `state` is a plain `label()` beside its own hand-written check,
  // `scheduled_runs_state_ck`, not the `enumText`/`enumCheck` pair; `scheduled-runs.ts` says why.
  declaresClosedVocabularies: false,
});
