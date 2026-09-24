// The CORE migration set's instance of the shared schema-conformance suite
// (`../testing/schema-conformance.ts`), which is where the machinery and its limits are described.
//
// Receipts the factory's header points here for, both taken 2026-09-22 on the core set: every check
// constraint and index filter rendered from its declaration equalled the stored DDL; and comparing
// each table's declared foreign keys, indexes and checks against the built database with no
// allowance list found nothing unmatched on either side.
//
// The three allowance lists this suite used to carry went because the objects they listed were
// written by hand in `--custom` migrations drizzle-kit had never diffed; the flip regenerated every
// set as one baseline, so every one of them is a declaration now.
//
// Two facts about the core set that the factory cannot state for a set it has not seen:
//
//   - Every check in `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so
//     `checksInDdl`'s blindness to an anonymous check reaches nothing here.
//   - Measured 2026-09-22: removing `locations_order_flow_ck` from the declaration AND from
//     `drizzle/0000_baseline.sql` together passed the `locations` table case, because "declared
//     none, built none" agrees; only the `locations.order_flow` vocabulary case failed.
import { CORE_MIGRATIONS } from "../migrations.js";
import { describeSchemaConformance } from "../testing/schema-conformance.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "core",
  // No prerequisites: core is the set every other set is applied on top of.
  subject: CORE_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
  reload: () => import("./index.js"),
});
