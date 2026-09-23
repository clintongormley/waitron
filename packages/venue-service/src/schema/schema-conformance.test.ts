// The VENUE-SERVICE migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the venue-service set in
// particular.
//
// Two facts the factory cannot state for a set it has not seen. Every check constraint in
// `drizzle/0000_baseline.sql` is written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. And both `unique()` declarations in
// `service.ts` are given names, so the unnamed-constraint refusal reaches nothing either.
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { VENUE_SERVICE_MIGRATIONS } from "../migrations.js";
// The set's one schema file, which is also what `drizzle.config.ts` generates from; the package
// has no `src/schema/index.ts` barrel.
import * as declarations from "./service.js";

describeSchemaConformance({
  subjectName: "venue-service",
  // Core, then catalogue: `drizzle/0000_baseline.sql` has foreign keys into core's `locations`,
  // `floor_zones`, `devices`, `catalogues`, `categories`, `products`, `kitchen_stations`,
  // `working_orders` and `working_order_lines`, and into catalogue's `menu_items`. It creates no
  // trigger. It is the list this package's own database suites apply, `src/migrations.test.ts`
  // among them; `src/routes.test.ts` adds identity after this set, which no table here references.
  prerequisites: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS],
  subject: VENUE_SERVICE_MIGRATIONS,
  declarations,
  // False: every value-set text column here — `default_service_mode`, both `service_mode`s,
  // `hardware_unit` and `vat_class` — is a plain `label()` beside its own hand-written check, not
  // the `enumText`/`enumCheck` pair; `service.ts` says why above `departments.default_service_mode`.
  declaresClosedVocabularies: false,
});
