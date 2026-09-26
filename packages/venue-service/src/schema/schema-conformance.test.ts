// Every check constraint in `drizzle/0000_baseline.sql` has a `CONSTRAINT <name>` clause, so
// `checksInDdl`'s blindness to an anonymous check reaches nothing here.
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { VENUE_SERVICE_MIGRATIONS } from "../migrations.js";
import * as declarations from "./index.js";

describeSchemaConformance({
  subjectName: "venue-service",
  // This set has foreign keys into core's tables and into catalogue's `menu_items`.
  prerequisites: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS],
  subject: VENUE_SERVICE_MIGRATIONS,
  declarations,
  // `kitchen_notices.kind` carries the `enumText`/`enumCheck` pair, through `enumType`. The
  // value-set columns in `service.ts` are plain `label()`s beside a hand-written check, and that
  // file says why above `departments.default_service_mode`.
  declaresClosedVocabularies: true,
});
