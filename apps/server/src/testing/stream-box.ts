import { parseModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "../modules.js";
import { writeModuleConfig } from "../module-config.js";
// A box provisioned the way a setup boot leaves one, for the in-process scenarios that start a real
// server on it: the stream loop (`stream-loop-scenario.ts`) and the spare join
// (`spare-join-scenario.ts`).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  nodes,
  openVenueDatabase,
  stampDeployment,
  venueLocationId,
  withTransaction,
} from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyAllocatedTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import {
  planVenue,
  type applyVenue as applyMinuteVenue,
  type VenueRequest,
} from "@waitron/provisioning";
import type { WaitronModule } from "@waitron/module";
import type { BucketConfig } from "@waitron/stream";
import { mintBreakGlassSecret } from "../break-glass.js";
import { ensureBoxSecrets } from "../box-secrets.js";
import { formatEnvFile, parseEnvFile } from "../env-file.js";
import { seedTermZeroMembership } from "../membership-seed.js";
import { establishNodeIdentity } from "../node-identity.js";
import { streamSettingsPayload } from "../stream-host.js";
import { copyMigrationsRoot } from "./boot-harness.js";

export interface BoxDirs {
  root: string;
  state: string;
  venue: string;
}

export async function boxDirs(parent: string, name: string): Promise<BoxDirs> {
  const root = join(parent, name);
  const dirs = { root, state: join(root, "state"), venue: join(root, "state", "venue") };
  await mkdir(dirs.venue, { recursive: true });
  return dirs;
}

/** What a box on `dirs` starts with, listening on `port`. */
export function bootEnv(
  dirs: Pick<BoxDirs, "state" | "venue">,
  port: number,
  migrationsRoot: string,
  litestreamBin: string,
): NodeJS.ProcessEnv {
  return {
    WAITRON_STATE_DIR: dirs.state,
    WAITRON_VENUE_DIR: dirs.venue,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_LITESTREAM_BIN: litestreamBin,
  };
}

/** Every migration set copied under `<scratch>/migrations`, as a box's `WAITRON_MIGRATIONS_DIR`. */
export async function copyMigrations(scratch: string): Promise<string> {
  const migrationsRoot = join(scratch, "migrations");
  await copyMigrationsRoot(migrationsRoot);
  return migrationsRoot;
}

export interface StreamBox {
  nodeId: string;
  seriesId: string;
  locationId: string;
  publicKey: string;
  /** The node's break-glass secret. */
  nodeSecret: string;
}

/**
 * Secrets and TLS in the state folder, a migrated and provisioned venue, a node key and a term-0
 * membership document naming `advertisedOrigin`; `modulesJson` supplies its database selection and
 * must agree with `venue`'s modules. With `streaming`, `switchOnStreaming` too.
 */
export async function provisionStreamBox(options: {
  dirs: BoxDirs;
  advertisedOrigin: string;
  streaming?: { bucket: BucketConfig; recoveryKey: string };
  modulesJson: unknown;
  venue: { request: VenueRequest; modules: readonly WaitronModule[] };
  apply?: typeof applyMinuteVenue;
}): Promise<StreamBox> {
  const { dirs } = options;
  const { modules } = options.venue;
  await ensureBoxSecrets({
    stateDir: dirs.state,
    hostnames: ["waitron.local", "localhost"],
    now: () => new Date(),
    listIpv4: () => [],
  });
  const ring = loadKeyRing(parseEnvFile(await readFile(join(dirs.state, "secrets.env"), "utf8")));
  await applyMigrations(dirs.venue, migrationOptionsFor(manifestSets(), null));
  const seeding = await openVenueDatabase(dirs.venue);
  let box: StreamBox;
  try {
    await stampDeployment(seeding.venue, "preproduction");
    const venue = await (options.apply ?? applyAllocatedTestVenue)(
      planVenue(options.venue.request, modules),
      { db: seeding.venue, modules },
    );
    const venueId = await venueLocationId(seeding.venue);
    const nodeSecret = await mintBreakGlassSecret(
      { venue: seeding.venue, node: seeding.node },
      venue.nodeId,
    );
    await establishNodeIdentity({ ownerDb: seeding.venue, node: seeding.node, ring }, venue.nodeId);
    await seedTermZeroMembership(
      { db: seeding.venue, node: seeding.node, ring },
      venue.nodeId,
      options.advertisedOrigin,
    );
    const [row] = await seeding.venue
      .select({ publicKey: nodes.publicKey })
      .from(nodes)
      .where(eq(nodes.id, venue.nodeId));
    box = {
      nodeId: venue.nodeId,
      seriesId: venue.seriesIds[0]!,
      locationId: venueId,
      publicKey: row!.publicKey!,
      nodeSecret,
    };
    await writeModuleConfig(
      seeding.venue,
      parseModuleConfig(options.modulesJson, ALL_MODULES),
      null,
    );
  } finally {
    await seeding.close();
  }
  await writeFile(
    join(dirs.state, "trading.env"),
    formatEnvFile({
      WAITRON_NODE_ID: box.nodeId,
      WAITRON_ENV: "preproduction",
    }),
  );
  if (options.streaming !== undefined)
    await switchOnStreaming(dirs, box.locationId, options.streaming);
  return box;
}

/**
 * Streaming to `bucket` switched on with `recoveryKey`, written into a provisioned box's folders.
 * Only while no server runs on them.
 */
export async function switchOnStreaming(
  dirs: Pick<BoxDirs, "state" | "venue">,
  venueId: string,
  streaming: { bucket: BucketConfig; recoveryKey: string },
): Promise<void> {
  const ring = loadKeyRing(parseEnvFile(await readFile(join(dirs.state, "secrets.env"), "utf8")));
  const store = await openVenueDatabase(dirs.venue);
  try {
    await withTransaction(store.venue, (tx) =>
      putCredential(tx, ring, {
        purpose: "backup.stream",
        value: streamSettingsPayload({ venueId, bucket: streaming.bucket }),
      }),
    );
  } finally {
    await store.close();
  }
  await writeFile(
    join(dirs.state, "backup.env"),
    formatEnvFile({ WAITRON_BACKUP_RECOVERY_KEY: streaming.recoveryKey }),
  );
}
