// The MEDIA migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the media set in particular.
//
// Trigger behaviour is covered separately by `../image-references.test.ts`.
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { MEDIA_MIGRATIONS } from "../migrations.js";
// The set's one schema file, which is also what `drizzle.config.ts` generates from; the package
// has no `src/schema/index.ts` barrel.
import * as declarations from "./images.js";

describeSchemaConformance({
  subjectName: "media",
  // Core, then catalogue: `drizzle/0001_image_references.sql` creates triggers ON core's `products`
  // and catalogue's `category_details`; those tables must exist when the triggers are installed.
  prerequisites: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS],
  subject: MEDIA_MIGRATIONS,
  declarations,
  // False: no column in `images.ts` is declared with the `enumText`/`enumCheck` pair.
  declaresClosedVocabularies: false,
});
