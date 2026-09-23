// The CORE migration set's instance of the shared schema-conformance suite
// (`../testing/schema-conformance.ts`), which is where the machinery, what it compares and each of
// its limits are described. What is here is what is true of the core set in particular.
//
// The measurement behind the factory's claim that a declared expression and a built one are
// directly comparable as text on this engine: taken 2026-09-22 across all 47 core tables, zero
// differences between the rendered declaration and the stored DDL, for every check constraint and
// every index filter.
//
// The three allowance lists this suite used to carry — foreign keys, indexes and checks the
// migrations created that no declaration held — went with the PostgreSQL catalogue, and NOT because
// anything was given up. They existed because those objects were written by hand in `--custom`
// migrations that drizzle-kit had never diffed. The flip regenerated every set as one baseline, so
// every one of them is a declaration now; measured the same day, comparing each table's declared
// foreign keys, indexes and checks against the catalogue with no allowance at all and finding
// nothing on either side unmatched. A hand-written foreign key, index or named check reappearing in
// a migration fails this suite, which is what an empty allowance list buys. Core's triggers, in its
// hand-written migrations under `drizzle/`, are not declarations either, and the factory does not
// read them.
//
// Three facts about the core set that the factory cannot state for a set it has not seen:
//
//   - Every check in `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so
//     `checksInDdl`'s blindness to an anonymous check reaches nothing here — measured 2026-09-23,
//     every `CHECK(` in that file preceded by one.
//   - No core declaration carries an unnamed `unique()`, the shape `fromDeclaration` refuses.
//   - The hole the vocabulary block exists for was measured 2026-09-22 by removing
//     `locations_order_flow_ck` from the declaration AND from `drizzle/0000_baseline.sql` together:
//     the `locations` table case PASSED, because "declared none, built none" agrees, and only the
//     `locations.order_flow` vocabulary case failed.
import { CORE_MIGRATIONS } from "../migrations.js";
import { describeSchemaConformance } from "../testing/schema-conformance.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "core",
  // No prerequisites: core is the set every other set is applied on top of, so the database it
  // builds holds its tables and nothing else.
  subject: CORE_MIGRATIONS,
  // The barrel alone. `deployment`, `mirror_config` and `node_membership` used to be handed in
  // separately, because a hand-written `--custom` migration created them and they were kept out of
  // it. The flip brought all three into `./index.js`, so listing them again would declare each
  // table twice — a duplicate case per table, and an inventory comparison that never matches.
  declarations: barrel,
  declaresClosedVocabularies: true,
  // The one caller that passes this, because `packages/db` is the one caller with a mutation run
  // to collect it (see the option). Written here, not in the factory, because `./index.js`
  // resolves against the module the specifier is written in.
  reload: () => import("./index.js"),
});
