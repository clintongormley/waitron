// The factory's limits are described in `@waitron/db/testing/schema-conformance.js`. Both checks in
// `drizzle/0000_baseline.sql` are named, so `checksInDdl`'s blindness to an anonymous check reaches
// nothing here; and nothing in this package declares a `unique()`.
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { BOOKINGS_MIGRATIONS } from "../migrations.js";
import * as declarations from "./bookings.js";

describeSchemaConformance({
  subjectName: "bookings",
  // The database the set's foreign keys resolve in (core's `locations`, `dining_tables` and
  // `working_orders`), not something the migration needs: with an empty list every case passes.
  prerequisites: [CORE_MIGRATIONS],
  subject: BOOKINGS_MIGRATIONS,
  declarations,
  // True: `bookings.status` carries the `enumText`/`enumCheck` pair, through `enumType`.
  declaresClosedVocabularies: true,
});
