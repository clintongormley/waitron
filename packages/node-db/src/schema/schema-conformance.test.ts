// The factory's limits are described in `@waitron/db/testing/schema-conformance.js`. Every check in
// the generated migration is named, and nothing here declares a `unique()`. The factory builds the
// set on the venue handle; which file the tables land in is `../schema.test.ts`'s to pin.
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { NODE_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "node",
  subject: NODE_MIGRATIONS,
  declarations: barrel,
  // False: `node_mode`'s two role columns are plain `label()`s narrowed by `$type`; their named
  // checks hold the values, and `../schema.test.ts` writes through one of them.
  declaresClosedVocabularies: false,
});
