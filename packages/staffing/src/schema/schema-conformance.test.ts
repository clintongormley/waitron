import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { CORE_MIGRATIONS } from "@waitron/db";
import { describeSchemaConformance } from "@waitron/db/testing/schema-conformance.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { STAFFING_MIGRATIONS } from "../migrations.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "staffing",
  prerequisites: [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    WORKFORCE_MIGRATIONS,
  ],
  subject: STAFFING_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
});
