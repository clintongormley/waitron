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
