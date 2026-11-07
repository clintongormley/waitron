// The factory's blind spot for what an index EXPRESSION says reaches this set:
// `persons_tenant_email_uq`, `persons_tenant_live_display_name_uq` and
// `persons_tenant_pending_email_uq` are each over a folded-key expression, so a declaration and a
// migration that disagree about how a key is folded pass here. Each index's name, uniqueness,
// filter and the position of its expression among its parts are still compared.
import { CORE_MIGRATIONS } from "../migrations.js";
import { describeSchemaConformance } from "../testing/schema-conformance.js";
import * as barrel from "./index.js";

describeSchemaConformance({
  subjectName: "core",
  // No prerequisites: core is the set every other set is applied on top of.
  subject: CORE_MIGRATIONS,
  declarations: barrel,
  declaresClosedVocabularies: true,
  // Media's and credentials' tables declare none: `tenant_credentials.purpose` is a plain
  // `label()`, and `PURPOSES` in `packages/credentials/src/purposes.ts` holds its values.
  tablesWithoutClosedVocabularies: [
    "media_images",
    "media_image_data",
    "media_image_blobs",
    "media_image_edits",
    "tenant_credentials",
  ],
  reload: () => import("./index.js"),
});
