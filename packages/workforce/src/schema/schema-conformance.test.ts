// The WORKFORCE migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the workforce set in
// particular.
//
// Two facts the factory cannot state for a set it has not seen. Every check constraint in
// `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. And no declaration in this package carries
// a `unique()` at all, named or otherwise, so the unnamed-constraint refusal reaches nothing
// either.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "workforce",
  // Core and identity, because the set's foreign keys point at core's `locations`, `tills` and
  // `nodes` and at identity's `persons`, so this is the database those keys resolve in. Not because
  // the migration needs them: with an empty list the set still builds and every case still passes
  // (measured 2026-09-23).
  prerequisites: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  subject: WORKFORCE_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
});
