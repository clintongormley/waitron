// The factory's limits are described in `@waitron/db/testing/schema-conformance.js`. Every check in
// `drizzle/0000_baseline.sql` is named, so `checksInDdl`'s blindness to an anonymous check reaches
// nothing here; and nothing in this package declares a `unique()`.
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { CREDENTIALS_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "credentials",
  // No prerequisites: `drizzle/0000_baseline.sql` names no other set's table — no foreign key, no
  // trigger. The CODE needs core (`credentialProvisioned` reads `tenants`); the migration does not.
  subject: CREDENTIALS_MIGRATIONS,
  declarations: barrel,
  // False: `purpose` is a plain `label()`. `PURPOSES` in `src/purposes.ts` is the authority on its
  // values, and the column's one check refuses only the empty string.
  declaresClosedVocabularies: false,
});
