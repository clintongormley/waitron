import { createErrorBoundary, type Logger } from "@waitron/server-kit";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { JOIN_STATUS } from "./box-join-api.js";

/** A finish saves the clock steps first (`runOperation`); a note this box cannot write is its own
 * fault, so 500. */
const CLOCK_STEP_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.clock_step_unsaved": 500,
};
/**
 * The status of AppError codes the provision, fiscal-test and configuration routes throw inside
 * their error boundaries. A code not listed gets the boundary's default 400.
 */
const PROVISION_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.configuration_outdated": 400,
  "setup.configuration_newer": 400,
  "setup.configuration_parts_differ": 400,
  "setup.configuration_unreadable": 422,
  "setup.request_invalid": 400,
  "setup.certificate_refused": 422,
  "setup.owner_required": 403,
  "setup.connection_insecure": 403,
  "setup.not_ready": 503,
  "setup.provisioning_secret_required": 400,
  "setup.fiscal_test_required": 409,
  // A present-but-malformed `admin.email` (see `parseVenue`).
  "person.email_invalid": 400,
  "cloud.request_unavailable": 409,
  "setup.already_provisioned": 409,
  "provisioning.foreign_taxpayer": 409,
  "provisioning.second_venue": 409,
  "provisioning.taxpayer_identity_mismatch": 409,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
  "deployment.already_stamped": 409,
  // A `provision-only` module (fiscal) is disabled in module settings.
  "module.provision_only_disabled": 409,
  // A configuration export with two categories in one place, or two Active products, sharing a
  // name. Menu authoring uses the same statuses in menu-api-errors.ts.
  "category.name_taken": 409,
  "product.name_taken": 409,
  "recovery.passphrase_invalid": 422,
  "backup.artifact_invalid": 422,
  "backup.archive_invalid": 422,
  "restore.manifest_invalid": 422,
  "restore.archive_resource_limit": 507,
  // An export's image metadata, or its language, the media module refuses; 400, as
  // packages/media/src/routes.ts answers both.
  "image.invalid_metadata": 400,
  "content.language_invalid": 400,
  ...CLOCK_STEP_STATUS,
};
// The tag is a log label for a non-`AppError` fault other than a full disk, never a wire code: the
// client sees `server.internal`.
export const runProvision = createErrorBoundary(PROVISION_STATUS, "setup.provision_failed");
/**
 * The adopt route's contract. `mirror.bundle_fetch_failed` is 502, not a client fault: the main box
 * the join was pointed at failed. `mirror.vault_not_empty` and `mirror.vault_key_differs` are this
 * box's own refusals.
 * The two ring refusals, `credentials.key_invalid` and `credentials.key_ring_version_collision`,
 * are left unlisted (400, the setup screen's generic words): only a faulty main box raises them.
 */
const ADOPT_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.request_invalid": 400,
  "mirror.primary_url_invalid": 400,
  "mirror.bundle_fetch_failed": 502,
  "mirror.vault_not_empty": 409,
  "mirror.vault_key_differs": 409,
  "mirror.environment_mismatch": 409,
  // What this box's own start after joining would refuse.
  "server.config_missing": 409,
  "server.config_invalid": 409,
  "server.unreleased_build": 409,
  "provisioning.second_venue": 409,
  "provisioning.foreign_taxpayer": 409,
  "setup.connection_insecure": 403,
  "setup.owner_required": 403,
  "setup.not_ready": 503,
  "mirror.join_handle_invalid": 409,
  "setup.operation_conflict": 409,
  "setup.already_provisioning": 409,
  "setup.adopt_incomplete": 409,
  "deployment.already_stamped": 409,
  ...CLOCK_STEP_STATUS,
};
export const runAdopt = createErrorBoundary(ADOPT_STATUS, "setup.adopt_failed");
export const runJoin = createErrorBoundary(
  {
    ...JOIN_STATUS,
    "setup.request_invalid": 400,
    "setup.connection_insecure": 403,
    "setup.owner_required": 403,
    "mirror.primary_url_invalid": 400,
    "mirror.bundle_fetch_failed": 502,
    "setup.already_provisioning": 409,
    "setup.adopt_incomplete": 409,
    "mirror.join_waiting": 409,
    "mirror.join_in_use": 409,
  },
  "mirror.join_failed",
);
const RESET_STATUS: Record<string, ContentfulStatusCode> = {
  "setup.connection_insecure": 403,
  "setup.owner_required": 403,
  "setup.reset_unavailable": 409,
  "setup.operation_conflict": 409,
};
export const runReset = createErrorBoundary(RESET_STATUS, "setup.reset_failed");
const ARCHIVE_RESTORE_STATUS: Record<string, ContentfulStatusCode> = {
  ...PROVISION_STATUS,
  "restore.environment_mismatch": 409,
  "restore.schema_too_new": 409,
  "provisioning.database_ahead": 409,
  "restore.stream_source_live": 409,
  "restore.stream_source_unchecked": 409,
  "restore.archive_incomplete": 422,
  "restore.unexpected_entry": 422,
  "restore.unsafe_entry_path": 422,
  "restore.identity_incomplete": 422,
  "restore.drive_file_unreadable": 409,
  // The 503 cloud-api.ts and cloud-locked-start.ts already give this code, not this file's 502.
  "cloud.unavailable": 503,
};
/**
 * The bucket rebuild's own refusals, beside the shared ones. The bucket or Litestream failing is
 * this box's upstream failing (502, as `mirror.bundle_fetch_failed` is for adopt).
 */
export const BUCKET_RESTORE_STATUS: Record<string, ContentfulStatusCode> = {
  ...ARCHIVE_RESTORE_STATUS,
  "restore.stream_folder_required": 409,
  "restore.stream_copy_changed": 409,
  "restore.stream_pointer_missing": 422,
  "restore.stream_pointer_unverified": 422,
  "backup.stream_pointer_invalid": 422,
  "restore.stream_integrity_failed": 422,
  "restore.stream_state_missing": 422,
  "restore.stream_venue_unconfirmed": 409,
  "backup.stream_request_failed": 502,
  "backup.stream_restore_failed": 502,
  "restore.stream_disk_full": 507,
};
export const runRestore = createErrorBoundary(ARCHIVE_RESTORE_STATUS, "setup.restore_failed");
export const runBucketRestore = createErrorBoundary(BUCKET_RESTORE_STATUS, "setup.restore_failed");
export const runConfiguration = createErrorBoundary(
  PROVISION_STATUS,
  "setup.configuration_import_failed",
);
/** A structured error response mirroring the error boundary's `{ error: { code, params } }` shape,
 * for a refusal a handler returns rather than throws. */
export function directError(
  c: Context,
  log: Logger,
  code: "setup.not_ready" | "setup.already_provisioning" | "node.reset",
  httpStatus: ContentfulStatusCode,
  level: "warn" | "debug" = "warn",
): Response {
  log(level, code, {});
  return c.json({ error: { code, params: {} } }, httpStatus);
}
