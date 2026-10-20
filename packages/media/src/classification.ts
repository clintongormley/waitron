import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

export const MEDIA_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("media_images", "state", "shared image metadata; copied to standbys"),
  classify("media_image_data", "state", "shared image bytes; copied to standbys"),
  classify(
    "media_image_blobs",
    "state",
    "immutable replacement sources shared by photo identities",
  ),
  classify("media_image_edits", "state", "current picture, framing and revision for each photo"),
];
