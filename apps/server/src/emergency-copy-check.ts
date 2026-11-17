import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { decodeSettingsRow, VENUE_SETTINGS, type DeploymentEnvironment } from "@waitron/db";
import {
  servingPrimaryNodeId,
  verifyMembershipDocument,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { checkHandoverCopy, type WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { NODE_FILE, openBackupQuery, WAL_SUFFIX, type BackupQuery } from "@waitron/store";
import { parseGenerationName } from "@waitron/stream";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import { checkCopyIntegrity } from "./handover-integrity.js";
import { isReadableChart } from "./membership-trust.js";
import { assertVenueCopyNotAhead } from "./spare-copy.js";
import "./errors.js";

async function fileSha256(path: string, signal: AbortSignal | undefined): Promise<string> {
  const hash = createHash("sha256");
  try {
    await pipeline(createReadStream(path), hash, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  return hash.digest("hex");
}

async function firstRow(query: BackupQuery, text: string, values: readonly string[] = []) {
  for await (const row of query.rows(text, values)) return row;
  return undefined;
}

/**
 * Whether the venue database Cloud placed at `venuePath` is the copy `binding` names and can become
 * a machine of its own. Every read is through read-only connections, so the file is never changed.
 */
export async function checkPlacedEmergencyCopy(deps: {
  binding: EmergencyCopyBinding;
  venuePath: string;
  /** This process's. */
  environment: DeploymentEnvironment;
  migrationsRoot: string | null;
  modules: readonly WaitronModule[];
  signal?: AbortSignal;
}): Promise<void> {
  const { binding, venuePath } = deps;
  // Every open below is immutable, so a WAL-mode file gains no `-wal` or `-shm`: safe only because
  // a `-wal` beside the file is refused first, and an immutable open would read past it.
  if (existsSync(`${venuePath}${WAL_SUFFIX}`)) throw new AppError("emergency_copy.wal_present", {});
  if (existsSync(join(dirname(venuePath), NODE_FILE)))
    throw new AppError("emergency_copy.node_db_present", {});
  if ((await fileSha256(venuePath, deps.signal)) !== binding.selectedStream.databaseSha256)
    throw new AppError("emergency_copy.hash_mismatch", {});
  if (!(await checkCopyIntegrity(venuePath, { signal: deps.signal, immutable: true })))
    throw new AppError("emergency_copy.integrity_failed", {});
  await assertVenueCopyNotAhead(venuePath, deps.migrationsRoot, { immutable: true });

  const opened = await openBackupQuery(venuePath, { immutable: true });
  try {
    const { query } = opened;
    const deployed = await firstRow(query, "select environment from deployment where id = 1");
    const copy = deployed === undefined ? null : String(deployed.environment);
    if (copy !== binding.environment || binding.environment !== deps.environment)
      throw new AppError("emergency_copy.environment_mismatch", {
        copy,
        binding: binding.environment,
        process: deps.environment,
      });

    // `readVenueSettings` needs a write-capable Transaction; this is its select, through the
    // read-only reader, decoded by the same function.
    const settingsRow = await firstRow(
      query,
      "select version, revision, doc from settings where module = ?",
      [VENUE_SETTINGS.module],
    );
    const venue = decodeSettingsRow(
      settingsRow === undefined
        ? undefined
        : {
            version: Number(settingsRow.version),
            revision: Number(settingsRow.revision),
            doc: JSON.parse(String(settingsRow.doc)) as Record<string, unknown>,
          },
      VENUE_SETTINGS,
    ).doc;
    if (venue.cloudVenueId !== binding.venueId)
      throw new AppError("emergency_copy.venue_mismatch", {});
    if (venue.streamId !== binding.selectedStream.streamId)
      throw new AppError("emergency_copy.stream_mismatch", {});

    if (parseGenerationName(binding.selectedStream.generation)?.nodeId !== binding.sourceNodeId)
      throw new AppError("emergency_copy.generation_mismatch", {});

    const sourceRow = await firstRow(query, "select id from nodes where id = ?", [
      binding.sourceNodeId,
    ]);
    const chartRow = await firstRow(query, "select document from node_membership where id = 1");
    const chart: unknown = chartRow === undefined ? null : JSON.parse(String(chartRow.document));
    if (
      sourceRow === undefined ||
      !isReadableChart(chart) ||
      servingPrimaryNodeId(chart as SignedMembershipDocument) !== binding.sourceNodeId
    )
      throw new AppError("emergency_copy.source_not_primary", {});

    // Consistency with the copy's own keys, not authenticity: that rests on Cloud's hash.
    const trustSet: Record<string, string> = {};
    for await (const row of query.rows("select id, public_key from nodes"))
      trustSet[String(row.id)] = String(row.public_key);
    if (!verifyMembershipDocument(chart as SignedMembershipDocument, trustSet).valid)
      throw new AppError("emergency_copy.chart_unverified", {});

    if (
      (await firstRow(query, "select id from nodes where id = ?", [binding.copyNodeId])) !==
      undefined
    )
      throw new AppError("emergency_copy.copy_node_known", {});

    const checked = await checkHandoverCopy(deps.modules, query);
    if (!checked.ok) throw new AppError("emergency_copy.chain_broken", { module: checked.module });
  } finally {
    await opened.close();
  }
}
