// The MEDIA migration set's instance of the shared schema-conformance suite
// (`@waitron/db/testing/schema-conformance.js`), which is where the machinery, what it compares and
// each of its limits are described. What is here is what is true of the media set in particular.
//
// Three facts the factory cannot state for a set it has not seen. Both check constraints in
// `drizzle/0000_baseline.sql` are written with a `CONSTRAINT <name>` clause, so `checksInDdl`'s
// blindness to an anonymous check reaches nothing here. The one `unique()` declaration in
// `images.ts` is given a name, so the unnamed-constraint refusal reaches nothing either. And the
// factory never reads a trigger, so the eight `drizzle/0001_image_references.sql` creates are
// outside this suite; they stand in for the two foreign keys `products.image` and
// `category_details.image` cannot declare, and their guard is `../image-references.test.ts`.
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
  // and catalogue's `category_details`, and a trigger on a table that does not exist yet is refused
  // when the migration runs. Neither media table has a key into another set.
  prerequisites: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS],
  subject: MEDIA_MIGRATIONS,
  declarations,
  // False: no column in `images.ts` is declared with the `enumText`/`enumCheck` pair.
  declaresClosedVocabularies: false,
});
