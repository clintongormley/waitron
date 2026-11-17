import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import {
  deployment,
  nodes,
  readMembershipTrustSetTx,
  readNodeMembershipRow,
  readSettings,
  VENUE_SETTINGS,
  type DeploymentEnvironment,
  type Transaction,
} from "@waitron/db";
import {
  servingPrimaryNodeId,
  verifyMembershipDocument,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { checkHandoverCopy, type WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { openImmutable } from "@waitron/provisioning";
import {
  connectionPair,
  drizzleNodeSqlite,
  JOURNAL_SUFFIX,
  NODE_FILE,
  openBackupQuery,
  WAL_SUFFIX,
} from "@waitron/store";
import type { EmergencyCopyBinding } from "./emergency-copy-binding.js";
import { digestFile } from "./handover-capture.js";
import { checkCopyIntegrity } from "./handover-integrity.js";
import { isReadableChart } from "./membership-trust.js";
import { assertCopyNotAhead } from "./spare-copy.js";
import "./errors.js";

/** `digestFile`'s hash, rejecting a stop with the signal's own reason rather than an `AbortError`. */
async function fileSha256(path: string, signal: AbortSignal | undefined): Promise<string> {
  try {
    return (await digestFile(path, signal)).sha256;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
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
  // a `-wal` or `-journal` beside the file is refused first, and an immutable open would ignore it.
  if ([WAL_SUFFIX, JOURNAL_SUFFIX].some((suffix) => existsSync(`${venuePath}${suffix}`)))
    throw new AppError("emergency_copy.journal_present", {});
  if (existsSync(join(dirname(venuePath), NODE_FILE)))
    throw new AppError("emergency_copy.node_db_present", {});
  if ((await fileSha256(venuePath, deps.signal)) !== binding.selectedStream.databaseSha256)
    throw new AppError("emergency_copy.hash_mismatch", {});
  if (!(await checkCopyIntegrity(venuePath, { signal: deps.signal, immutable: true })))
    throw new AppError("emergency_copy.integrity_failed", {});
  const connection = openImmutable(venuePath);
  try {
    // Only for the type: the readers below select through table objects, which need no schema,
    // and the connection refuses writes.
    const copy = drizzleNodeSqlite(connectionPair(connection, connection), {
      schema: {},
    }) as unknown as Transaction;
    await assertCopyNotAhead(copy, deps.migrationsRoot);
    deps.signal?.throwIfAborted();

    const [deployed] = await copy
      .select({ environment: deployment.environment })
      .from(deployment)
      .where(eq(deployment.id, 1));
    const environment = deployed?.environment ?? null;
    if (environment !== binding.environment || binding.environment !== deps.environment)
      throw new AppError("emergency_copy.environment_mismatch", {
        copy: environment,
        binding: binding.environment,
        process: deps.environment,
      });

    const venue = (await readSettings(copy, VENUE_SETTINGS)).doc;
    if (venue.cloudVenueId !== binding.venueId)
      throw new AppError("emergency_copy.venue_mismatch", {});
    if (venue.streamId !== binding.selectedStream.streamId)
      throw new AppError("emergency_copy.stream_mismatch", {});

    const known = new Set(
      (
        await copy
          .select({ id: nodes.id })
          .from(nodes)
          .where(inArray(nodes.id, [binding.sourceNodeId, binding.copyNodeId]))
      ).map((row) => row.id),
    );
    const chart = (await readNodeMembershipRow(copy))?.document ?? null;
    if (
      !known.has(binding.sourceNodeId) ||
      !isReadableChart(chart) ||
      servingPrimaryNodeId(chart as SignedMembershipDocument) !== binding.sourceNodeId
    )
      throw new AppError("emergency_copy.source_not_primary", {});
    // Consistency with the copy's own keys, not authenticity: that rests on Cloud's hash.
    if (
      !verifyMembershipDocument(
        chart as SignedMembershipDocument,
        await readMembershipTrustSetTx(copy),
      ).valid
    )
      throw new AppError("emergency_copy.chart_unverified", {});
    if (known.has(binding.copyNodeId)) throw new AppError("emergency_copy.copy_node_known", {});
  } finally {
    connection.close();
  }

  const opened = await openBackupQuery(venuePath, { immutable: true });
  try {
    const checked = await checkHandoverCopy(deps.modules, opened.query);
    deps.signal?.throwIfAborted();
    if (!checked.ok) throw new AppError("emergency_copy.chain_broken", { module: checked.module });
  } finally {
    await opened.close();
  }
}
