// Two of the shared suite's limits reach nothing here: every check constraint in
// `drizzle/0000_baseline.sql` has a `CONSTRAINT <name>` clause, and both `unique()` declarations in
// `service.ts` are named.
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { VENUE_SERVICE_MIGRATIONS } from "../migrations.js";
import * as declarations from "./service.js";

describeSchemaConformance({
  subjectName: "venue-service",
  // This set has foreign keys into core's tables and into catalogue's `menu_items`.
  prerequisites: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS],
  subject: VENUE_SERVICE_MIGRATIONS,
  declarations,
  // Every value-set column here is a plain `label()` with a hand-written check; `service.ts` says
  // why above `departments.default_service_mode`.
  declaresClosedVocabularies: false,
});
